# proveback-app

會議身份驗證的設定與驗證服務。搭配 `proveback-bot` 使用。

- **管理後台** `/admin/`:建立政策(揭露哪些欄位、限定國籍、時限),貼會議連結派 bot。
- **驗證頁** `/s/:id`:與會者看到同意畫面,依政策用 Google 登入(證明組織)和/或 Self(證明護照屬性)。
- **Bot API** `/api/*`:給 `proveback-bot` 建立驗證 session、兌換驗證碼。

只儲存政策要揭露的欄位,其餘 Self 回傳的屬性不落地。資料存在 `data/db.json`。

## 啟動

```bash
npm install
cp .env.example .env
npm start
```

兩種驗證方式各自獨立,沒填金鑰的那一種會進入**示範模式**(用模擬資料),所以可以先只接其中一個。

## 接上 Google OAuth

用來證明與會者屬於哪個組織。組織 = Google Workspace 的網域(`hd`);個人帳號則取信箱網域(例如 `gmail.com`)。

1. 到 Google Cloud Console → APIs & Services → OAuth consent screen,建立同意畫面(測試階段選 External,並把測試者的 Google 帳號加進 Test users)。
2. Credentials → Create credentials → OAuth client ID → Web application。
3. Authorized redirect URIs 填 `<PUBLIC_URL>/auth/google/callback`。本機測試可以直接填 `http://localhost:4000/auth/google/callback`。
4. 把 Client ID 和 Client secret 填入 `GOOGLE_CLIENT_ID`、`GOOGLE_CLIENT_SECRET`,重啟。

只要求 `openid email` 兩個 scope,不讀取其他資料。Email 只有在政策勾選揭露時才會保存。

## 接上 Self

1. 到 Self Enterprise dashboard 建立一個 flow(Pre-KYC 或 Custom Config),在 Configure 分頁把 **Nationality** reveal 打開。政策想揭露的欄位,flow 上都要先開。
2. 取得測試金鑰 `sk_test_…` 與 flow ID,填入 `SELF_API_KEY`、`SELF_FLOW_ID`。
3. 用 ngrok 或 Cloudflare Tunnel 把 4000 port 公開,把公開網址填入 `PUBLIC_URL`。
4. 在 dashboard 的 Developer → Webhooks(Test 分頁)新增 `https://<公開網址>/webhooks/self`,把 `whsec_…` 填入 `SELF_WEBHOOK_SECRET`。
5. 手機裝 Self app,Settings → Manage ID documents → Generate Mock Document 產生測試護照。

測試金鑰接受 mock 護照且不計費;換成 live 金鑰即為正式環境,flow ID 不變。

## 流程

1. bot 偵測到有人加入 → `POST /api/sessions` → 拿到 `verifyUrl` 發到聊天室。
2. 與會者開連結、同意,依序完成政策要求的步驟:Google 登入(`/auth/google/callback`)、Self 驗證(Self 呼叫 `/webhooks/self`)。
3. 全部完成後套用政策(組織網域限制、國籍限制、揭露欄位),產生一次性驗證碼顯示在頁面上。
4. 與會者把驗證碼貼回會議聊天室 → bot `POST /api/redeem`,確認發話者就是該 session 的與會者,才公告徽章。

第 4 步是為了把「驗證的人」綁到「會議裡的那個人」:聊天室連結是公開的,少了這步別人可以冒用。
