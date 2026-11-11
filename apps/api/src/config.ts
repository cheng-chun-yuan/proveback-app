import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const trim = (s: string) => s.replace(/\/$/, '');

export interface Config {
  port: number;
  webUrl: string;
  publicApiUrl: string;
  dbPath: string;
  sessionSecret: string;
  botName: string;
  fakeBotDelayMs: number;
  sessionTtlSec: number;
  google: { clientId: string; clientSecret: string; redirectUri: string } | null;
  recall: { apiKey: string; region: string; webhookToken: string } | null;
  self: { apiKey: string; webhookSecret: string; flowId: string } | null;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const port = Number(env.PORT || 8787);
  const webUrl = trim(env.WEB_URL || 'http://localhost:5173');
  return {
    port,
    webUrl,
    publicApiUrl: trim(env.PUBLIC_API_URL || `http://localhost:${port}`),
    dbPath: env.DB_PATH || fileURLToPath(new URL('../data/proveback.sqlite', import.meta.url)),
    // 沒設定時每次啟動都換一把:登入狀態與 nullifier 雜湊都不會跨重啟,只適合本機試玩
    sessionSecret: env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
    botName: env.BOT_NAME || 'ProveBack',
    fakeBotDelayMs: Number(env.FAKE_BOT_DELAY_MS ?? 1000),
    sessionTtlSec: Number(env.VERIFY_SESSION_TTL_SEC ?? 300),
    google:
      env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
        ? {
            clientId: env.GOOGLE_CLIENT_ID,
            clientSecret: env.GOOGLE_CLIENT_SECRET,
            // 預設走前端網域(由 dev server 代理到後端),cookie 才會設在前端的 origin 上
            redirectUri: env.GOOGLE_REDIRECT_URI || `${webUrl}/api/v1/auth/google/callback`,
          }
        : null,
    recall: env.RECALL_API_KEY
      ? { apiKey: env.RECALL_API_KEY, region: env.RECALL_REGION || 'us-west-2', webhookToken: env.RECALL_WEBHOOK_TOKEN || '' }
      : null,
    self: env.SELF_API_KEY
      ? { apiKey: env.SELF_API_KEY, webhookSecret: env.SELF_WEBHOOK_SECRET || '', flowId: env.SELF_FLOW_ID || '' }
      : null,
  };
}
