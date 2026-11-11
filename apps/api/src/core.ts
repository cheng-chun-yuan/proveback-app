// Domain logic: sign-in, participants, verification sessions, applying proofs, binding guests. The route layer only handles validation and authorization.
import crypto from 'node:crypto';
import type {
  Checks, FailureReason, Guest, HostEvent, Meeting, MeetingDetail, Member, Participant, Policy, PublicEvent,
  PublicMeeting, PublicParticipant, User, Verification, VerifySession, Workspace,
} from '@proveback/contract';
import { webRoutes } from '@proveback/contract';
import type { Bus } from './bus';
import type { Config } from './config';
import { type Db, type Row, isUniqueViolation } from './db';
import { normalizeSelfUserId, selfCreateSession, selfOpenLink, type SelfOpenRequirements } from './providers';
import { ApiError, NAME_MATCH_THRESHOLD, nameScore, newId, now, sha256 } from './util';

/** The content of a proof, shared by real Self and fake mode */
export interface Proof {
  valid: boolean;
  /** reason when not valid */
  invalidReason?: 'expired' | 'proof_invalid';
  nullifier: string | null;
  name: string | null;
  nationality: string | null;
  ofacClear: boolean;
  /** actual: the real age is known (fake mode); attested: only the minimum age guaranteed by the proof is known (real Self) */
  age: { kind: 'actual'; value: number } | { kind: 'attested'; min: number | null };
}

// ---------- row -> contract object ----------
const toUser = (r: Row): User => ({ id: r.id, email: r.email, name: r.name, avatarUrl: r.avatar_url ?? null });
const toWorkspace = (r: Row): Workspace => ({ id: r.id, name: r.name, type: r.type, domain: r.domain ?? null });
const toMember = (r: Row): Member => ({ userId: r.user_id, workspaceId: r.workspace_id, email: r.email, name: r.name, role: r.role, status: r.status });
const toPolicy = (r: Row): Policy => ({
  id: r.id, workspaceId: r.workspace_id, name: r.name, isDefault: !!r.is_default, requireOfacClear: !!r.require_ofac_clear,
  excludedCountries: JSON.parse(r.excluded_countries), discloseNationality: !!r.disclose_nationality, nameMatch: r.name_match,
  minimumAge: r.minimum_age ?? null,
});
const toMeeting = (r: Row): Meeting => ({
  id: r.id, workspaceId: r.workspace_id, title: r.title, meetUrl: r.meet_url, policyId: r.policy_id, createdBy: r.created_by,
  createdAt: r.created_at, status: r.status, botStatus: r.bot_status, joinToken: r.join_token,
});
const toVerification = (r: Row): Verification => ({
  status: r.v_status, guestId: r.v_guest_id ?? null, returning: !!r.v_returning, verifiedAt: r.v_verified_at ?? null,
  checks: r.v_checks ? (JSON.parse(r.v_checks) as Checks) : null, failureReason: r.v_failure ?? null,
});
const toParticipant = (r: Row): Participant => ({
  id: r.id, meetingId: r.meeting_id, displayName: r.display_name, kind: r.kind, joinedAt: r.joined_at, leftAt: r.left_at ?? null,
  verification: toVerification(r),
});
const toPublicParticipant = (r: Row): PublicParticipant => ({ id: r.id, displayName: r.display_name, kind: r.kind, status: r.v_status });
const sessionOf = (r: Row): VerifySession => ({
  id: r.id, participantId: r.participant_id, expiresAt: r.expires_at, status: r.status, failureReason: r.failure_reason ?? null,
  selfApp: null, universalLink: r.universal_link,
});

export type Core = ReturnType<typeof createCore>;

