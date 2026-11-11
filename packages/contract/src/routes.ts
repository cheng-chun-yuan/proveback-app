// 契約 v1:路由。pattern 給後端註冊路由,url() 給前端組網址。
export const API_BASE = '/api/v1';

export const paths = {
  // 4.1 登入
  authGoogleStart: '/auth/google/start', // GET ?redirect= → 302
  authGoogleCallback: '/auth/google/callback', // GET,後端專用 → 302
  authLogout: '/auth/logout', // POST → 204
  me: '/me', // GET → MeResponse

  // 4.2 Workspace 與成員
  workspaces: '/workspaces', // POST CreateWorkspaceBody → Workspace
  workspace: '/workspaces/:wsId', // GET → Workspace
  members: '/workspaces/:wsId/members', // GET → List<Member>;POST AddMemberBody → Member
  member: '/workspaces/:wsId/members/:userId', // PATCH UpdateMemberBody → Member;DELETE → 204

  // 4.3 驗證政策
  policies: '/workspaces/:wsId/policies', // GET → List<Policy>;POST CreatePolicyBody → Policy
  policy: '/policies/:policyId', // PATCH UpdatePolicyBody → Policy;DELETE → 204

  // 4.4 會議
  meetings: '/workspaces/:wsId/meetings', // GET → List<Meeting>;POST CreateMeetingBody → Meeting
  meeting: '/meetings/:mtgId', // GET → MeetingDetail
  meetingBot: '/meetings/:mtgId/bot', // POST → Meeting(botStatus: joining);DELETE → Meeting
  participantReset: '/meetings/:mtgId/participants/:pid/reset', // POST → Participant
  meetingEvents: '/meetings/:mtgId/events', // GET → SSE(主辦方頻道)

  // 4.5 來賓名冊
  guests: '/workspaces/:wsId/guests', // GET → List<Guest>
  guest: '/guests/:guestId', // DELETE → 204

  // 4.6 公開端點
  publicMeeting: '/public/meetings/:joinToken', // GET → PublicMeeting
  publicSessions: '/public/meetings/:joinToken/sessions', // POST CreateSessionBody → VerifySession
  publicSession: '/public/sessions/:sessionId', // GET → VerifySession
  publicEvents: '/public/meetings/:joinToken/events', // GET → SSE(公開頻道)

  // 開發用(v1 之後新增的端點,只在假資料模式存在,正式環境回 404)。見 dev.ts
  devStatus: '/dev/status', // GET → DevStatus
  devLogin: '/dev/login', // POST DevLoginBody → 204(設 session cookie)
  devJoin: '/dev/meetings/:mtgId/participants', // POST DevJoinBody → Participant
  devLeave: '/dev/meetings/:mtgId/participants/:pid/leave', // POST → 204
  devCompleteSession: '/dev/sessions/:sessionId/complete', // POST DevCompleteSessionBody → VerifySession
} as const;

export type PathKey = keyof typeof paths;

type ParamNames<S extends string> = S extends `${string}:${infer P}/${infer Rest}`
  ? P | ParamNames<`/${Rest}`>
  : S extends `${string}:${infer P}`
    ? P
    : never;

export type PathParams<K extends PathKey> = [ParamNames<(typeof paths)[K]>] extends [never]
  ? Record<string, never>
  : Record<ParamNames<(typeof paths)[K]>, string>;

/** 組出完整網址,例如 url('meeting', { mtgId }) → "/api/v1/meetings/mtg_x" */
export function url<K extends PathKey>(
  key: K,
  ...args: [ParamNames<(typeof paths)[K]>] extends [never] ? [] : [params: PathParams<K>]
): string {
  const params = (args[0] ?? {}) as Record<string, string>;
  return API_BASE + paths[key].replace(/:([A-Za-z]+)/g, (_, name: string) => encodeURIComponent(params[name] ?? ''));
}

// 前端頁面路由(apps/web)。後端只在組 QR 與導回網址時用到。
export const webRoutes = {
  login: '/login',
  meetings: (wsId: string) => `/w/${wsId}/meetings`,
  meeting: (wsId: string, mtgId: string) => `/w/${wsId}/meetings/${mtgId}`,
  policies: (wsId: string) => `/w/${wsId}/policies`,
  members: (wsId: string) => `/w/${wsId}/members`,
  guests: (wsId: string) => `/w/${wsId}/guests`,
  join: (joinToken: string) => `/join/${joinToken}`,
  botScreen: (joinToken: string) => `/bot-screen/${joinToken}`,
  // 假資料模式專用頁
  devLogin: '/dev/login',
  devSelf: (sessionId: string) => `/dev/self/${sessionId}`,
} as const;
