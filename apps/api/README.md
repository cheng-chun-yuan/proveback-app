# @proveback/api

ProveBack 的後端:Hono + libSQL(`@libsql/client`;本機是 SQLite 檔案,正式環境是 Turso),介面完全照 `packages/contract`。

## 啟動

```bash
npm install            # 在 repo 根目錄
cp apps/api/.env.example apps/api/.env
npm run dev:api        # http://localhost:8787/api/v1
```

```bash
npm test -w @proveback/api        # 契約測試(假資料模式、暫存檔資料庫)
npm run typecheck -w @proveback/api
```

## Database

libSQL through `@libsql/client`. All access is async; `db.tx(async (t) => …)` runs an interactive write transaction and every statement inside it must use the handle `t`.

| Variable | Meaning |
|---|---|
| `DATABASE_URL` | `libsql://…` (Turso) or `file:…`. Fallback: `TURSO_DATABASE_URL`. Unset = local file at `DB_PATH`. |
| `DATABASE_AUTH_TOKEN` | Token for a remote database. Fallback: `TURSO_AUTH_TOKEN`. |
| `DB_PATH` | Local SQLite file, used only when no URL is set. Default `apps/api/data/proveback.sqlite`. |
| `SSE_POLL_MS` | How often an open SSE stream re-reads its snapshot from the database (default `1500`, `0` = off). |
| `SSE_MAX_MS` | Maximum lifetime of one SSE stream (default unlimited; `50000` on Vercel). The browser reconnects by itself. |

The schema is created on the first query of each process (`CREATE TABLE IF NOT EXISTS`).

## Deploying to Vercel

The repo root has `vercel.json` and `api/index.js`. `npm run build:vercel` builds the web app into `apps/web/dist` and bundles `src/vercel.ts` into `apps/api/dist/vercel.js`; `/api/*` and `/webhooks/*` are rewritten to that one function (Node.js runtime), everything else falls back to the SPA.

1. Create a Turso database and import the repo in Vercel with the repo root as the project root (Node.js 22 or newer).
2. Set these environment variables:

| Variable | Value |
|---|---|
| `DATABASE_URL` + `DATABASE_AUTH_TOKEN` | The Turso URL and token (or `TURSO_DATABASE_URL` + `TURSO_AUTH_TOKEN` from the Turso integration) |
| `SESSION_SECRET` | A long random string. Must be set and must not change. |
| `WEB_URL` | The deployment's public URL, e.g. `https://proveback.example.com` |
| `PUBLIC_API_URL` | The same URL (webhooks are served from the same domain) |
| Google / Recall / Self keys | Optional, as in `.env.example`; a service without keys stays in fake mode |

What is different on Vercel (`process.env.VERCEL` is set):

- Instances share nothing in memory. Each SSE stream polls the database every `SSE_POLL_MS` and sends a fresh `snapshot` when the state changed, so events from other instances arrive within about 1.5 s. Events from the same instance still arrive immediately and are followed by one redundant `snapshot`.
- Streams end after 50 s (`SSE_MAX_MS`) and the browser's `EventSource` reconnects. The function's `maxDuration` is 60 s.
- No timers run after a response. Session expiry is applied on read; in fake mode the bot is already `in_meeting` when `POST /meetings/:mtgId/bot` returns.
- Without `DATABASE_URL` the API falls back to a SQLite file in `/tmp`, which is neither persistent nor shared. Use it only to check that a deployment boots.

## 假資料模式

Google、Recall、Self 三個外部服務各自獨立:沒填金鑰的那一個就用假資料,並開放 `packages/contract/src/dev.ts` 定義的端點。全部留空就能不靠任何帳號走完整個流程。

| 服務 | 假資料模式的行為 |
|---|---|
| Google | `/auth/google/start` 導向前端的 `/dev/login`,由它呼叫 `POST /dev/login` |
| Recall | 派 bot 後約 1 秒變成 `in_meeting`;用 `POST /dev/meetings/:mtgId/participants` 模擬有人進會議 |
| Self | `universalLink` 指向前端的 `/dev/self/:sessionId`,由它呼叫 `POST /dev/sessions/:sessionId/complete` |

三個都接上真實服務後,`/dev/*` 全部回 404。

## 接上真實服務

**Google OAuth**:Google Cloud Console 建立 Web application 的 OAuth client,Authorized redirect URI 填 `<WEB_URL>/api/v1/auth/google/callback`,把 client ID 與 secret 填進 `.env`。scope 是 `openid email profile`。

