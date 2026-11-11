// 把 mock store 掛到契約定義的 REST 路徑上
import { http, HttpResponse, type HttpHandler } from 'msw';
import {
  API_BASE, AddMemberBody, CreateMeetingBody, CreatePolicyBody, CreateSessionBody, CreateWorkspaceBody,
  DevCompleteSessionBody, DevJoinBody, DevLoginBody, UpdateMemberBody, UpdatePolicyBody, paths, type PathKey,
} from '@proveback/contract';
import type { z } from 'zod';
import { MockError, mockApi } from './store';

type Method = 'get' | 'post' | 'patch' | 'delete';
type Params = Record<string, string>;

function route<S extends z.ZodTypeAny>(method: Method, key: PathKey, schema: S | null, fn: (p: Params, body: z.infer<S>) => unknown): HttpHandler {
  return http[method](`*${API_BASE}${paths[key]}`, async ({ params, request }) => {
    try {
      let body: unknown;
      if (schema) {
        const parsed = schema.safeParse(await request.json().catch(() => null));
        if (!parsed.success) throw new MockError('validation_failed', '請求內容不符合格式', 400);
        body = parsed.data;
      }
      const out = fn(params as Params, body as z.infer<S>);
      return out === undefined ? new HttpResponse(null, { status: 204 }) : HttpResponse.json(out as object);
    } catch (e) {
      if (e instanceof MockError) return HttpResponse.json({ error: { code: e.code, message: e.message } }, { status: e.status });
      throw e;
    }
  });
}

const p = (params: Params, name: string) => params[name] ?? '';

export const handlers: HttpHandler[] = [
  route('get', 'me', null, () => mockApi.me()),
  route('post', 'authLogout', null, () => mockApi.logout()),

  route('post', 'workspaces', CreateWorkspaceBody, (_, b) => mockApi.createWorkspace(b)),
  route('get', 'workspace', null, (q) => mockApi.getWorkspace(p(q, 'wsId'))),
  route('get', 'members', null, (q) => mockApi.members(p(q, 'wsId'))),
  route('post', 'members', AddMemberBody, (q, b) => mockApi.addMember(p(q, 'wsId'), b)),
  route('patch', 'member', UpdateMemberBody, (q, b) => mockApi.updateMember(p(q, 'wsId'), p(q, 'userId'), b.role)),
  route('delete', 'member', null, (q) => mockApi.removeMember(p(q, 'wsId'), p(q, 'userId'))),

  route('get', 'policies', null, (q) => mockApi.policies(p(q, 'wsId'))),
  route('post', 'policies', CreatePolicyBody, (q, b) => mockApi.createPolicy(p(q, 'wsId'), b)),
  route('patch', 'policy', UpdatePolicyBody, (q, b) => mockApi.updatePolicy(p(q, 'policyId'), b)),
  route('delete', 'policy', null, (q) => mockApi.deletePolicy(p(q, 'policyId'))),

  route('get', 'meetings', null, (q) => mockApi.meetings(p(q, 'wsId'))),
  route('post', 'meetings', CreateMeetingBody, (q, b) => mockApi.createMeeting(p(q, 'wsId'), b)),
  route('get', 'meeting', null, (q) => mockApi.meeting(p(q, 'mtgId'))),
  route('post', 'meetingBot', null, (q) => mockApi.sendBot(p(q, 'mtgId'))),
  route('delete', 'meetingBot', null, (q) => mockApi.recallBot(p(q, 'mtgId'))),
  route('post', 'participantReset', null, (q) => mockApi.resetParticipant(p(q, 'mtgId'), p(q, 'pid'))),

  route('get', 'guests', null, (q) => mockApi.guests(p(q, 'wsId'))),
  route('delete', 'guest', null, (q) => mockApi.revokeGuest(p(q, 'guestId'))),

  route('get', 'publicMeeting', null, (q) => mockApi.publicMeeting(p(q, 'joinToken'))),
  route('post', 'publicSessions', CreateSessionBody, (q, b) => mockApi.createSession(p(q, 'joinToken'), b.participantId)),
  route('get', 'publicSession', null, (q) => mockApi.publicSession(p(q, 'sessionId'))),

  route('get', 'devStatus', null, () => mockApi.devStatus()),
  route('post', 'devLogin', DevLoginBody, (_, b) => mockApi.devLogin(b)),
  route('post', 'devJoin', DevJoinBody, (q, b) => mockApi.devJoin(p(q, 'mtgId'), b)),
  route('post', 'devLeave', null, (q) => mockApi.devLeave(p(q, 'mtgId'), p(q, 'pid'))),
  route('post', 'devCompleteSession', DevCompleteSessionBody, (q, b) => mockApi.devCompleteSession(p(q, 'sessionId'), b)),
];
