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
const MOCK = !SELF_API_KEY;

// Self 回傳的 proof_attributes 裡,我們允許政策選擇揭露的欄位
const ATTRIBUTES = {
  nationality: '國籍',
  issuingState: '發照國',
  name: '姓名',
  gender: '性別',
  dateOfBirth: '出生日期',
};

let selfSdk = null;
if (!MOCK) selfSdk = await import('@selfxyz/enterprise-sdk');
const self = selfSdk ? new selfSdk.SelfClient({ apiKey: SELF_API_KEY }) : null;

if (db.policies.length === 0) {
  db.policies.push({
    id: crypto.randomUUID(),
    name: '示範政策',
    badgeLabel: '護照已驗證',
    disclose: ['nationality'],
    allowedNationalities: [],
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
</style></head><body><main>${body}</main></body></html>`;

const policyOf = (session) => {
  const meeting = db.meetings.find((m) => m.id === session.meetingId);
  return meeting && db.policies.find((p) => p.id === meeting.policyId);
};

// 驗證結果進來後,套用政策。只保留政策要揭露的欄位,其餘丟掉。
function finalize(session, attrs, valid, reason) {
  const policy = policyOf(session);
  if (!valid || !policy) {
    session.status = 'failed';
    session.reason = reason || '驗證未通過';
  } else if (policy.allowedNationalities.length && !policy.allowedNationalities.includes(attrs.nationality)) {
    session.status = 'rejected';
    session.reason = '不符合這場會議的資格條件';
  } else {
    session.status = 'verified';
    session.code = 'V-' + crypto.randomInt(100000, 1000000);
    session.disclosed = Object.fromEntries(
      policy.disclose.filter((k) => attrs[k]).map((k) => [k, String(attrs[k])]),
    );
  }
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
  if (MOCK) return res.status(404).end();
  let event;
  try {
    event = selfSdk.SelfWebhooks.verify(req.body, req.headers, SELF_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Self webhook 驗簽失敗:', err.message);
    return res.status(400).send('bad signature');
  }
  if (event.type === 'verification.completed') {
    const session = db.sessions.find((s) => s.id === event.external_uuid);
    if (session && session.status === 'pending') {
      finalize(session, event.proof_attributes || {}, event.status === 'valid', event.reason);
      session.nullifier = event.nullifier || null;
      save();
    }
  }
  res.status(200).send('ok');
});

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// ---------- 與會者看到的驗證頁 ----------
app.get('/s/:id', (req, res) => {
  const session = db.sessions.find((s) => s.id === req.params.id);
  const policy = session && policyOf(session);
  if (!policy) return res.status(404).send(page('找不到', '<h1>連結無效或已過期</h1>'));
  if (session.status !== 'pending') return res.redirect(`/s/${session.id}/done`);

  const reveal = policy.disclose.length
    ? `<ul>${policy.disclose.map((k) => `<li>${esc(ATTRIBUTES[k])}</li>`).join('')}</ul>`
    : '<p>不會揭露任何個人資料,只會顯示「已驗證」。</p>';
  const mockForm = `<span class="tag">示範模式:未接 Self,以下為模擬資料</span>
    <form method="post" action="/s/${session.id}/mock">
      <label>模擬護照國籍</label>
      <select name="nationality">${['TWN', 'USA', 'JPN', 'KOR', 'DEU', 'FRA', 'GBR', 'SGP']
        .map((c) => `<option>${c}</option>`)
        .join('')}</select>
      <label>模擬姓名</label><input name="name" value="${esc(session.participantName)}">
      <button>同意並完成驗證</button>
    </form>`;
  const selfForm = `<form method="post" action="/s/${session.id}/start"><button>同意,用 Self 驗證護照</button></form>
    <p class="muted">會開啟 Self app,用護照晶片產生零知識證明。證件影像不會傳給會議主辦方。</p>`;

  res.send(
    page(
      '會議身份驗證',
      `<h1>會議身份驗證</h1>
       <p><b>${esc(session.participantName)}</b>,這場會議(政策:${esc(policy.name)})要求驗證身份。</p>
       <p>驗證後,以下資訊會在會議聊天室公開給所有與會者:</p>${reveal}
       ${MOCK ? mockForm : selfForm}`,
    ),
  );
});

app.post('/s/:id/start', async (req, res) => {
  const session = db.sessions.find((s) => s.id === req.params.id);
  const policy = session && policyOf(session);
  if (MOCK || !policy || session.status !== 'pending') return res.redirect(`/s/${req.params.id}`);
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
  const session = db.sessions.find((s) => s.id === req.params.id);
  if (!MOCK || !session) return res.status(404).end();
  if (session.status === 'pending') {
    finalize(session, { nationality: req.body.nationality, issuingState: req.body.nationality, name: req.body.name }, true);
  }
  res.redirect(`/s/${session.id}/done`);
});

app.get('/s/:id/done', (req, res) => {
  const session = db.sessions.find((s) => s.id === req.params.id);
  if (!session) return res.status(404).send(page('找不到', '<h1>連結無效或已過期</h1>'));
  if (session.status === 'pending') {
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
    mock: MOCK,
    attributes: ATTRIBUTES,
    policies: db.policies,
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
  const policy = {
    id: crypto.randomUUID(),
    name: String(b.name || '未命名政策').slice(0, 80),
    badgeLabel: String(b.badgeLabel || '已驗證').slice(0, 40),
    disclose: (b.disclose || []).filter((k) => k in ATTRIBUTES),
    allowedNationalities: String(b.allowedNationalities || '')
      .toUpperCase()
      .split(/[\s,]+/)
      .filter((c) => /^[A-Z]{3}$/.test(c)),
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
  console.log(`proveback-app: ${PUBLIC_URL}/admin/  (${MOCK ? '示範模式,未接 Self' : 'Self 已啟用'})`);
});
