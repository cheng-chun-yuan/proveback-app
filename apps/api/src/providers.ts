// Thin wrappers around external services. Only this file knows the shape of the Google / Recall.ai / Self APIs.
import { webRoutes } from '@proveback/contract';
import type { Config } from './config';
import { ApiError } from './util';

// ---------- Google OAuth(authorization code flow) ----------
export interface GoogleIdentity {
  email: string;
  name: string;
  avatarUrl: string | null;
}

export function googleAuthUrl(cfg: NonNullable<Config['google']>, state: string, nonce: string) {
  const q = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    nonce,
    prompt: 'select_account',
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
}

export async function googleExchange(cfg: NonNullable<Config['google']>, code: string, nonce: string): Promise<GoogleIdentity> {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      redirect_uri: cfg.redirectUri,
      grant_type: 'authorization_code',
    }),
  });
  const tok = (await r.json().catch(() => ({}))) as { id_token?: string; error?: string; error_description?: string };
  if (!r.ok || !tok.id_token) throw new ApiError('upstream_error', tok.error_description || tok.error || 'Google token exchange failed');
  // The id_token is fetched by the backend directly from the Google token endpoint over TLS, so checking the claims here is enough
  const c = JSON.parse(Buffer.from(tok.id_token.split('.')[1] ?? '', 'base64url').toString()) as Record<string, any>;
  const ok =
    c.aud === cfg.clientId &&
    ['https://accounts.google.com', 'accounts.google.com'].includes(c.iss) &&
    c.exp * 1000 > Date.now() &&
    c.nonce === nonce &&
    typeof c.email === 'string' &&
    c.email_verified === true;
  if (!ok) throw new ApiError('upstream_error', 'Google returned an invalid identity');
  const email = c.email.toLowerCase();
  return { email, name: typeof c.name === 'string' && c.name ? c.name : email, avatarUrl: typeof c.picture === 'string' ? c.picture : null };
}

// ---------- Recall.ai ----------
async function recallCall(cfg: NonNullable<Config['recall']>, path: string, body: unknown) {
  let r: Response;
  try {
    r = await fetch(`https://${cfg.region}.recall.ai/api/v1${path}`, {
      method: 'POST',
      headers: { authorization: `Token ${cfg.apiKey}`, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body ?? {}),
    });
  } catch (e) {
    throw new ApiError('upstream_error', `Recall unreachable: ${(e as Error).message}`);
  }
  const text = await r.text();
  if (!r.ok) throw new ApiError('upstream_error', `Recall ${path} -> ${r.status}: ${text.slice(0, 200)}`);
  return text ? (JSON.parse(text) as Record<string, any>) : {};
}

export async function recallCreateBot(cfg: Config, m: { meetingId: string; meetUrl: string; joinToken: string }): Promise<string> {
  const rc = cfg.recall!;
  const bot = await recallCall(rc, '/bot/', {
    meeting_url: m.meetUrl,
    bot_name: cfg.botName,
    metadata: { meetingId: m.meetingId },
    // The bot video feed = the frontend bot screen page (QR + live roster)
    output_media: { camera: { kind: 'webpage', config: { url: cfg.webUrl + webRoutes.botScreen(m.joinToken) } } },
    recording_config: {
      realtime_endpoints: [
        {
          type: 'webhook',
          url: `${cfg.publicApiUrl}/webhooks/recall?token=${encodeURIComponent(rc.webhookToken)}`,
          events: ['participant_events.join', 'participant_events.leave'],
        },
      ],
    },
  });
  if (typeof bot.id !== 'string') throw new ApiError('upstream_error', 'Recall did not return a bot id');
  return bot.id;
}

export const recallLeave = (cfg: Config, botId: string) => recallCall(cfg.recall!, `/bot/${botId}/leave_call/`, {});

// ---------- Self (off-chain: the hosted SDK creates the session, and the proof is sent back to the backend by webhook for signature verification) ----------
type SelfSdk = typeof import('@selfxyz/enterprise-sdk');
let sdk: Promise<SelfSdk> | null = null;
const selfSdk = () => (sdk ??= import('@selfxyz/enterprise-sdk'));

export async function selfCreateSession(cfg: Config, s: { sessionId: string; joinToken: string }) {
  const { SelfClient } = await selfSdk();
  const back = `${cfg.webUrl}${webRoutes.join(s.joinToken)}?session=${encodeURIComponent(s.sessionId)}`;
  try {
    const created = await new SelfClient({ apiKey: cfg.self!.apiKey }).sessions.create({
      flowId: cfg.self!.flowId,
      externalUuid: s.sessionId,
      expiresInSeconds: Math.max(60, cfg.sessionTtlSec), // Self requires at least 60 seconds
      successUrl: back,
      failureUrl: back,
    });
    return { selfSessionId: created.id, verificationUrl: created.verificationUrl };
  } catch (e) {
    throw new ApiError('upstream_error', `Self session failed: ${(e as Error).message}`);
  }
}

export async function selfVerifyWebhook(cfg: Config, raw: string, headers: Record<string, string>) {
  const { SelfWebhooks } = await selfSdk();
  return SelfWebhooks.verify(raw, headers, cfg.self!.webhookSecret);
}
