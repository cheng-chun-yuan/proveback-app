# @proveback/web

ProveBack 的前端:主辦方儀表板、來賓驗證頁、bot 畫面頁。只透過 `@proveback/contract` 定義的介面跟後端溝通,不知道 Recall.ai 與 Self 的 API。

## 接後端開發

```bash
npm run dev:api
npm run dev:web
```

開 http://localhost:5173 。dev server 會把 `/api` 轉給 `http://localhost:8787`(REST 與 SSE 都走這裡,cookie 才不會跨站)。後端沒設定金鑰的外部服務會進入假資料模式,這時前端會出現對應的模擬畫面。

## Mock 模式(不需要後端)

```bash
npm run dev:mock -w @proveback/web
```

- REST 由 MSW 攔截,回應來自 `src/mock/store.ts` 的記憶體狀態,初始資料取自契約的 `mock*`。
- 即時事件不走 EventSource,改接 store 的事件匯流排(`src/api/events.ts` 的介面相同)。
- 狀態存在 localStorage 並用 BroadcastChannel 同步,所以主辦方頁、來賓頁、模擬 Self 頁可以開在同一個瀏覽器的不同分頁。換瀏覽器或換裝置看不到彼此的資料。
- 頁面最上方的「重設資料」會清掉 mock 狀態。

走一遍流程:登入 → 選「合作夥伴季度會議」或新建一場 → 派出 bot → 用「模擬參與者加入」加一位來賓 → 開啟來賓驗證頁 → 選自己 → 同意 → 開啟模擬 Self 頁送出護照 → 回主辦方頁看結果。護照編號填 `P-KEN` 會被認成名冊裡既有的來賓。

不開瀏覽器也能驗證 mock 的行為(用 msw/node 跑同一組 handler,每個回應都過契約 schema):

```bash
npm run test:mock -w @proveback/web
```

## 頁面

| 路由 | 對象 | 內容 |
|---|---|---|
| `/login` | 主辦方 | Google 登入 |
| `/w/:wsId/meetings` | 主辦方 | 會議列表、建立會議 |
| `/w/:wsId/meetings/:mtgId` | 主辦方 | 即時參與者與驗證細節、派出/收回 bot、重設驗證、來賓連結 |
| `/w/:wsId/policies` | 主辦方 | 驗證政策 |
| `/w/:wsId/members` | 主辦方 | 成員與角色、建立公司 workspace |
| `/w/:wsId/guests` | 主辦方 | 來賓名冊、撤銷綁定 |
| `/join/:joinToken` | 來賓 | 選參與者 → 看揭露項目 → Self 驗證 → 結果 |
| `/bot-screen/:joinToken` | Recall bot | 1280×720 畫面:QR 與即時驗證名單 |
| `/dev/login` | 假資料模式 | 模擬 Google 登入 |
| `/dev/self/:sessionId` | 假資料模式 | 模擬 Self 掃護照 |

## 結構

- `src/api/client.ts`:唯一的 HTTP 出口。網址用契約的 `url()`,回應用契約的 zod schema 解析。
- `src/api/events.ts`:SSE 訂閱,第一筆 `snapshot` 之後套用增量事件,斷線自動重連。
- `src/pages/`、`src/components/`:頁面與共用元件。
- `src/mock/`:mock 模式專用,正式 build 不會包含。

## 檢查

```bash
npm run typecheck -w @proveback/web
npm run build -w @proveback/web
```
