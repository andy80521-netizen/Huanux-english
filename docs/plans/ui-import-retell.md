# 規劃：UI 改版 ②b｜啟蒙的開始：匯入流程與複述練習

- **級別**：大（全站改版第二階段的後半；5 個畫面約 2,100 行；不改資料、不新增套件）
- **PR**：#12
- **狀態**：已核准，實作中

## 目標
把「啟蒙的開始」剩下的匯入流程與複述練習改成 A「靜讀」設計（設計稿已經擁有者確認），功能、流程、資料不變。完成後「啟蒙的開始」整個分頁都是新設計。

1. **匯入新教材**（`MaterialImportMode`）：三種方式成為三張選項卡（手機直排、桌機三欄），各有圖示與一行說明；音檔區為虛線大按鈕；舊題庫為勾選列；處理中改成**三步驟進度**，選項卡變淡；成功／警告／錯誤訊息用語意色
2. **校對內容**（`MaterialReviewPanel`）：每句一張卡；英文用 Newsreader 輸入框；開始／結束時間做成「−0.5｜數值｜+0.5」膠囊；低信心度＝warn 邊框＋提示列；播放片段為外框按鈕；已刪除區塊可展開；**手機版「取消／確認儲存」固定在畫面底部**
3. **萃取預覽**（`ExtractPreviewDialog`）：沿用 `ConfirmDialog` 的新對話框樣式；分組勾選清單
4. **複述練習**（`RetellView`）：段落說明、重聽這一段、要用上的句型（左側細線＋襯線字）；錄音中大號計時「1:24 / 3:00」＋呼吸燈＋「我說完了」；桌機右側欄放重聽與歷史紀錄
5. **複述回饋**（`RetellFeedbackPanel`）：內容涵蓋／語言表現兩個大號襯線分數＋細條（沿用分數跑動）；內容涵蓋 ✓／✗；語言修正為刪除線原句對照修正句；句型運用三色標籤（用對了＝accent、用錯了＝warn、沒用到＝muted）；示範版本斜體襯線＋播放示範

## 背景與使用情境
- PR ①（設計系統）、②a（列表、詳情、跟讀、評分結果）已上線
- 匯入一份教材通常一次要校對數十句，校對頁的操作效率是重點；複述是聽完一段後自由說，回饋內容多，需要清楚的閱讀層級

## 設計依據
- 設計畫布「Huanux 視覺方向提案」第五列：匯入（手機）、校對（手機）、複述結果（手機深色）、匯入處理中（桌機）、複述錄音中（桌機）
- 只用 PR ① 的語意 token 與共用元件（`Button`、`IconButton`、`ProgressBar`、`SegmentedControl`、`ConfirmDialog`）

## 相關檔案
- `src/components/MaterialImportMode.tsx`
- `src/components/MaterialReviewPanel.tsx`
- `src/components/ExtractPreviewDialog.tsx`
- `src/components/RetellView.tsx`
- `src/components/RetellFeedbackPanel.tsx`
- `src/components/MaterialDetailView.tsx`
- `src/components/ui/Button.tsx`
- `src/utils/countUp.ts`
- `src/styles/app.css`
- `src/components/ui/SegmentedControl.tsx`
- `src/components/ui/ProgressBar.tsx`
- `src/components/ConfirmDialog.tsx`

## 做法

### 1. 匯入新教材（`MaterialImportMode.tsx` 的匯入畫面）
- 拿掉 ②a 加上的 `max-w-3xl` 限制，改成和其他頁一致的寬版（桌機選項卡三欄，最大 1200px）
- 頁首：返回 `IconButton`＋「匯入新教材」；下方新增一行說明（見文案清單）
- 三張選項卡（`bg-surface border-line`）：圖示（accent-soft 圓角方塊）、標題、一行說明
  - 從音檔匯入：虛線大按鈕「選擇音檔 (.mp3)」
  - 從文字或文件匯入：`textarea`（Newsreader）＋「直接送出文字」（主按鈕）＋「上傳檔案」（次要）
  - 從舊題庫匯入：勾選列（整列可點、選中時 accent 邊框與淡底）＋「匯入選定題庫」（次要）；「尚無舊題庫資料」保留
