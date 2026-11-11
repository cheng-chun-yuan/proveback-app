# 介面契約 v1

事實來源是 `packages/contract/src`,這份文件只說明規則與程式碼表達不了的部分。

| 檔案 | 內容 |
|---|---|
| `schemas.ts` | 資料模型、請求 body、回應(zod schema 與推導出的型別) |
| `routes.ts` | REST 路徑(`paths`)、組網址的 `url()`、前端頁面路由(`webRoutes`) |
| `events.ts` | SSE 事件:主辦方頻道 `HostEvent`、公開頻道 `PublicEvent` |
| `dev.ts` | 假資料模式專用端點的 schema |
| `mock.ts` | 符合契約的假資料 |

## 通用規則

- Base path:`/api/v1`。
- 主辦方端點用 session cookie(登入後由後端設定,`HttpOnly`)。
- 公開端點以 `joinToken` 或 `sessionId` 當憑證,不需登入。
- 錯誤格式:`{ "error": { "code", "message" } }`,錯誤碼見 `ErrorCode`。
- 列表一律回 `{ items: T[] }`,不做分頁。
- 首次登入自動建立一個 `personal` workspace。

## 驗什麼、存什麼

| 項目 | 做法 | 是否儲存 |
|---|---|---|
| 是否受制裁 (OFAC) | Self 內建檢查 | 只存 pass / fail |
| 國籍是否在排除名單 | 後端比對政策 | 政策開啟揭露時才存國籍代碼 |
| 姓名與會議顯示名稱是否相符 | 後端比對後丟棄姓名 | 只存比對結果與分數 |
| 同一人再次出現 | nullifier 比對 | 存 nullifier 的雜湊 |
| 護照號碼、生日、照片、完整姓名 | 不要求揭露 | 不存 |

`member` 類型的參與者不需要走 Self,`verification.status` 固定為 `verified`、`checks` 為 `null`。

公開端點與公開頻道刻意不回傳 `checks` 與國籍,只有 `status`。

## 即時事件

兩個 SSE 端點共用同一種封包 `{ type, meetingId, at, data }`。連線後第一筆一定是 `snapshot`(內容同 `GET /meetings/:mtgId` 或 `PublicMeeting`),之後才是增量事件。

| type | 主辦方頻道 data | 公開頻道 data |
|---|---|---|
| `snapshot` | `MeetingDetail` | `PublicMeeting` |
| `meeting.updated` | `Meeting` | `{ status, botStatus }` |
| `participant.joined` | `Participant` | `PublicParticipant` |
| `participant.left` | `{ participantId }` | `{ participantId }` |
| `verification.updated` | `{ participantId, verification }` | `{ participantId, status }` |

## 綁定規則

- `UNIQUE (workspace_id, nullifier_hash)`:一本護照在一個 workspace 只對應一筆來賓。
- `UNIQUE (meeting_id, guest_id)`:同一場會議一個來賓只能認領一個參與者;第二次認領回 `failureReason: 'already_bound'`。
- 一個參與者同時只有一個有效 session,新的會使舊的失效。
- 撤銷來賓後,同一 nullifier 再出現視為新來賓,`returning` 為 `false`。
- 唯一性靠資料庫約束,不做先查後寫。

## Self

- 後端用 Self 的託管 SDK 建立 session,`universalLink` 就是 Self 給的驗證網址;`selfApp` 目前固定為 `null`。
- 證明由 Self 以 webhook 送回後端驗簽(off-chain),不使用鏈上驗證。

## 假資料模式

後端沒設定某個外部服務的金鑰時,該服務改用假資料,並開放 `dev.ts` 定義的端點:

- Google:`/auth/google/start` 導向前端的 `/dev/login`,由它呼叫 `POST /dev/login`。
- Recall:`POST /dev/meetings/:mtgId/participants` 模擬有人進入會議。
- Self:`universalLink` 指向前端的 `/dev/self/:sessionId`,由它呼叫 `POST /dev/sessions/:sessionId/complete`。

正式環境這些端點回 404。

## 已知限制

1. **代掃**:QR 全會議可見,別人可以代替某位參與者掃護照。`nameMatch: 'require'` 可擋大部分情況。
2. **鏡頭前是否本人**:Self 不提供照片,無法比對視訊畫面。
3. **Meet 參與者辨識**:Meet 不提供來賓 email,只有顯示名稱,同名者無法區分。
4. **bot 入會**:bot 需要主辦方在 Meet 內按允許,期間 `botStatus` 為 `waiting_room`。
