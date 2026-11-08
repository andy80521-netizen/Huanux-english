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

## 第二輪質詢（請針對以下 Q1～Q3 逐題回答）
第一輪共識（我會採用）：交接時用交易把 `completed → saving`、`saveAttempt + 1`、刪掉 `results`；`getIdToken(true)` 後呼叫背景函式並等最多 10 秒的 202，失敗立刻 `saveError`；任務文件存翻譯檢查點、每批 60 秒逾時；心跳判斷卡住；教材建立後不可再進入 `saveError`；封面／重逢失敗不推翻教材；`whisper-transcribe` 只在 `status == 'processing'` 時寫入；放棄前先確認教材不存在才刪音檔。

**Q1：所有權保護用 Firestore REST `documents:commit` 是否可靠？**
草案：後端每次寫任務文件都「讀 → 確認 `status == 'saving'` 且 `saveAttempt` 是自己的 → 以讀到的 `updateTime` 當前置條件寫入」（409/412 就重讀一次）。建立教材時用**一次 `commit`** 同時做兩件事：`materials/{id}` 以 `currentDocument.exists=false` 建立＋任務文件以 `updateTime` 前置條件改成 `status: 'saved'`；兩者原子成功或一起失敗。前端「重試／回到校對／放棄」都先用交易把 `saveAttempt + 1`（或改 `status`）讓舊執行失效。
請找漏洞：前置條件是否足以擋住被接管的舊執行？心跳寫入會改 `updateTime`，是否會讓自己的下一次寫入一直 412？有沒有更簡單但一樣安全的做法？

**Q2：超過 15 分鐘的長教材怎麼處理？**
選項：(a) 接近 12 分鐘時保存檢查點、用同一個 `saveAttempt` 以 HTTP 呼叫自己接續；(b) 不自動接續，停在「可能中斷了」，使用者按重試從檢查點繼續；(c) 送出前依句數估算時間，超過就拒絕。以每批 30 句、每批 5～20 秒估算，多少句才會碰到上限？自我接續在 deploy preview 與正式站如何取得正確網址（`process.env.URL` 在 preview 是否指向正式站？用請求本身的 origin 是否可靠）？

**Q3：封面與重逢的觸發**
Gemini、Nemotron 建議直接 import 封面與重逢的程式在 `save-material` 裡跑；DeepSeek、Grok 建議 HTTP 呼叫既有背景函式、只等 202。`generate-cover` 本身要產場景描述＋產圖，可能數分鐘。請評估兩者對 15 分鐘預算、失敗隔離與 ID Token 效期的影響。

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

## 委員會審查整合（2026-11-09，第一輪＋質詢；待擁有者核准）

成員：Codex（兩輪）、Gemini 3.8 Flash、Nemotron、DeepSeek、Grok。Poolside 失敗（模型已下架）。

### 草案的主要漏洞（皆已對照程式碼確認，修正後的設計見下）
1. **交接不可靠**（Codex 🔴、Grok）：寫入 `saving` 與呼叫背景函式是兩件事，中間關 App 會永遠卡在 `saving`
2. **舊執行沒有失效機制**（Codex 🔴）：重試、回到校對、放棄之後，舊的執行仍可能晚一步建立教材；「放棄」可能刪掉已建立教材正在用的音檔
3. **教材已建立後仍可能被標成失敗**（Codex 🔴、Grok）：封面／重逢或刪任務失敗不能推翻已存好的教材
4. **任務文件太大**（Codex）：`whisper-transcribe` 已把整份轉錄 `results` 存在同一份文件，再加 `reviewed` 會兩份全文
5. **轉錄函式會蓋回狀態**（Grok）：`whisper-transcribe` 的寫入只檢查文件存在，遲到的寫入會把 `saving` 改回 `completed`
6. **ID Token 效期**（Codex、Gemini）：要在交接與重試時強制取得新 Token
7. **安全**（DeepSeek、Grok）：任務文件由前端寫入，後端必須驗證 `audioUrl` 是這個使用者、這份教材的音檔、句數與字數上限、封面選項；路徑用 Token 的 uid 組，不信任前端傳的路徑
8. 自我呼叫網址：`process.env.URL` 在預覽網站仍指向正式站（Codex、Gemini、Grok）

### 修正後的設計（建議採用）
**交接（前端）**
- 用交易把任務 `completed`（或重試時的 `saveError`／中斷）改成 `saving`、`saveAttempt + 1`、刪掉 `results`、寫入 `reviewed`、`title`、`audioUrl`、`coverChoice`、`progress`
- `getIdToken(true)` → 呼叫背景函式（body 帶 `saveAttempt`），**等最多 10 秒的 202**（不等翻譯）
- 收到 202 才回到教材庫；網路失敗或逾時 → 立刻寫 `saveError`「沒有叫到背景存檔」並可重試，不用等 3 分鐘
- 送出前估算大小，超過 900KB 提示分段（不設句數上限）

