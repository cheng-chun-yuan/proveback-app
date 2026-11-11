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

describe('登入與 workspace', () => {
  it('未登入一律 401', async () => {
    ctx = makeApp();
    const anon = new Client(ctx);
    await anon.fail(401, 'unauthenticated', 'GET', url('me'));
    await anon.fail(401, 'unauthenticated', 'GET', url('members', { wsId: 'ws_x' }));
    await anon.fail(401, 'unauthenticated', 'GET', url('meeting', { mtgId: 'mtg_x' }));
  });

  it('假登入:start 導向前端的 /dev/login,只接受站內相對路徑', async () => {
    ctx = makeApp();
    const anon = new Client(ctx);
    const res = await anon.raw('GET', url('authGoogleStart') + '?redirect=' + encodeURIComponent('/w/x/meetings'));
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('http://localhost:5173/dev/login?redirect=%2Fw%2Fx%2Fmeetings');
    const evil = await anon.raw('GET', url('authGoogleStart') + '?redirect=' + encodeURIComponent('//evil.example'));
    expect(evil.headers.get('location')).toBe('http://localhost:5173/dev/login?redirect=%2F');
    expect((await anon.raw('GET', url('authGoogleCallback'))).status).toBe(404);
  });

  it('首次登入自動建立 personal workspace 與預設政策;登出後失效', async () => {
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
    // 再登入一次不會多一個 workspace
    await c.login('alice@acme.com', 'Alice Chen');
    expect((await c.ok(MeResponse, 'GET', url('me'))).workspaces).toHaveLength(1);
    expect((await c.raw('POST', url('authLogout'))).status).toBe(204);
    await c.fail(401, 'unauthenticated', 'GET', url('me'));
  });

  it('建立 company workspace、邀請成員、角色與權限', async () => {
    ctx = makeApp();
    const alice = await new Client(ctx).login('alice@acme.com');
    const ws = await alice.ok(Workspace, 'POST', url('workspaces'), { name: 'ACME', type: 'company', domain: 'acme.com' });
    expect(ws.domain).toBe('acme.com');
    await alice.fail(400, 'validation_failed', 'POST', url('workspaces'), { name: '', type: 'company' });

    const invited = await alice.ok(Member, 'POST', url('members', { wsId: ws.id }), { email: 'bob@acme.com', role: 'member' });
    expect(invited.status).toBe('invited');
    await alice.fail(409, 'conflict', 'POST', url('members', { wsId: ws.id }), { email: 'bob@acme.com', role: 'member' });

    // 外人看不到;被邀請的人登入後變 active
    const eve = await new Client(ctx).login('eve@evil.com');
    await eve.fail(403, 'forbidden', 'GET', url('members', { wsId: ws.id }));
    await eve.fail(404, 'not_found', 'GET', url('workspace', { wsId: 'ws_nope' }));
    const bob = await new Client(ctx).login('bob@acme.com', 'Bob Lin');
    const members = await bob.ok(list(Member), 'GET', url('members', { wsId: ws.id }));
    expect(members.items.find((m) => m.email === 'bob@acme.com')).toMatchObject({ status: 'active', name: 'Bob Lin', role: 'member' });
    expect((await bob.ok(MeResponse, 'GET', url('me'))).workspaces.map((w) => w.id)).toContain(ws.id);

    // member 不能改成員或政策
    await bob.fail(403, 'forbidden', 'POST', url('members', { wsId: ws.id }), { email: 'x@acme.com', role: 'member' });
    await bob.fail(403, 'forbidden', 'POST', url('policies', { wsId: ws.id }), { name: 'x', isDefault: false, requireOfacClear: true, excludedCountries: [], discloseNationality: false, nameMatch: 'off', minimumAge: null });

    const promoted = await alice.ok(Member, 'PATCH', url('member', { wsId: ws.id, userId: invited.userId }), { role: 'admin' });
    expect(promoted.role).toBe('admin');
    // admin 不能動 owner;最後一個 owner 不能被降級或移除
    const aliceId = members.items.find((m) => m.email === 'alice@acme.com')!.userId;
    await bob.fail(403, 'forbidden', 'DELETE', url('member', { wsId: ws.id, userId: aliceId }));
    await alice.fail(409, 'conflict', 'PATCH', url('member', { wsId: ws.id, userId: aliceId }), { role: 'admin' });
    expect((await alice.raw('DELETE', url('member', { wsId: ws.id, userId: invited.userId }))).status).toBe(204);
    await bob.fail(403, 'forbidden', 'GET', url('members', { wsId: ws.id }));
  });
});

