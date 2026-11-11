import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect } from 'vitest';
import type { z } from 'zod';
import { ErrorBody, Meeting, Participant, Policy, VerifySession, url, type CreatePolicyBody, type DevCompleteSessionBody } from '@proveback/contract';
import { createApp } from '../src/app';
import { loadConfig, type Config } from '../src/config';

export function makeApp(overrides: Partial<Config> = {}) {
  // Empty env -> all three external services are in fake mode
  // A fresh temp-file database per app: libsql opens a new connection after each transaction, so ':memory:' would lose its data.
  // SSE polling is off by default so the stream tests see exactly the bus events.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'proveback-test-'));
  const ctx = createApp({ ...loadConfig({}), dbPath: path.join(dir, 'test.sqlite'), sessionSecret: 'test-secret', fakeBotDelayMs: 5, ssePollMs: 0, ...overrides });
  return {
    ...ctx,
    close: () => {
      ctx.close();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}
export type Ctx = ReturnType<typeof makeApp>;

export class Client {
  cookie = '';
  constructor(readonly ctx: Ctx) {}

  async raw(method: string, path: string, body?: unknown) {
    const res = await this.ctx.app.request(path, {
      method,
      headers: { ...(this.cookie ? { cookie: this.cookie } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) this.cookie = set.split(';')[0]!;
    return res;
  }
  /** Expect success and validate the response against the contract schema */
  async ok<S extends z.ZodTypeAny>(schema: S, method: string, path: string, body?: unknown): Promise<z.infer<S>> {
    const res = await this.raw(method, path, body);
    const text = await res.text();
    expect(res.status, `${method} ${path} → ${text}`).toBe(200);
    return schema.parse(JSON.parse(text));
  }
  /** Expect failure and validate the error format */
  async fail(status: number, code: string, method: string, path: string, body?: unknown) {
    const res = await this.raw(method, path, body);
    expect(res.status, `${method} ${path}`).toBe(status);
    const err = ErrorBody.parse(await res.json());
    expect(err.error.code).toBe(code);
  }
  async login(email: string, name = email.split('@')[0]!) {
    const res = await this.raw('POST', url('devLogin'), { email, name });
    expect(res.status).toBe(204);
    return this;
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const basePolicy: CreatePolicyBody = {
  name: 'Test policy', isDefault: false, requireOfacClear: true, excludedCountries: ['PRK'], discloseNationality: true, nameMatch: 'warn', minimumAge: null,
};

export const passport = (over: Partial<DevCompleteSessionBody> = {}): DevCompleteSessionBody => ({
  passportId: 'P-001', name: 'SATO KEN', nationality: 'JPN', ofacClear: true, age: 30, ...over,
});

/** Signed-in host + a workspace + a policy + a meeting that already has a bot */
export async function setup(ctx: Ctx, policy: Partial<CreatePolicyBody> = {}) {
  const host = await new Client(ctx).login('alice@acme.com', 'Alice Chen');
  const me = await host.raw('GET', url('me')).then((r) => r.json() as Promise<{ workspaces: { id: string }[] }>);
  const wsId = me.workspaces[0]!.id;
  const pol = await host.ok(Policy, 'POST', url('policies', { wsId }), { ...basePolicy, ...policy });
  const newMeeting = async (title = 'Meeting') => {
    const m = await host.ok(Meeting, 'POST', url('meetings', { wsId }), { title, meetUrl: 'https://meet.google.com/abc-defg-hij', policyId: pol.id });
    await host.ok(Meeting, 'POST', url('meetingBot', { mtgId: m.id }));
    await sleep(30);
    return m;
  };
  const meeting = await newMeeting();
  const join = (mtgId: string, displayName: string, email?: string) =>
    host.ok(Participant, 'POST', url('devJoin', { mtgId }), { displayName, ...(email ? { email } : {}) });
  /** A guest completes one verification; returns the final session status */
  const verify = async (joinToken: string, participantId: string, proof = passport()) => {
    const anon = new Client(ctx);
    const s = await anon.ok(VerifySession, 'POST', url('publicSessions', { joinToken }), { participantId });
    return anon.ok(VerifySession, 'POST', url('devCompleteSession', { sessionId: s.id }), proof);
  };
  return { host, wsId, policy: pol, meeting, newMeeting, join, verify };
}
