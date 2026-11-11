import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

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

export class Db {
  readonly raw: DatabaseSync;
  constructor(file: string) {
    if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
    this.raw = new DatabaseSync(file);
    this.raw.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
    this.raw.exec(SCHEMA);
  }
  get(sql: string, ...args: any[]): Row | undefined {
    return this.raw.prepare(sql).get(...args) as Row | undefined;
  }
  all(sql: string, ...args: any[]): Row[] {
    return this.raw.prepare(sql).all(...args) as Row[];
  }
  run(sql: string, ...args: any[]) {
    return this.raw.prepare(sql).run(...args);
  }
  /** Synchronous transaction: rolls back if fn throws */
  tx<T>(fn: () => T): T {
    this.raw.exec('BEGIN IMMEDIATE');
    try {
      const out = fn();
      this.raw.exec('COMMIT');
      return out;
    } catch (e) {
      this.raw.exec('ROLLBACK');
      throw e;
    }
  }
  close() {
    if (this.raw.isOpen) this.raw.close();
  }
}

export const isUniqueViolation = (e: unknown) =>
  e instanceof Error && /UNIQUE constraint failed/.test(e.message);
