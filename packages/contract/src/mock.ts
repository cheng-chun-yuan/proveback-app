// 符合契約的假資料。前端的 MSW mock 與後端的契約測試都可以用。
import type { Guest, Meeting, MeetingDetail, Member, Participant, Policy, PublicMeeting, User, VerifySession, Workspace } from './schemas';

const t = (min: number) => new Date(Date.UTC(2026, 10, 11, 9, min)).toISOString();

export const mockUser: User = { id: 'usr_alice', email: 'alice@acme.com', name: 'Alice Chen', avatarUrl: null };

export const mockWorkspaces: Workspace[] = [
  { id: 'ws_acme', name: 'ACME', type: 'company', domain: 'acme.com' },
  { id: 'ws_alice', name: 'Alice 的個人空間', type: 'personal', domain: null },
];

export const mockMembers: Member[] = [
  { userId: 'usr_alice', workspaceId: 'ws_acme', email: 'alice@acme.com', name: 'Alice Chen', role: 'owner', status: 'active' },
  { userId: 'usr_bob', workspaceId: 'ws_acme', email: 'bob@acme.com', name: 'Bob Lin', role: 'admin', status: 'active' },
  { userId: 'usr_carol', workspaceId: 'ws_acme', email: 'carol@acme.com', name: 'carol@acme.com', role: 'member', status: 'invited' },
];

export const mockPolicies: Policy[] = [
  {
    id: 'pol_default', workspaceId: 'ws_acme', name: '標準外部會議', isDefault: true,
    requireOfacClear: true, excludedCountries: ['PRK', 'IRN'], discloseNationality: true, nameMatch: 'warn', minimumAge: null,
  },
  {
    id: 'pol_strict', workspaceId: 'ws_acme', name: '嚴格(姓名必須相符)', isDefault: false,
    requireOfacClear: true, excludedCountries: ['PRK', 'IRN', 'RUS'], discloseNationality: false, nameMatch: 'require', minimumAge: 18,
  },
];

export const mockMeeting: Meeting = {
  id: 'mtg_demo', workspaceId: 'ws_acme', title: '合作夥伴季度會議', meetUrl: 'https://meet.google.com/abc-defg-hij',
  policyId: 'pol_default', createdBy: 'usr_alice', createdAt: t(0), status: 'live', botStatus: 'in_meeting', joinToken: 'jt_demo_3f9a1c',
};

export const mockMeetings: Meeting[] = [
  mockMeeting,
  {
    id: 'mtg_next', workspaceId: 'ws_acme', title: '供應商面談', meetUrl: 'https://meet.google.com/xyz-uvwx-rst',
    policyId: 'pol_strict', createdBy: 'usr_alice', createdAt: t(30), status: 'scheduled', botStatus: 'idle', joinToken: 'jt_next_77b2e0',
  },
];

const unverified = { status: 'unverified', guestId: null, returning: false, verifiedAt: null, checks: null, failureReason: null } as const;

export const mockParticipants: Participant[] = [
  { id: 'par_bot', meetingId: 'mtg_demo', displayName: 'ProveBack', kind: 'bot', joinedAt: t(1), leftAt: null, verification: unverified },
  {
    id: 'par_alice', meetingId: 'mtg_demo', displayName: 'Alice Chen', kind: 'member', joinedAt: t(2), leftAt: null,
    verification: { status: 'verified', guestId: null, returning: false, verifiedAt: t(2), checks: null, failureReason: null },
  },
  {
    id: 'par_ken', meetingId: 'mtg_demo', displayName: 'Ken Sato', kind: 'guest', joinedAt: t(3), leftAt: null,
    verification: {
      status: 'verified', guestId: 'gst_ken', returning: true, verifiedAt: t(5), failureReason: null,
      checks: { ofac: 'pass', nationality: { allowed: true, value: 'JPN' }, nameMatch: { result: 'match', score: 1 }, age: 'skipped' },
    },
  },
  { id: 'par_mia', meetingId: 'mtg_demo', displayName: 'Mia', kind: 'guest', joinedAt: t(4), leftAt: null, verification: { ...unverified, status: 'pending' } },
  {
    id: 'par_ivan', meetingId: 'mtg_demo', displayName: 'Ivan', kind: 'guest', joinedAt: t(6), leftAt: null,
    verification: {
      status: 'failed', guestId: null, returning: false, verifiedAt: null, failureReason: 'excluded_country',
      checks: { ofac: 'pass', nationality: { allowed: false, value: 'PRK' }, nameMatch: { result: 'skipped', score: null }, age: 'skipped' },
    },
  },
  { id: 'par_zoe', meetingId: 'mtg_demo', displayName: 'Zoe Wang', kind: 'guest', joinedAt: t(7), leftAt: null, verification: unverified },
];

export const mockMeetingDetail: MeetingDetail = { meeting: mockMeeting, participants: mockParticipants };

export const mockGuests: Guest[] = [
  { id: 'gst_ken', workspaceId: 'ws_acme', label: 'Ken Sato', nationality: 'JPN', firstSeenAt: t(-600), lastVerifiedAt: t(5), meetingCount: 3, revoked: false },
  { id: 'gst_lee', workspaceId: 'ws_acme', label: 'Lee', nationality: null, firstSeenAt: t(-900), lastVerifiedAt: t(-300), meetingCount: 1, revoked: false },
];

export const mockPublicMeeting: PublicMeeting = {
  title: mockMeeting.title,
  workspaceName: 'ACME',
  disclosures: { ofac: true, excludedCountries: ['PRK', 'IRN'], nationality: true, nameMatch: true, minimumAge: null },
  participants: mockParticipants.map((p) => ({ id: p.id, displayName: p.displayName, kind: p.kind, status: p.verification.status })),
};

export const mockVerifySession: VerifySession = {
  id: 'vs_demo', participantId: 'par_zoe', expiresAt: t(15), status: 'pending', failureReason: null,
  selfApp: null, universalLink: 'http://localhost:5173/dev/self/vs_demo',
};