**背景執行（後端 `save-material`）**
- 只用使用者 ID Token＋REST；路徑用 Token 的 uid 組
- 認領：REST 交易內確認 `status == 'saving'`、`saveAttempt` 等於 body、沒有未過期租約 → 寫入自己的 `leaseId`
- 之後每次寫入（檢查點、心跳、收尾）都在交易內重新確認 `leaseId` 與 `saveAttempt`，不符就安靜結束（不寫 `saveError`）；衝突（`ABORTED`／`FAILED_PRECONDITION`）重跑交易
- **心跳不用平行計時器**：每批寫檢查點時一起寫，所有寫入串行（Codex、Gemini、Grok）
- 翻譯共用 `netlify/shared/translate.ts`（提示詞一字不改，加測試鎖住）；每批 60 秒逾時、最多重試 2 次；每批完成把翻譯存成檢查點，重試從檢查點繼續
- 驗證任務內容後才呼叫 AI（`audioUrl` 路徑、句數、字數、時間、封面選項）
- **一次 `commit` 原子完成**：`materials/{id}` 以不存在為前置條件建立＋任務改 `saved`
- 之後才 HTTP 呼叫既有的 `generate-cover`、`detect-sightings`，只等 202（重逢先寫 `materialSightings` 為 `processing`）；失敗只記在教材的封面／重逢狀態，**不推翻教材**；最後刪任務文件（刪除失敗仍算成功）
- 自我呼叫網址：用請求網址的 origin，但**必須符合允許清單**（正式站與本專案的預覽網址），不符就不送 Token
- 軟期限 12 分鐘：保存檢查點、標成「需要續存」，使用者按「繼續」從檢查點接續（不自動接續）

**其他程式**
- `whisper-transcribe` 只在讀到 `status == 'processing'` 時才寫入結果
- 全域提示放在 `App.tsx`（不隨分頁卸載）：頂部一行、多筆都列、不蓋底部錄音列；「可能中斷了」以心跳判斷
- 「回到校對」：從任務還原、校對畫面支援 Storage 網址播放；這個模式的「取消」只回列表、不刪檔；先讓舊執行失效
- 「放棄」：先讓舊執行失效 → 確認教材不存在才刪音檔與任務；教材已存在就只刪任務並提示已儲存
- 路徑二（TTS）與所有存檔中狀態：按鈕顯示「翻譯中 12/35…」與轉圈

### 分歧與我的建議
| 議題 | 各方說法 | 我的建議 |
|---|---|---|
| 封面／重逢怎麼觸發 | Gemini、Nemotron：在存檔函式內直接 import 執行；DeepSeek、Grok、Codex：HTTP 呼叫既有背景函式只等 202 | **HTTP 只等 202**：封面產圖、重逢比對各自要數分鐘，放進同一個 15 分鐘會和翻譯搶時間，失敗也會連坐 |
| 要不要等 202 再離開 | Nemotron：不等；其他：等 | **等最多 10 秒**：只有這樣才能分辨「沒叫到」，不必等 3 分鐘才發現 |
| 超過 15 分鐘 | Grok、Codex、Gemini：不要自動接續；Gemini 另建議 500 句上限 | **不自動接續、不設句數上限**：正常音檔 1～3 分鐘就完成（24MB 約 260～520 句）；真的超時就停在檢查點、按「繼續」接續 |
| 所有權 | 草案：讀 `updateTime` 再寫；Grok：交易＋`leaseId`；Codex：寫入串行＋執行代號 | **交易＋`leaseId`＋串行寫入**（兩者合併） |

### 駁回的意見
- 每文件每秒 1 次寫入會被觸發（Nemotron）：每批 5 秒以上才寫一次，不會
- 用 `-background` 檔名（Gemini）：本專案既有背景函式都用 `config.background`，維持一致

### 建議拆成兩個 PR
1. **先做小修（小級）**：所有存檔中狀態的按鈕顯示「翻譯中 12/35…」與轉圈。立刻解決「看起來沒反應」
2. **背景存檔（大級，本 PR）**：上面的完整設計

## 做法
（擁有者核准後填寫）

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
- 2026-11-09：委員會第一輪＋質詢完成（Poolside 失敗）；整合報告給擁有者。**下一步：等擁有者核准**
