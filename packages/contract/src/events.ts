// 契約 v1:即時事件(SSE)。兩個頻道共用同一種封包,SSE 的 data 欄位是 JSON。
// 連線後第一筆一定是 snapshot,之後才是增量事件,所以斷線重連不需要另外補資料。
import { z } from 'zod';
import { BotStatus, ID, ISODate, Meeting, MeetingDetail, MeetingStatus, Participant, PublicMeeting, PublicParticipant, Verification, VerificationStatus } from './schemas';

export const eventTypes = ['snapshot', 'meeting.updated', 'participant.joined', 'participant.left', 'verification.updated'] as const;
export type EventType = (typeof eventTypes)[number];

const envelope = <N extends EventType, T extends z.ZodTypeAny>(type: N, data: T) =>
  z.object({ type: z.literal(type), meetingId: ID, at: ISODate, data });

// 主辦方頻道:GET /meetings/:mtgId/events
export const HostEvent = z.discriminatedUnion('type', [
  envelope('snapshot', MeetingDetail),
  envelope('meeting.updated', Meeting),
  envelope('participant.joined', Participant),
  envelope('participant.left', z.object({ participantId: ID })),
  envelope('verification.updated', z.object({ participantId: ID, verification: Verification })),
]);
export type HostEvent = z.infer<typeof HostEvent>;

// 公開頻道:GET /public/meetings/:joinToken/events(不含 checks、國籍)
export const PublicEvent = z.discriminatedUnion('type', [
  envelope('snapshot', PublicMeeting),
  envelope('meeting.updated', z.object({ status: MeetingStatus, botStatus: BotStatus })),
  envelope('participant.joined', PublicParticipant),
  envelope('participant.left', z.object({ participantId: ID })),
  envelope('verification.updated', z.object({ participantId: ID, status: VerificationStatus })),
]);
export type PublicEvent = z.infer<typeof PublicEvent>;

export interface EventEnvelope<T> {
  type: EventType;
  meetingId: ID;
  at: ISODate;
  data: T;
}
