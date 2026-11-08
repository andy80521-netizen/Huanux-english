# 規劃：匯入教材在伺服器背景存檔

- **級別**：大（轉錄任務文件新增狀態與欄位、新增後端背景流程；擁有者 2026-11-09 選擇「伺服器後台處理」）
- **PR**：#37
- **狀態**：規劃中

## 目標
上傳 mp3 匯入、在校對畫面按「確認儲存」後：
1. 翻譯＋存檔交給**伺服器背景**完成；使用者可以立刻離開、切分頁、鎖屏、關掉 App，都不影響
2. 任何分頁都看得到「教材儲存中：〈標題〉12/35」
3. 完成後教材出現在教材庫並提示「已儲存」；失敗時可以「重試」、「回到校對」或「放棄」，校對內容不會遺失

## 背景
- 擁有者 2026-11-09 回報：音檔校對完按儲存、確認捨棄刪除的句子後「沒反應」
- 原因（讀碼確認）：`confirmAndSaveMaterial` 在前端逐批（30 句）呼叫 `translate-sentences`，全部翻完才 `setDoc`。翻譯進度只顯示在頁面最上方，手機底部的「確認儲存」只是變灰。整個過程綁在前端：
  - 切到其他分頁會卸載 `MaterialImportMode`：非同步流程通常仍會跑完，但畫面狀態遺失，失敗時沒有任何地方顯示
  - App 退到背景或鎖屏：iOS 會暫停網頁程式，翻譯請求可能中斷
  - 在匯入頁按「返回」會走 `handleCancelReview`，刪除已上傳的音檔與任務文件

## 範圍
- **只做路徑一（上傳 mp3）**：音檔在進入校對前已經上傳到 Storage，伺服器拿得到
- 路徑二（文字＋TTS）：語音是在手機上產生的檔案，存檔時才從手機上傳，無法交給伺服器，**維持現狀**；只改「按鈕顯示進度」
- 不改 `Material` 的資料格式；不改寫既有教材

## 目前的程式（2026-11-09 讀碼）
- `MaterialImportMode.confirmAndSaveMaterial`（路徑一）：
  1. `translateSentences`（前端，逐批 30 句呼叫 `translate-sentences`，沒有逾時）
  2. 組 `Material`：`id`、`title`、`course: "未分類"`、`sourceText`、`audioUrl`、`audioSource: 'upload'`、`sentences[{ id: s_i, text, translation, startTime, endTime, lowConfidence, needsReview, mastery: 0 }]`、`createdAt`、`graduated: false`；有選封面時加 `coverStyle`、`coverStatus: 'generating'`、`coverRequestedAt`
  3. `setDoc` → 有選封面時 `startCoverGeneration`（呼叫 `generate-cover`）→ `requestSightingDetection`（呼叫 `detect-sightings`）→ 刪除 `transcriptionJobs/{materialId}`
- `transcriptionJobs/{materialId}`：轉錄時建立 `{ status: 'processing', createdAt }`，`whisper-transcribe` 寫回 `completed`＋`results` 或 `error`＋`errorMessage`
- 後端寫 Firestore 一律用**使用者的 ID Token＋REST API**（不用服務帳號）；`detect-sightings.ts` 已有 `fsGet`／`fsPatch`／`fsDelete` 與值轉換

## 設計草案（請委員會挑錯）

### 1. 前端按「確定存檔」
1. 寫入 `transcriptionJobs/{materialId}`（merge，保留 `createdAt`）：
   - `status: 'saving'`、`title`、`audioUrl`、`coverChoice`
   - `reviewed`：校對後的句子 `[{ text, startTime, endTime, lowConfidence, needsReview }]`
   - `progress: { done: 0, total: N }`、`saveRequestedAt`
2. 呼叫 Background Function `save-material`，body `{ idToken, materialId }`
3. 立刻回到教材庫；全域顯示儲存進度（第 3 節）