- **處理中三步驟進度**：新增純函式 `src/utils/importSteps.ts`：`importSteps(loadingState, ttsPending, progress)` → `{ steps: [{ label, status: 'done'|'active'|'pending', detail? }] } | null`
  - `ttsPending`：呼叫端只在 `pendingMaterial?.source === 'tts'` 時傳 true；`progress` 為 `{ done, total }`（生成語音時把 `ttsProgress.current` 對應成 done）
  - 音檔：上傳音檔（`uploadingAudio`）→ 轉錄與斷句（`transcribing`）→ 校對與翻譯（`translating`）
  - 文字與舊題庫：準備句子（`processing` 且 `ttsPending` 為 false）→ 生成語音（`generating`）→ 校對與儲存（`processing` 且 `ttsPending` 為 true）。舊題庫沒有 AI 分析這一步，所以第一步叫「準備句子」（Codex）
  - 進行中那一步的 detail **完全沿用原本的提示文字**：正在上傳音檔至 Storage...／Whisper 正在進行語音轉錄與斷句...／正在翻譯（已完成 n / 共 m 句）...／Gemini AI 正在處理中...／正在生成語音 (n/m)...（progress 為空時用 0，與現行相同）
  - 「轉錄與斷句」進行中時，未開始的「校對與翻譯」detail 為「完成後先校對時間軸，確認儲存時再翻譯」
  - 已完成的步驟只顯示勾號，不另加「已完成」文字
  - `idle` 與沒在用的舊狀態（`uploading`、`analyzing`、`timestamping`）回傳 null：UI 保留原本的單行提示文字（保底）
  - 「取消匯入」只在 `uploadingAudio`、`transcribing` 出現（與現行相同）
  - 處理中選項卡 `opacity-45 pointer-events-none`，輸入、勾選、按鈕同時 disabled（現行勾選列仍可點，一併擋住）
- **校對中隱藏三張選項卡**（Grok）：`pendingMaterial` 存在時不渲染選項卡，校對畫面佔滿整頁、以「校對內容」為主標題，與設計稿一致（擁有者 2026-10-27 同意）
- 返回鈕換成 `IconButton`，`onClick`（取消 Whisper、取消校對時清除暫存音檔）與 `disabled={loadingState === 'translating'}` 整段保留
- 結果區（文字匯入後的句子列表、生成語音／萃取語言模型按鈕、萃取成功訊息）：換成新樣式，句子用 Newsreader；文案不變
- 成功／萃取成功：`bg-accent-soft text-ink`；警告：`bg-warn/10 text-warn`；錯誤：`bg-danger/10 text-danger` 加 `role="alert"`；不用實心 warn／danger 配白字（深色對比不足）。文案不變
- Whisper 錯誤的「重試」「取消」按鈕與文案不變

### 2. 校對內容（`MaterialReviewPanel.tsx`）
- 「校對內容」成為這個畫面的主標題；「檔案：…（保留 N 句，已刪除 M 句）」在下方
- 封面風格改 `SegmentedControl`（寫實攝影／日系動漫／不產生封面），標籤「封面風格」去掉冒號；`huanux_cover_style` 儲存邏輯不動
- 句子卡：第 N 句＋刪除（文字按鈕）；低信心度提示列；「原文 (English)」標籤＋Newsreader `textarea`；TTS 來源時的「翻譯 (Chinese)」`textarea`；時間錯誤與微調警告用 warn
- 時間膠囊：`−0.5` 按鈕（Unicode 減號，與現行相同）｜`input type="number"`（保留 `step="0.01"`、`parseFloat(...) || 0`、字級 16px 避免 iOS 聚焦放大）｜`+0.5` 按鈕；標籤「開始 (s)」「結束 (s)」以 `htmlFor` 綁定輸入框
- 低信心度判斷維持 `lowConfidence || needsReview`；播放沿用同一個 `audioRef`
- 播放片段／暫停播放：外框按鈕，播放中 accent 淡底
- 已刪除（N）：可展開區塊，內容與復原按鈕換新樣式
- 動作列：
  - **手機**：「取消」「確認儲存」以 `sticky bottom-0` 固定在**匯入頁捲動區的底部**（在 App 底部分頁列的上方，不會互相重疊）；「至少需保留 1 句才能存檔」「第 N 句的時間需要修正」、翻譯失敗訊息顯示在按鈕上方，讓使用者按了沒反應時看得到原因
  - 打字時：不特別處理（擁有者選 A）：鍵盤會蓋住動作列，收起鍵盤後即可按；列入 iPhone 實機驗收
  - **桌機**：在標題區右側；兩組按鈕以 `lg:hidden`／`hidden lg:flex` 分開，畫面上只會有一組
