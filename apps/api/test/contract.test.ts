import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  DevStatus, Guest, HostEvent, Meeting, MeetingDetail, Member, MeResponse, Participant, Policy, PublicEvent, PublicMeeting,
  VerifySession, Workspace, list, url,
} from '@proveback/contract';
import { nameScore } from '../src/util';
import { Client, type Ctx, makeApp, passport, setup, sleep } from './helpers';

let ctx: Ctx;
afterEach(() => ctx?.close());

const participant = async (host: Client, mtgId: string, pid: string) =>
  (await host.ok(MeetingDetail, 'GET', url('meeting', { mtgId }))).participants.find((p) => p.id === pid)!;

describe('Sign-in and workspace', () => {
  it('unauthenticated requests always get 401', async () => {
    ctx = makeApp();
    const anon = new Client(ctx);
    await anon.fail(401, 'unauthenticated', 'GET', url('me'));
    await anon.fail(401, 'unauthenticated', 'GET', url('members', { wsId: 'ws_x' }));
    await anon.fail(401, 'unauthenticated', 'GET', url('meeting', { mtgId: 'mtg_x' }));
  });

  it('fake sign-in: start redirects to the frontend /dev/login and only accepts relative in-site paths', async () => {
    ctx = makeApp();
    const anon = new Client(ctx);
    const res = await anon.raw('GET', url('authGoogleStart') + '?redirect=' + encodeURIComponent('/w/x/meetings'));
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('http://localhost:5173/dev/login?redirect=%2Fw%2Fx%2Fmeetings');
    const evil = await anon.raw('GET', url('authGoogleStart') + '?redirect=' + encodeURIComponent('//evil.example'));
    expect(evil.headers.get('location')).toBe('http://localhost:5173/dev/login?redirect=%2F');
    expect((await anon.raw('GET', url('authGoogleCallback'))).status).toBe(404);
  });

  it('first sign-in creates a personal workspace and default policy; the session is invalid after sign-out', async () => {
    ctx = makeApp();
    const c = await new Client(ctx).login('alice@acme.com', 'Alice Chen');
    const me = await c.ok(MeResponse, 'GET', url('me'));
    expect(me.user.email).toBe('alice@acme.com');
    expect(me.workspaces).toHaveLength(1);
    expect(me.workspaces[0]!.type).toBe('personal');
    const wsId = me.workspaces[0]!.id;
    await c.ok(Workspace, 'GET', url('workspace', { wsId }));
    const pols = await c.ok(list(Policy), 'GET', url('policies', { wsId }));
    expect(pols.items).toHaveLength(1);
    expect(pols.items[0]!.isDefault).toBe(true);
    // Signing in again does not create another workspace
    await c.login('alice@acme.com', 'Alice Chen');
    expect((await c.ok(MeResponse, 'GET', url('me'))).workspaces).toHaveLength(1);
    expect((await c.raw('POST', url('authLogout'))).status).toBe(204);
    await c.fail(401, 'unauthenticated', 'GET', url('me'));
  });

  it('create a company workspace, invite members, roles and permissions', async () => {
    ctx = makeApp();
    const alice = await new Client(ctx).login('alice@acme.com');
    const ws = await alice.ok(Workspace, 'POST', url('workspaces'), { name: 'ACME', type: 'company', domain: 'acme.com' });
    expect(ws.domain).toBe('acme.com');
    await alice.fail(400, 'validation_failed', 'POST', url('workspaces'), { name: '', type: 'company' });

    const invited = await alice.ok(Member, 'POST', url('members', { wsId: ws.id }), { email: 'bob@acme.com', role: 'member' });
    expect(invited.status).toBe('invited');
    await alice.fail(409, 'conflict', 'POST', url('members', { wsId: ws.id }), { email: 'bob@acme.com', role: 'member' });

    // Outsiders cannot see it; an invited person becomes active after signing in
    const eve = await new Client(ctx).login('eve@evil.com');
    await eve.fail(403, 'forbidden', 'GET', url('members', { wsId: ws.id }));
    await eve.fail(404, 'not_found', 'GET', url('workspace', { wsId: 'ws_nope' }));
    const bob = await new Client(ctx).login('bob@acme.com', 'Bob Lin');
    const members = await bob.ok(list(Member), 'GET', url('members', { wsId: ws.id }));
    expect(members.items.find((m) => m.email === 'bob@acme.com')).toMatchObject({ status: 'active', name: 'Bob Lin', role: 'member' });
    expect((await bob.ok(MeResponse, 'GET', url('me'))).workspaces.map((w) => w.id)).toContain(ws.id);

    // A member cannot change members or policies
    await bob.fail(403, 'forbidden', 'POST', url('members', { wsId: ws.id }), { email: 'x@acme.com', role: 'member' });
    await bob.fail(403, 'forbidden', 'POST', url('policies', { wsId: ws.id }), { name: 'x', isDefault: false, requireOfacClear: true, excludedCountries: [], discloseNationality: false, nameMatch: 'off', minimumAge: null });

    const promoted = await alice.ok(Member, 'PATCH', url('member', { wsId: ws.id, userId: invited.userId }), { role: 'admin' });
    expect(promoted.role).toBe('admin');
    // An admin cannot touch an owner; the last owner cannot be demoted or removed
    const aliceId = members.items.find((m) => m.email === 'alice@acme.com')!.userId;
    await bob.fail(403, 'forbidden', 'DELETE', url('member', { wsId: ws.id, userId: aliceId }));
    await alice.fail(409, 'conflict', 'PATCH', url('member', { wsId: ws.id, userId: aliceId }), { role: 'admin' });
    expect((await alice.raw('DELETE', url('member', { wsId: ws.id, userId: invited.userId }))).status).toBe(204);
    await bob.fail(403, 'forbidden', 'GET', url('members', { wsId: ws.id }));
  });
});