describe('政策', () => {
  it('建立、更新、預設切換、刪除', async () => {
    ctx = makeApp();
    const { host, wsId, policy, meeting } = await setup(ctx);
    await host.fail(400, 'validation_failed', 'POST', url('policies', { wsId }), { ...policy, excludedCountries: ['korea'] });
    const patched = await host.ok(Policy, 'PATCH', url('policy', { policyId: policy.id }), { nameMatch: 'require', minimumAge: 18, isDefault: true });
    expect(patched).toMatchObject({ nameMatch: 'require', minimumAge: 18, isDefault: true, excludedCountries: ['PRK'] });
    const all = await host.ok(list(Policy), 'GET', url('policies', { wsId }));
    expect(all.items.filter((p) => p.isDefault)).toHaveLength(1);
    // 預設政策、被會議使用的政策都不能刪
    await host.fail(409, 'conflict', 'DELETE', url('policy', { policyId: policy.id }));
    const other = all.items.find((p) => p.id !== policy.id)!;
    expect((await host.raw('DELETE', url('policy', { policyId: other.id }))).status).toBe(204);
    await host.fail(404, 'not_found', 'PATCH', url('policy', { policyId: other.id }), { name: 'x' });
    expect(meeting.policyId).toBe(policy.id);
  });
});

describe('會議與 bot', () => {
  it('建立會議、派 bot、收回 bot', async () => {
    ctx = makeApp({ fakeBotDelayMs: 40 });
    const host = await new Client(ctx).login('alice@acme.com');
    const wsId = (await host.ok(MeResponse, 'GET', url('me'))).workspaces[0]!.id;
    const policyId = (await host.ok(list(Policy), 'GET', url('policies', { wsId }))).items[0]!.id;
    await host.fail(400, 'validation_failed', 'POST', url('meetings', { wsId }), { title: 't', meetUrl: 'not a url', policyId });
    await host.fail(400, 'validation_failed', 'POST', url('meetings', { wsId }), { title: 't', meetUrl: 'https://meet.google.com/x', policyId: 'pol_nope' });
    const m = await host.ok(Meeting, 'POST', url('meetings', { wsId }), { title: '季度會議', meetUrl: 'https://meet.google.com/abc-defg-hij', policyId });
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

    // 其他 workspace 的人碰不到這場會議
    const eve = await new Client(ctx).login('eve@evil.com');
    await eve.fail(403, 'forbidden', 'GET', url('meeting', { mtgId: m.id }));
    await eve.fail(403, 'forbidden', 'POST', url('devJoin', { mtgId: m.id }), { displayName: 'x' });
  });

  it('workspace 成員進會議直接是 verified、checks 為 null;離開後有 leftAt', async () => {
    ctx = makeApp();
    const { host, meeting, join } = await setup(ctx);
    const alice = await join(meeting.id, 'Alice Chen', 'alice@acme.com');
    expect(alice).toMatchObject({ kind: 'member', verification: { status: 'verified', checks: null, guestId: null } });
    const guest = await join(meeting.id, 'Ken Sato');
    expect(guest).toMatchObject({ kind: 'guest', verification: { status: 'unverified' } });
    // 成員不需要也不能開驗證 session
    await new Client(ctx).fail(400, 'validation_failed', 'POST', url('publicSessions', { joinToken: meeting.joinToken }), { participantId: alice.id });
    expect((await host.raw('POST', url('devLeave', { mtgId: meeting.id, pid: guest.id }))).status).toBe(204);
    expect((await participant(host, meeting.id, guest.id)).leftAt).not.toBeNull();
    await new Client(ctx).fail(409, 'conflict', 'POST', url('publicSessions', { joinToken: meeting.joinToken }), { participantId: guest.id });
  });
});

