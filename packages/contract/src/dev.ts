// 開發用端點的 schema。只在後端假資料模式啟用,用來取代 Google / Recall / Self。
// 這些是 v1 之後「新增的端點」,不改動任何既有介面。
import { z } from 'zod';
import { Country } from './schemas';

export const DevStatus = z.object({
  fake: z.object({ google: z.boolean(), recall: z.boolean(), self: z.boolean() }),
});
export type DevStatus = z.infer<typeof DevStatus>;

// 假 Google 登入
export const DevLoginBody = z.object({ email: z.string().email(), name: z.string().min(1) });
export type DevLoginBody = z.infer<typeof DevLoginBody>;

// 假裝有人進入會議(取代 Recall 的 participant join)。email 符合 workspace 成員時 kind 為 member
export const DevJoinBody = z.object({ displayName: z.string().min(1), email: z.string().email().optional() });
export type DevJoinBody = z.infer<typeof DevJoinBody>;

// 假裝 Self 送來一份證明。passportId 用來產生 nullifier,同一個值代表同一本護照
export const DevCompleteSessionBody = z.object({
  passportId: z.string().min(1),
  name: z.string().min(1), // 護照上的姓名
  nationality: Country,
  ofacClear: z.boolean(),
  age: z.number().int().min(0).max(120),
});
export type DevCompleteSessionBody = z.infer<typeof DevCompleteSessionBody>;
