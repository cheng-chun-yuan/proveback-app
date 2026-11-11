import crypto from 'node:crypto';
import { Hono, type Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { streamSSE } from 'hono/streaming';
import type { z } from 'zod';
import {
  API_BASE, AddMemberBody, CreateMeetingBody, CreatePolicyBody, CreateSessionBody, CreateWorkspaceBody, DevCompleteSessionBody,
  DevJoinBody, DevLoginBody, UpdateMemberBody, UpdatePolicyBody, paths, webRoutes,
  type DevStatus, type HostEvent, type MeResponse, type PublicEvent, type User,
} from '@proveback/contract';
import { Bus } from './bus';
import { type Config, loadConfig } from './config';
import { createCore, type Proof } from './core';
import { Db, type Row } from './db';
import { googleAuthUrl, googleExchange, normalizeSelfUserId, recallCreateBot, recallLeave, selfOpenVerify, selfVerifyWebhook } from './providers';
import { ApiError, newId, now } from './util';

const COOKIE = 'pb_session';

export function createApp(cfg: Config = loadConfig()) {
  const db = new Db(cfg.databaseUrl ?? `file:${cfg.dbPath}`, cfg.databaseAuthToken ?? undefined);
  const bus = new Bus();
  const core = createCore(cfg, db, bus);
  const app = new Hono();
  const P = (p: string) => API_BASE + p;
  const fake = { google: !cfg.google, recall: !cfg.recall, self: !cfg.self && !cfg.selfOpen };

  app.onError((err, c) => {
    if (err instanceof ApiError) return c.json({ error: { code: err.code, message: err.message } }, err.status as 400);
    console.error('[api]', err);
    return c.json({ error: { code: 'upstream_error', message: 'Internal error' } }, 500);
  });
  app.notFound((c) => c.json({ error: { code: 'not_found', message: 'Not found' } }, 404));

  // ---------- helpers ----------
  async function body<S extends z.ZodTypeAny>(c: Context, schema: S): Promise<z.infer<S>> {
    const parsed = schema.safeParse(await c.req.json().catch(() => undefined));
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new ApiError('validation_failed', issue ? `${issue.path.join('.') || 'body'}: ${issue.message}` : 'Invalid body');
    }
    return parsed.data;
  }
  const param = (c: Context, name: string) => c.req.param(name) ?? '';

  async function requireUser(c: Context): Promise<User> {
    const user = await core.userByToken(getCookie(c, COOKIE));
    if (!user) throw new ApiError('unauthenticated', 'Login required');
    return user;
  }
  /** Must be an active member of the workspace; admin = requires owner or admin */
  async function requireMember(user: User, wsId: string, admin = false): Promise<Row> {
    if (!(await db.get('SELECT 1 AS x FROM workspaces WHERE id = ?', wsId))) throw new ApiError('not_found', 'Workspace not found');
    const m = await db.get("SELECT * FROM members WHERE workspace_id = ? AND user_id = ? AND status = 'active'", wsId, user.id);
    if (!m) throw new ApiError('forbidden', 'Not a member of this workspace');
    if (admin && m.role === 'member') throw new ApiError('forbidden', 'Requires owner or admin');
    return m;
  }
  async function requireMeeting(c: Context): Promise<{ user: User; meeting: Row }> {
    const user = await requireUser(c);
    const meeting = await core.meetingRow(param(c, 'mtgId'));
    if (!meeting) throw new ApiError('not_found', 'Meeting not found');
    await requireMember(user, meeting.workspace_id);
    return { user, meeting };
  }
  async function publicMeetingRow(c: Context): Promise<Row> {
    const m = await core.meetingByToken(param(c, 'joinToken'));
    if (!m) throw new ApiError('not_found', 'Meeting not found');
    return m;
  }
  const setSession = (c: Context, token: string) =>
    setCookie(c, COOKIE, token, { httpOnly: true, sameSite: 'Lax', path: '/', secure: cfg.webUrl.startsWith('https://'), maxAge: 30 * 86400 });
  // Only allow redirects to relative paths within the site
  const safeRedirect = (r: string | undefined) => (r && /^\/(?![/\\])/.test(r) ? r : '/');
  const devOnly = (isFake: boolean) => {
    if (!isFake) throw new ApiError('not_found', 'Not found');
  };

  const HEARTBEAT_MS = 15_000;

  /**
   * SSE. Two sources feed one stream:
   *  - the in-process bus: incremental events for changes made by this instance;
   *  - a poll: every cfg.ssePollMs the channel's snapshot is re-read from the database and, if it differs from the last
   *    state this connection was sent, a fresh `snapshot` event goes out. That is what carries changes made by other
   *    instances. A change that already arrived as a bus event is followed by one redundant snapshot, which is harmless
   *    (the client replaces its state on any snapshot).
   * The stream ends after cfg.sseMaxMs so the browser's EventSource reconnects before the platform cuts the function off.
   */
  function sse<E extends { type: string; data: unknown }>(c: Context, subscribe: (fn: (e: E) => void) => () => void, snapshot: () => Promise<E>) {
    return streamSSE(c, async (stream) => {
      const queue: E[] = [];
      let wake: (() => void) | null = null;
      let closed = false;
      const off = subscribe((e) => {
        queue.push(e);
        wake?.();
      });
      stream.onAbort(() => {
        closed = true;
        off();
        wake?.();
      });
      const started = Date.now();
      let lastWrite = started;
      const send = async (e: E) => {
        await stream.writeSSE({ data: JSON.stringify(e) });
        lastWrite = Date.now();
      };
      try {
        // Subscribe first, then snapshot. An event queued while the snapshot was being read may or may not be in it,
        // so read again until one comes back with nothing queued behind it.
        let snap = await snapshot();
        for (let i = 0; i < 5 && queue.length; i++) {
          queue.length = 0;
          snap = await snapshot();
        }
        let seen = JSON.stringify(snap.data);
        let lastPoll = Date.now();
        await send(snap);

        while (!closed) {
          const t = Date.now();
          if (cfg.sseMaxMs > 0 && t - started >= cfg.sseMaxMs) break;
          if (!queue.length) {
            const waits = [HEARTBEAT_MS - (t - lastWrite)];
            if (cfg.ssePollMs > 0) waits.push(cfg.ssePollMs - (t - lastPoll));
            if (cfg.sseMaxMs > 0) waits.push(cfg.sseMaxMs - (t - started));
            const ms = Math.max(0, Math.min(...waits));
            if (ms > 0) {
              await new Promise<void>((resolve) => {
                const timer = setTimeout(resolve, ms);
                timer.unref();
                wake = () => {
                  clearTimeout(timer);
                  resolve();
                };
              });
              wake = null;
            }
            if (closed) break;
          }
          while (queue.length) await send(queue.shift()!);
          if (cfg.ssePollMs > 0 && Date.now() - lastPoll >= cfg.ssePollMs) {
            const fresh = await snapshot();
            if (closed) break;
            // Events that arrived during the read go out first; the poll is retried on the next turn of the loop
            if (queue.length) continue;
            lastPoll = Date.now();
            const json = JSON.stringify(fresh.data);
            if (json !== seen) {
              seen = json;
              await send(fresh);
            }
          }
          if (Date.now() - lastWrite >= HEARTBEAT_MS) {
            await stream.write(': ping\n\n');
            lastWrite = Date.now();
          }
        }
      } finally {
        off();
      }
    });
  }

  // ---------- 4.1 Sign-in ----------
  app.get(P(paths.authGoogleStart), async (c) => {
    const redirect = safeRedirect(c.req.query('redirect'));
    if (!cfg.google) return c.redirect(`${cfg.webUrl}${webRoutes.devLogin}?redirect=${encodeURIComponent(redirect)}`, 302);
    const state = crypto.randomBytes(16).toString('hex');
    const nonce = crypto.randomBytes(16).toString('hex');
    await db.run('DELETE FROM oauth_states WHERE created_at < ?', new Date(Date.now() - 600_000).toISOString());
    await db.run('INSERT INTO oauth_states (state, nonce, redirect, created_at) VALUES (?, ?, ?, ?)', state, nonce, redirect, now());
    return c.redirect(googleAuthUrl(cfg.google, state, nonce), 302);
  });

  app.get(P(paths.authGoogleCallback), async (c) => {
    if (!cfg.google) throw new ApiError('not_found', 'Not found');
    const st = await db.get('SELECT * FROM oauth_states WHERE state = ?', c.req.query('state') ?? '');
    if (!st || st.created_at < new Date(Date.now() - 600_000).toISOString()) throw new ApiError('validation_failed', 'Invalid or expired login state');
    await db.run('DELETE FROM oauth_states WHERE state = ?', st.state); // single use
    const code = c.req.query('code');
    if (!code) return c.redirect(cfg.webUrl + webRoutes.login, 302); // user cancelled
    const identity = await googleExchange(cfg.google, code, st.nonce);
    setSession(c, (await core.login(identity)).token);
    return c.redirect(cfg.webUrl + st.redirect, 302);
  });

  app.post(P(paths.authLogout), async (c) => {
    await core.logout(getCookie(c, COOKIE));
    deleteCookie(c, COOKIE, { path: '/' });
    return c.body(null, 204);
  });

  app.get(P(paths.me), async (c) => {
    const user = await requireUser(c);
    return c.json({ user, workspaces: await core.workspacesOf(user.id) } satisfies MeResponse);
  });

  // ---------- 4.2 Workspaces and members ----------
  app.post(P(paths.workspaces), async (c) => {
    const user = await requireUser(c);
    return c.json(await core.createWorkspace(user.id, await body(c, CreateWorkspaceBody)));
  });

  app.get(P(paths.workspace), async (c) => {
    const user = await requireUser(c);
    await requireMember(user, param(c, 'wsId'));
    return c.json(core.toWorkspace((await db.get('SELECT * FROM workspaces WHERE id = ?', param(c, 'wsId')))!));
  });

  app.get(P(paths.members), async (c) => {
    await requireMember(await requireUser(c), param(c, 'wsId'));
    return c.json({ items: (await core.memberRows(param(c, 'wsId'))).map(core.toMember) });
  });

  const memberOf = async (wsId: string, userId: string) => (await core.memberRows(wsId)).find((m) => m.user_id === userId);
  const ownerCount = async (wsId: string) => Number((await db.get("SELECT COUNT(*) AS n FROM members WHERE workspace_id = ? AND role = 'owner'", wsId))!.n);

  app.post(P(paths.members), async (c) => {
    const wsId = param(c, 'wsId');
    const me = await requireMember(await requireUser(c), wsId, true);
    const input = await body(c, AddMemberBody);
    if (input.role === 'owner' && me.role !== 'owner') throw new ApiError('forbidden', 'Only an owner can add another owner');
    const email = input.email.toLowerCase();
    let u = await db.get('SELECT * FROM users WHERE email = ?', email);
    if (!u) {
      // Someone who has never signed in: create an inactive user first, with member status invited, which becomes active on first sign-in
      await db.run('INSERT INTO users (id, email, name, activated) VALUES (?, ?, ?, 0) ON CONFLICT (email) DO NOTHING', newId('usr'), email, email);
      u = (await db.get('SELECT * FROM users WHERE email = ?', email))!;
    }
    const r = await db.run(
      'INSERT INTO members (workspace_id, user_id, role, status) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING',
      wsId, u.id, input.role, u.activated ? 'active' : 'invited',
    );
    if (!r.changes) throw new ApiError('conflict', 'Already a member');
    return c.json(core.toMember((await memberOf(wsId, u.id))!));
  });

  app.patch(P(paths.member), async (c) => {
    const wsId = param(c, 'wsId');
    const me = await requireMember(await requireUser(c), wsId, true);
    const { role } = await body(c, UpdateMemberBody);
    const target = await memberOf(wsId, param(c, 'userId'));
    if (!target) throw new ApiError('not_found', 'Member not found');
    if ((target.role === 'owner' || role === 'owner') && me.role !== 'owner') throw new ApiError('forbidden', 'Only an owner can change owner roles');
    if (target.role === 'owner' && role !== 'owner' && (await ownerCount(wsId)) <= 1) throw new ApiError('conflict', 'A workspace needs at least one owner');
    await db.run('UPDATE members SET role = ? WHERE workspace_id = ? AND user_id = ?', role, wsId, target.user_id);
    return c.json(core.toMember((await memberOf(wsId, target.user_id))!));
  });

  app.delete(P(paths.member), async (c) => {
    const wsId = param(c, 'wsId');
    const me = await requireMember(await requireUser(c), wsId, true);
    const target = await memberOf(wsId, param(c, 'userId'));
    if (!target) throw new ApiError('not_found', 'Member not found');
    if (target.role === 'owner' && me.role !== 'owner') throw new ApiError('forbidden', 'Only an owner can remove an owner');
    if (target.role === 'owner' && (await ownerCount(wsId)) <= 1) throw new ApiError('conflict', 'A workspace needs at least one owner');
    await db.run('DELETE FROM members WHERE workspace_id = ? AND user_id = ?', wsId, target.user_id);
    return c.body(null, 204);
  });

  // ---------- 4.3 Verification policies ----------
  app.get(P(paths.policies), async (c) => {
    await requireMember(await requireUser(c), param(c, 'wsId'));
    return c.json({ items: (await db.all('SELECT * FROM policies WHERE workspace_id = ? ORDER BY is_default DESC, rowid', param(c, 'wsId'))).map(core.toPolicy) });
  });

  app.post(P(paths.policies), async (c) => {
    const wsId = param(c, 'wsId');
    await requireMember(await requireUser(c), wsId, true);
    const p = await body(c, CreatePolicyBody);
    const id = newId('pol');
    await db.tx(async (t) => {
      if (p.isDefault) await t.run('UPDATE policies SET is_default = 0 WHERE workspace_id = ?', wsId);
      await t.run(
        'INSERT INTO policies (id, workspace_id, name, is_default, require_ofac_clear, excluded_countries, disclose_nationality, name_match, minimum_age) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        id, wsId, p.name, p.isDefault ? 1 : 0, p.requireOfacClear ? 1 : 0, JSON.stringify(p.excludedCountries), p.discloseNationality ? 1 : 0, p.nameMatch, p.minimumAge,
      );
    });
    return c.json(core.toPolicy((await core.policyRow(id))!));
  });

  async function requirePolicy(c: Context): Promise<Row> {
    const user = await requireUser(c);
    const row = await core.policyRow(param(c, 'policyId'));
    if (!row) throw new ApiError('not_found', 'Policy not found');
    await requireMember(user, row.workspace_id, true);
    return row;
  }

  app.patch(P(paths.policy), async (c) => {
    const row = await requirePolicy(c);
    const patch = await body(c, UpdatePolicyBody);
    if (patch.isDefault === false && row.is_default) throw new ApiError('conflict', 'Make another policy the default instead');
    const next = { ...core.toPolicy(row), ...patch };
    await db.tx(async (t) => {
      if (next.isDefault) await t.run('UPDATE policies SET is_default = 0 WHERE workspace_id = ?', row.workspace_id);
      await t.run(
        'UPDATE policies SET name = ?, is_default = ?, require_ofac_clear = ?, excluded_countries = ?, disclose_nationality = ?, name_match = ?, minimum_age = ? WHERE id = ?',
        next.name, next.isDefault ? 1 : 0, next.requireOfacClear ? 1 : 0, JSON.stringify(next.excludedCountries), next.discloseNationality ? 1 : 0, next.nameMatch, next.minimumAge, row.id,
      );
    });
    return c.json(core.toPolicy((await core.policyRow(row.id))!));
  });

  app.delete(P(paths.policy), async (c) => {
    const row = await requirePolicy(c);
    if (row.is_default) throw new ApiError('conflict', 'The default policy cannot be deleted');
    if (await db.get('SELECT 1 AS x FROM meetings WHERE policy_id = ?', row.id)) throw new ApiError('conflict', 'Policy is used by a meeting');
    await db.run('DELETE FROM policies WHERE id = ?', row.id);
    return c.body(null, 204);
  });

  // ---------- 4.4 Meetings ----------
  app.get(P(paths.meetings), async (c) => {
    await requireMember(await requireUser(c), param(c, 'wsId'));
    return c.json({ items: (await db.all('SELECT * FROM meetings WHERE workspace_id = ? ORDER BY created_at DESC, rowid DESC', param(c, 'wsId'))).map(core.toMeeting) });
  });

  app.post(P(paths.meetings), async (c) => {
    const wsId = param(c, 'wsId');
    const user = await requireUser(c);
    await requireMember(user, wsId);
    const input = await body(c, CreateMeetingBody);
    const policy = await core.policyRow(input.policyId);
    if (!policy || policy.workspace_id !== wsId) throw new ApiError('validation_failed', 'policyId: not a policy of this workspace');
    const id = newId('mtg');
    await db.run(
      "INSERT INTO meetings (id, workspace_id, title, meet_url, policy_id, created_by, created_at, status, bot_status, join_token) VALUES (?, ?, ?, ?, ?, ?, ?, 'scheduled', 'idle', ?)",
      id, wsId, input.title, input.meetUrl, input.policyId, user.id, now(), 'jt_' + crypto.randomBytes(18).toString('base64url'),
    );
    return c.json(core.toMeeting((await core.meetingRow(id))!));
  });

  app.get(P(paths.meeting), async (c) => c.json(await core.meetingDetail((await requireMeeting(c)).meeting.id)));

  app.post(P(paths.meetingBot), async (c) => {
    const { meeting } = await requireMeeting(c);
    if (['joining', 'waiting_room', 'in_meeting'].includes(meeting.bot_status)) throw new ApiError('conflict', 'Bot is already in or joining the meeting');
    if (cfg.recall) {
      try {
        const botId = await recallCreateBot(cfg, { meetingId: meeting.id, meetUrl: meeting.meet_url, joinToken: meeting.join_token });
        await db.run('UPDATE meetings SET recall_bot_id = ? WHERE id = ?', botId, meeting.id);
      } catch (e) {
        await core.setBotStatus(meeting.id, 'error');
        throw e;
      }
      await core.setBotStatus(meeting.id, 'joining');
    } else {
      // Fake mode: after a short delay the bot "joins the meeting"
      await core.setBotStatus(meeting.id, 'joining');
      const join = async () => {
        if ((await core.meetingRow(meeting.id))?.bot_status === 'joining') await core.participantJoined(meeting.id, { externalId: 'bot', name: cfg.botName });
      };
      // Serverless: no timer survives the response, so the bot joins before it is sent
      if (cfg.inlineTimers) await join();
      else core.later(cfg.fakeBotDelayMs, join);
    }
    return c.json(core.toMeeting((await core.meetingRow(meeting.id))!));
  });

  app.delete(P(paths.meetingBot), async (c) => {
    const { meeting } = await requireMeeting(c);
    if (['idle', 'left'].includes(meeting.bot_status)) throw new ApiError('conflict', 'Bot is not in the meeting');
    if (cfg.recall && meeting.recall_bot_id) await recallLeave(cfg, meeting.recall_bot_id).catch((e) => console.error('[recall] leave failed:', e.message));
    await core.setBotStatus(meeting.id, 'left');
    await core.participantLeftByExternalId(meeting.id, 'bot');
    for (const p of await db.all("SELECT * FROM participants WHERE meeting_id = ? AND kind = 'bot' AND left_at IS NULL", meeting.id)) await core.participantLeft(p);
    return c.json(core.toMeeting((await core.meetingRow(meeting.id))!));
  });

  app.post(P(paths.participantReset), async (c) => {
    const { meeting } = await requireMeeting(c);
    const p = await core.participantRow(param(c, 'pid'));
    if (!p || p.meeting_id !== meeting.id) throw new ApiError('not_found', 'Participant not found');
    if (p.kind !== 'guest') throw new ApiError('validation_failed', 'Only guests can be reset');
    return c.json(await core.resetParticipant(p));
  });

  app.get(P(paths.meetingEvents), async (c) => {
    const { meeting } = await requireMeeting(c);
    return sse<HostEvent>(c, (fn) => bus.onHost(meeting.id, fn), async () => ({ type: 'snapshot', meetingId: meeting.id, at: now(), data: await core.meetingDetail(meeting.id) }));
  });

  // ---------- 4.5 Guest roster ----------
  app.get(P(paths.guests), async (c) => {
    await requireMember(await requireUser(c), param(c, 'wsId'));
    return c.json({ items: await core.guests(param(c, 'wsId')) });
  });

  app.delete(P(paths.guest), async (c) => {
    const user = await requireUser(c);
    const g = await db.get('SELECT * FROM guests WHERE id = ?', param(c, 'guestId'));
    if (!g) throw new ApiError('not_found', 'Guest not found');
    await requireMember(user, g.workspace_id, true);
    await core.revokeGuest(g.id);
    return c.body(null, 204);
  });

  // ---------- 4.6 Public endpoints (joinToken / sessionId act as the credential) ----------
  app.get(P(paths.publicMeeting), async (c) => c.json(await core.publicMeeting(await publicMeetingRow(c))));

  app.post(P(paths.publicSessions), async (c) => {
    const m = await publicMeetingRow(c);
    const { participantId } = await body(c, CreateSessionBody);
    return c.json(await core.createSession(m, participantId));
  });

  app.get(P(paths.publicSession), async (c) => c.json(await core.getSession(param(c, 'sessionId'))));

  app.get(P(paths.publicEvents), async (c) => {
    const m = await publicMeetingRow(c);
    return sse<PublicEvent>(c, (fn) => bus.onPublic(m.id, fn), async () => ({ type: 'snapshot', meetingId: m.id, at: now(), data: await core.publicMeeting(m) }));
  });

  // ---------- Dev endpoints (only present when the matching external service is in fake mode) ----------
  app.get(P(paths.devStatus), (c) => {
    devOnly(fake.google || fake.recall || fake.self);
    return c.json({ fake } satisfies DevStatus);
  });

  app.post(P(paths.devLogin), async (c) => {
    devOnly(fake.google);
    const input = await body(c, DevLoginBody);
    setSession(c, (await core.login({ email: input.email, name: input.name, avatarUrl: null })).token);
    return c.body(null, 204);
  });

  app.post(P(paths.devJoin), async (c) => {
    devOnly(fake.recall);
    const { meeting } = await requireMeeting(c);
    const input = await body(c, DevJoinBody);
    return c.json(await core.participantJoined(meeting.id, { externalId: newId('dev'), name: input.displayName, email: input.email }));
  });

  app.post(P(paths.devLeave), async (c) => {
    devOnly(fake.recall);
    const { meeting } = await requireMeeting(c);
    const p = await core.participantRow(param(c, 'pid'));
    if (!p || p.meeting_id !== meeting.id) throw new ApiError('not_found', 'Participant not found');
    await core.participantLeft(p);
    return c.body(null, 204);
  });

  app.post(P(paths.devCompleteSession), async (c) => {
    devOnly(fake.self);
    const input = await body(c, DevCompleteSessionBody);
    return c.json(
      await core.applyProof(param(c, 'sessionId'), {
        valid: true,
        nullifier: `dev:${input.passportId}`,
        name: input.name,
        nationality: input.nationality,
        ofacClear: input.ofacClear,
        age: { kind: 'actual', value: input.age },
      }),
    );
  });

  // ---------- 4.7 Backend-only webhooks (not part of the frontend/backend contract) ----------
  app.post('/webhooks/recall', async (c) => {
    if (!cfg.recall) throw new ApiError('not_found', 'Not found');
    if (!cfg.recall.webhookToken || c.req.query('token') !== cfg.recall.webhookToken) throw new ApiError('unauthenticated', 'Bad webhook token');
    const payload = (await c.req.json().catch(() => ({}))) as Record<string, any>;
    const event = String(payload.event ?? '');
    const data = payload.data ?? {};
    const botId: string | undefined = data.bot?.id ?? data.bot_id;
    const meetingId: string | undefined = data.bot?.metadata?.meetingId;
    const meeting = (meetingId && (await core.meetingRow(meetingId))) || (botId && (await db.get('SELECT * FROM meetings WHERE recall_bot_id = ?', botId)));
    if (!meeting) return c.body(null, 200);

    const participant = data.data?.participant;
    if (event === 'participant_events.join' && participant) {
      await core.participantJoined(meeting.id, { externalId: String(participant.id), name: participant.name || 'Participant', email: participant.email ?? null });
    } else if (event === 'participant_events.leave' && participant) {
      await core.participantLeftByExternalId(meeting.id, String(participant.id));
    } else {
      // Bot status events: the Recall format is untested, so this is a best-effort mapping (both old and new formats)
      const code = event === 'bot.status_change' ? String(data.status?.code ?? '') : event.replace(/^bot\./, '');
      const map: Record<string, 'joining' | 'waiting_room' | 'in_meeting' | 'left' | 'error'> = {
        joining_call: 'joining', in_waiting_room: 'waiting_room', in_call_not_recording: 'in_meeting', in_call_recording: 'in_meeting',
        call_ended: 'left', done: 'left', fatal: 'error',
      };
      const next = map[code];
      if (next) await core.setBotStatus(meeting.id, next);
    }
    return c.body(null, 200);
  });

  // Open SDK: the Self app posts the proof here. The reply format is the one the Self app expects.
  app.post('/webhooks/self-proof', async (c) => {
    if (!cfg.selfOpen) throw new ApiError('not_found', 'Not found');
    const reply = (ok: boolean, reason?: string, status: 200 | 400 = 200) =>
      c.json({ status: ok ? 'success' : 'error', result: ok, ...(reason ? { reason } : {}) }, status);
    const b = await c.req.json().catch(() => null);
    if (!b || !b.attestationId || !b.proof || !b.publicSignals || !b.userContextData) {
      return reply(false, 'Missing attestationId, proof, publicSignals or userContextData', 400);
    }
    let result: Awaited<ReturnType<typeof selfOpenVerify>>;
    try {
      result = await selfOpenVerify(cfg, b, async (id) => (await core.selfOpenSession(id))?.requirements ?? null);
    } catch (e) {
      console.error('[self-open] proof rejected:', (e as Error).message);
      return reply(false, 'The proof could not be verified');
    }
    const found = await core.selfOpenSession(normalizeSelfUserId(result.userData.userIdentifier));
    if (!found) return reply(false, 'This verification link is no longer valid. Scan the code in the meeting again.');
    const d = result.discloseOutput;
    const req = found.requirements;
    const proof: Proof = {
      valid: result.isValidDetails.isValid,
      invalidReason: 'proof_invalid',
      nullifier: d.nullifier ? String(d.nullifier) : null,
      name: d.name ? String(d.name) : null,
      nationality: d.nationality ? String(d.nationality).toUpperCase() : null,
      ofacClear: req.ofac ? result.isValidDetails.isOfacValid : false,
      age: { kind: 'attested', min: req.minimumAge !== null && result.isValidDetails.isMinimumAgeValid ? req.minimumAge : null },
    };
    try {
      await core.applyProof(found.sessionId, proof);
    } catch (e) {
      if (!(e instanceof ApiError)) throw e;
      return reply(false, e.message);
    }
    // A valid proof is acknowledged as received; whether it satisfied the meeting's policy shows on the board and the guest page
    return reply(true);
  });

  app.post('/webhooks/self', async (c) => {
    if (!cfg.self) throw new ApiError('not_found', 'Not found');
    const raw = await c.req.text(); // signature verification needs the raw body
    let event: Awaited<ReturnType<typeof selfVerifyWebhook>>;
    try {
      event = await selfVerifyWebhook(cfg, raw, Object.fromEntries(c.req.raw.headers));
    } catch (e) {
      console.error('[self] webhook rejected:', (e as Error).message);
      throw new ApiError('validation_failed', 'Bad signature');
    }
    if (event.type === 'verification.completed') {
      const a = event.proof_attributes ?? {};
      const proof: Proof = {
        valid: event.status === 'valid',
        invalidReason: event.status === 'expired' ? 'expired' : 'proof_invalid',
        nullifier: event.nullifier ?? null,
        name: typeof a.name === 'string' ? a.name : null,
        nationality: typeof a.nationality === 'string' ? a.nationality.toUpperCase() : null,
        ofacClear: a.ofac === true,
        age: { kind: 'attested', min: typeof a.minimumAge === 'number' ? a.minimumAge : null },
      };
      try {
        await core.applyProof(event.external_uuid, proof);
      } catch (e) {
        if (!(e instanceof ApiError && e.code === 'not_found')) throw e; // Unknown session: still return 200 so Self does not keep retrying
      }
    }
    return c.text('ok', 200);
  });

  return {
    app,
    db,
    core,
    cfg,
    fake,
    close: () => {
      core.stop();
      db.close();
    },
  };
}
