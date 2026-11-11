import fs from 'node:fs';
import path from 'node:path';
import type { Client, InValue, ResultSet } from '@libsql/client';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL, avatar_url TEXT, activated INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS auth_sessions (
  token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS oauth_states (
  state TEXT PRIMARY KEY, nonce TEXT NOT NULL, redirect TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL, domain TEXT
);
CREATE TABLE IF NOT EXISTS members (
  workspace_id TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT NOT NULL, status TEXT NOT NULL,
  PRIMARY KEY (workspace_id, user_id)
);
CREATE TABLE IF NOT EXISTS policies (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, name TEXT NOT NULL, is_default INTEGER NOT NULL,
  require_ofac_clear INTEGER NOT NULL, excluded_countries TEXT NOT NULL, disclose_nationality INTEGER NOT NULL,
  name_match TEXT NOT NULL, minimum_age INTEGER
);
CREATE TABLE IF NOT EXISTS meetings (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, title TEXT NOT NULL, meet_url TEXT NOT NULL, policy_id TEXT NOT NULL,
  created_by TEXT NOT NULL, created_at TEXT NOT NULL, status TEXT NOT NULL, bot_status TEXT NOT NULL,
  join_token TEXT NOT NULL UNIQUE, recall_bot_id TEXT
);
CREATE TABLE IF NOT EXISTS participants (
  id TEXT PRIMARY KEY, meeting_id TEXT NOT NULL, external_id TEXT NOT NULL, display_name TEXT NOT NULL, kind TEXT NOT NULL,
  joined_at TEXT NOT NULL, left_at TEXT,
  v_status TEXT NOT NULL DEFAULT 'unverified', v_guest_id TEXT, v_returning INTEGER NOT NULL DEFAULT 0,
  v_verified_at TEXT, v_checks TEXT, v_failure TEXT,
  UNIQUE (meeting_id, external_id)
);
-- One passport maps to only one guest per workspace. On revoke, nullifier_hash is set to NULL (UNIQUE allows multiple NULLs)
CREATE TABLE IF NOT EXISTS guests (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, nullifier_hash TEXT, label TEXT NOT NULL, nationality TEXT,
  first_seen_at TEXT NOT NULL, last_verified_at TEXT NOT NULL, revoked INTEGER NOT NULL DEFAULT 0,
  UNIQUE (workspace_id, nullifier_hash)
);
-- A guest can claim only one participant per meeting
CREATE TABLE IF NOT EXISTS bindings (
  meeting_id TEXT NOT NULL, guest_id TEXT NOT NULL, participant_id TEXT NOT NULL,
  UNIQUE (meeting_id, guest_id)
);
CREATE TABLE IF NOT EXISTS verify_sessions (
  id TEXT PRIMARY KEY, participant_id TEXT NOT NULL, meeting_id TEXT NOT NULL, expires_at TEXT NOT NULL,
  status TEXT NOT NULL, failure_reason TEXT, universal_link TEXT NOT NULL, self_session_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_participants_meeting ON participants (meeting_id);
CREATE INDEX IF NOT EXISTS idx_sessions_participant ON verify_sessions (participant_id);
`;

export type Row = Record<string, any>;

/** What both the database and a transaction handle can do */
export interface Queryable {
  get(sql: string, ...args: any[]): Promise<Row | undefined>;
  all(sql: string, ...args: any[]): Promise<Row[]>;
  run(sql: string, ...args: any[]): Promise<{ changes: number }>;
}

type Exec = (stmt: { sql: string; args: InValue[] }) => Promise<ResultSet>;

const toRows = (rs: ResultSet): Row[] =>
  rs.rows.map((r) => {
    const o: Row = {};
    rs.columns.forEach((c, i) => (o[c] = r[i]));
    return o;
  });
const stmt = (sql: string, args: any[]) => ({ sql, args: args.map((a) => (a === undefined ? null : a)) as InValue[] });

const queryable = (exec: Exec): Queryable => ({
  get: async (sql, ...args) => toRows(await exec(stmt(sql, args)))[0],
  all: async (sql, ...args) => toRows(await exec(stmt(sql, args))),
  run: async (sql, ...args) => ({ changes: (await exec(stmt(sql, args))).rowsAffected }),
});

/**
 * libSQL / Turso client. `url` is `file:<path>` for a local SQLite file, or a remote `libsql://` / `https://` URL.
 * The schema is created once per process: every query awaits the memoized `ready()`.
 */
export class Db implements Queryable {
  private opening: Promise<Client> | null = null;
  private client: Client | null = null;
  private closed = false;
  private readonly local: boolean;
  /** Local files only: writes and transactions run one at a time, because a libsql transaction holds its own connection */
  private lock: Promise<unknown> = Promise.resolve();
  private readonly q: Queryable;

  constructor(private readonly url: string, private readonly authToken?: string) {
    this.local = url.startsWith('file:');
    this.q = queryable(async (s) => (await this.ready()).execute(s));
  }

  ready(): Promise<Client> {
    return (this.opening ??= this.open().catch((e) => {
      this.opening = null; // let the next request retry
      throw e;
    }));
  }

  private async open(): Promise<Client> {
    let client: Client;
    if (this.local) {
      fs.mkdirSync(path.dirname(this.url.slice('file:'.length)), { recursive: true });
      const { createClient } = await import('@libsql/client');
      client = createClient({ url: this.url });
      await client.execute('PRAGMA journal_mode = WAL');
    } else {
      // The HTTP client has no native dependency, which is what a serverless function wants
      const { createClient } = await import('@libsql/client/web');
      client = createClient({ url: this.url, authToken: this.authToken });
    }
    await client.executeMultiple(SCHEMA);
    this.client = client;
    if (this.closed) client.close();
    return client;
  }

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    if (!this.local) return fn();
    const p = this.lock.then(fn, fn);
    this.lock = p.catch(() => {});
    return p;
  }

  get(sql: string, ...args: any[]) {
    return this.q.get(sql, ...args);
  }
  all(sql: string, ...args: any[]) {
    return this.q.all(sql, ...args);
  }
  run(sql: string, ...args: any[]) {
    return this.serial(() => this.q.run(sql, ...args));
  }

  /**
   * Interactive write transaction: commits when fn resolves, rolls back when it throws.
   * Every statement inside fn must go through the handle `t`, never through the Db itself.
   */
  tx<T>(fn: (t: Queryable) => Promise<T>): Promise<T> {
    return this.serial(async () => {
      const tx = await (await this.ready()).transaction('write');
      try {
        const out = await fn(queryable((s) => tx.execute(s)));
        await tx.commit();
        return out;
      } catch (e) {
        await tx.rollback().catch(() => {});
        throw e;
      } finally {
        tx.close();
      }
    });
  }

  close() {
    this.closed = true;
    this.client?.close();
  }
}

export const isUniqueViolation = (e: unknown): boolean => {
  if (!(e instanceof Error)) return false;
  const code = String((e as { code?: unknown }).code ?? '');
  return /UNIQUE constraint failed/i.test(e.message) || code === 'SQLITE_CONSTRAINT_UNIQUE' || code === 'SQLITE_CONSTRAINT_PRIMARYKEY' || isUniqueViolation(e.cause);
};
