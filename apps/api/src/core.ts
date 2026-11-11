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
const toSession = (r: Row): VerifySession => ({
  id: r.id, participantId: r.participant_id, expiresAt: r.expires_at, status: r.status, failureReason: r.failure_reason ?? null,
  selfApp: null, universalLink: r.universal_link,
});

export type Core = ReturnType<typeof createCore>;

export function createCore(cfg: Config, db: Db, bus: Bus) {
  const timers = new Set<NodeJS.Timeout>();
  const later = (ms: number, fn: () => void) => {
    const t = setTimeout(() => {
      timers.delete(t);
      try {
        fn();
      } catch (e) {
        console.error('[timer]', e);
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

  function meetingDetail(meetingId: string): MeetingDetail {
    sweepExpired(meetingId);
    const m = meetingRow(meetingId);
    if (!m) throw new ApiError('not_found', 'Meeting not found');
    const ps = db.all('SELECT * FROM participants WHERE meeting_id = ? ORDER BY joined_at, rowid', meetingId);
    return { meeting: toMeeting(m), participants: ps.map(toParticipant) };
  }

  function publicMeeting(m: Row): PublicMeeting {
    sweepExpired(m.id);
    const ws = db.get('SELECT * FROM workspaces WHERE id = ?', m.workspace_id)!;
    const policy = toPolicy(policyRow(m.policy_id)!);
    // The public endpoint only lists people still in the meeting, and omits checks and nationality
    const ps = db.all('SELECT * FROM participants WHERE meeting_id = ? AND left_at IS NULL ORDER BY joined_at, rowid', m.id);
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
  function createWorkspace(userId: string, input: { name: string; type: 'personal' | 'company'; domain?: string | null }): Workspace {
    const id = newId('ws');
    db.tx(() => {
      db.run('INSERT INTO workspaces (id, name, type, domain) VALUES (?, ?, ?, ?)', id, input.name, input.type, input.type === 'company' ? (input.domain?.toLowerCase() || null) : null);
      db.run("INSERT INTO members (workspace_id, user_id, role, status) VALUES (?, ?, 'owner', 'active')", id, userId);
      db.run(
        "INSERT INTO policies (id, workspace_id, name, is_default, require_ofac_clear, excluded_countries, disclose_nationality, name_match, minimum_age) VALUES (?, ?, 'Default policy', 1, 1, '[]', 1, 'warn', NULL)",
        newId('pol'), id,
      );
    });
    return toWorkspace(db.get('SELECT * FROM workspaces WHERE id = ?', id)!);
  }

  /** Called after Google (or fake sign-in) confirms identity. Returns a session token (plaintext only goes to the cookie; the database stores a hash) */
  function login(identity: { email: string; name: string; avatarUrl: string | null }): { user: User; token: string } {
    const email = identity.email.toLowerCase();
    let u = db.get('SELECT * FROM users WHERE email = ?', email);
    if (!u) {
      db.run('INSERT INTO users (id, email, name, avatar_url, activated) VALUES (?, ?, ?, ?, 1)', newId('usr'), email, identity.name, identity.avatarUrl);
    } else {
      db.run('UPDATE users SET name = ?, avatar_url = ?, activated = 1 WHERE id = ?', identity.name, identity.avatarUrl, u.id);
    }
    u = db.get('SELECT * FROM users WHERE email = ?', email)!;
    // Invited members become active on first sign-in
    db.run("UPDATE members SET status = 'active' WHERE user_id = ? AND status = 'invited'", u.id);
    const hasPersonal = db.get(
      "SELECT 1 AS x FROM workspaces w JOIN members m ON m.workspace_id = w.id WHERE m.user_id = ? AND m.role = 'owner' AND w.type = 'personal'",
      u.id,
    );
    if (!hasPersonal) createWorkspace(u.id, { name: `${u.name}'s workspace`, type: 'personal' });
    const token = crypto.randomBytes(32).toString('base64url');
    db.run('INSERT INTO auth_sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)', sha256(token), u.id, new Date(Date.now() + 30 * 86400_000).toISOString());
    return { user: toUser(u), token };
  }

  function userByToken(token: string | undefined): User | null {
    if (!token) return null;
    const s = db.get('SELECT * FROM auth_sessions WHERE token_hash = ?', sha256(token));
    if (!s || s.expires_at < now()) return null;
    const u = db.get('SELECT * FROM users WHERE id = ?', s.user_id);
    return u ? toUser(u) : null;
  }
  const logout = (token: string | undefined) => token && db.run('DELETE FROM auth_sessions WHERE token_hash = ?', sha256(token));

  const workspacesOf = (userId: string): Workspace[] =>
    db
      .all("SELECT w.* FROM workspaces w JOIN members m ON m.workspace_id = w.id WHERE m.user_id = ? AND m.status = 'active' ORDER BY w.type DESC, w.name", userId)
      .map(toWorkspace);

  // ---------- Participants ----------
  /** Someone joined the meeting (a Recall join event, or devJoin in fake mode) */
  function participantJoined(meetingId: string, input: { externalId: string; name: string; email?: string | null }): Participant {
    const m = meetingRow(meetingId);
    if (!m) throw new ApiError('not_found', 'Meeting not found');
    const existing = db.get('SELECT * FROM participants WHERE meeting_id = ? AND external_id = ?', meetingId, input.externalId);
    if (existing) {
      if (existing.left_at) db.run('UPDATE participants SET left_at = NULL, display_name = ? WHERE id = ?', input.name, existing.id);
    } else {
      const isMember =
        !!input.email &&
        !!db.get(
          "SELECT 1 AS x FROM members m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = ? AND m.status = 'active' AND u.email = ?",
          m.workspace_id, input.email.toLowerCase(),
        );
      const kind = input.name === cfg.botName ? 'bot' : isMember ? 'member' : 'guest';
      const at = now();
      // Workspace members are identified by their Google account and do not go through Self: always verified, checks is null
      db.run(
        'INSERT INTO participants (id, meeting_id, external_id, display_name, kind, joined_at, v_status, v_verified_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        newId('par'), meetingId, input.externalId, input.name, kind, at, kind === 'member' ? 'verified' : 'unverified', kind === 'member' ? at : null,
      );
    }
    const p = db.get('SELECT * FROM participants WHERE meeting_id = ? AND external_id = ?', meetingId, input.externalId)!;
    if (!existing || existing.left_at) {
      emit(meetingId, { type: 'participant.joined', data: toParticipant(p) }, { type: 'participant.joined', data: toPublicParticipant(p) });
    }
    // Real Recall: the first participant event means the bot is already in the meeting
    if (m.bot_status === 'joining' || m.bot_status === 'waiting_room') setBotStatus(meetingId, 'in_meeting');
    return toParticipant(p);
  }

  function participantLeft(p: Row) {
    if (p.left_at) return;
    db.run('UPDATE participants SET left_at = ? WHERE id = ?', now(), p.id);
    emit(p.meeting_id, { type: 'participant.left', data: { participantId: p.id } }, { type: 'participant.left', data: { participantId: p.id } });
  }
  function participantLeftByExternalId(meetingId: string, externalId: string) {
    const p = db.get('SELECT * FROM participants WHERE meeting_id = ? AND external_id = ?', meetingId, externalId);
    if (p) participantLeft(p);
  }

  function setBotStatus(meetingId: string, botStatus: Meeting['botStatus']) {
    const m = meetingRow(meetingId);
    if (!m || m.bot_status === botStatus) return;
    const status = botStatus === 'in_meeting' ? 'live' : botStatus === 'left' ? 'ended' : m.status;
    db.run('UPDATE meetings SET bot_status = ?, status = ? WHERE id = ?', botStatus, status, meetingId);
    emitMeeting(meetingRow(meetingId)!);
  }

  function resetParticipant(p: Row): Participant {
    db.tx(() => {
      db.run('DELETE FROM bindings WHERE meeting_id = ? AND participant_id = ?', p.meeting_id, p.id);
      db.run("UPDATE verify_sessions SET status = 'expired', failure_reason = 'expired' WHERE participant_id = ? AND status = 'pending'", p.id);
      db.run(
        "UPDATE participants SET v_status = 'unverified', v_guest_id = NULL, v_returning = 0, v_verified_at = NULL, v_checks = NULL, v_failure = NULL WHERE id = ?",
        p.id,
      );
    });
    const fresh = participantRow(p.id)!;
    emitVerification(fresh);
    return toParticipant(fresh);
  }

  // ---------- Verification sessions ----------
  function setParticipantFailed(participantId: string, reason: FailureReason, checks: Checks | null) {
    db.run(
      "UPDATE participants SET v_status = 'failed', v_guest_id = NULL, v_returning = 0, v_verified_at = NULL, v_checks = ?, v_failure = ? WHERE id = ?",
      checks ? JSON.stringify(checks) : null, reason, participantId,
    );
    emitVerification(participantRow(participantId)!);
  }

  function failSession(s: Row, reason: FailureReason, checks: Checks | null = null) {
    db.run('UPDATE verify_sessions SET status = ?, failure_reason = ? WHERE id = ?', reason === 'expired' ? 'expired' : 'failed', reason, s.id);
    setParticipantFailed(s.participant_id, reason, checks);
  }

  /** Timeout handling: called by the timer and on reads; only affects sessions that are still pending */
  function expireIfDue(sessionId: string) {
    const s = db.get('SELECT * FROM verify_sessions WHERE id = ?', sessionId);
    if (s && s.status === 'pending' && s.expires_at <= now()) failSession(s, 'expired');
  }
  function sweepExpired(meetingId: string) {
    for (const s of db.all("SELECT id FROM verify_sessions WHERE meeting_id = ? AND status = 'pending' AND expires_at <= ?", meetingId, now())) expireIfDue(s.id);
  }

  /** What a policy needs disclosed. Nationality is requested only when the policy shows it or has to check it against a list. */
  const requirementsOf = (pol: Row): SelfOpenRequirements => ({
    name: pol.name_match !== 'off',
    nationality: !!pol.disclose_nationality || JSON.parse(pol.excluded_countries).length > 0,
    ofac: !!pol.require_ofac_clear,
    minimumAge: pol.minimum_age ?? null,
  });

  /** Open SDK: find the pending session behind a Self user id, with what it was asked to prove */
  function selfOpenSession(selfUserId: string): { sessionId: string; requirements: SelfOpenRequirements } | null {
    const s = db.get('SELECT id, meeting_id FROM verify_sessions WHERE self_session_id = ?', normalizeSelfUserId(selfUserId));
    const m = s && meetingRow(s.meeting_id);
    const pol = m && policyRow(m.policy_id);
    return pol ? { sessionId: s!.id, requirements: requirementsOf(pol) } : null;
  }

  async function createSession(m: Row, participantId: string): Promise<VerifySession> {
    const p = participantRow(participantId);
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
      universalLink = selfOpenLink(cfg, userId, requirementsOf(policyRow(m.policy_id)!));
      selfSessionId = normalizeSelfUserId(userId);
    }
    db.tx(() => {
      // A participant has only one active session at a time
      db.run("UPDATE verify_sessions SET status = 'expired', failure_reason = 'expired' WHERE participant_id = ? AND status = 'pending'", p.id);
      db.run(
        "INSERT INTO verify_sessions (id, participant_id, meeting_id, expires_at, status, universal_link, self_session_id) VALUES (?, ?, ?, ?, 'pending', ?, ?)",
        id, p.id, m.id, expiresAt, universalLink, selfSessionId,
      );
      db.run("UPDATE participants SET v_status = 'pending', v_guest_id = NULL, v_returning = 0, v_verified_at = NULL, v_checks = NULL, v_failure = NULL WHERE id = ?", p.id);
    });
    emitVerification(participantRow(p.id)!);
    later(cfg.sessionTtlSec * 1000 + 50, () => expireIfDue(id));
    return toSession(db.get('SELECT * FROM verify_sessions WHERE id = ?', id)!);
  }

  function getSession(sessionId: string): VerifySession {
    expireIfDue(sessionId);
    const s = db.get('SELECT * FROM verify_sessions WHERE id = ?', sessionId);
    if (!s) throw new ApiError('not_found', 'Session not found');
    return toSession(s);
  }

  /** Apply a proof. Order: proof_invalid -> ofac -> excluded_country -> underage -> name_mismatch -> binding */
  function applyProof(sessionId: string, proof: Proof): VerifySession {
    expireIfDue(sessionId);
    const s = db.get('SELECT * FROM verify_sessions WHERE id = ?', sessionId);
    if (!s) throw new ApiError('not_found', 'Session not found');
    if (s.status !== 'pending') return toSession(s); // Already has a result (or is no longer valid); do not process again

    const p = participantRow(s.participant_id)!;
    const m = meetingRow(s.meeting_id)!;
    const policy = toPolicy(policyRow(m.policy_id)!);

    const done = () => toSession(db.get('SELECT * FROM verify_sessions WHERE id = ?', sessionId)!);
    if (!proof.valid) return failSession(s, proof.invalidReason ?? 'proof_invalid'), done();
    if (!proof.nullifier) return failSession(s, 'proof_invalid'), done();

    const needNationality = policy.excludedCountries.length > 0 || policy.discloseNationality;
    if (needNationality && !proof.nationality) return failSession(s, 'proof_invalid'), done();

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
    if (reason) return failSession(s, reason, checks), done();

    // Bind the guest. Uniqueness relies entirely on database constraints:
    //   guests   UNIQUE (workspace_id, nullifier_hash) -> upsert
    //   bindings UNIQUE (meeting_id, guest_id)         -> a conflict means already_bound
    const at = now();
    const hash = nullifierHash(proof.nullifier);
    const candidateId = newId('gst');
    let guestId = candidateId;
    try {
      db.tx(() => {
        const g = db.get(
          `INSERT INTO guests (id, workspace_id, nullifier_hash, label, nationality, first_seen_at, last_verified_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (workspace_id, nullifier_hash)
           DO UPDATE SET label = excluded.label, nationality = excluded.nationality, last_verified_at = excluded.last_verified_at
           RETURNING id`,
          candidateId, m.workspace_id, hash, p.display_name, policy.discloseNationality ? proof.nationality : null, at, at,
        )!;
        guestId = g.id;
        db.run('INSERT INTO bindings (meeting_id, guest_id, participant_id) VALUES (?, ?, ?)', m.id, guestId, p.id);
      });
    } catch (e) {
      if (isUniqueViolation(e)) return failSession(s, 'already_bound', checks), done();
      throw e;
    }

    db.run("UPDATE verify_sessions SET status = 'verified', failure_reason = NULL WHERE id = ?", s.id);
    db.run(
      "UPDATE participants SET v_status = 'verified', v_guest_id = ?, v_returning = ?, v_verified_at = ?, v_checks = ?, v_failure = NULL WHERE id = ?",
      guestId, guestId === candidateId ? 0 : 1, at, JSON.stringify(checks), p.id,
    );
    emitVerification(participantRow(p.id)!);
    return done();
  }

  // ---------- Guest roster ----------
  const guests = (wsId: string): Guest[] =>
    db
      .all(
        `SELECT g.*, (SELECT COUNT(*) FROM bindings b WHERE b.guest_id = g.id) AS meeting_count
         FROM guests g WHERE g.workspace_id = ? ORDER BY g.last_verified_at DESC`,
        wsId,
      )
      .map((r) => ({
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
    createSession, getSession, applyProof, selfOpenSession, guests, revokeGuest, later,
    stop: () => {
      for (const t of timers) clearTimeout(t);
      timers.clear();
    },
  };
}
