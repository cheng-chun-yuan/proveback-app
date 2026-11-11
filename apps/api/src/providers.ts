// Thin wrappers around external services. Only this file knows the shape of the Google / Recall.ai / Self APIs.
import { createRequire } from 'node:module';
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

// ---------- Self, open-source SDK (legacy; needs no API key) ----------
// The Self app posts the proof straight to this API and it is verified here, off-chain.
// The verifier reads Self's registry roots from Celo over public RPC, so the server needs outbound network access.
// Self marks this SDK as legacy in favour of the hosted one above; it is kept because it works without an account.

/** What a session asks the passport holder to prove. The QR link and the verifier must agree on this. */
export interface SelfOpenRequirements {
  name: boolean;
  nationality: boolean;
  ofac: boolean;
  minimumAge: number | null;
}

// @selfxyz/common cannot be loaded as ESM on current Node (a JSON import without an attribute), so load both as CommonJS
const cjs = createRequire(import.meta.url);
type SelfCore = typeof import('@selfxyz/core');
const selfCore = (): SelfCore => cjs('@selfxyz/core');

export const selfOpenEndpoint = (cfg: Config) => `${cfg.publicApiUrl}/webhooks/self-proof`;

/** Self hands the user id back as hex or as a decimal string; reduce every form to 32 lowercase hex characters */
export function normalizeSelfUserId(id: string): string {
  let u = String(id || '').toLowerCase().replace(/^0x/, '').replace(/-/g, '');
  if (/^\d+$/.test(u) && u.length > 32) u = BigInt(u).toString(16);
  return u.padStart(32, '0').slice(-32);
}

const verificationConfig = (r: SelfOpenRequirements) => ({
  ...(r.ofac ? { ofac: true } : {}),
  ...(r.minimumAge !== null ? { minimumAge: r.minimumAge } : {}),
});

export function selfOpenLink(cfg: Config, userId: string, r: SelfOpenRequirements): string {
  try {
    const { SelfAppBuilder } = cjs('@selfxyz/common') as { SelfAppBuilder: new (o: Record<string, unknown>) => { build(): unknown } };
    const app = new SelfAppBuilder({
      appName: 'ProveBack',
      scope: cfg.selfOpen!.scope,
      endpoint: selfOpenEndpoint(cfg),
      endpointType: cfg.selfOpen!.mock ? 'staging_https' : 'https',
      userId,
      userIdType: 'uuid',
      disclosures: { ...(r.name ? { name: true } : {}), ...(r.nationality ? { nationality: true } : {}), ...verificationConfig(r) },
    }).build();
    return selfCore().getUniversalLink(app as Parameters<SelfCore['getUniversalLink']>[0]);
  } catch (e) {
    throw new ApiError('upstream_error', `Could not build the Self link: ${(e as Error).message}`);
  }
}

export interface SelfOpenProofBody {
  attestationId: unknown;
  proof: unknown;
  publicSignals: unknown;
  userContextData: unknown;
}

/** Verify a proof posted by the Self app. `lookup` returns what the session behind a user id was asked to prove. */
export async function selfOpenVerify(cfg: Config, body: SelfOpenProofBody, lookup: (userId: string) => SelfOpenRequirements | null) {
  const { SelfBackendVerifier, AllIds } = selfCore();
  type V = InstanceType<SelfCore['SelfBackendVerifier']>;
  const store = {
    getActionId: async (userIdentifier: string) => normalizeSelfUserId(userIdentifier),
    getConfig: async (id: string) => {
      const r = lookup(id);
      return r ? verificationConfig(r) : {};
    },
    setConfig: async () => false,
  };
  const verifier = new SelfBackendVerifier(cfg.selfOpen!.scope, selfOpenEndpoint(cfg), cfg.selfOpen!.mock, AllIds, store, 'uuid');
  return verifier.verify(
    body.attestationId as Parameters<V['verify']>[0],
    body.proof as Parameters<V['verify']>[1],
    body.publicSignals as Parameters<V['verify']>[2],
    String(body.userContextData),
  );
}