describe('Policies', () => {
  it('create, update, switch default, delete', async () => {
    ctx = makeApp();
    const { host, wsId, policy, meeting } = await setup(ctx);
    await host.fail(400, 'validation_failed', 'POST', url('policies', { wsId }), { ...policy, excludedCountries: ['korea'] });
    const patched = await host.ok(Policy, 'PATCH', url('policy', { policyId: policy.id }), { nameMatch: 'require', minimumAge: 18, isDefault: true });
    expect(patched).toMatchObject({ nameMatch: 'require', minimumAge: 18, isDefault: true, excludedCountries: ['PRK'] });
    const all = await host.ok(list(Policy), 'GET', url('policies', { wsId }));
    expect(all.items.filter((p) => p.isDefault)).toHaveLength(1);
    // The default policy and policies used by meetings cannot be deleted
    await host.fail(409, 'conflict', 'DELETE', url('policy', { policyId: policy.id }));
    const other = all.items.find((p) => p.id !== policy.id)!;
    expect((await host.raw('DELETE', url('policy', { policyId: other.id }))).status).toBe(204);
    await host.fail(404, 'not_found', 'PATCH', url('policy', { policyId: other.id }), { name: 'x' });
    expect(meeting.policyId).toBe(policy.id);
  });
});

describe('Meetings and bots', () => {
  it('create a meeting, dispatch a bot, recall a bot', async () => {
    ctx = makeApp({ fakeBotDelayMs: 40 });
    const host = await new Client(ctx).login('alice@acme.com');
    const wsId = (await host.ok(MeResponse, 'GET', url('me'))).workspaces[0]!.id;
    const policyId = (await host.ok(list(Policy), 'GET', url('policies', { wsId }))).items[0]!.id;
    await host.fail(400, 'validation_failed', 'POST', url('meetings', { wsId }), { title: 't', meetUrl: 'not a url', policyId });
    await host.fail(400, 'validation_failed', 'POST', url('meetings', { wsId }), { title: 't', meetUrl: 'https://meet.google.com/x', policyId: 'pol_nope' });
    const m = await host.ok(Meeting, 'POST', url('meetings', { wsId }), { title: 'Quarterly meeting', meetUrl: 'https://meet.google.com/abc-defg-hij', policyId });
    expect(m).toMatchObject({ status: 'scheduled', botStatus: 'idle' });
    expect((await host.ok(list(Meeting), 'GET', url('meetings', { wsId }))).items).toHaveLength(1);

    const joining = await host.ok(Meeting, 'POST', url('meetingBot', { mtgId: m.id }));
    expect(joining.botStatus).toBe('joining');
    await host.fail(409, 'conflict', 'POST', url('meetingBot', { mtgId: m.id }));
    await sleep(80);
    const live = await host.ok(MeetingDetail, 'GET', url('meeting', { mtgId: m.id }));
    expect(live.meeting).toMatchObject({ status: 'live', botStatus: 'in_meeting' });
    expect(live.participants.map((p) => p.kind)).toEqual(['bot']);

    const left = await host.ok(Meeting, 'DELETE', url('meetingBot', { mtgId: m.id }));
    expect(left).toMatchObject({ status: 'ended', botStatus: 'left' });
    expect((await host.ok(MeetingDetail, 'GET', url('meeting', { mtgId: m.id }))).participants[0]!.leftAt).not.toBeNull();
    await host.fail(409, 'conflict', 'DELETE', url('meetingBot', { mtgId: m.id }));

    // People in other workspaces cannot access this meeting
    const eve = await new Client(ctx).login('eve@evil.com');
    await eve.fail(403, 'forbidden', 'GET', url('meeting', { mtgId: m.id }));
    await eve.fail(403, 'forbidden', 'POST', url('devJoin', { mtgId: m.id }), { displayName: 'x' });
  });

  it('workspace members are verified with null checks on joining; leftAt is set after leaving', async () => {
    ctx = makeApp();
    const { host, meeting, join } = await setup(ctx);
    const alice = await join(meeting.id, 'Alice Chen', 'alice@acme.com');
    expect(alice).toMatchObject({ kind: 'member', verification: { status: 'verified', checks: null, guestId: null } });
    const guest = await join(meeting.id, 'Ken Sato');
    expect(guest).toMatchObject({ kind: 'guest', verification: { status: 'unverified' } });
    // Members do not need to, and cannot, open a verification session
    await new Client(ctx).fail(400, 'validation_failed', 'POST', url('publicSessions', { joinToken: meeting.joinToken }), { participantId: alice.id });
    expect((await host.raw('POST', url('devLeave', { mtgId: meeting.id, pid: guest.id }))).status).toBe(204);
    expect((await participant(host, meeting.id, guest.id)).leftAt).not.toBeNull();
    await new Client(ctx).fail(409, 'conflict', 'POST', url('publicSessions', { joinToken: meeting.joinToken }), { participantId: guest.id });
  });
});

