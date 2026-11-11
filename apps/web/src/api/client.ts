// 唯一的 HTTP 出口。網址一律用契約的 url() 組,回應一律用契約的 zod schema 解析。
import { z } from 'zod';
import {
  AddMemberBody, CreateMeetingBody, CreatePolicyBody, CreateSessionBody, CreateWorkspaceBody,
  DevCompleteSessionBody, DevJoinBody, DevLoginBody, DevStatus, ErrorBody, type ErrorCode, Guest, Meeting,
  MeetingDetail, Member, MeResponse, Participant, Policy, PublicMeeting, UpdateMemberBody, UpdatePolicyBody,
  VerifySession, Workspace, list, url, webRoutes,
} from '@proveback/contract';

export class ApiError extends Error {
  constructor(
    public code: ErrorCode | 'network' | 'bad_response',
    message: string,
    public status = 0,
  ) {
    super(message);
  }
}

const PUBLIC_PREFIXES = ['/join/', '/bot-screen/', '/dev/', webRoutes.login];

async function request<S extends z.ZodTypeAny>(method: string, path: string, schema: S, body?: unknown): Promise<z.infer<S>>;
async function request(method: string, path: string, schema: null, body?: unknown): Promise<void>;
async function request(method: string, path: string, schema: z.ZodTypeAny | null, body?: unknown): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      credentials: 'include',
      headers: body === undefined ? { accept: 'application/json' } : { accept: 'application/json', 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError('network', '連不上伺服器,請確認後端有在執行。');
  }

  if (!res.ok) {
    const parsed = ErrorBody.safeParse(await res.json().catch(() => null));
    const err = parsed.success
      ? new ApiError(parsed.data.error.code, parsed.data.error.message, res.status)
      : new ApiError('bad_response', `伺服器回應 ${res.status}`, res.status);
    // 主辦方頁面遇到未登入就回登入頁;公開頁與登入頁不跳轉
    if (err.code === 'unauthenticated' && !PUBLIC_PREFIXES.some((p) => location.pathname.startsWith(p))) {
      location.assign(webRoutes.login);
    }
    throw err;
  }

  if (schema === null) return;
  const data = schema.safeParse(await res.json().catch(() => null));
  if (!data.success) {
    console.error('回應不符合契約', method, path, data.error.issues);
    throw new ApiError('bad_response', '伺服器回應的格式不符合介面契約。', res.status);
  }
  return data.data;
}

export const api = {
  // 登入
  me: () => request('GET', url('me'), MeResponse),
  logout: () => request('POST', url('authLogout'), null),
  googleStartUrl: (redirect: string) => `${url('authGoogleStart')}?redirect=${encodeURIComponent(redirect)}`,

  // Workspace 與成員
  createWorkspace: (body: CreateWorkspaceBody) => request('POST', url('workspaces'), Workspace, body),
  members: (wsId: string) => request('GET', url('members', { wsId }), list(Member)),
  addMember: (wsId: string, body: AddMemberBody) => request('POST', url('members', { wsId }), Member, body),
  updateMember: (wsId: string, userId: string, body: UpdateMemberBody) => request('PATCH', url('member', { wsId, userId }), Member, body),
  removeMember: (wsId: string, userId: string) => request('DELETE', url('member', { wsId, userId }), null),

  // 驗證政策
  policies: (wsId: string) => request('GET', url('policies', { wsId }), list(Policy)),
  createPolicy: (wsId: string, body: CreatePolicyBody) => request('POST', url('policies', { wsId }), Policy, body),
  updatePolicy: (policyId: string, body: UpdatePolicyBody) => request('PATCH', url('policy', { policyId }), Policy, body),
  deletePolicy: (policyId: string) => request('DELETE', url('policy', { policyId }), null),

  // 會議
  meetings: (wsId: string) => request('GET', url('meetings', { wsId }), list(Meeting)),
  createMeeting: (wsId: string, body: CreateMeetingBody) => request('POST', url('meetings', { wsId }), Meeting, body),
  meeting: (mtgId: string) => request('GET', url('meeting', { mtgId }), MeetingDetail),
  sendBot: (mtgId: string) => request('POST', url('meetingBot', { mtgId }), Meeting),
  recallBot: (mtgId: string) => request('DELETE', url('meetingBot', { mtgId }), Meeting),
  resetParticipant: (mtgId: string, pid: string) => request('POST', url('participantReset', { mtgId, pid }), Participant),

  // 來賓名冊
  guests: (wsId: string) => request('GET', url('guests', { wsId }), list(Guest)),
  revokeGuest: (guestId: string) => request('DELETE', url('guest', { guestId }), null),

  // 公開端點
  publicMeeting: (joinToken: string) => request('GET', url('publicMeeting', { joinToken }), PublicMeeting),
  createSession: (joinToken: string, body: CreateSessionBody) => request('POST', url('publicSessions', { joinToken }), VerifySession, body),
  publicSession: (sessionId: string) => request('GET', url('publicSession', { sessionId }), VerifySession),

  // 假資料模式專用。正式環境這些端點回 404
  devStatus: async (): Promise<DevStatus | null> => {
    try {
      return await request('GET', url('devStatus'), DevStatus);
    } catch {
      return null;
    }
  },
  devLogin: (body: DevLoginBody) => request('POST', url('devLogin'), null, body),
  devJoin: (mtgId: string, body: DevJoinBody) => request('POST', url('devJoin', { mtgId }), Participant, body),
  devLeave: (mtgId: string, pid: string) => request('POST', url('devLeave', { mtgId, pid }), null),
  devCompleteSession: (sessionId: string, body: DevCompleteSessionBody) =>
    request('POST', url('devCompleteSession', { sessionId }), VerifySession, body),
};

export const errorMessage = (e: unknown) => (e instanceof Error ? e.message : '發生未知錯誤');