- 內嵌的「捨棄已刪除句子」確認：換新樣式，文案與兩個按鈕不變

### 3. 萃取預覽（`ExtractPreviewDialog.tsx`）
- 外框、標題、按鈕比照 `ConfirmDialog` 的樣式（surface、圓角），**不加 Esc 關閉**：這裡的取消就是「全部不要」，匯入頁會顯示「沒有加入任何句型」、詳情頁會把該句標成已萃取，按 Esc 不該觸發（Codex、Grok）
- 分組（結構句型／片語／語組）只影響顯示，勾選仍用原 `candidates` 索引，未知分類放最後一組；儲存中不能改勾選；「加入中…」「全部不要」等文案不變

### 4. 複述練習（`RetellView.tsx`）
- 拿掉 ②a 在 `MaterialDetailView` 外包的 `max-w-3xl`，改成寬版
- 頁首：返回（錄音中、分析中 disabled，沿用）＋「複述練習」＋「第 N 段：標題」
- 段落區：說明文字、「重聽這一段／停止播放」（次要按鈕，錄音中 disabled）、「試著用上這些句型」（左側 accent 細線、句型 Newsreader、中文 muted）
- 錄音區：
  - 待錄音：大圓錄音鈕＋「按下開始錄音，最長 3 分鐘」
  - 錄音中：呼吸燈＋大號計時 `formatTime(seconds)`＋「/ 3:00」＋「我說完了」主按鈕＋「停下來想沒關係，不會自動結束」
  - 處理中：轉圈＋原本的處理文字
  - 錯誤：「重試分析」「重新錄一次」
- 完成：你說的（語音辨識）＋`RetellFeedbackPanel`＋「重播我的錄音」「再複述一次」
- 歷史紀錄：可展開列（日期、內容／語言分數）；展開後「當時說的」＋回饋
- 桌機（`lg`）：主欄（段落、錄音、回饋，文字寬度上限約 680px）＋右側欄 320px（重聽這一段、歷史紀錄）；主欄的重聽鈕只在手機顯示，桌機只有一顆；手機單欄
- 計時用 `` `${formatTime(seconds)} / ${formatTime(MAX_SECONDS)}` ``；3 分鐘自動停止保留；呼吸燈用既有 `animate-breathe`
- 錄音鈕仍是使用者直接點擊的按鈕，`startRecording` 的靜音解鎖順序不動

### 5. 複述回饋（`RetellFeedbackPanel.tsx`）
- 兩個分數：大號 Newsreader＋標籤＋`ProgressBar`（max 100）；新增可選 prop `animateScores`（預設 false），只有「這次結果」傳 true；跑動用 `countUpValue`，減少動態效果時直接顯示；分數不是數字時只顯示原值、不畫條
- 評語：一般內文
- 內容涵蓋：✓（accent）／✗ 漏掉（warn）
- 語言修正：卡片，原句 muted＋warn 刪除線，修正句 Newsreader，說明 muted 小字
- 句型運用：狀態標籤三色＋句型 Newsreader＋說明
- 示範版本：標題列＋「播放示範／語音準備中…」（accent-soft 小按鈕）；內容 Newsreader 斜體

### 6. 共用
- 這 5 個元件不再使用 `slate-`、`indigo-`、`red-`、`emerald-`、`amber-`、`green-`、`orange-`、`yellow-`、`purple-` 色階 class
- 不改任何 handler、狀態流轉、Firestore 讀寫、AI 呼叫

