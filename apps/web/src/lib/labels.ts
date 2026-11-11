import type { BotStatus, FailureReason, MeetingStatus, ParticipantKind, Role, VerificationStatus } from '@proveback/contract';
import type { z } from 'zod';

export const verificationLabel: Record<VerificationStatus, string> = {
  unverified: '未驗證',
  pending: '驗證中',
  verified: '已驗證',
  failed: '未通過',
};

export const failureLabel: Record<FailureReason, string> = {
  ofac: '護照持有人在制裁名單上',
  excluded_country: '國籍在這場會議的排除名單內',
  name_mismatch: '護照姓名與會議中的顯示名稱不符',
  underage: '未達這場會議要求的年齡',
  expired: '驗證逾時,沒有在時限內完成',
  proof_invalid: '護照證明無效',
  already_bound: '這本護照已經在這場會議綁定另一位參與者',
};

export const botLabel: Record<z.infer<typeof BotStatus>, string> = {
  idle: '尚未派出',
  joining: '加入中',
  waiting_room: '等待主辦方在 Meet 內允許',
  in_meeting: '已在會議中',
  left: '已離開',
  error: '發生錯誤',
};

export const meetingLabel: Record<z.infer<typeof MeetingStatus>, string> = {
  scheduled: '未開始',
  live: '進行中',
  ended: '已結束',
};

export const kindLabel: Record<z.infer<typeof ParticipantKind>, string> = { member: '成員', guest: '來賓', bot: 'Bot' };
export const roleLabel: Record<Role, string> = { owner: '擁有者', admin: '管理員', member: '成員' };

export const formatTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('zh-TW', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

/** 把 "prk, irn RUS" 解析成 alpha-3 代碼;回傳不合法的項目讓表單提示 */
export function parseCountries(text: string): { codes: string[]; invalid: string[] } {
  const items = text.toUpperCase().split(/[\s,、,]+/).filter(Boolean);
  const codes = [...new Set(items.filter((c) => /^[A-Z]{3}$/.test(c)))];
  return { codes, invalid: items.filter((c) => !/^[A-Z]{3}$/.test(c)) };
}