### 2. 後端 `save-material`（Background，最多 15 分鐘）
1. `verifyRealUserToken`；讀任務文件，`status` 必須是 `saving`
2. **防重複執行**：寫入 `saveStartedAt`（帶 `updateTime` 前置條件）；已有另一個執行中且 N 分鐘內有進度 → 結束
3. 翻譯：抽出 `netlify/shared/translate.ts`（提示詞與檢查與 `translate-sentences` 共用、完全相同），每批 30 句，每批完成寫 `progress.done`
4. 組 `Material`（抽成純函式 `buildUploadMaterial`，前後端格式一致）→ 以 `currentDocument.exists=false` 前置條件建立教材（已存在＝之前已存好 → 直接收尾）
5. 有選封面 → 呼叫 `generate-cover`；呼叫 `detect-sightings`（同一個 ID Token，打自己網站的 Function）
6. 刪除任務文件
7. 任何失敗：`status: 'saveError'`、`errorMessage`；`reviewed` 保留

### 3. 前端全域狀態
- App 層監聽 `transcriptionJobs` 中 `status in ['saving', 'saveError']`：
  - 儲存中：所有分頁上方顯示「教材儲存中：〈標題〉12/35」
  - 失敗：「〈標題〉儲存失敗：原因」＋「重試」「回到校對」「放棄」
  - **卡住判斷**：`saving` 超過 3 分鐘沒有進度 → 顯示「可能中斷了」＋「重試」
  - 完成：任務文件消失且教材已存在 → 「〈標題〉已儲存」
- 「回到校對」：從任務文件還原校對內容，音檔改用 Storage 的 `audioUrl` 播放（校對畫面目前只吃本機檔案，要加網址來源）
- 「放棄」：刪除音檔與任務文件（沿用 `cleanupPathOneUpload`）

### 4. 順便修
- 路徑二（TTS）與任何「處理中」狀態：手機底部與桌機的「確認儲存」按鈕直接顯示「翻譯中 12/35…」或「儲存中…」與轉圈

## 想請委員會回答的問題
1. 防重複執行與卡住判斷：前置條件、`saveStartedAt`、3 分鐘門檻是否合理？Background Function 被平台重試時怎麼辦？
2. 前端要不要等 Background Function 回 202 才離開？呼叫失敗（網路斷）時任務會停在 `saving`，怎麼讓使用者知道？
3. 在背景函式裡呼叫 `generate-cover`／`detect-sightings`（打自己網站的網址），還是由前端看到完成後再觸發？
4. REST 寫入大型巢狀 `Material`（數百句）：值轉換、文件 1MB 上限、`reviewed` 放在任務文件的大小
5. 安全：任務文件內容由前端寫入、後端讀取後寫成教材，需要驗證哪些欄位（`audioUrl` 只能是自己的 Storage 路徑、句數、字數上限）？
6. ID Token 1 小時效期：長教材翻譯是否可能超過？
7. 全域提示的介面：放在哪裡、會不會干擾跟讀錄音？
8. 驗收測試怎麼設計（純函式＋假 fetch）？

## 相關檔案
- `src/components/MaterialImportMode.tsx`
- `src/components/MaterialReviewPanel.tsx`
- `netlify/functions/translate-sentences.ts`
- `netlify/functions/whisper-transcribe.ts`
- `netlify/functions/detect-sightings.ts`
- `netlify/functions/generate-cover.ts`
- `netlify/shared/auth.ts`
- `src/services/cover.ts`
- `src/services/sightings.ts`
- `src/App.tsx`
- `src/types.ts`

## 做法
（委員會評估、擁有者核准後填寫）

## 驗收條件
（待定案）

## 手動試用步驟
（待定案）

## 不要做的事
- 不改 `Material` 格式、不改寫既有教材
- 不使用服務帳號（沿用使用者 ID Token＋REST）
- 不新增 npm 套件
- 翻譯提示詞不改內容（只搬到共用模組）

## 資料相容與備份
- 新程式能否讀取舊格式資料：能（教材格式不變）
- 是否改寫既有資料：否；只在**新的**轉錄任務文件加狀態與欄位（暫存，存好即刪除）
- Merge 前的備份方式：不需要

## 新增套件
- 不需要

## 決策紀錄
- 2026-11-09 擁有者：按儲存後要在後台繼續，不管怎麼跳畫面都不影響；選擇「伺服器後台處理」（大級）

## 進度紀錄
- 2026-11-09：讀碼、寫規劃草案；開草稿 PR，送委員會＋Codex