## 驗收條件
1. `importSteps`：
   - `idle`、`uploading`、`analyzing`、`timestamping` → null
   - `uploadingAudio`／`transcribing`／`translating` 為音檔三步，done／active／pending 正確；`translating` 不論 `ttsPending` 都走音檔路徑
   - active detail 與原本提示文字**完全相同**：`translating` + `{2,9}` →「正在翻譯（已完成 2 / 共 9 句）...」、progress 為 null →「已完成 0 / 共 0 句」；`generating` + `{1,4}` →「正在生成語音 (1/4)...」；`processing` →「Gemini AI 正在處理中...」
   - `transcribing` 時未開始的「校對與翻譯」detail 為「完成後先校對時間軸，確認儲存時再翻譯」
   - `processing` + `ttsPending` false → 文字第 1 步「準備句子」active；+ true → 第 3 步「校對與儲存」active
   → ✅（`tests/importSteps.test.ts`）
2. 文案守門（每句以完整連續字串比對）：既有文案全部保留（見下方清單）；新文案「選一種方式匯入。原文會逐句斷句並翻譯，不會摘要或改寫。」與三張卡的說明各自完整存在；計時以 `formatTime(MAX_SECONDS)` 組出「/ 3:00」→ ✅（`tests/uiCopyImportRetell.test.ts`）
   - 既有文案：選擇音檔 (.mp3)、直接送出文字、上傳檔案、匯入選定題庫、尚無舊題庫資料、取消匯入、重試、生成語音，開始跟讀、萃取語言模型、請先登入、檔案超過 24MB，請壓縮或改用較短的音檔、校對內容、確認儲存、至少需保留 1 句才能存檔、此句的斷句或時間可能不準，建議優先核對、原文 (English)、翻譯 (Chinese)、開始 (s)、結束 (s)、播放片段、暫停播放、復原、確定存檔、將永久捨棄、開始時間必須小於結束時間、全部不要、加入中…、複述練習、重聽這一段、停止播放、試著用上這些句型、按下開始錄音，最長 3 分鐘、我說完了、停下來想沒關係，不會自動結束、你說的（語音辨識）、重試分析、重新錄一次、再複述一次、重播我的錄音、當時說的、無法取得麥克風權限、語音辨識中…、分析你的複述中…、內容涵蓋、語言表現、語言修正、句型運用、示範版本、播放示範、語音準備中…、用對了、用錯了、沒用到、漏掉：
3. 色階禁令：5 個元件不再使用 `slate-`、`indigo-`、`red-`、`emerald-`、`amber-`、`green-`、`orange-`、`yellow-`、`purple-` 色階 class → ✅（同上）
4. 寬度：`MaterialImportMode`、`MaterialDetailView` 不再有 ②a 的 `max-w-3xl` 暫時限制 → ✅（同上）
5. `MaterialReviewPanel` 使用 `SegmentedControl` 且保留 `huanux_cover_style`；`ExtractPreviewDialog` 沒有 Escape 鍵處理 → ✅（同上）
6. `bash scripts/check.sh` 通過 → ✅
7. 手機：匯入三張卡、處理中三步驟（音檔、文字各走一次）、校對頁底部動作列、萃取預覽、複述錄音中與結果 → 👀
8. 桌機：選項卡三欄、處理進度、複述右側欄 → 👀
9. 淺色、深色沒有看不清的字 → 👀
10. 減少動態效果時複述分數直接顯示；歷史紀錄展開時不跑分 → 👀
11. 校對頁（手機）：底部只有一組按鈕且在分頁列上方；最後一句不被擋住；iPhone 上編輯第一句與最後一句的英文、兩個時間欄，焦點欄位看得到，收起鍵盤後按鈕可按 → 👀
12. 轉錄中按「取消匯入」回到可再選檔；校對中返回會清掉暫存音檔（沿用）→ 👀
13. 萃取預覽：匯入頁與詳情頁各開一次，分組顯示、勾選數量正確；「全部不要」行為與現行相同；按 Esc 不會關閉 → 👀
14. 舊題庫匯入 → 生成語音 → 校對 → 儲存，步驟顯示正確 → 👀