export function createCore(cfg: Config, db: Db, bus: Bus) {
  // A Self link carries the whole app configuration and makes a QR code too dense to scan.
  // Hand out a short link on this API instead; it redirects to the stored Self link.
  const SHORT_LINK_OVER = 300;
  const toSession = (r: Row): VerifySession => {
    const s = sessionOf(r);
    return s.universalLink.length > SHORT_LINK_OVER ? { ...s, universalLink: `${cfg.publicApiUrl}/api/v1/public/sessions/${r.id}/self` } : s;
  };
  const selfLinkOf = async (sessionId: string): Promise<string | null> =>
    ((await db.get('SELECT universal_link FROM verify_sessions WHERE id = ?', sessionId))?.universal_link as string | undefined) ?? null;
  const timers = new Set<NodeJS.Timeout>();
  let stopped = false;
  /** Local only. On serverless nothing may depend on a timer firing after the response (see cfg.inlineTimers). */
  const later = (ms: number, fn: () => void | Promise<void>) => {
    const t = setTimeout(async () => {
      timers.delete(t);
      try {
        await fn();
      } catch (e) {
        if (!stopped) console.error('[timer]', e);
      }
    }, ms);
    t.unref();
    timers.add(t);
  };

  // The nullifier is not stored directly; an HMAC is stored. The key is derived from SESSION_SECRET
  const nullifierKey = crypto.createHmac('sha256', cfg.sessionSecret).update('proveback:nullifier').digest();
  const nullifierHash = (n: string) => crypto.createHmac('sha256', nullifierKey).update(n).digest('hex');

  // ---------- Events ----------
  const emit = (meetingId: string, host: Omit<HostEvent, 'meetingId' | 'at'>, pub: Omit<PublicEvent, 'meetingId' | 'at'>) => {
    const at = now();
    bus.emit({ ...host, meetingId, at } as HostEvent, { ...pub, meetingId, at } as PublicEvent);
  };
  const emitMeeting = (m: Row) =>
    emit(m.id, { type: 'meeting.updated', data: toMeeting(m) }, { type: 'meeting.updated', data: { status: m.status, botStatus: m.bot_status } });
  const emitVerification = (p: Row) =>
    emit(
      p.meeting_id,
      { type: 'verification.updated', data: { participantId: p.id, verification: toVerification(p) } },
      { type: 'verification.updated', data: { participantId: p.id, status: p.v_status } },
    );

  // ---------- Queries ----------
  const meetingRow = (id: string) => db.get('SELECT * FROM meetings WHERE id = ?', id);
  const meetingByToken = (token: string) => db.get('SELECT * FROM meetings WHERE join_token = ?', token);
  const participantRow = (id: string) => db.get('SELECT * FROM participants WHERE id = ?', id);
  const policyRow = (id: string) => db.get('SELECT * FROM policies WHERE id = ?', id);
  const memberRows = (wsId: string) =>
    db.all('SELECT m.*, u.email, u.name FROM members m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = ? ORDER BY u.email', wsId);

  async function meetingDetail(meetingId: string): Promise<MeetingDetail> {
    await sweepExpired(meetingId);
    const m = await meetingRow(meetingId);
    if (!m) throw new ApiError('not_found', 'Meeting not found');
    const ps = await db.all('SELECT * FROM participants WHERE meeting_id = ? ORDER BY joined_at, rowid', meetingId);
    return { meeting: toMeeting(m), participants: ps.map(toParticipant) };
  }

  async function publicMeeting(m: Row): Promise<PublicMeeting> {
    await sweepExpired(m.id);
    const ws = (await db.get('SELECT * FROM workspaces WHERE id = ?', m.workspace_id))!;
    const policy = toPolicy((await policyRow(m.policy_id))!);
    // The public endpoint only lists people still in the meeting, and omits checks and nationality
    const ps = await db.all('SELECT * FROM participants WHERE meeting_id = ? AND left_at IS NULL ORDER BY joined_at, rowid', m.id);
    return {
      title: m.title,
      workspaceName: ws.name,
      disclosures: {
        ofac: policy.requireOfacClear,
        excludedCountries: policy.excludedCountries,
        nationality: policy.discloseNationality,
        nameMatch: policy.nameMatch !== 'off',
        minimumAge: policy.minimumAge,
      },
      participants: ps.map(toPublicParticipant),
    };
  }

  // ---------- Sign-in ----------
  async function createWorkspace(userId: string, input: { name: string; type: 'personal' | 'company'; domain?: string | null }): Promise<Workspace> {
    const id = newId('ws');
    await db.tx(async (t) => {
      await t.run('INSERT INTO workspaces (id, name, type, domain) VALUES (?, ?, ?, ?)', id, input.name, input.type, input.type === 'company' ? (input.domain?.toLowerCase() || null) : null);
      await t.run("INSERT INTO members (workspace_id, user_id, role, status) VALUES (?, ?, 'owner', 'active')", id, userId);
      await t.run(
        "INSERT INTO policies (id, workspace_id, name, is_default, require_ofac_clear, excluded_countries, disclose_nationality, name_match, minimum_age) VALUES (?, ?, 'Default policy', 1, 1, '[]', 1, 'warn', NULL)",
        newId('pol'), id,
      );
    });
    return toWorkspace((await db.get('SELECT * FROM workspaces WHERE id = ?', id))!);
  }

  /** Called after Google (or fake sign-in) confirms identity. Returns a session token (plaintext only goes to the cookie; the database stores a hash) */
  async function login(identity: { email: string; name: string; avatarUrl: string | null }): Promise<{ user: User; token: string }> {
    const email = identity.email.toLowerCase();
    // One statement, so two concurrent first sign-ins cannot collide on the email constraint
    await db.run(
      `INSERT INTO users (id, email, name, avatar_url, activated) VALUES (?, ?, ?, ?, 1)
       ON CONFLICT (email) DO UPDATE SET name = excluded.name, avatar_url = excluded.avatar_url, activated = 1`,
      newId('usr'), email, identity.name, identity.avatarUrl,
    );
    const u = (await db.get('SELECT * FROM users WHERE email = ?', email))!;
    // Invited members become active on first sign-in
    await db.run("UPDATE members SET status = 'active' WHERE user_id = ? AND status = 'invited'", u.id);
    const hasPersonal = await db.get(
      "SELECT 1 AS x FROM workspaces w JOIN members m ON m.workspace_id = w.id WHERE m.user_id = ? AND m.role = 'owner' AND w.type = 'personal'",
      u.id,
    );
    if (!hasPersonal) await createWorkspace(u.id, { name: `${u.name}'s workspace`, type: 'personal' });
    const token = crypto.randomBytes(32).toString('base64url');
    await db.run('INSERT INTO auth_sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)', sha256(token), u.id, new Date(Date.now() + 30 * 86400_000).toISOString());
    return { user: toUser(u), token };
  }

  async function userByToken(token: string | undefined): Promise<User | null> {
    if (!token) return null;
    const s = await db.get('SELECT * FROM auth_sessions WHERE token_hash = ?', sha256(token));
    if (!s || s.expires_at < now()) return null;
    const u = await db.get('SELECT * FROM users WHERE id = ?', s.user_id);
    return u ? toUser(u) : null;
  }
  const logout = async (token: string | undefined) => {
    if (token) await db.run('DELETE FROM auth_sessions WHERE token_hash = ?', sha256(token));
  };

  const workspacesOf = async (userId: string): Promise<Workspace[]> =>
    (await db.all("SELECT w.* FROM workspaces w JOIN members m ON m.workspace_id = w.id WHERE m.user_id = ? AND m.status = 'active' ORDER BY w.type DESC, w.name", userId))
      .map(toWorkspace);

  // ---------- Participants ----------
  /** Someone joined the meeting (a Recall join event, or devJoin in fake mode) */
  async function participantJoined(meetingId: string, input: { externalId: string; name: string; email?: string | null }): Promise<Participant> {
    const m = await meetingRow(meetingId);
    if (!m) throw new ApiError('not_found', 'Meeting not found');
    const existing = await db.get('SELECT * FROM participants WHERE meeting_id = ? AND external_id = ?', meetingId, input.externalId);
    let joined = false;
    if (existing) {
      if (existing.left_at) {
        await db.run('UPDATE participants SET left_at = NULL, display_name = ? WHERE id = ?', input.name, existing.id);
        joined = true;
      }
    } else {
      const isMember =
        !!input.email &&
        !!(await db.get(
          "SELECT 1 AS x FROM members m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = ? AND m.status = 'active' AND u.email = ?",
          m.workspace_id, input.email.toLowerCase(),
        ));
      const kind = input.name === cfg.botName ? 'bot' : isMember ? 'member' : 'guest';
      const at = now();
      // Workspace members are identified by their Google account and do not go through Self: always verified, checks is null.
      // ON CONFLICT: the same join event delivered twice at once creates one row and one event
      const r = await db.run(
        'INSERT INTO participants (id, meeting_id, external_id, display_name, kind, joined_at, v_status, v_verified_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (meeting_id, external_id) DO NOTHING',
        newId('par'), meetingId, input.externalId, input.name, kind, at, kind === 'member' ? 'verified' : 'unverified', kind === 'member' ? at : null,
      );
      joined = r.changes > 0;
    }
    const p = (await db.get('SELECT * FROM participants WHERE meeting_id = ? AND external_id = ?', meetingId, input.externalId))!;
    if (joined) {
      emit(meetingId, { type: 'participant.joined', data: toParticipant(p) }, { type: 'participant.joined', data: toPublicParticipant(p) });
    }
    // Real Recall: the first participant event means the bot is already in the meeting
    if (m.bot_status === 'joining' || m.bot_status === 'waiting_room') await setBotStatus(meetingId, 'in_meeting');
    return toParticipant(p);
  }

  async function participantLeft(p: Row) {
    if (p.left_at) return;
    await db.run('UPDATE participants SET left_at = ? WHERE id = ?', now(), p.id);
    emit(p.meeting_id, { type: 'participant.left', data: { participantId: p.id } }, { type: 'participant.left', data: { participantId: p.id } });
  }
  async function participantLeftByExternalId(meetingId: string, externalId: string) {
    const p = await db.get('SELECT * FROM participants WHERE meeting_id = ? AND external_id = ?', meetingId, externalId);
    if (p) await participantLeft(p);
  }

  async function setBotStatus(meetingId: string, botStatus: Meeting['botStatus']) {
    const m = await meetingRow(meetingId);
    if (!m || m.bot_status === botStatus) return;
    const status = botStatus === 'in_meeting' ? 'live' : botStatus === 'left' ? 'ended' : m.status;
    await db.run('UPDATE meetings SET bot_status = ?, status = ? WHERE id = ?', botStatus, status, meetingId);
    emitMeeting((await meetingRow(meetingId))!);
  }

  async function resetParticipant(p: Row): Promise<Participant> {
    await db.tx(async (t) => {
      await t.run('DELETE FROM bindings WHERE meeting_id = ? AND participant_id = ?', p.meeting_id, p.id);
      await t.run("UPDATE verify_sessions SET status = 'expired', failure_reason = 'expired' WHERE participant_id = ? AND status = 'pending'", p.id);
      await t.run(
        "UPDATE participants SET v_status = 'unverified', v_guest_id = NULL, v_returning = 0, v_verified_at = NULL, v_checks = NULL, v_failure = NULL WHERE id = ?",
        p.id,
      );
    });
    const fresh = (await participantRow(p.id))!;
    emitVerification(fresh);
    return toParticipant(fresh);
  }

  // ---------- Verification sessions ----------
  async function setParticipantFailed(participantId: string, reason: FailureReason, checks: Checks | null) {
    await db.run(
      "UPDATE participants SET v_status = 'failed', v_guest_id = NULL, v_returning = 0, v_verified_at = NULL, v_checks = ?, v_failure = ? WHERE id = ?",
      checks ? JSON.stringify(checks) : null, reason, participantId,
    );
    emitVerification((await participantRow(participantId))!);
  }

  async function failSession(s: Row, reason: FailureReason, checks: Checks | null = null) {
    // Only a session that is still pending can fail, so two requests racing on one session produce one result
    const r = await db.run("UPDATE verify_sessions SET status = ?, failure_reason = ? WHERE id = ? AND status = 'pending'", reason === 'expired' ? 'expired' : 'failed', reason, s.id);
    if (r.changes) await setParticipantFailed(s.participant_id, reason, checks);
  }

  /** Timeout handling: called on reads (and by the local timer); only affects sessions that are still pending */
  async function expireIfDue(sessionId: string) {
    const s = await db.get('SELECT * FROM verify_sessions WHERE id = ?', sessionId);
    if (s && s.status === 'pending' && s.expires_at <= now()) await failSession(s, 'expired');
  }
  async function sweepExpired(meetingId: string) {
    const due = await db.all("SELECT * FROM verify_sessions WHERE meeting_id = ? AND status = 'pending' AND expires_at <= ?", meetingId, now());
    for (const s of due) await failSession(s, 'expired');
  }

  /** What a policy needs disclosed. Nationality is requested only when the policy shows it or has to check it against a list. */
  const requirementsOf = (pol: Row): SelfOpenRequirements => ({
    name: pol.name_match !== 'off',
    nationality: !!pol.disclose_nationality || JSON.parse(pol.excluded_countries).length > 0,
    ofac: !!pol.require_ofac_clear,
    minimumAge: pol.minimum_age ?? null,
  });

  /** Open SDK: find the pending session behind a Self user id, with what it was asked to prove */
  async function selfOpenSession(selfUserId: string): Promise<{ sessionId: string; requirements: SelfOpenRequirements } | null> {
    const s = await db.get('SELECT id, meeting_id FROM verify_sessions WHERE self_session_id = ?', normalizeSelfUserId(selfUserId));
    const m = s && (await meetingRow(s.meeting_id));
    const pol = m && (await policyRow(m.policy_id));
    return pol ? { sessionId: s!.id, requirements: requirementsOf(pol) } : null;
  }

  async function createSession(m: Row, participantId: string): Promise<VerifySession> {
    const p = await participantRow(participantId);
    if (!p || p.meeting_id !== m.id) throw new ApiError('not_found', 'Participant not found in this meeting');
    if (p.kind !== 'guest') throw new ApiError('validation_failed', 'Only guests need to verify');
    if (p.left_at) throw new ApiError('conflict', 'Participant has left the meeting');
    if (p.v_status === 'verified') throw new ApiError('conflict', 'Participant is already verified');

    const id = newId('vs');
    const expiresAt = new Date(Date.now() + cfg.sessionTtlSec * 1000).toISOString();
    let universalLink = cfg.webUrl + webRoutes.devSelf(id);
    let selfSessionId: string | null = null;
    if (cfg.self) {
      const created = await selfCreateSession(cfg, { sessionId: id, joinToken: m.join_token });
      universalLink = created.verificationUrl;
      selfSessionId = created.selfSessionId;
    } else if (cfg.selfOpen) {
      // Open SDK: the Self user id is a fresh UUID; the proof comes back carrying it
      const userId = crypto.randomUUID();
      universalLink = selfOpenLink(cfg, userId, requirementsOf((await policyRow(m.policy_id))!));
      selfSessionId = normalizeSelfUserId(userId);
    }
    await db.tx(async (t) => {
      // A participant has only one active session at a time
      await t.run("UPDATE verify_sessions SET status = 'expired', failure_reason = 'expired' WHERE participant_id = ? AND status = 'pending'", p.id);
      await t.run(
        "INSERT INTO verify_sessions (id, participant_id, meeting_id, expires_at, status, universal_link, self_session_id) VALUES (?, ?, ?, ?, 'pending', ?, ?)",
        id, p.id, m.id, expiresAt, universalLink, selfSessionId,
      );
      await t.run("UPDATE participants SET v_status = 'pending', v_guest_id = NULL, v_returning = 0, v_verified_at = NULL, v_checks = NULL, v_failure = NULL WHERE id = ?", p.id);
    });
    emitVerification((await participantRow(p.id))!);
    // Expiry is enforced on every read; the timer only makes it show up promptly on a long-lived local process
    if (!cfg.inlineTimers) later(cfg.sessionTtlSec * 1000 + 50, () => expireIfDue(id));
    return toSession((await db.get('SELECT * FROM verify_sessions WHERE id = ?', id))!);
  }

  async function getSession(sessionId: string): Promise<VerifySession> {
    await expireIfDue(sessionId);
    const s = await db.get('SELECT * FROM verify_sessions WHERE id = ?', sessionId);
    if (!s) throw new ApiError('not_found', 'Session not found');
    return toSession(s);
  }

  /** Apply a proof. Order: proof_invalid -> ofac -> excluded_country -> underage -> name_mismatch -> binding */
  async function applyProof(sessionId: string, proof: Proof): Promise<VerifySession> {
    await expireIfDue(sessionId);
    const s = await db.get('SELECT * FROM verify_sessions WHERE id = ?', sessionId);
    if (!s) throw new ApiError('not_found', 'Session not found');
    if (s.status !== 'pending') return toSession(s); // Already has a result (or is no longer valid); do not process again

    const p = (await participantRow(s.participant_id))!;
    const m = (await meetingRow(s.meeting_id))!;
    const policy = toPolicy((await policyRow(m.policy_id))!);

    const done = async () => toSession((await db.get('SELECT * FROM verify_sessions WHERE id = ?', sessionId))!);
    const fail = async (reason: FailureReason, checks: Checks | null = null) => {
      await failSession(s, reason, checks);
      return done();
    };
    if (!proof.valid) return fail(proof.invalidReason ?? 'proof_invalid');
    if (!proof.nullifier) return fail('proof_invalid');

    const needNationality = policy.excludedCountries.length > 0 || policy.discloseNationality;
    if (needNationality && !proof.nationality) return fail('proof_invalid');

    const ageOk =
      policy.minimumAge == null
        ? null
        : proof.age.kind === 'actual'
          ? proof.age.value >= policy.minimumAge
          : proof.age.min != null && proof.age.min >= policy.minimumAge;

    let nameMatch: Checks['nameMatch'] = { result: 'skipped', score: null };
    if (policy.nameMatch !== 'off') {
      const score = proof.name ? nameScore(p.display_name, proof.name) : 0;
      nameMatch = { result: score >= NAME_MATCH_THRESHOLD ? 'match' : 'mismatch', score };
    }
    // The name is not used past this point and is never written to the database

    const checks: Checks = {
      ofac: policy.requireOfacClear ? (proof.ofacClear ? 'pass' : 'fail') : 'skipped',
      nationality: needNationality
        ? { allowed: !policy.excludedCountries.includes(proof.nationality!), value: policy.discloseNationality ? proof.nationality : null }
        : null,
      nameMatch,
      age: ageOk == null ? 'skipped' : ageOk ? 'pass' : 'fail',
    };

    const reason: FailureReason | null =
      checks.ofac === 'fail' ? 'ofac'
      : checks.nationality && !checks.nationality.allowed ? 'excluded_country'
      : checks.age === 'fail' ? 'underage'
      : policy.nameMatch === 'require' && nameMatch.result === 'mismatch' ? 'name_mismatch'
      : null;
    if (reason) return fail(reason, checks);

    // Bind the guest. Uniqueness relies entirely on database constraints:
    //   guests   UNIQUE (workspace_id, nullifier_hash) -> upsert
    //   bindings UNIQUE (meeting_id, guest_id)         -> a conflict means already_bound
    // The session and participant results are written in the same transaction, so a second request racing on this
    // session sees either 'pending' or the final result, never a half-applied one.
    const at = now();
    const hash = nullifierHash(proof.nullifier);
    const candidateId = newId('gst');
    let claimed = true;
    try {
      await db.tx(async (t) => {
        const claim = await t.run("UPDATE verify_sessions SET status = 'verified', failure_reason = NULL WHERE id = ? AND status = 'pending'", s.id);
        if (!claim.changes) {
          claimed = false; // another request already settled this session
          return;
        }
        const g = (await t.get(
          `INSERT INTO guests (id, workspace_id, nullifier_hash, label, nationality, first_seen_at, last_verified_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (workspace_id, nullifier_hash)
           DO UPDATE SET label = excluded.label, nationality = excluded.nationality, last_verified_at = excluded.last_verified_at
           RETURNING id`,
          candidateId, m.workspace_id, hash, p.display_name, policy.discloseNationality ? proof.nationality : null, at, at,
        ))!;
        const guestId: string = g.id;
        await t.run('INSERT INTO bindings (meeting_id, guest_id, participant_id) VALUES (?, ?, ?)', m.id, guestId, p.id);
        await t.run(
          "UPDATE participants SET v_status = 'verified', v_guest_id = ?, v_returning = ?, v_verified_at = ?, v_checks = ?, v_failure = NULL WHERE id = ?",
          guestId, guestId === candidateId ? 0 : 1, at, JSON.stringify(checks), p.id,
        );
      });
    } catch (e) {
      if (isUniqueViolation(e)) return fail('already_bound', checks);
      throw e;
    }
    if (claimed) emitVerification((await participantRow(p.id))!);
    return done();
  }

  // ---------- Guest roster ----------
  const guests = async (wsId: string): Promise<Guest[]> =>
    (
      await db.all(
        `SELECT g.*, (SELECT COUNT(*) FROM bindings b WHERE b.guest_id = g.id) AS meeting_count
         FROM guests g WHERE g.workspace_id = ? ORDER BY g.last_verified_at DESC`,
        wsId,
      )
    ).map((r) => ({
      id: r.id, workspaceId: r.workspace_id, label: r.label, nationality: r.nationality ?? null, firstSeenAt: r.first_seen_at,
      lastVerifiedAt: r.last_verified_at, meetingCount: Number(r.meeting_count), revoked: !!r.revoked,
    }));

  /** Revoke: clear the nullifier hash, so the same passport appearing again is a new guest */
  const revokeGuest = (guestId: string) => db.run('UPDATE guests SET revoked = 1, nullifier_hash = NULL WHERE id = ?', guestId);

  return {
    toUser, toWorkspace, toMember, toPolicy, toMeeting, toParticipant,
    meetingRow, meetingByToken, participantRow, policyRow, memberRows,
    meetingDetail, publicMeeting,
    createWorkspace, login, userByToken, logout, workspacesOf,
    participantJoined, participantLeft, participantLeftByExternalId, setBotStatus, resetParticipant,
    createSession, getSession, selfLinkOf, applyProof, selfOpenSession, guests, revokeGuest, later,
    stop: () => {
      stopped = true;
      for (const t of timers) clearTimeout(t);
      timers.clear();
    },
  };
}