describe('Verification flow', () => {
  it('guest completes verification: verified, guest bound, nationality only visible to the host', async () => {
    ctx = makeApp();
    const { host, wsId, meeting, join } = await setup(ctx);
    const ken = await join(meeting.id, 'Ken Sato');
    const anon = new Client(ctx);

    const pub = await anon.ok(PublicMeeting, 'GET', url('publicMeeting', { joinToken: meeting.joinToken }));
    expect(pub.disclosures).toEqual({ ofac: true, excludedCountries: ['PRK'], nationality: true, nameMatch: true, minimumAge: null });
    await anon.fail(404, 'not_found', 'GET', url('publicMeeting', { joinToken: 'jt_nope' }));
    await anon.fail(404, 'not_found', 'POST', url('publicSessions', { joinToken: meeting.joinToken }), { participantId: 'par_nope' });

    const s = await anon.ok(VerifySession, 'POST', url('publicSessions', { joinToken: meeting.joinToken }), { participantId: ken.id });
    expect(s).toMatchObject({ status: 'pending', participantId: ken.id, selfApp: null, universalLink: `http://localhost:5173/dev/self/${s.id}` });
    expect(new Date(s.expiresAt).getTime() - Date.now()).toBeGreaterThan(290_000);
    expect((await participant(host, meeting.id, ken.id)).verification.status).toBe('pending');

    const done = await anon.ok(VerifySession, 'POST', url('devCompleteSession', { sessionId: s.id }), passport());
    expect(done).toMatchObject({ status: 'verified', failureReason: null });
    expect((await anon.ok(VerifySession, 'GET', url('publicSession', { sessionId: s.id }))).status).toBe('verified');

    const v = (await participant(host, meeting.id, ken.id)).verification;
    expect(v).toMatchObject({
      status: 'verified', returning: false, failureReason: null,
      checks: { ofac: 'pass', nationality: { allowed: true, value: 'JPN' }, nameMatch: { result: 'match', score: 1 }, age: 'skipped' },
    });
    expect(v.guestId).toMatch(/^gst_/);
    const guests = await host.ok(list(Guest), 'GET', url('guests', { wsId }));
    expect(guests.items).toEqual([expect.objectContaining({ id: v.guestId, label: 'Ken Sato', nationality: 'JPN', meetingCount: 1, revoked: false })]);

    // A verified person cannot open another session; resubmitting a proof to the same session does not change the result
    await anon.fail(409, 'conflict', 'POST', url('publicSessions', { joinToken: meeting.joinToken }), { participantId: ken.id });
    const again = await anon.ok(VerifySession, 'POST', url('devCompleteSession', { sessionId: s.id }), passport({ nationality: 'PRK' }));
    expect(again.status).toBe('verified');

    // The public endpoint does not leak checks, nationality or name
    const pubAfter = await anon.raw('GET', url('publicMeeting', { joinToken: meeting.joinToken })).then((r) => r.text());
    expect(pubAfter).not.toMatch(/JPN|checks|nationality":\s*\{|guestId|SATO/);
    expect(PublicMeeting.parse(JSON.parse(pubAfter)).participants.find((p) => p.id === ken.id)).toEqual({ id: ken.id, displayName: 'Ken Sato', kind: 'guest', status: 'verified' });
    const sessionText = await anon.raw('GET', url('publicSession', { sessionId: s.id })).then((r) => r.text());
    expect(sessionText).not.toMatch(/JPN|SATO|P-001/);
    // The database has no passport name, passport number or plaintext nullifier
    const dump = JSON.stringify(['guests', 'participants', 'verify_sessions', 'bindings'].map((t) => ctx.db.all(`SELECT * FROM ${t}`)));
    expect(dump).not.toMatch(/SATO KEN|P-001/);
  });

  it('policy that does not disclose nationality: stores only allowed, not the nationality code', async () => {
    ctx = makeApp();
    const { host, wsId, meeting, join, verify } = await setup(ctx, { discloseNationality: false });
    const ken = await join(meeting.id, 'Ken Sato');
    expect((await verify(meeting.joinToken, ken.id)).status).toBe('verified');
    expect((await participant(host, meeting.id, ken.id)).verification.checks!.nationality).toEqual({ allowed: true, value: null });
    expect((await host.ok(list(Guest), 'GET', url('guests', { wsId }))).items[0]!.nationality).toBeNull();
    expect(JSON.stringify(ctx.db.all('SELECT * FROM guests')) + JSON.stringify(ctx.db.all('SELECT * FROM participants'))).not.toContain('JPN');
  });

  it.each([
    ['ofac', {}, passport({ ofacClear: false }), 'Ken Sato'],
    ['excluded_country', {}, passport({ nationality: 'PRK' }), 'Ken Sato'],
    ['underage', { minimumAge: 18 }, passport({ age: 17 }), 'Ken Sato'],
    ['name_mismatch', { nameMatch: 'require' as const }, passport({ name: 'WANG DAVID' }), 'Ken Sato'],
  ])('failure reason %s', async (reason, policy, proof, displayName) => {
    ctx = makeApp();
    const { host, wsId, meeting, join, verify } = await setup(ctx, policy);
    const p = await join(meeting.id, displayName);
    expect(await verify(meeting.joinToken, p.id, proof)).toMatchObject({ status: 'failed', failureReason: reason });
    const v = (await participant(host, meeting.id, p.id)).verification;
    expect(v).toMatchObject({ status: 'failed', failureReason: reason, guestId: null, verifiedAt: null });
    expect(v.checks).not.toBeNull();
    expect((await host.ok(list(Guest), 'GET', url('guests', { wsId }))).items).toHaveLength(0);
    // Can retry after a failure
    expect((await verify(meeting.joinToken, p.id, passport())).status).toBe('verified');
  });

  it('nameMatch: warn records a mismatch but lets it through; off skips the check', async () => {
    ctx = makeApp();
    const a = await setup(ctx, { nameMatch: 'warn' });
    const p = await a.join(a.meeting.id, 'Ken Sato');
    expect((await a.verify(a.meeting.joinToken, p.id, passport({ name: 'WANG DAVID' }))).status).toBe('verified');
    expect((await participant(a.host, a.meeting.id, p.id)).verification.checks!.nameMatch).toEqual({ result: 'mismatch', score: 0 });
    ctx.close();
    ctx = makeApp();
    const b = await setup(ctx, { nameMatch: 'off', requireOfacClear: false, excludedCountries: [], discloseNationality: false });
    const q = await b.join(b.meeting.id, 'Whoever');
    expect((await b.verify(b.meeting.joinToken, q.id, passport({ ofacClear: false, nationality: 'PRK' }))).status).toBe('verified');
    expect((await participant(b.host, b.meeting.id, q.id)).verification.checks).toEqual({ ofac: 'skipped', nationality: null, nameMatch: { result: 'skipped', score: null }, age: 'skipped' });
  });

  it('name matching: case, diacritics, order, MRZ truncation', () => {
    expect(nameScore('Ken Sato', 'SATO KEN')).toBe(1);
    expect(nameScore('José Müller', 'MULLER JOSE')).toBe(1);
    expect(nameScore('Christopher Lee', 'LEE CHRISTOPH')).toBe(1);
    expect(nameScore('Mia', 'CHEN MIA')).toBeGreaterThanOrEqual(0.6);
    expect(nameScore('Ken Sato', 'WANG DAVID')).toBe(0);
    expect(nameScore('', 'X')).toBe(0);
  });

  it('a new session invalidates the old one; timeout -> expired', async () => {
    ctx = makeApp({ sessionTtlSec: 0.15 });
    const { host, meeting, join } = await setup(ctx);
    const p = await join(meeting.id, 'Ken Sato');
    const anon = new Client(ctx);
    const s1 = await anon.ok(VerifySession, 'POST', url('publicSessions', { joinToken: meeting.joinToken }), { participantId: p.id });
    const s2 = await anon.ok(VerifySession, 'POST', url('publicSessions', { joinToken: meeting.joinToken }), { participantId: p.id });
    expect(await anon.ok(VerifySession, 'GET', url('publicSession', { sessionId: s1.id }))).toMatchObject({ status: 'expired', failureReason: 'expired' });
    // A proof for the old session does not count
    expect((await anon.ok(VerifySession, 'POST', url('devCompleteSession', { sessionId: s1.id }), passport())).status).toBe('expired');
    expect((await participant(host, meeting.id, p.id)).verification.status).toBe('pending');
    await sleep(260);
    expect((await participant(host, meeting.id, p.id)).verification).toMatchObject({ status: 'failed', failureReason: 'expired' });
    expect(await anon.ok(VerifySession, 'GET', url('publicSession', { sessionId: s2.id }))).toMatchObject({ status: 'expired', failureReason: 'expired' });
    expect((await anon.ok(VerifySession, 'POST', url('devCompleteSession', { sessionId: s2.id }), passport())).status).toBe('expired');
    await anon.fail(404, 'not_found', 'GET', url('publicSession', { sessionId: 'vs_nope' }));
  });
});

describe('Binding rules', () => {
  it('the same passport is recognized in a second meeting (returning), and meetingCount increments', async () => {
    ctx = makeApp();
    const { host, wsId, meeting, newMeeting, join, verify } = await setup(ctx);
    const p1 = await join(meeting.id, 'Ken Sato');
    await verify(meeting.joinToken, p1.id);
    const m2 = await newMeeting('Second meeting');
    const p2 = await join(m2.id, 'Ken S.');
    expect((await verify(m2.joinToken, p2.id)).status).toBe('verified');
    const v1 = (await participant(host, meeting.id, p1.id)).verification;
    const v2 = (await participant(host, m2.id, p2.id)).verification;
    expect(v2.returning).toBe(true);
    expect(v2.guestId).toBe(v1.guestId);
    const guests = await host.ok(list(Guest), 'GET', url('guests', { wsId }));
    expect(guests.items).toEqual([expect.objectContaining({ id: v1.guestId, label: 'Ken S.', meetingCount: 2 })]);
  });

  it('the same passport claiming a second participant in one meeting -> already_bound', async () => {
    ctx = makeApp();
    const { host, wsId, meeting, join, verify } = await setup(ctx);
    const a = await join(meeting.id, 'Ken Sato');
    const b = await join(meeting.id, 'Ken Sato');
    expect((await verify(meeting.joinToken, a.id)).status).toBe('verified');
    expect(await verify(meeting.joinToken, b.id)).toMatchObject({ status: 'failed', failureReason: 'already_bound' });
    expect((await participant(host, meeting.id, b.id)).verification).toMatchObject({ status: 'failed', failureReason: 'already_bound', guestId: null });
    expect((await participant(host, meeting.id, a.id)).verification.status).toBe('verified');
    expect((await host.ok(list(Guest), 'GET', url('guests', { wsId }))).items).toHaveLength(1);
    // A different passport is fine
    expect((await verify(meeting.joinToken, b.id, passport({ passportId: 'P-002' }))).status).toBe('verified');
  });

  it('after reset it returns to unverified and the same passport can claim again', async () => {
    ctx = makeApp();
    const { host, meeting, join, verify } = await setup(ctx);
    const a = await join(meeting.id, 'Ken Sato');
    const b = await join(meeting.id, 'Ken Sato');
    await verify(meeting.joinToken, a.id);
    const reset = await host.ok(Participant, 'POST', url('participantReset', { mtgId: meeting.id, pid: a.id }));
    expect(reset.verification).toEqual({ status: 'unverified', guestId: null, returning: false, verifiedAt: null, checks: null, failureReason: null });
    expect((await verify(meeting.joinToken, b.id)).status).toBe('verified');
    await host.fail(404, 'not_found', 'POST', url('participantReset', { mtgId: meeting.id, pid: 'par_nope' }));
  });

  it('after revoking a guest, the same passport counts as a new guest', async () => {
    ctx = makeApp();
    const { host, wsId, meeting, newMeeting, join, verify } = await setup(ctx);
    const p1 = await join(meeting.id, 'Ken Sato');
    await verify(meeting.joinToken, p1.id);
    const g1 = (await participant(host, meeting.id, p1.id)).verification.guestId!;
    const outsider = await new Client(ctx).login('eve@evil.com');
    await outsider.fail(403, 'forbidden', 'DELETE', url('guest', { guestId: g1 }));
    expect((await host.raw('DELETE', url('guest', { guestId: g1 }))).status).toBe(204);
    await host.fail(404, 'not_found', 'DELETE', url('guest', { guestId: 'gst_nope' }));

    const m2 = await newMeeting('Second meeting');
    const p2 = await join(m2.id, 'Ken Sato');
    await verify(m2.joinToken, p2.id);
    const v2 = (await participant(host, m2.id, p2.id)).verification;
    expect(v2.returning).toBe(false);
    expect(v2.guestId).not.toBe(g1);
    const guests = await host.ok(list(Guest), 'GET', url('guests', { wsId }));
    expect(guests.items.find((g) => g.id === g1)!.revoked).toBe(true);
    expect(guests.items.find((g) => g.id === v2.guestId)!.revoked).toBe(false);
  });
});

describe('SSE', () => {
  async function open(c: Client, path: string) {
    const res = await c.raw('GET', path);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    let buf = '';
    const next = async (): Promise<unknown> => {
      for (;;) {
        const i = buf.indexOf('\n\n');
        if (i >= 0) {
          const frame = buf.slice(0, i);
          buf = buf.slice(i + 2);
          expect(frame).not.toMatch(/^event:/m); // no event name is set, so EventSource.onmessage can receive it
          const data = frame.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('\n');
          if (data) return JSON.parse(data);
          continue; // heartbeat comment
        }
        const { value, done } = await reader.read();
        if (done) throw new Error('stream closed');
        buf += dec.decode(value, { stream: true });
      }
    };
    return { next, close: () => reader.cancel() };
  }

  it('two channels: snapshot first, then incremental events; the public channel omits checks and nationality', async () => {
    ctx = makeApp();
    const { host, meeting, join, verify } = await setup(ctx);
    const hostStream = await open(host, url('meetingEvents', { mtgId: meeting.id }));
    const pubStream = await open(new Client(ctx), url('publicEvents', { joinToken: meeting.joinToken }));

    const h0 = HostEvent.parse(await hostStream.next());
    const p0 = PublicEvent.parse(await pubStream.next());
    expect(h0.type).toBe('snapshot');
    expect(p0.type).toBe('snapshot');
    expect(h0.meetingId).toBe(meeting.id);

    const ken = await join(meeting.id, 'Ken Sato');
    const h1 = HostEvent.parse(await hostStream.next());
    const p1 = PublicEvent.parse(await pubStream.next());
    expect(h1).toMatchObject({ type: 'participant.joined', data: { id: ken.id, verification: { status: 'unverified' } } });
    expect(p1).toMatchObject({ type: 'participant.joined', data: { id: ken.id, displayName: 'Ken Sato', kind: 'guest', status: 'unverified' } });
    expect(Object.keys((p1 as any).data).sort()).toEqual(['displayName', 'id', 'kind', 'status']);

    await verify(meeting.joinToken, ken.id);
    const h2 = HostEvent.parse(await hostStream.next());
    const p2raw = await pubStream.next();
    expect(h2).toMatchObject({ type: 'verification.updated', data: { participantId: ken.id, verification: { status: 'pending' } } });
    expect(PublicEvent.parse(p2raw)).toMatchObject({ type: 'verification.updated', data: { participantId: ken.id, status: 'pending' } });
    const h3 = HostEvent.parse(await hostStream.next());
    const p3raw = await pubStream.next();
    expect(h3).toMatchObject({ type: 'verification.updated', data: { verification: { status: 'verified', checks: { nationality: { value: 'JPN' } } } } });
    expect(p3raw).toMatchObject({ type: 'verification.updated', data: { participantId: ken.id, status: 'verified' } });
    expect(Object.keys((p3raw as any).data).sort()).toEqual(['participantId', 'status']);

    await host.raw('POST', url('devLeave', { mtgId: meeting.id, pid: ken.id }));
    expect(HostEvent.parse(await hostStream.next())).toMatchObject({ type: 'participant.left', data: { participantId: ken.id } });
    expect(PublicEvent.parse(await pubStream.next())).toMatchObject({ type: 'participant.left', data: { participantId: ken.id } });

    await host.raw('DELETE', url('meetingBot', { mtgId: meeting.id }));
    expect(HostEvent.parse(await hostStream.next())).toMatchObject({ type: 'meeting.updated', data: { id: meeting.id, botStatus: 'left', status: 'ended' } });
    const pm = await pubStream.next();
    expect(PublicEvent.parse(pm)).toMatchObject({ type: 'meeting.updated' });
    expect((pm as any).data).toEqual({ status: 'ended', botStatus: 'left' });

    await hostStream.close();
    await pubStream.close();

    // Reconnect: the new snapshot is the latest state, and people who left are not in the public roster
    const re = await open(new Client(ctx), url('publicEvents', { joinToken: meeting.joinToken }));
    const snap = PublicEvent.parse(await re.next());
    expect(snap.type === 'snapshot' && snap.data.participants.some((p) => p.id === ken.id)).toBe(false);
    await re.close();

    await new Client(ctx).fail(401, 'unauthenticated', 'GET', url('meetingEvents', { mtgId: meeting.id }));
  });
});

describe('Fake mode switches', () => {
  it('devStatus reports which services are fake; once a service is real, its dev endpoints disappear', async () => {
    ctx = makeApp();
    expect(await new Client(ctx).ok(DevStatus, 'GET', url('devStatus'))).toEqual({ fake: { google: true, recall: true, self: true } });
    ctx.close();

    ctx = makeApp({
      google: { clientId: 'id', clientSecret: 'secret', redirectUri: 'http://localhost:5173/api/v1/auth/google/callback' },
      self: { apiKey: 'sk_test_x', webhookSecret: 'whsec_x', flowId: 'flow' },
    });
    const c = new Client(ctx);
    expect(await c.ok(DevStatus, 'GET', url('devStatus'))).toEqual({ fake: { google: false, recall: true, self: false } });
    await c.fail(404, 'not_found', 'POST', url('devLogin'), { email: 'a@b.co', name: 'a' });
    await c.fail(404, 'not_found', 'POST', url('devCompleteSession', { sessionId: 'vs_x' }), passport());
    // Real Google: start redirects to Google with state and nonce
    const res = await c.raw('GET', url('authGoogleStart') + '?redirect=/w/x');
    const loc = new URL(res.headers.get('location')!);
    expect(loc.origin + loc.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(loc.searchParams.get('state')).toBeTruthy();
    expect(loc.searchParams.get('nonce')).toBeTruthy();
    expect(loc.searchParams.get('scope')).toBe('openid email profile');
    await c.fail(400, 'validation_failed', 'GET', url('authGoogleCallback') + '?state=bogus&code=x');
    // Self webhook: reject if the signature is wrong
    const hook = await ctx.app.request('/webhooks/self', { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } });
    expect(hook.status).toBe(400);
    ctx.close();

    ctx = makeApp({ google: { clientId: 'id', clientSecret: 's', redirectUri: 'x' }, recall: { apiKey: 'k', region: 'us-west-2', webhookToken: 'tok' }, self: { apiKey: 'k', webhookSecret: 's', flowId: 'f' } });
    await new Client(ctx).fail(404, 'not_found', 'GET', url('devStatus'));
    await new Client(ctx).fail(401, 'unauthenticated', 'POST', '/webhooks/recall?token=wrong', {});
  });

  it('Recall webhook (real mode): join / leave events create participants and mark the bot as in_meeting', async () => {
    ctx = makeApp({ recall: { apiKey: 'k', region: 'us-west-2', webhookToken: 'tok' } });
    const host = await new Client(ctx).login('alice@acme.com', 'Alice Chen');
    const wsId = (await host.ok(MeResponse, 'GET', url('me'))).workspaces[0]!.id;
    const policyId = (await host.ok(list(Policy), 'GET', url('policies', { wsId }))).items[0]!.id;
    const m = await host.ok(Meeting, 'POST', url('meetings', { wsId }), { title: 't', meetUrl: 'https://meet.google.com/abc-defg-hij', policyId });
    // Do not actually call Recall: set the status to joining directly, simulating after Create Bot succeeds
    ctx.db.run("UPDATE meetings SET bot_status = 'joining', recall_bot_id = 'bot_1' WHERE id = ?", m.id);
    const hook = (event: string, participant: object) =>
      ctx.app.request('/webhooks/recall?token=tok', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ event, data: { data: { participant }, bot: { id: 'bot_1', metadata: { meetingId: m.id } } } }),
      });
    expect((await hook('participant_events.join', { id: 100, name: 'ProveBack' })).status).toBe(200);
    expect((await hook('participant_events.join', { id: 101, name: 'Ken Sato' })).status).toBe(200);
    expect((await hook('participant_events.join', { id: 101, name: 'Ken Sato' })).status).toBe(200); // resending does not create duplicates
    expect((await hook('participant_events.join', { id: 102, name: 'Alice', email: 'Alice@acme.com' })).status).toBe(200);
    let d = await host.ok(MeetingDetail, 'GET', url('meeting', { mtgId: m.id }));
    expect(d.meeting).toMatchObject({ botStatus: 'in_meeting', status: 'live' });
    expect(d.participants.map((p) => [p.displayName, p.kind])).toEqual([['ProveBack', 'bot'], ['Ken Sato', 'guest'], ['Alice', 'member']]);
    await hook('participant_events.leave', { id: 101, name: 'Ken Sato' });
    d = await host.ok(MeetingDetail, 'GET', url('meeting', { mtgId: m.id }));
    expect(d.participants[1]!.leftAt).not.toBeNull();
    await host.fail(404, 'not_found', 'POST', url('devJoin', { mtgId: m.id }), { displayName: 'x' });
  });
});

// Type-level check: the result of list() can be used as the contract List<T>
const _check: z.infer<ReturnType<typeof list<typeof Guest>>> = { items: [] };
void _check;
