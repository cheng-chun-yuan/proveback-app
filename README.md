# ProveBack

會議身分驗證 prototype。主辦方用 Google 登入管理 workspace 與驗證政策;開 Google Meet 時 bot 進入會議,在自己的視訊畫面顯示 QR code;來賓掃碼後用 Self 掃護照,只揭露政策要求的項目,結果即時顯示在 bot 畫面與主辦方儀表板。

Self 的證明一律在後端驗證(off-chain),不使用鏈上合約。

## 結構

```
packages/contract/   型別、zod schema、路由常數、事件定義(前後端唯一共用處)
apps/web/            前端,只 import contract
apps/api/            後端,只 import contract
```

## 分工規則

1. `apps/web` 與 `apps/api` 互不 import、互不修改對方目錄。
2. `packages/contract` 是介面契約 v1,已凍結。之後只允許加選填欄位、加新端點、加新事件。
3. 破壞性變更一律開 `/api/v2`,不改 v1。
4. 外部服務(Google OAuth、Recall.ai、Self)只有後端會碰。

契約說明見 [docs/contract-v1.md](docs/contract-v1.md)。

## 開發

```bash
npm install
npm run dev:api
npm run dev:web
```

後端沒填金鑰的外部服務會自動進入假資料模式,不需要任何帳號就能走完整個流程。
