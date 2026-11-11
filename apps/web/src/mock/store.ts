// Stand-in for the backend in mock mode: in-memory state that behaves like the backend's fake-data mode.
// Loaded only when VITE_MOCK=1, so it stays off the main path of the production bundle.
import {
  type AddMemberBody, type Checks, type CreateMeetingBody, type CreatePolicyBody, type CreateWorkspaceBody,
  type DevCompleteSessionBody, type DevJoinBody, type DevLoginBody, type DevStatus, type ErrorCode, type FailureReason,
  type Guest, type HostEvent, type Meeting, type MeetingDetail, type Member, type MeResponse, type Participant,
  type Policy, type PublicEvent, type PublicMeeting, type PublicParticipant, type UpdatePolicyBody, type User,
  type Verification, type VerifySession, type Workspace,
  mockGuests, mockMeetings, mockMembers, mockParticipants, mockPolicies, mockUser, mockWorkspaces, webRoutes,
} from '@proveback/contract';

export class MockError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
const notFound = (what: string) => new MockError('not_found', `${what} not found`, 404);
const conflict = (msg: string) => new MockError('conflict', msg, 409);

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const rid = (prefix: string) => `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
const now = () => new Date().toISOString();
const inBrowser = typeof window !== 'undefined';
const origin = inBrowser ? location.origin : 'http://localhost:5173';

const UNVERIFIED: Verification = { status: 'unverified', guestId: null, returning: false, verifiedAt: null, checks: null, failureReason: null };

const db = {
  user: null as User | null,
  workspaces: clone(mockWorkspaces) as Workspace[],
  members: [
    ...clone(mockMembers),
    { userId: mockUser.id, workspaceId: 'ws_alice', email: mockUser.email, name: mockUser.name, role: 'owner', status: 'active' },
  ] as Member[],
  policies: [
    ...clone(mockPolicies),
    {
      id: 'pol_personal', workspaceId: 'ws_alice', name: 'Default policy', isDefault: true, requireOfacClear: true,
      excludedCountries: [], discloseNationality: true, nameMatch: 'warn', minimumAge: null,
    },
  ] as Policy[],
  meetings: clone(mockMeetings) as Meeting[],
  participants: clone(mockParticipants) as Participant[],
  guests: clone(mockGuests) as Guest[],
  sessions: new Map<string, VerifySession>(),
  // Simulates UNIQUE (workspace_id, nullifier_hash) and UNIQUE (meeting_id, guest_id)
  passports: new Map<string, string>([['ws_acme:P-KEN', 'gst_ken']]),
  bindings: new Map<string, string>([['mtg_demo:gst_ken', 'par_ken']]),
};

// ---------- Shared across tabs ----------
// The host page, guest page and simulated Self page are usually open in different tabs, so state lives in localStorage,
// is re-read before every call and written back after; events are relayed to other tabs through BroadcastChannel.
const DB_KEY = 'pb-mock-db-v1';
const channel = inBrowser && typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('pb-mock') : null;

function persist() {
  if (!inBrowser) return;
  try {
    localStorage.setItem(DB_KEY, JSON.stringify({ ...db, sessions: [...db.sessions], passports: [...db.passports], bindings: [...db.bindings] }));
  } catch {
    /* If it cannot be saved, state stays in this tab only */
  }
}
function load() {
  if (!inBrowser) return;
  try {
    const raw = localStorage.getItem(DB_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw) as Record<string, unknown>;
    Object.assign(db, saved, {
      sessions: new Map(saved.sessions as [string, VerifySession][]),
      passports: new Map(saved.passports as [string, string][]),
      bindings: new Map(saved.bindings as [string, string][]),
    });
  } catch {
    /* Ignore corrupted stored data */
  }
}
load();

/** Clear mock data and return to the initial state */
export function resetMock() {
  if (inBrowser) localStorage.removeItem(DB_KEY);
}

// ---------- Events ----------
const hostSubs = new Map<string, Set<(e: HostEvent) => void>>();
const publicSubs = new Map<string, Set<(e: PublicEvent) => void>>();

const toPublic = (p: Participant): PublicParticipant => ({ id: p.id, displayName: p.displayName, kind: p.kind, status: p.verification.status });

interface Relay { mtgId: string; joinToken: string; host: HostEvent; pub: PublicEvent }
function deliver(r: Relay) {
  hostSubs.get(r.mtgId)?.forEach((cb) => cb(r.host));
  publicSubs.get(r.joinToken)?.forEach((cb) => cb(r.pub));
}
channel?.addEventListener('message', (e: MessageEvent<Relay>) => deliver(e.data));

function emit(meeting: Meeting, host: Omit<HostEvent, 'meetingId' | 'at'>, pub: Omit<PublicEvent, 'meetingId' | 'at'>) {
  const base = { meetingId: meeting.id, at: now() };
  const relay: Relay = {
    mtgId: meeting.id,
    joinToken: meeting.joinToken,
    host: clone({ ...host, ...base }) as HostEvent,
    pub: clone({ ...pub, ...base }) as PublicEvent,
  };
  setTimeout(() => {
    deliver(relay);
    channel?.postMessage(relay);
  }, 0);
}
const emitMeeting = (m: Meeting) =>
  emit(m, { type: 'meeting.updated', data: m }, { type: 'meeting.updated', data: { status: m.status, botStatus: m.botStatus } });
const emitJoined = (m: Meeting, p: Participant) => emit(m, { type: 'participant.joined', data: p }, { type: 'participant.joined', data: toPublic(p) });
const emitLeft = (m: Meeting, p: Participant) =>
  emit(m, { type: 'participant.left', data: { participantId: p.id } }, { type: 'participant.left', data: { participantId: p.id } });
const emitVerification = (m: Meeting, p: Participant) =>
  emit(
    m,
    { type: 'verification.updated', data: { participantId: p.id, verification: p.verification } },
    { type: 'verification.updated', data: { participantId: p.id, status: p.verification.status } },
  );

function subscribe<E>(subs: Map<string, Set<(e: E) => void>>, key: string, cb: (e: E) => void, snapshot: () => E | null) {
  const set = subs.get(key) ?? new Set();
  subs.set(key, set);
  set.add(cb);
  // Same as the backend: the first event after connecting is a snapshot
  setTimeout(() => {
    if (!set.has(cb)) return;
    load();
    const s = snapshot();
    if (s) cb(s);
  }, 0);
  return () => {
    set.delete(cb);
  };
}

export function subscribeHost(mtgId: string, cb: (e: HostEvent) => void) {
  return subscribe(hostSubs, mtgId, cb, () => {
    const m = db.meetings.find((x) => x.id === mtgId);
    return m ? (clone({ type: 'snapshot', meetingId: m.id, at: now(), data: detail(m) }) as HostEvent) : null;
  });
}
export function subscribePublic(joinToken: string, cb: (e: PublicEvent) => void) {
  return subscribe(publicSubs, joinToken, cb, () => {
    const m = db.meetings.find((x) => x.joinToken === joinToken);
    return m ? (clone({ type: 'snapshot', meetingId: m.id, at: now(), data: publicView(m) }) as PublicEvent) : null;
  });
}

// ---------- Lookups ----------
function me(): User {
  if (!db.user) throw new MockError('unauthenticated', 'You are not signed in. Sign in and try again.', 401);
  return db.user;
}
function workspace(wsId: string): Workspace {
  const u = me();
  const ws = db.workspaces.find((w) => w.id === wsId);
  if (!ws) throw notFound(' workspace');
  if (!db.members.some((m) => m.workspaceId === wsId && m.userId === u.id)) throw new MockError('forbidden', 'You are not a member of this workspace', 403);
  return ws;
}
function meeting(mtgId: string): Meeting {
  const m = db.meetings.find((x) => x.id === mtgId);
  if (!m) throw notFound('Meeting');
  workspace(m.workspaceId);
  return m;
}
function meetingByToken(joinToken: string): Meeting {
  const m = db.meetings.find((x) => x.joinToken === joinToken);
  if (!m) throw notFound('Meeting (the link may be invalid or expired)');
  return m;
}
function policyOf(m: Meeting): Policy {
  const p = db.policies.find((x) => x.id === m.policyId);
  if (!p) throw notFound('Policy');
  return p;
}
function participant(m: Meeting, pid: string): Participant {
  const p = db.participants.find((x) => x.id === pid && x.meetingId === m.id);
  if (!p) throw notFound('Participant');
  return p;
}
const detail = (m: Meeting): MeetingDetail => ({ meeting: m, participants: db.participants.filter((p) => p.meetingId === m.id) });

function publicView(m: Meeting): PublicMeeting {
  const pol = policyOf(m);
  return {
    title: m.title,
    workspaceName: db.workspaces.find((w) => w.id === m.workspaceId)?.name ?? '',
    disclosures: {
      ofac: pol.requireOfacClear,
      excludedCountries: pol.excludedCountries,
      nationality: pol.discloseNationality,
      nameMatch: pol.nameMatch !== 'off',
      minimumAge: pol.minimumAge,
    },
    participants: db.participants.filter((p) => p.meetingId === m.id && !p.leftAt).map(toPublic),
  };
}

function expireSessions(pid: string) {
  for (const s of db.sessions.values()) if (s.participantId === pid && s.status === 'pending') s.status = 'expired';
}

// ---------- Endpoints ----------
const impl = {
  devStatus: (): DevStatus => ({ fake: { google: true, recall: true, self: true } }),

  devLogin(body: DevLoginBody): void {
    // Mock mode has a single user: reuse a fixed ID so existing workspace memberships stay valid
    db.user = { ...mockUser, email: body.email, name: body.name };
    for (const m of db.members) if (m.userId === mockUser.id) Object.assign(m, { email: body.email, name: body.name });
  },
  logout(): void {
    db.user = null;
  },
  me(): MeResponse {
    const u = me();
    const ids = new Set(db.members.filter((m) => m.userId === u.id).map((m) => m.workspaceId));
    return { user: u, workspaces: db.workspaces.filter((w) => ids.has(w.id)) };
  },

  createWorkspace(body: CreateWorkspaceBody): Workspace {
    const u = me();
    const ws: Workspace = { id: rid('ws'), name: body.name, type: body.type, domain: body.type === 'company' ? (body.domain ?? null) : null };
    db.workspaces.push(ws);
    db.members.push({ userId: u.id, workspaceId: ws.id, email: u.email, name: u.name, role: 'owner', status: 'active' });
    db.policies.push({
      id: rid('pol'), workspaceId: ws.id, name: 'Default policy', isDefault: true, requireOfacClear: true,
      excludedCountries: [], discloseNationality: true, nameMatch: 'warn', minimumAge: null,
    });
    return ws;
  },
  getWorkspace: (wsId: string) => workspace(wsId),

  members: (wsId: string) => ({ items: db.members.filter((m) => m.workspaceId === workspace(wsId).id) }),
  addMember(wsId: string, body: AddMemberBody): Member {
    workspace(wsId);
    if (db.members.some((m) => m.workspaceId === wsId && m.email === body.email)) throw conflict('This email address is already a member of the workspace');
    const member: Member = { userId: rid('usr'), workspaceId: wsId, email: body.email, name: body.email, role: body.role, status: 'invited' };
    db.members.push(member);
    return member;
  },
  updateMember(wsId: string, userId: string, role: Member['role']): Member {
    workspace(wsId);
    const m = db.members.find((x) => x.workspaceId === wsId && x.userId === userId);
    if (!m) throw notFound('Member');
    if (m.role === 'owner' && role !== 'owner' && !db.members.some((x) => x.workspaceId === wsId && x.role === 'owner' && x !== m)) {
      throw conflict('A workspace must have at least one owner');
    }
    m.role = role;
    return m;
  },
  removeMember(wsId: string, userId: string): void {
    workspace(wsId);
    const m = db.members.find((x) => x.workspaceId === wsId && x.userId === userId);
    if (!m) throw notFound('Member');
    if (m.role === 'owner' && !db.members.some((x) => x.workspaceId === wsId && x.role === 'owner' && x !== m)) {
      throw conflict('You cannot remove the only owner');
    }
    db.members = db.members.filter((x) => x !== m);
  },

  policies: (wsId: string) => ({ items: db.policies.filter((p) => p.workspaceId === workspace(wsId).id) }),
  createPolicy(wsId: string, body: CreatePolicyBody): Policy {
    workspace(wsId);
    const p: Policy = { ...body, id: rid('pol'), workspaceId: wsId };
    if (p.isDefault) for (const o of db.policies) if (o.workspaceId === wsId) o.isDefault = false;
    db.policies.push(p);
    return p;
  },
  updatePolicy(policyId: string, body: UpdatePolicyBody): Policy {
    const p = db.policies.find((x) => x.id === policyId);
    if (!p) throw notFound('Policy');
    workspace(p.workspaceId);
    if (body.isDefault) for (const o of db.policies) if (o.workspaceId === p.workspaceId) o.isDefault = false;
    Object.assign(p, body);
    return p;
  },
  deletePolicy(policyId: string): void {
    const p = db.policies.find((x) => x.id === policyId);
    if (!p) throw notFound('Policy');
    workspace(p.workspaceId);
    if (db.meetings.some((m) => m.policyId === policyId)) throw conflict('This policy is used by existing meetings and cannot be deleted. Change those meetings first');
    db.policies = db.policies.filter((x) => x !== p);
  },

  meetings: (wsId: string) => ({ items: db.meetings.filter((m) => m.workspaceId === workspace(wsId).id) }),
  createMeeting(wsId: string, body: CreateMeetingBody): Meeting {
    workspace(wsId);
    if (!db.policies.some((p) => p.id === body.policyId && p.workspaceId === wsId)) throw notFound('Policy');
    const m: Meeting = {
      id: rid('mtg'), workspaceId: wsId, title: body.title, meetUrl: body.meetUrl, policyId: body.policyId,
      createdBy: me().id, createdAt: now(), status: 'scheduled', botStatus: 'idle', joinToken: rid('jt'),
    };
    db.meetings.push(m);
    return m;
  },
  meeting: (mtgId: string) => detail(meeting(mtgId)),

  sendBot(mtgId: string): Meeting {
    const m = meeting(mtgId);
    if (['joining', 'waiting_room', 'in_meeting'].includes(m.botStatus)) throw conflict('The bot has already been sent');
    m.botStatus = 'joining';
    emitMeeting(m);
    setTimeout(() => {
      // Another tab may have changed the data; re-read it and look up this meeting again
      load();
      const cur = db.meetings.find((x) => x.id === mtgId);
      if (!cur || cur.botStatus !== 'joining') return;
      cur.botStatus = 'in_meeting';
      cur.status = 'live';
      emitMeeting(cur);
      const bot: Participant = { id: rid('par'), meetingId: cur.id, displayName: 'ProveBack', kind: 'bot', joinedAt: now(), leftAt: null, verification: UNVERIFIED };
      db.participants.push(bot);
      emitJoined(cur, bot);
      persist();
    }, 900);
    return m;
  },
  recallBot(mtgId: string): Meeting {
    const m = meeting(mtgId);
    m.botStatus = 'left';
    m.status = 'ended';
    emitMeeting(m);
    for (const p of db.participants) {
      if (p.meetingId === m.id && p.kind === 'bot' && !p.leftAt) {
        p.leftAt = now();
        emitLeft(m, p);
      }
    }
    return m;
  },
  resetParticipant(mtgId: string, pid: string): Participant {
    const m = meeting(mtgId);
    const p = participant(m, pid);
    if (p.kind !== 'guest') throw conflict('Only guests need to be verified');
    if (p.verification.guestId) db.bindings.delete(`${m.id}:${p.verification.guestId}`);
    expireSessions(p.id);
    p.verification = UNVERIFIED;
    emitVerification(m, p);
    return p;
  },

  guests: (wsId: string) => ({ items: db.guests.filter((g) => g.workspaceId === workspace(wsId).id) }),
  revokeGuest(guestId: string): void {
    const g = db.guests.find((x) => x.id === guestId);
    if (!g) throw notFound('Guest');
    workspace(g.workspaceId);
    g.revoked = true;
    // After revoking, the same passport appearing again counts as a new guest
    for (const [k, v] of db.passports) if (v === guestId) db.passports.delete(k);
  },

  devJoin(mtgId: string, body: DevJoinBody): Participant {
    const m = meeting(mtgId);
    const isMember = !!body.email && db.members.some((x) => x.workspaceId === m.workspaceId && x.email === body.email);
    const p: Participant = {
      id: rid('par'), meetingId: m.id, displayName: body.displayName, kind: isMember ? 'member' : 'guest', joinedAt: now(), leftAt: null,
      verification: isMember ? { ...UNVERIFIED, status: 'verified', verifiedAt: now() } : UNVERIFIED,
    };
    db.participants.push(p);
    emitJoined(m, p);
    return p;
  },
  devLeave(mtgId: string, pid: string): void {
    const m = meeting(mtgId);
    const p = participant(m, pid);
    if (p.leftAt) return;
    p.leftAt = now();
    emitLeft(m, p);
  },

  // ---------- Public endpoints ----------
  publicMeeting: (joinToken: string) => publicView(meetingByToken(joinToken)),

  createSession(joinToken: string, participantId: string): VerifySession {
    const m = meetingByToken(joinToken);
    const p = participant(m, participantId);
    if (p.kind !== 'guest' || p.leftAt) throw new MockError('validation_failed', 'This participant does not need verification or cannot be verified', 400);
    if (p.verification.status === 'verified') throw conflict('This participant is already verified');
    expireSessions(p.id); // A participant has only one active session at a time
    const s: VerifySession = {
      id: rid('vs'), participantId: p.id, expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(), status: 'pending',
      failureReason: null, selfApp: null, universalLink: origin + webRoutes.devSelf(''),
    };
    s.universalLink = origin + webRoutes.devSelf(s.id);
    db.sessions.set(s.id, s);
    p.verification = { ...UNVERIFIED, status: 'pending' };
    emitVerification(m, p);
    return s;
  },

  publicSession(sessionId: string): VerifySession {
    const s = db.sessions.get(sessionId);
    if (!s) throw notFound('Verification session');
    if (s.status === 'pending' && Date.parse(s.expiresAt) < Date.now()) {
      s.status = 'expired';
      s.failureReason = 'expired';
      const p = db.participants.find((x) => x.id === s.participantId);
      const m = p && db.meetings.find((x) => x.id === p.meetingId);
      if (p && m && p.verification.status === 'pending') {
        p.verification = { ...UNVERIFIED, status: 'failed', failureReason: 'expired' };
        emitVerification(m, p);
      }
    }
    return s;
  },

  devCompleteSession(sessionId: string, proof: DevCompleteSessionBody): VerifySession {
    const s = impl.publicSession(sessionId);
    if (s.status === 'expired') throw new MockError('expired', 'This verification link has expired. Ask for a new one', 410);
    if (s.status !== 'pending') throw conflict('This verification is already complete');
    const p = db.participants.find((x) => x.id === s.participantId);
    const m = p && db.meetings.find((x) => x.id === p.meetingId);
    if (!p || !m) throw notFound('Participant');
    const pol = policyOf(m);

    const score = pol.nameMatch === 'off' ? null : nameScore(proof.name, p.displayName);
    const checks: Checks = {
      ofac: pol.requireOfacClear ? (proof.ofacClear ? 'pass' : 'fail') : 'skipped',
      nationality: {
        allowed: !pol.excludedCountries.includes(proof.nationality),
        value: pol.discloseNationality ? proof.nationality : null,
      },
      nameMatch: score === null ? { result: 'skipped', score: null } : { result: score >= 0.6 ? 'match' : 'mismatch', score },
      age: pol.minimumAge === null ? 'skipped' : proof.age >= pol.minimumAge ? 'pass' : 'fail',
    };

    let reason: FailureReason | null = null;
    if (checks.ofac === 'fail') reason = 'ofac';
    else if (!checks.nationality?.allowed) reason = 'excluded_country';
    else if (checks.age === 'fail') reason = 'underage';
    else if (pol.nameMatch === 'require' && checks.nameMatch.result === 'mismatch') reason = 'name_mismatch';

    let guestId: string | null = null;
    let returning = false;
    if (!reason) {
      const key = `${m.workspaceId}:${proof.passportId}`;
      const existing = db.passports.get(key);
      const bound = existing ? db.bindings.get(`${m.id}:${existing}`) : undefined;
      if (existing && bound && bound !== p.id) {
        reason = 'already_bound';
      } else if (existing) {
        const g = db.guests.find((x) => x.id === existing);
        returning = true;
        guestId = existing;
        if (g) {
          g.label = p.displayName;
          g.lastVerifiedAt = now();
          g.nationality = checks.nationality?.value ?? g.nationality;
          if (!bound) g.meetingCount += 1;
        }
      } else {
        guestId = rid('gst');
        db.guests.push({
          id: guestId, workspaceId: m.workspaceId, label: p.displayName, nationality: checks.nationality?.value ?? null,
          firstSeenAt: now(), lastVerifiedAt: now(), meetingCount: 1, revoked: false,
        });
        db.passports.set(key, guestId);
      }
      if (guestId) db.bindings.set(`${m.id}:${guestId}`, p.id);
    }

    p.verification = reason
      ? { status: 'failed', guestId: null, returning: false, verifiedAt: null, checks, failureReason: reason }
      : { status: 'verified', guestId, returning, verifiedAt: now(), checks, failureReason: null };
    s.status = reason ? 'failed' : 'verified';
    s.failureReason = reason;
    emitVerification(m, p);
    return s;
  },
};

// Before each call, read back changes from other tabs; after it (including when it throws, e.g. session timeout), write back
export const mockApi = new Proxy(impl, {
  get(target, key, receiver) {
    const fn = Reflect.get(target, key, receiver) as unknown;
    if (typeof fn !== 'function') return fn;
    return (...args: unknown[]) => {
      load();
      try {
        return (fn as (...a: unknown[]) => unknown).apply(target, args);
      } finally {
        persist();
      }
    };
  },
});

/** Name match: strip diacritics, uppercase, split into words, then compute the overlap ratio (word order does not matter) */
function nameScore(a: string, b: string): number {
  const tokens = (s: string) =>
    new Set(s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^\p{L}]+/gu, ' ').trim().split(' ').filter(Boolean));
  const x = tokens(a);
  const y = tokens(b);
  if (!x.size || !y.size) return 0;
  const common = [...x].filter((t) => y.has(t)).length;
  return Math.round((common / new Set([...x, ...y]).size) * 100) / 100;
}
