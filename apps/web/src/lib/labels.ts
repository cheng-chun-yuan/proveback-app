import type { BotStatus, FailureReason, MeetingStatus, ParticipantKind, Role, VerificationStatus } from '@proveback/contract';
import type { z } from 'zod';

export const verificationLabel: Record<VerificationStatus, string> = {
  unverified: 'Waiting',
  pending: 'Scanning',
  verified: 'Verified',
  failed: 'Not verified',
};

/** Words and tones for the split-flap status cells. At most 9 characters each. */
export const boardWord: Record<VerificationStatus, string> = {
  unverified: 'WAITING',
  pending: 'SCANNING',
  verified: 'VERIFIED',
  failed: 'TRY AGAIN',
};
export const boardTone: Record<VerificationStatus, 'dim' | 'now' | 'ok' | 'bad'> = {
  unverified: 'dim',
  pending: 'now',
  verified: 'ok',
  failed: 'bad',
};

export const failureLabel: Record<FailureReason, string> = {
  ofac: 'The passport holder is on a sanctions list.',
  excluded_country: "The passport's nationality is on this meeting's excluded list.",
  name_mismatch: 'The name on the passport does not match the display name in the meeting.',
  underage: 'The passport holder is below the age this meeting requires.',
  expired: 'The verification was not finished in time.',
  proof_invalid: 'The passport proof could not be validated.',
  already_bound: 'This passport is already linked to another participant in this meeting.',
};

export const botLabel: Record<z.infer<typeof BotStatus>, string> = {
  idle: 'NOT SENT',
  joining: 'JOINING',
  waiting_room: 'WAITING ROOM',
  in_meeting: 'IN MEETING',
  left: 'LEFT',
  error: 'ERROR',
};
export const botTone: Record<z.infer<typeof BotStatus>, 'dim' | 'now' | 'ok' | 'bad'> = {
  idle: 'dim',
  joining: 'now',
  waiting_room: 'now',
  in_meeting: 'ok',
  left: 'dim',
  error: 'bad',
};

export const meetingLabel: Record<z.infer<typeof MeetingStatus>, string> = {
  scheduled: 'Not started',
  live: 'Live',
  ended: 'Ended',
};

export const kindLabel: Record<z.infer<typeof ParticipantKind>, string> = { member: 'Member', guest: 'Guest', bot: 'Bot' };
export const roleLabel: Record<Role, string> = { owner: 'Owner', admin: 'Admin', member: 'Member' };

export const formatTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

/** Parse "prk, irn RUS" into alpha-3 codes; invalid items are returned so the form can point at them. */
export function parseCountries(text: string): { codes: string[]; invalid: string[] } {
  const items = text.toUpperCase().split(/[\s,、,]+/).filter(Boolean);
  const codes = [...new Set(items.filter((c) => /^[A-Z]{3}$/.test(c)))];
  return { codes, invalid: items.filter((c) => !/^[A-Z]{3}$/.test(c)) };
}
