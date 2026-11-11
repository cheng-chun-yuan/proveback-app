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

// ---------- Name matching ----------
// Passport MRZ names are uppercase, have no diacritics, may be truncated, and may be in "surname given name" order.
// Approach: normalize and split into tokens, ignoring order; tokens match if they are identical or one is a prefix of the other (3+ characters).
// The score is the Dice coefficient (0-1); 0.6 or higher counts as a match.
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