describe('驗證流程', () => {
  it('來賓完成驗證:verified、綁定來賓、國籍只給主辦方', async () => {
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

    // 已驗證的人不能再開 session;同一個 session 重送證明不會改變結果
    await anon.fail(409, 'conflict', 'POST', url('publicSessions', { joinToken: meeting.joinToken }), { participantId: ken.id });
    const again = await anon.ok(VerifySession, 'POST', url('devCompleteSession', { sessionId: s.id }), passport({ nationality: 'PRK' }));
    expect(again.status).toBe('verified');

    // 公開端點不洩漏 checks、國籍、姓名
    const pubAfter = await anon.raw('GET', url('publicMeeting', { joinToken: meeting.joinToken })).then((r) => r.text());
    expect(pubAfter).not.toMatch(/JPN|checks|nationality":\s*\{|guestId|SATO/);
    expect(PublicMeeting.parse(JSON.parse(pubAfter)).participants.find((p) => p.id === ken.id)).toEqual({ id: ken.id, displayName: 'Ken Sato', kind: 'guest', status: 'verified' });
    const sessionText = await anon.raw('GET', url('publicSession', { sessionId: s.id })).then((r) => r.text());
    expect(sessionText).not.toMatch(/JPN|SATO|P-001/);
    // 資料庫裡沒有護照姓名、護照代號、nullifier 明文
    const dump = JSON.stringify(['guests', 'participants', 'verify_sessions', 'bindings'].map((t) => ctx.db.all(`SELECT * FROM ${t}`)));
    expect(dump).not.toMatch(/SATO KEN|P-001/);
  });

  it('不揭露國籍的政策:只存 allowed,不存國籍代碼', async () => {
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
  ])('失敗原因 %s', async (reason, policy, proof, displayName) => {
    ctx = makeApp();
    const { host, wsId, meeting, join, verify } = await setup(ctx, policy);
    const p = await join(meeting.id, displayName);
    expect(await verify(meeting.joinToken, p.id, proof)).toMatchObject({ status: 'failed', failureReason: reason });
    const v = (await participant(host, meeting.id, p.id)).verification;
    expect(v).toMatchObject({ status: 'failed', failureReason: reason, guestId: null, verifiedAt: null });
    expect(v.checks).not.toBeNull();
    expect((await host.ok(list(Guest), 'GET', url('guests', { wsId }))).items).toHaveLength(0);
    // 失敗後可以重來
    expect((await verify(meeting.joinToken, p.id, passport())).status).toBe('verified');
  });

  it('nameMatch: warn 記錄不相符但放行;off 則跳過', async () => {
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

  it('姓名比對:大小寫、變音符號、順序、MRZ 截斷', () => {
    expect(nameScore('Ken Sato', 'SATO KEN')).toBe(1);
    expect(nameScore('José Müller', 'MULLER JOSE')).toBe(1);
    expect(nameScore('Christopher Lee', 'LEE CHRISTOPH')).toBe(1);
    expect(nameScore('Mia', 'CHEN MIA')).toBeGreaterThanOrEqual(0.6);
    expect(nameScore('Ken Sato', 'WANG DAVID')).toBe(0);
    expect(nameScore('', 'X')).toBe(0);
  });

  it('新的 session 使舊的失效;逾時 → expired', async () => {
    ctx = makeApp({ sessionTtlSec: 0.15 });
    const { host, meeting, join } = await setup(ctx);
    const p = await join(meeting.id, 'Ken Sato');
    const anon = new Client(ctx);
    const s1 = await anon.ok(VerifySession, 'POST', url('publicSessions', { joinToken: meeting.joinToken }), { participantId: p.id });
    const s2 = await anon.ok(VerifySession, 'POST', url('publicSessions', { joinToken: meeting.joinToken }), { participantId: p.id });
    expect(await anon.ok(VerifySession, 'GET', url('publicSession', { sessionId: s1.id }))).toMatchObject({ status: 'expired', failureReason: 'expired' });
    // 舊 session 的證明不算數
    expect((await anon.ok(VerifySession, 'POST', url('devCompleteSession', { sessionId: s1.id }), passport())).status).toBe('expired');
    expect((await participant(host, meeting.id, p.id)).verification.status).toBe('pending');
    await sleep(260);
    expect((await participant(host, meeting.id, p.id)).verification).toMatchObject({ status: 'failed', failureReason: 'expired' });
    expect(await anon.ok(VerifySession, 'GET', url('publicSession', { sessionId: s2.id }))).toMatchObject({ status: 'expired', failureReason: 'expired' });
    expect((await anon.ok(VerifySession, 'POST', url('devCompleteSession', { sessionId: s2.id }), passport())).status).toBe('expired');
    await anon.fail(404, 'not_found', 'GET', url('publicSession', { sessionId: 'vs_nope' }));
  });
});

describe('綁定規則', () => {
  it('同一本護照在第二場會議被認出(returning),meetingCount 累加', async () => {
    ctx = makeApp();
    const { host, wsId, meeting, newMeeting, join, verify } = await setup(ctx);
    const p1 = await join(meeting.id, 'Ken Sato');
    await verify(meeting.joinToken, p1.id);
    const m2 = await newMeeting('第二場');
    const p2 = await join(m2.id, 'Ken S.');
    expect((await verify(m2.joinToken, p2.id)).status).toBe('verified');
    const v1 = (await participant(host, meeting.id, p1.id)).verification;
    const v2 = (await participant(host, m2.id, p2.id)).verification;
    expect(v2.returning).toBe(true);
    expect(v2.guestId).toBe(v1.guestId);
    const guests = await host.ok(list(Guest), 'GET', url('guests', { wsId }));
    expect(guests.items).toEqual([expect.objectContaining({ id: v1.guestId, label: 'Ken S.', meetingCount: 2 })]);
  });

  it('同一場會議同一本護照認領第二個參與者 → already_bound', async () => {
    ctx = makeApp();
    const { host, wsId, meeting, join, verify } = await setup(ctx);
    const a = await join(meeting.id, 'Ken Sato');
    const b = await join(meeting.id, 'Ken Sato');
    expect((await verify(meeting.joinToken, a.id)).status).toBe('verified');
    expect(await verify(meeting.joinToken, b.id)).toMatchObject({ status: 'failed', failureReason: 'already_bound' });
    expect((await participant(host, meeting.id, b.id)).verification).toMatchObject({ status: 'failed', failureReason: 'already_bound', guestId: null });
    expect((await participant(host, meeting.id, a.id)).verification.status).toBe('verified');
    expect((await host.ok(list(Guest), 'GET', url('guests', { wsId }))).items).toHaveLength(1);
    // 另一本護照可以
    expect((await verify(meeting.joinToken, b.id, passport({ passportId: 'P-002' }))).status).toBe('verified');
  });

  it('reset 之後退回 unverified,同一本護照可以重新認領', async () => {
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

  it('撤銷來賓後,同一本護照視為新來賓', async () => {
    ctx = makeApp();
    const { host, wsId, meeting, newMeeting, join, verify } = await setup(ctx);
    const p1 = await join(meeting.id, 'Ken Sato');
    await verify(meeting.joinToken, p1.id);
    const g1 = (await participant(host, meeting.id, p1.id)).verification.guestId!;
    const outsider = await new Client(ctx).login('eve@evil.com');
    await outsider.fail(403, 'forbidden', 'DELETE', url('guest', { guestId: g1 }));
    expect((await host.raw('DELETE', url('guest', { guestId: g1 }))).status).toBe(204);
    await host.fail(404, 'not_found', 'DELETE', url('guest', { guestId: 'gst_nope' }));

    const m2 = await newMeeting('第二場');
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
          expect(frame).not.toMatch(/^event:/m); // 不設 event 名稱,EventSource.onmessage 才收得到
          const data = frame.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('\n');
          if (data) return JSON.parse(data);
          continue; // heartbeat 註解
        }
        const { value, done } = await reader.read();
        if (done) throw new Error('stream closed');
        buf += dec.decode(value, { stream: true });
      }
    };
    return { next, close: () => reader.cancel() };
  }

  it('兩個頻道:先 snapshot 再增量事件,公開頻道不含 checks 與國籍', async () => {
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

    // 斷線重連:新的 snapshot 就是最新狀態,且離開的人不在公開名單裡
    const re = await open(new Client(ctx), url('publicEvents', { joinToken: meeting.joinToken }));
    const snap = PublicEvent.parse(await re.next());
    expect(snap.type === 'snapshot' && snap.data.participants.some((p) => p.id === ken.id)).toBe(false);
    await re.close();

    await new Client(ctx).fail(401, 'unauthenticated', 'GET', url('meetingEvents', { mtgId: meeting.id }));
  });
});

describe('假資料模式的開關', () => {
  it('devStatus 回報哪些是假的;服務改成真的之後對應的 dev 端點消失', async () => {
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
    // 真 Google:start 導向 Google,帶 state 與 nonce
    const res = await c.raw('GET', url('authGoogleStart') + '?redirect=/w/x');
    const loc = new URL(res.headers.get('location')!);
    expect(loc.origin + loc.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(loc.searchParams.get('state')).toBeTruthy();
    expect(loc.searchParams.get('nonce')).toBeTruthy();
    expect(loc.searchParams.get('scope')).toBe('openid email profile');
    await c.fail(400, 'validation_failed', 'GET', url('authGoogleCallback') + '?state=bogus&code=x');
    // Self webhook:簽章不對就拒絕
    const hook = await ctx.app.request('/webhooks/self', { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } });
    expect(hook.status).toBe(400);
    ctx.close();

    ctx = makeApp({ google: { clientId: 'id', clientSecret: 's', redirectUri: 'x' }, recall: { apiKey: 'k', region: 'us-west-2', webhookToken: 'tok' }, self: { apiKey: 'k', webhookSecret: 's', flowId: 'f' } });
    await new Client(ctx).fail(404, 'not_found', 'GET', url('devStatus'));
    await new Client(ctx).fail(401, 'unauthenticated', 'POST', '/webhooks/recall?token=wrong', {});
  });

  it('Recall webhook(真模式):join / leave 事件建立參與者並把 bot 標成 in_meeting', async () => {
    ctx = makeApp({ recall: { apiKey: 'k', region: 'us-west-2', webhookToken: 'tok' } });
    const host = await new Client(ctx).login('alice@acme.com', 'Alice Chen');
    const wsId = (await host.ok(MeResponse, 'GET', url('me'))).workspaces[0]!.id;
    const policyId = (await host.ok(list(Policy), 'GET', url('policies', { wsId }))).items[0]!.id;
    const m = await host.ok(Meeting, 'POST', url('meetings', { wsId }), { title: 't', meetUrl: 'https://meet.google.com/abc-defg-hij', policyId });
    // 不真的呼叫 Recall:直接把狀態設成 joining,模擬 Create Bot 成功之後
    ctx.db.run("UPDATE meetings SET bot_status = 'joining', recall_bot_id = 'bot_1' WHERE id = ?", m.id);
    const hook = (event: string, participant: object) =>
      ctx.app.request('/webhooks/recall?token=tok', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ event, data: { data: { participant }, bot: { id: 'bot_1', metadata: { meetingId: m.id } } } }),
      });
    expect((await hook('participant_events.join', { id: 100, name: 'ProveBack' })).status).toBe(200);
    expect((await hook('participant_events.join', { id: 101, name: 'Ken Sato' })).status).toBe(200);
    expect((await hook('participant_events.join', { id: 101, name: 'Ken Sato' })).status).toBe(200); // 重送不會重複
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

// 型別層級的檢查:list() 的結果可以被當成契約的 List<T>
const _check: z.infer<ReturnType<typeof list<typeof Guest>>> = { items: [] };
void _check;