## 手動試用步驟
1. 預覽網站用 **Email 測試帳號**登入（連正式 Firebase；匯入與複述會產生 Whisper／Gemini 費用）
2. 匯入一個短 mp3：看三步驟進度 → 校對頁（改一句時間、刪一句再復原、播放片段）→ 確認儲存（看翻譯進度）
3. 貼一小段英文送出：看結果列表 → 生成語音 → 校對 → 儲存；也試「萃取語言模型」的預覽對話框
4. 進教材詳情 → 複述練習一段：錄音中看計時，說完看回饋；展開歷史紀錄
5. 桌機與手機、淺色與深色各看一次

## 不要做的事
- 不改匯入、Whisper、翻譯、TTS、時間軸校對、複述分段、AI 回饋的任何邏輯與資料
- 除了「文案變更清單」，不改文案
- 不新增套件

## 委員會意見整合（第一輪，2026-10-27）
成員：Gemini、Nemotron、Poolside、DeepSeek、Grok、Codex。全部回覆。

**採納**
- 舊題庫沒有分析步驟，第一步改「準備句子」（Codex）
- 底部動作列的捲動容器、與 App 底部分頁列的關係、打字時行為要定義並實機驗收（Codex、Gemini）
- 萃取預覽不加 Esc：取消＝全部不要，有副作用（Codex、Grok）
- 校對中隱藏三張選項卡（Grok）；active detail 完全沿用原提示文字、`importSteps` 參數語意寫死（Grok）
- 成功用 accent-soft、錯誤與警告用淡底，不用實心配白字（Grok）
- 桌機只有一顆重聽、歷史紀錄不跑分、計時用 `MAX_SECONDS` 組字、數字輸入 16px、低信心度條件、返回鈕邏輯整段保留、勾選列處理中也要擋（Grok）
- 文案守門清單補齊十多句既有文案，並以完整連續字串比對（Grok）

**駁回**
- `sticky` 在 iOS 不可靠、改 `fixed`（Grok）— `fixed` 會蓋到 App 自己的底部分頁列；動作列放在匯入頁捲動區內 `sticky`，並列入 iPhone 實機驗收
- 複述歷史紀錄加播放錄音（Gemini 提問）— 新功能，不在本 PR 範圍
- `RetellView` 外包的 `max-w-3xl` 在 `RetellView.tsx` 內（Poolside）— 誤判，實際寫在 `MaterialDetailView.tsx`

## 文案變更清單（擁有者 2026-10-27 已同意）
| 位置 | 原本 | 改成 |
|---|---|---|
| 匯入頁標題下（新） | （無） | 選一種方式匯入。原文會逐句斷句並翻譯，不會摘要或改寫。 |
| 三張選項卡說明（新） | （無） | 真人 mp3（podcast、廣播），自動切出每句時間／貼上英文，或上傳 .txt／.pdf，用 AI 語音產生原音／把舊版課程的題目轉成教材 |
| 處理中（新） | 單行提示文字 | 正在匯入＋步驟名稱（上傳音檔、轉錄與斷句、校對與翻譯／準備句子、生成語音、校對與儲存）；已完成的步驟只顯示勾號；進行中那一步沿用原本的提示文字；未開始的「校對與翻譯」附「完成後先校對時間軸，確認儲存時再翻譯」 |
| 校對頁 | 封面風格： | 封面風格 |
| 複述計時（新） | 1:24 | 1:24 / 3:00 |

## 資料相容與備份
- 新程式能否讀取舊格式資料：可以，不改資料結構
- 是否改寫既有資料：否
- Merge 前的備份方式：不需要

## 新增套件
- 無

## 決策紀錄
- 2026-10-27 擁有者：②b 先畫設計稿；級別「大」
- 2026-10-27 擁有者：設計稿確認；新增說明文字同意；校對頁手機版動作列固定在底部
- 2026-10-27 擁有者核准規劃：舊題庫第一步叫「準備句子」；校對中隱藏三張選項卡；打字時底部動作列不特別處理（選項 A）

## 進度紀錄
- 2026-10-27：建立分支與規劃文件，開草稿 PR #12；委員會＋Codex 第一輪全部回覆，已整合