**Recall.ai**:填 `RECALL_API_KEY`、`RECALL_REGION`、`RECALL_WEBHOOK_TOKEN`,並把 `PUBLIC_API_URL` 設成公開 HTTPS 網址。`WEB_URL` 也必須是 Recall 連得到的公開網址,因為 bot 的視訊畫面就是前端的 `/bot-screen/:joinToken`。

**Self**:在 Self Enterprise dashboard 建一個 flow,打開 Nationality 與 Full name 的揭露以及 OFAC;把測試金鑰、flow ID 填進 `.env`;webhook 網址填 `<PUBLIC_API_URL>/webhooks/self`,把 `whsec_…` 填進 `SELF_WEBHOOK_SECRET`。證明只在後端驗簽(off-chain),不使用鏈上驗證。

**Self(開源 SDK,不需要金鑰)**:`SELF_API_KEY` 留空,設 `SELF_MODE=open`,並把 `PUBLIC_API_URL` 設成公開 HTTPS 網址。來賓頁的連結會直接開啟 Self app,app 把證明送到 `<PUBLIC_API_URL>/webhooks/self-proof`,後端在這裡驗證(off-chain)。每場會議要求揭露的項目依政策決定:要比對姓名才要姓名、要顯示國籍或有排除名單才要國籍、OFAC 與最低年齡照政策設定。`SELF_MOCK=true`(預設)接受 Self app 產生的 mock 護照。注意:Self 已把這套 SDK 標為舊版;驗證時會透過公開 RPC 讀取 Celo 上的登錄資料,伺服器需要能連外。這條路徑還沒有用真實的 Self app 測過。

## 驗證邏輯

一份證明依序檢查:`proof_invalid` → `ofac` → `excluded_country` → `underage` → `name_mismatch` → 綁定來賓(`already_bound`)。

- **姓名比對**:正規化(大小寫、變音符號)後切 token,不看順序,容許 MRZ 截斷;分數是 Dice 係數,≥ 0.6 算相符。比對完姓名就丟掉,不寫進資料庫。
- **國籍**:只有政策開啟 `discloseNationality` 才儲存國籍代碼,否則只存是否允許。
- **年齡(真 Self)**:Self 的最低年齡是設定在 flow 上的,證明只保證「至少 N 歲」。政策的 `minimumAge` 為 null 時跳過;否則證明保證的年齡 ≥ 政策要求才算通過,不然一律判 `underage`。所以 flow 上的最低年齡要設成不低於政策要求的值。
- **nullifier**:只存 HMAC 雜湊(金鑰由 `SESSION_SECRET` 衍生)。
- **唯一性**:靠資料庫約束,`guests UNIQUE (workspace_id, nullifier_hash)`、`bindings UNIQUE (meeting_id, guest_id)`。撤銷來賓會清掉雜湊,同一本護照再出現就是新來賓。

## 尚未實測的假設

以下只在假資料模式與單元測試中驗證過,沒有對真實服務跑過:

- **Google OAuth**:authorization code 流程與 claims 檢查。
- **Recall.ai**:Create Bot 的 `output_media.camera` 網頁輸出、`realtime_endpoints` 的參與者事件格式、`leave_call`。
- **Recall 的 bot 狀態事件**:`waiting_room` 等狀態要靠 Recall 的狀態 webhook(另外在 dashboard 設定),這裡只是盡力對應事件名稱;沒收到的話,以「第一個參與者事件」當作 bot 已進入會議。
- **Recall 的錄製**:bot 預設會錄製會議,這裡沒有關閉錄製的設定。
- **Self**:`sessions.create` 與 webhook 的欄位依 SDK 型別與官方文件撰寫;`proof_attributes` 裡 `name`、`nationality`、`ofac`、`minimumAge` 的實際內容要用測試金鑰確認。

## 結構

| 檔案 | 內容 |
|---|---|
| `src/app.ts` | 路由、授權、SSE、webhook |
| `src/core.ts` | 登入、參與者、驗證 session、套用證明、綁定來賓 |
| `src/providers.ts` | Google / Recall / Self 的呼叫(只有這裡知道外部 API 的樣子) |
| `src/db.ts` | libSQL client、schema、transaction |
| `src/vercel.ts` | Vercel function entry (`hono/vercel`) |
| `test/contract.test.ts` | 每個回應都用契約 schema 驗證 |
