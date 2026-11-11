import express from 'express';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { db, save } from './store.js';

const PORT = process.env.PORT || 4000;
const PUBLIC_URL = (process.env.PUBLIC_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const BOT_URL = (process.env.BOT_URL || 'http://localhost:4100').replace(/\/$/, '');
const SHARED_SECRET = process.env.SHARED_SECRET || 'change-me';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const SELF_API_KEY = process.env.SELF_API_KEY || '';
const SELF_WEBHOOK_SECRET = process.env.SELF_WEBHOOK_SECRET || '';
const SELF_FLOW_ID = process.env.SELF_FLOW_ID || '';
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const MOCK_SELF = !SELF_API_KEY;
const MOCK_GOOGLE = !GOOGLE_CLIENT_ID;
const GOOGLE_REDIRECT = `${PUBLIC_URL}/auth/google/callback`;

// 兩種驗證方式:Google 登入證明組織(信箱網域),Self 證明護照屬性
const METHODS = { google: 'Google 登入(組織)', self: 'Self 護照' };
// 政策可以選擇揭露的欄位。org / email 來自 Google,其餘來自 Self
const ATTRIBUTES = {
  org: '組織',
  email: 'Email',
  nationality: '國籍',
  issuingState: '發照國',
  name: '姓名',
  gender: '性別',
  dateOfBirth: '出生日期',
};

let selfSdk = null;
if (!MOCK_SELF) selfSdk = await import('@selfxyz/enterprise-sdk');
const self = selfSdk ? new selfSdk.SelfClient({ apiKey: SELF_API_KEY }) : null;

if (db.policies.length === 0) {
  db.policies.push({
    id: crypto.randomUUID(),
    name: '示範政策',
    badgeLabel: '已驗證',
    methods: ['google', 'self'],
    disclose: ['org', 'nationality'],
    allowedNationalities: [],
    allowedDomains: [],
    timeoutSec: 180,
    selfFlowId: '',
  });
  save();
}

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const page = (title, body, head = '') => `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>${head}
<style>
body{font-family:system-ui,-apple-system,"PingFang TC",sans-serif;background:#f5f6f8;color:#16181d;margin:0;padding:24px 16px}
main{max-width:440px;margin:40px auto;background:#fff;border-radius:14px;padding:28px;box-shadow:0 1px 3px rgba(0,0,0,.08)}
h1{font-size:20px;margin:0 0 12px}p,li{line-height:1.6;color:#3b4252}
button{width:100%;padding:12px;border:0;border-radius:10px;background:#1f4fd8;color:#fff;font-size:16px;cursor:pointer;margin-top:12px}
select,input{width:100%;padding:10px;border:1px solid #cfd4dc;border-radius:8px;font-size:15px;box-sizing:border-box;margin:4px 0 10px}
.code{font:700 34px ui-monospace,monospace;letter-spacing:2px;text-align:center;padding:16px;background:#eef3ff;border-radius:10px;margin:16px 0;user-select:all}
.tag{display:inline-block;background:#fff3cd;color:#7a5b00;border-radius:6px;padding:2px 8px;font-size:12px;margin-bottom:10px}
.muted{color:#6b7280;font-size:13px}
.step{border:1px solid #e3e6ec;border-radius:10px;padding:10px 12px;margin:8px 0;font-size:15px}
.step.ok{background:#eefaf2;border-color:#bfe6cd;color:#0b6b33}
</style></head><body><main>${body}</main></body></html>`;

const notFound = (res) => res.status(404).send(page('找不到', '<h1>連結無效或已過期</h1>'));
const findSession = (id) => db.sessions.find((s) => s.id === id);
const methodsOf = (policy) => (policy.methods?.length ? policy.methods : ['self']);

const policyOf = (session) => {
  const meeting = db.meetings.find((m) => m.id === session.meetingId);
  return meeting && db.policies.find((p) => p.id === meeting.policyId);
};

function fail(session, status, reason) {
  session.status = status;
  session.reason = reason;
  delete session.steps;
  session.completedAt = new Date().toISOString();
  save();
}

// 記錄一個驗證步驟的結果;全部完成後套用政策。
// 只保留政策要揭露的欄位,其餘(包含中途暫存的 steps)全部丟掉。
function completeStep(session, method, attrs) {
  const policy = policyOf(session);
  if (!policy || session.status !== 'pending') return;
  session.steps = { ...session.steps, [method]: attrs };
  const methods = methodsOf(policy);
  if (!methods.every((m) => session.steps[m])) return save();

  const all = Object.assign({}, ...methods.map((m) => session.steps[m]));
  const domains = policy.allowedDomains || [];
  if (methods.includes('google') && domains.length && !domains.includes(all.org)) {
    return fail(session, 'rejected', '你的帳號不屬於這場會議允許的組織');
  }
  if (methods.includes('self') && policy.allowedNationalities.length && !policy.allowedNationalities.includes(all.nationality)) {
    return fail(session, 'rejected', '不符合這場會議的資格條件');
  }
  session.status = 'verified';
  session.code = 'V-' + crypto.randomInt(100000, 1000000);
  session.disclosed = Object.fromEntries(policy.disclose.filter((k) => all[k]).map((k) => [k, String(all[k])]));
  delete session.steps;
  session.completedAt = new Date().toISOString();
  save();
}

function badgeText(session) {
  const policy = policyOf(session);
  const parts = [policy?.badgeLabel || '已驗證'];
  for (const [k, v] of Object.entries(session.disclosed || {})) parts.push(`${ATTRIBUTES[k] || k}:${v}`);
  return parts.join('|');
}

const app = express();

// ---------- Self webhook(要用 raw body 驗簽,所以放在 express.json 之前) ----------
app.post('/webhooks/self', express.raw({ type: '*/*' }), (req, res) => {
  if (MOCK_SELF) return res.status(404).end();
  let event;
  try {
    event = selfSdk.SelfWebhooks.verify(req.body, req.headers, SELF_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Self webhook 驗簽失敗:', err.message);
    return res.status(400).send('bad signature');
  }
  if (event.type === 'verification.completed') {
    const session = findSession(event.external_uuid);
    if (session && session.status === 'pending') {
      if (event.status === 'valid') completeStep(session, 'self', event.proof_attributes || {});
      else fail(session, 'failed', event.reason || '護照驗證未通過');
    }
  }
  res.status(200).send('ok');
});

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// ---------- 與會者看到的驗證頁 ----------
app.get('/s/:id', (req, res) => {
  const session = findSession(req.params.id);
  const policy = session && policyOf(session);
  if (!policy) return notFound(res);
  if (session.status !== 'pending') return res.redirect(`/s/${session.id}/done`);

  const reveal = policy.disclose.length
    ? `<ul>${policy.disclose.map((k) => `<li>${esc(ATTRIBUTES[k])}</li>`).join('')}</ul>`
    : '<p>不會揭露任何個人資料,只會顯示「已驗證」。</p>';

  const methods = methodsOf(policy);
  const next = methods.find((m) => !session.steps?.[m]);
  const steps = methods
    .map((m, i) => `<div class="step ${session.steps?.[m] ? 'ok' : ''}">${session.steps?.[m] ? '✓' : i + 1 + '.'} ${esc(METHODS[m])}</div>`)
    .join('');

  let action = '';
  if (next === 'google') {
    action = `<form method="get" action="/s/${session.id}/google"><button>同意,用 Google 登入</button></form>
      <p class="muted">只會讀取你的 Email,用來確認所屬組織(信箱網域)。</p>`;
  } else if (next === 'self' && MOCK_SELF) {
    action = `<span class="tag">示範模式:未接 Self,以下為模擬資料</span>
      <form method="post" action="/s/${session.id}/mock">
        <label>模擬護照國籍</label>
        <select name="nationality">${['TWN', 'USA', 'JPN', 'KOR', 'DEU', 'FRA', 'GBR', 'SGP'].map((c) => `<option>${c}</option>`).join('')}</select>
        <label>模擬姓名</label><input name="name" value="${esc(session.participantName)}">
        <button>同意並完成護照驗證</button>
      </form>`;
  } else if (next === 'self') {
    action = `<form method="post" action="/s/${session.id}/start"><button>同意,用 Self 驗證護照</button></form>
      <p class="muted">會開啟 Self app,用護照晶片產生零知識證明。證件影像不會傳給會議主辦方。</p>`;
  }

  res.send(
    page(
      '會議身份驗證',
      `<h1>會議身份驗證</h1>
       <p><b>${esc(session.participantName)}</b>,這場會議(政策:${esc(policy.name)})要求驗證身份。</p>
       <p>驗證後,以下資訊會在會議聊天室公開給所有與會者:</p>${reveal}
       ${steps}${action}`,
    ),
  );
});

// ---------- Google 登入 ----------
app.get('/s/:id/google', (req, res) => {
  const session = findSession(req.params.id);
  if (!session || session.status !== 'pending') return res.redirect(`/s/${req.params.id}`);
  if (MOCK_GOOGLE) {
    return res.send(
      page(
        'Google 登入(示範)',
        `<span class="tag">示範模式:未接 Google OAuth,以下為模擬資料</span>
         <h1>模擬 Google 登入</h1>
         <form method="post" action="/s/${session.id}/google/mock">
           <label>模擬 Email</label><input name="email" type="email" value="demo@acme.com" required>
           <button>登入</button>
         </form>`,
      ),
    );
  }
  session.googleNonce = crypto.randomBytes(16).toString('hex');
  save();
  const q = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: GOOGLE_REDIRECT,
    response_type: 'code',
    scope: 'openid email',
    state: `${session.id}.${session.googleNonce}`,
    nonce: session.googleNonce,
    prompt: 'select_account',
  });
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${q}`);
});

app.post('/s/:id/google/mock', (req, res) => {
  const session = findSession(req.params.id);
  if (!MOCK_GOOGLE || !session) return res.status(404).end();
  const email = String(req.body.email || '').trim().toLowerCase();
  if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) completeStep(session, 'google', { email, org: email.split('@')[1] });
  res.redirect(`/s/${session.id}`);
});

app.get('/auth/google/callback', async (req, res) => {
  const [id, nonce] = String(req.query.state || '').split('.');
  const session = findSession(id);
  if (MOCK_GOOGLE || !session || !nonce || session.googleNonce !== nonce) return notFound(res);
  delete session.googleNonce; // 一次性
  save();
  if (!req.query.code) return res.redirect(`/s/${session.id}`); // 使用者取消
  try {
    const r = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: String(req.query.code),
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: GOOGLE_REDIRECT,
        grant_type: 'authorization_code',
      }),
    });
    const tok = await r.json();
    if (!r.ok || !tok.id_token) throw new Error(tok.error_description || tok.error || '換取 token 失敗');
    // id_token 是後端直接向 Google 的 token endpoint 以 TLS 取得,這裡檢查 claims 即可
    const c = JSON.parse(Buffer.from(tok.id_token.split('.')[1], 'base64url').toString());
    const ok =
      c.aud === GOOGLE_CLIENT_ID &&
      ['https://accounts.google.com', 'accounts.google.com'].includes(c.iss) &&
      c.exp * 1000 > Date.now() &&
      c.nonce === nonce &&
      c.email &&
      c.email_verified === true;
    if (!ok) throw new Error('Google 回傳的身份資料無效');
    const email = String(c.email).toLowerCase();
    // hd = Google Workspace 的組織網域;個人帳號沒有 hd,就用信箱網域
    completeStep(session, 'google', { email, org: (c.hd || email.split('@')[1]).toLowerCase() });
    res.redirect(`/s/${session.id}`);
  } catch (err) {
    console.error('Google 登入失敗:', err.message);
    res.status(502).send(page('錯誤', `<h1>Google 登入失敗</h1><p>${esc(err.message)}</p><p><a href="/s/${session.id}">重試</a></p>`));
  }
});

// ---------- Self ----------
app.post('/s/:id/start', async (req, res) => {
  const session = findSession(req.params.id);
  const policy = session && policyOf(session);
  if (MOCK_SELF || !policy || session.status !== 'pending') return res.redirect(`/s/${req.params.id}`);
  try {
    const created = await self.sessions.create({
      flowId: policy.selfFlowId || SELF_FLOW_ID,
      externalUuid: session.id,
      expiresInSeconds: 1800,
      successUrl: `${PUBLIC_URL}/s/${session.id}/done`,
      failureUrl: `${PUBLIC_URL}/s/${session.id}/done`,
    });
    session.selfSessionId = created.id;
    save();
    res.redirect(303, created.verificationUrl);
  } catch (err) {
    console.error('建立 Self session 失敗:', err);
    res.status(502).send(page('錯誤', `<h1>無法啟動 Self 驗證</h1><p>${esc(err.message)}</p>`));
  }
});

app.post('/s/:id/mock', (req, res) => {
  const session = findSession(req.params.id);
  if (!MOCK_SELF || !session) return res.status(404).end();
  completeStep(session, 'self', { nationality: req.body.nationality, issuingState: req.body.nationality, name: req.body.name });
  res.redirect(`/s/${session.id}/done`);
});

app.get('/s/:id/done', (req, res) => {
  const session = findSession(req.params.id);
  if (!session) return notFound(res);
  if (session.status === 'pending') {
    // 只有在等 Self webhook 時才停在這裡,其餘情況回到步驟頁
    if (!session.selfSessionId || session.steps?.self) return res.redirect(`/s/${session.id}`);
    return res.send(
      page('等待驗證結果', '<h1>等待驗證結果…</h1><p>完成 Self 驗證後,這個頁面會自動更新。</p>', '<meta http-equiv="refresh" content="2">'),
    );
  }
  if (session.status === 'verified') {
    return res.send(
      page(
        '驗證完成',
        `<h1>驗證完成,還差一步</h1><p>請把下面這組驗證碼貼到會議聊天室,bot 才能確認是你本人:</p>
         <div class="code">${esc(session.code)}</div>
         <p class="muted">聊天室將顯示:${esc(badgeText(session))}</p>`,
      ),
    );
  }
  if (session.status === 'bound') return res.send(page('已完成', '<h1>✅ 已完成</h1><p>你的驗證徽章已在會議中公告,可以關閉這個頁面。</p>'));
  res.send(page('驗證未通過', `<h1>驗證未通過</h1><p>${esc(session.reason)}</p>`));
});

// ---------- 給 proveback-bot 用的 API ----------
const botAuth = (req, res, next) =>
  req.get('authorization') === `Bearer ${SHARED_SECRET}` ? next() : res.status(401).json({ error: 'unauthorized' });

app.get('/api/meetings/:id', botAuth, (req, res) => {
  const meeting = db.meetings.find((m) => m.id === req.params.id);
  const policy = meeting && db.policies.find((p) => p.id === meeting.policyId);
  if (!policy) return res.status(404).json({ error: 'not_found' });
  res.json({ id: meeting.id, policy: { name: policy.name, timeoutSec: policy.timeoutSec } });
});

app.post('/api/sessions', botAuth, (req, res) => {
  const { meetingId, participantId, participantName } = req.body;
  const meeting = db.meetings.find((m) => m.id === meetingId);
  const policy = meeting && db.policies.find((p) => p.id === meeting.policyId);
  if (!policy || participantId == null) return res.status(404).json({ error: 'not_found' });
  const pid = String(participantId);
  let session = db.sessions.find((s) => s.meetingId === meetingId && s.participantId === pid && ['pending', 'verified', 'bound'].includes(s.status));
  if (!session) {
    session = {
      id: crypto.randomBytes(16).toString('hex'),
      meetingId,
      participantId: pid,
      participantName: participantName || '與會者',
      status: 'pending',
      createdAt: new Date().toISOString(),
    };
    db.sessions.push(session);
    save();
  }
  res.json({ status: session.status, verifyUrl: `${PUBLIC_URL}/s/${session.id}`, timeoutSec: policy.timeoutSec });
});

app.post('/api/redeem', botAuth, (req, res) => {
  const { meetingId, participantId, code } = req.body;
  const session = db.sessions.find((s) => s.meetingId === meetingId && s.code === code && s.status === 'verified');
  if (!session) return res.json({ ok: false, reason: 'unknown_code' });
  if (session.participantId !== String(participantId)) return res.json({ ok: false, reason: 'participant_mismatch' });
  session.status = 'bound';
  session.boundAt = new Date().toISOString();
  save();
  res.json({ ok: true, badge: badgeText(session) });
});

app.get('/api/meetings/:id/participants/:pid', botAuth, (req, res) => {
  const session = db.sessions.find((s) => s.meetingId === req.params.id && s.participantId === req.params.pid && s.status === 'bound');
  res.json({ verified: !!session });
});

// ---------- 管理後台 ----------
const adminAuth = (req, res, next) => {
  if (!ADMIN_PASSWORD) return next();
  const [, b64] = (req.get('authorization') || '').split(' ');
  const pass = Buffer.from(b64 || '', 'base64').toString().split(':').slice(1).join(':');
  if (pass === ADMIN_PASSWORD) return next();
  res.set('WWW-Authenticate', 'Basic realm="proveback-app"').status(401).send('需要登入');
};

app.get('/admin/api/state', adminAuth, (req, res) => {
  res.json({
    mockSelf: MOCK_SELF,
    mockGoogle: MOCK_GOOGLE,
    googleRedirect: GOOGLE_REDIRECT,
    methods: METHODS,
    attributes: ATTRIBUTES,
    policies: db.policies.map((p) => ({ ...p, methods: methodsOf(p), allowedDomains: p.allowedDomains || [] })),
    meetings: db.meetings.map((m) => ({
      ...m,
      sessions: db.sessions
        .filter((s) => s.meetingId === m.id)
        .map((s) => ({ name: s.participantName, status: s.status, disclosed: s.disclosed || {}, reason: s.reason })),
    })),
  });
});

app.post('/admin/api/policies', adminAuth, (req, res) => {
  const b = req.body;
  const list = (v) => String(v || '').split(/[\s,]+/).filter(Boolean);
  const methods = (b.methods || []).filter((m) => m in METHODS);
  const policy = {
    id: crypto.randomUUID(),
    name: String(b.name || '未命名政策').slice(0, 80),
    badgeLabel: String(b.badgeLabel || '已驗證').slice(0, 40),
    methods: methods.length ? methods : ['self'],
    disclose: (b.disclose || []).filter((k) => k in ATTRIBUTES),
    allowedNationalities: list(b.allowedNationalities).map((c) => c.toUpperCase()).filter((c) => /^[A-Z]{3}$/.test(c)),
    allowedDomains: list(b.allowedDomains).map((d) => d.toLowerCase().replace(/^@/, '')).filter((d) => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(d)),
    timeoutSec: Math.min(Math.max(Number(b.timeoutSec) || 180, 30), 3600),
    selfFlowId: String(b.selfFlowId || '').trim(),
  };
  db.policies.push(policy);
  save();
  res.json(policy);
});

app.post('/admin/api/meetings', adminAuth, async (req, res) => {
  const { meetingUrl, policyId } = req.body;
  if (!db.policies.some((p) => p.id === policyId)) return res.status(400).json({ error: '找不到政策' });
  const meeting = { id: crypto.randomUUID(), meetingUrl: String(meetingUrl || ''), policyId, createdAt: new Date().toISOString() };
  db.meetings.push(meeting);
  save();
  try {
    const r = await fetch(`${BOT_URL}/bots`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${SHARED_SECRET}` },
      body: JSON.stringify({ meetingId: meeting.id, meetingUrl: meeting.meetingUrl }),
    });
    const out = await r.json();
    if (!r.ok) throw new Error(out.error || `bot 回應 ${r.status}`);
    meeting.botId = out.botId;
    meeting.joinUrl = out.joinUrl || null;
    meeting.status = 'bot_sent';
  } catch (err) {
    meeting.status = 'bot_error';
    meeting.error = err.message;
  }
  save();
  res.status(meeting.status === 'bot_sent' ? 200 : 502).json(meeting);
});

app.use('/admin', adminAuth, express.static(fileURLToPath(new URL('./public', import.meta.url))));
app.get('/', (req, res) => res.redirect('/admin/'));

app.listen(PORT, () => {
  console.log(`proveback-app: ${PUBLIC_URL}/admin/`);
  console.log(`  Self:   ${MOCK_SELF ? '示範模式(未設定 SELF_API_KEY)' : '已啟用'}`);
  console.log(`  Google: ${MOCK_GOOGLE ? '示範模式(未設定 GOOGLE_CLIENT_ID)' : `已啟用,redirect URI = ${GOOGLE_REDIRECT}`}`);
});
