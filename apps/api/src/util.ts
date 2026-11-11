import crypto from 'node:crypto';
import type { ErrorCode } from '@proveback/contract';

export const newId = (prefix: string) => `${prefix}_${crypto.randomBytes(9).toString('base64url')}`;
export const now = () => new Date().toISOString();
export const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

const STATUS: Record<ErrorCode, number> = {
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  validation_failed: 400,
  conflict: 409,
  expired: 410,
  upstream_error: 502,
};

export class ApiError extends Error {
  readonly status: number;
  constructor(readonly code: ErrorCode, message: string) {
    super(message);
    this.status = STATUS[code];
  }
}

// ---------- 姓名比對 ----------
// 護照 MRZ 的姓名是大寫、沒有變音符號、可能被截斷,順序也可能是「姓 名」。
// 做法:正規化後切成 token,不看順序;token 完全相同或其中一個是另一個的前綴(≥3 字元)就算相同。
// 分數是 Dice 係數(0–1),≥ 0.6 視為相符。
export const NAME_MATCH_THRESHOLD = 0.6;

export function nameTokens(name: string): string[] {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

const sameToken = (a: string, b: string) =>
  a === b || (Math.min(a.length, b.length) >= 3 && (a.startsWith(b) || b.startsWith(a)));

export function nameScore(a: string, b: string): number {
  const ta = nameTokens(a);
  const tb = [...nameTokens(b)];
  if (!ta.length || !tb.length) return 0;
  let hit = 0;
  for (const t of ta) {
    const i = tb.findIndex((u) => sameToken(t, u));
    if (i >= 0) {
      hit++;
      tb.splice(i, 1);
    }
  }
  const total = ta.length + nameTokens(b).length;
  return Math.round(((2 * hit) / total) * 100) / 100;
}
