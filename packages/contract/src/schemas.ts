// 契約 v1:資料模型。zod schema 是唯一事實來源,型別由它推導。
// 凍結規則:只能加選填欄位。破壞性變更請開 /api/v2。
import { z } from 'zod';

export const ID = z.string().min(1); // 前綴式:usr_ ws_ pol_ mtg_ par_ gst_ vs_
export const ISODate = z.string().datetime(); // ISO 8601 UTC
export const Country = z.string().regex(/^[A-Z]{3}$/); // ISO 3166-1 alpha-3
export type ID = z.infer<typeof ID>;
export type ISODate = z.infer<typeof ISODate>;
export type Country = z.infer<typeof Country>;

export const User = z.object({
  id: ID,
  email: z.string().email(),
  name: z.string(),
  avatarUrl: z.string().nullable(),
});
export type User = z.infer<typeof User>;

export const WorkspaceType = z.enum(['personal', 'company']);
export const Workspace = z.object({
  id: ID,
  name: z.string(),
  type: WorkspaceType,
  domain: z.string().nullable(), // company 才有,例如 "acme.com"
});
export type Workspace = z.infer<typeof Workspace>;

export const Role = z.enum(['owner', 'admin', 'member']);
export type Role = z.infer<typeof Role>;
export const Member = z.object({
  userId: ID,
  workspaceId: ID,
  email: z.string().email(),
  name: z.string(),
  role: Role,
  status: z.enum(['active', 'invited']),
});
export type Member = z.infer<typeof Member>;

export const NameMatchMode = z.enum(['off', 'warn', 'require']);
export const Policy = z.object({
  id: ID,
  workspaceId: ID,
  name: z.string().min(1),
  isDefault: z.boolean(),
  requireOfacClear: z.boolean(),
  excludedCountries: z.array(Country),
  discloseNationality: z.boolean(), // true 才把國籍顯示給主辦方
  nameMatch: NameMatchMode,
  minimumAge: z.number().int().min(0).max(120).nullable(),
});
export type Policy = z.infer<typeof Policy>;

export const MeetingStatus = z.enum(['scheduled', 'live', 'ended']);
export const BotStatus = z.enum(['idle', 'joining', 'waiting_room', 'in_meeting', 'left', 'error']);
export const Meeting = z.object({
  id: ID,
  workspaceId: ID,
  title: z.string(),
  meetUrl: z.string(),
  policyId: ID,
  createdBy: ID,
  createdAt: ISODate,
  status: MeetingStatus,
  botStatus: BotStatus,
  joinToken: z.string(), // 來賓頁與 bot 畫面頁用的公開 token
});
export type Meeting = z.infer<typeof Meeting>;

export const VerificationStatus = z.enum(['unverified', 'pending', 'verified', 'failed']);
export type VerificationStatus = z.infer<typeof VerificationStatus>;

export const FailureReason = z.enum([
  'ofac',
  'excluded_country',
  'name_mismatch',
  'underage',
  'expired',
  'proof_invalid',
  'already_bound',
]);
export type FailureReason = z.infer<typeof FailureReason>;

export const CheckResult = z.enum(['pass', 'fail', 'skipped']);
export const Checks = z.object({
  ofac: CheckResult,
  nationality: z.object({ allowed: z.boolean(), value: Country.nullable() }).nullable(),
  nameMatch: z.object({ result: z.enum(['match', 'mismatch', 'skipped']), score: z.number().nullable() }),
  age: CheckResult,
});
export type Checks = z.infer<typeof Checks>;

export const Verification = z.object({
  status: VerificationStatus,
  guestId: ID.nullable(), // 綁定到的來賓記錄
  returning: z.boolean(), // 此 nullifier 之前在這個 workspace 出現過
  verifiedAt: ISODate.nullable(),
  checks: Checks.nullable(),
  failureReason: FailureReason.nullable(),
});
export type Verification = z.infer<typeof Verification>;

