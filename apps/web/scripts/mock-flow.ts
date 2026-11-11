// Without a browser, run the mock-mode host and guest flows with msw/node and validate every response against the contract schemas.
import { setupServer } from 'msw/node';
import {
  type HostEvent, Guest, Meeting, MeetingDetail, MeResponse, Participant, Policy, type PublicEvent, PublicMeeting,
  VerifySession, list, url,
} from '@proveback/contract';
import type { z } from 'zod';
import { handlers } from '../src/mock/handlers';
import { subscribeHost, subscribePublic } from '../src/mock/store';

const server = setupServer(...handlers);
server.listen({ onUnhandledFrame: 'error' });
const base = 'http://localhost:5173';
let n = 0;

async function call<S extends z.ZodTypeAny>(method: string, path: string, schema: S | null, body?: unknown, expect = 200): Promise<z.infer<S>> {
  const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const want = schema === null && expect === 200 ? 204 : expect;
  if (res.status !== want) throw new Error(`${method} ${path} → ${res.status}, expected ${want}: ${await res.text()}`);
  n++;
  return schema && res.status === 200 ? schema.parse(await res.json()) : (undefined as z.infer<S>);
}
const ok = (cond: boolean, msg: string) => {
  if (!cond) throw new Error('FAIL: ' + msg);
  console.log('  ✓ ' + msg);
};
const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));

await call('GET', url('me'), null, undefined, 401);
await call('POST', url('devLogin'), null, { email: 'host@acme.com', name: 'Host' });
const me = await call('GET', url('me'), MeResponse);
ok(me.workspaces.length === 2, 'two workspaces are visible after sign-in');
const wsId = 'ws_acme';

const strict = await call('POST', url('policies', { wsId }), Policy, {
  name: 'Test policy', isDefault: false, requireOfacClear: true, excludedCountries: ['PRK'], discloseNationality: true, nameMatch: 'require', minimumAge: 18,
});
const mtg = await call('POST', url('meetings', { wsId }), Meeting, { title: 'Test meeting', meetUrl: 'https://meet.google.com/aaa-bbbb-ccc', policyId: strict.id });
await call('DELETE', url('policy', { policyId: strict.id }), null, undefined, 409);

const hostEvents: HostEvent[] = [];
const publicEvents: PublicEvent[] = [];
const off1 = subscribeHost(mtg.id, (e) => hostEvents.push(e));
const off2 = subscribePublic(mtg.joinToken, (e) => publicEvents.push(e));
await tick();
ok(hostEvents[0]?.type === 'snapshot' && publicEvents[0]?.type === 'snapshot', 'both channels start with a snapshot');

await call('POST', url('meetingBot', { mtgId: mtg.id }), Meeting);
await tick(1000);
ok(hostEvents.some((e) => e.type === 'meeting.updated' && e.data.botStatus === 'in_meeting'), 'bot joins the meeting and pushes meeting.updated');

const member = await call('POST', url('devJoin', { mtgId: mtg.id }), Participant, { displayName: 'Bob', email: 'bob@acme.com' });
ok(member.kind === 'member' && member.verification.status === 'verified' && member.verification.checks === null, 'members do not go through Self');
const zoe = await call('POST', url('devJoin', { mtgId: mtg.id }), Participant, { displayName: 'Zoe Wang' });
const eve = await call('POST', url('devJoin', { mtgId: mtg.id }), Participant, { displayName: 'Eve' });
const kim = await call('POST', url('devJoin', { mtgId: mtg.id }), Participant, { displayName: 'Kim' });

const pub = await call('GET', url('publicMeeting', { joinToken: mtg.joinToken }), PublicMeeting);
ok(pub.disclosures.nameMatch && pub.disclosures.minimumAge === 18 && pub.participants.length === 5, 'public page gets disclosures and participants');
ok(!JSON.stringify(pub).includes('checks'), 'public data contains no checks');

const proof = { passportId: 'P-ZOE', name: 'WANG ZOE', nationality: 'TWN', ofacClear: true, age: 30 };
const s1 = await call('POST', url('publicSessions', { joinToken: mtg.joinToken }), VerifySession, { participantId: zoe.id });
const s2 = await call('POST', url('publicSessions', { joinToken: mtg.joinToken }), VerifySession, { participantId: zoe.id });
ok((await call('GET', url('publicSession', { sessionId: s1.id }), VerifySession)).status === 'expired', 'a new session invalidates the old one');
ok((await call('POST', url('devCompleteSession', { sessionId: s2.id }), VerifySession, proof)).status === 'verified', 'Zoe verified (name still matches with different word order)');
await call('POST', url('publicSessions', { joinToken: mtg.joinToken }), null, { participantId: zoe.id }, 409);

const s3 = await call('POST', url('publicSessions', { joinToken: mtg.joinToken }), VerifySession, { participantId: eve.id });
const r3 = await call('POST', url('devCompleteSession', { sessionId: s3.id }), VerifySession, { ...proof, name: 'EVE' });
ok(r3.status === 'failed' && r3.failureReason === 'already_bound', 'the same passport cannot claim a second participant in one meeting');

const s4 = await call('POST', url('publicSessions', { joinToken: mtg.joinToken }), VerifySession, { participantId: kim.id });
const r4 = await call('POST', url('devCompleteSession', { sessionId: s4.id }), VerifySession, { passportId: 'P-KIM', name: 'KIM', nationality: 'PRK', ofacClear: true, age: 40 });
ok(r4.failureReason === 'excluded_country', 'excluded country is blocked');

const detail = await call('GET', url('meeting', { mtgId: mtg.id }), MeetingDetail);
const z = detail.participants.find((p) => p.id === zoe.id)!;
ok(z.verification.checks?.nationality?.value === 'TWN' && z.verification.checks.nameMatch.result === 'match', 'host can see check details');
await tick();
const pv = publicEvents.filter((e) => e.type === 'verification.updated');
ok(pv.length > 0 && pv.every((e) => Object.keys(e.data).sort().join() === 'participantId,status'), 'public channel verification events contain only participantId and status');

const guests = await call('GET', url('guests', { wsId }), list(Guest));
const g = guests.items.find((x) => x.id === z.verification.guestId)!;
ok(g.label === 'Zoe Wang' && g.meetingCount === 1, 'a guest record is added');
await call('POST', url('participantReset', { mtgId: mtg.id, pid: zoe.id }), Participant);
const s5 = await call('POST', url('publicSessions', { joinToken: mtg.joinToken }), VerifySession, { participantId: zoe.id });
await call('POST', url('devCompleteSession', { sessionId: s5.id }), VerifySession, proof);
const again = (await call('GET', url('meeting', { mtgId: mtg.id }), MeetingDetail)).participants.find((p) => p.id === zoe.id)!;
ok(again.verification.returning === true && again.verification.guestId === g.id, 'after reset, verifying again recognizes the same guest');
await call('DELETE', url('guest', { guestId: g.id }), null);

await call('POST', url('devLeave', { mtgId: mtg.id, pid: kim.id }), null);
await call('DELETE', url('meetingBot', { mtgId: mtg.id }), Meeting);
await call('GET', url('publicMeeting', { joinToken: 'nope' }), null, undefined, 404);
await call('POST', url('authLogout'), null);
await call('GET', url('meetings', { wsId }), null, undefined, 401);

off1();
off2();
server.close();
console.log(`mock flow ok (${n} requests, all responses match the contract schemas)`);