export const ParticipantKind = z.enum(['member', 'guest', 'bot']);
export const Participant = z.object({
  id: ID,
  meetingId: ID,
  displayName: z.string(),
  kind: ParticipantKind,
  joinedAt: ISODate,
  leftAt: ISODate.nullable(),
  verification: Verification,
});
export type Participant = z.infer<typeof Participant>;

export const Guest = z.object({
  id: ID,
  workspaceId: ID,
  label: z.string(), // 最近一次的顯示名稱
  nationality: Country.nullable(),
  firstSeenAt: ISODate,
  lastVerifiedAt: ISODate,
  meetingCount: z.number().int(),
  revoked: z.boolean(),
});
export type Guest = z.infer<typeof Guest>;

// ---------- 公開端點用(刻意不含 checks 與國籍) ----------
export const PublicParticipant = z.object({
  id: ID,
  displayName: z.string(),
  kind: ParticipantKind,
  status: VerificationStatus,
});
export type PublicParticipant = z.infer<typeof PublicParticipant>;

export const PublicMeeting = z.object({
  title: z.string(),
  workspaceName: z.string(),
  disclosures: z.object({
    ofac: z.boolean(),
    excludedCountries: z.array(Country),
    nationality: z.boolean(),
    nameMatch: z.boolean(),
    minimumAge: z.number().nullable(),
  }),
  participants: z.array(PublicParticipant),
});
export type PublicMeeting = z.infer<typeof PublicMeeting>;

export const VerifySessionStatus = z.enum(['pending', 'verified', 'failed', 'expired']);
export const VerifySession = z.object({
  id: ID,
  participantId: ID,
  expiresAt: ISODate, // 預設 5 分鐘
  status: VerifySessionStatus,
  failureReason: FailureReason.nullable(),
  selfApp: z.unknown(), // 不透明物件。有值就原封交給 Self QR 元件;null 表示只用 universalLink
  universalLink: z.string(), // 手機上直接開 Self app 用;桌機上把它畫成 QR
});
export type VerifySession = z.infer<typeof VerifySession>;

// ---------- 錯誤 ----------
export const ErrorCode = z.enum([
  'unauthenticated',
  'forbidden',
  'not_found',
  'validation_failed',
  'conflict',
  'expired',
  'upstream_error',
]);
export type ErrorCode = z.infer<typeof ErrorCode>;
export const ErrorBody = z.object({ error: z.object({ code: ErrorCode, message: z.string() }) });
export type ErrorBody = z.infer<typeof ErrorBody>;

// ---------- 請求 body ----------
export const CreateWorkspaceBody = z.object({ name: z.string().min(1), type: WorkspaceType, domain: z.string().optional() });
export type CreateWorkspaceBody = z.infer<typeof CreateWorkspaceBody>;

export const AddMemberBody = z.object({ email: z.string().email(), role: Role });
export type AddMemberBody = z.infer<typeof AddMemberBody>;

export const UpdateMemberBody = z.object({ role: Role });
export type UpdateMemberBody = z.infer<typeof UpdateMemberBody>;

export const CreatePolicyBody = Policy.omit({ id: true, workspaceId: true });
export type CreatePolicyBody = z.infer<typeof CreatePolicyBody>;

export const UpdatePolicyBody = CreatePolicyBody.partial();
export type UpdatePolicyBody = z.infer<typeof UpdatePolicyBody>;

export const CreateMeetingBody = z.object({ title: z.string().min(1), meetUrl: z.string().url(), policyId: ID });
export type CreateMeetingBody = z.infer<typeof CreateMeetingBody>;

export const CreateSessionBody = z.object({ participantId: ID });
export type CreateSessionBody = z.infer<typeof CreateSessionBody>;

// ---------- 回應 ----------
export const list = <T extends z.ZodTypeAny>(item: T) => z.object({ items: z.array(item) });
export const MeResponse = z.object({ user: User, workspaces: z.array(Workspace) });
export type MeResponse = z.infer<typeof MeResponse>;
export const MeetingDetail = z.object({ meeting: Meeting, participants: z.array(Participant) });
export type MeetingDetail = z.infer<typeof MeetingDetail>;
export type List<T> = { items: T[] };
