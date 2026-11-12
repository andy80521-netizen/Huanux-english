# 規劃：時間軸精確度第二階段——量測基準與離線對照（D／H）

- **級別**：中（新增伺服器診斷功能；不改資料結構、不新增套件；擁有者 2026-11-12 確認）
- **PR**：#46
- **狀態**：診斷功能完成，等擁有者 Merge 後取得 David Jones 的診斷資料；下一步標註工具（Artifact）與離線對照

## 目標
匯入 mp3 後切出的句子時間「不太需要手動調整」。在改轉錄策略前，先能**量化現在準不準**，之後任何改動都用同一把尺比較。

## 背景
- 承接 `docs/plans/import-timestamp-accuracy.md`（2026-11-08 核准順序：PR-A → PR-G → **基準** → **D／H 離線對照** → E／F）
- PR-A（播放停止精準化）、PR-G（校對與調整時間）已完成；PR #42～#45 修好 iPhone 播放（跳轉中暫停會讓播放器壞掉）
- 擁有者 2026-11-12 決定：
  - 擁有者用標註工具**聽過確認**
  - 音檔用 David Jones 這集＋擁有者再提供 1～2 個
  - 中級，先開委員會
- 工作環境連不到 OpenAI／Groq → 原始轉錄資料只能由伺服器（Netlify Function）取得

## 相關檔案
- `netlify/functions/whisper-transcribe.ts`（`mergeSegmentsIntoSentences`：句末標點切句、4 段強制切、語速異常併碎片、起點 −0.1、四捨五入）
- `netlify/shared/transcribe.ts`（Groq／OpenAI 常數與轉錄鏈）
- `netlify/shared/aiKeys.ts`（金鑰）
- `netlify/shared/firestoreRest.ts`（REST 寫入、`runOptimistic`）
- `netlify/functions/save-material.ts`（背景函式驗證 token、來源網域的寫法）
- `src/components/MaterialDetailView.tsx`（放診斷按鈕的位置）
- `src/types.ts`
- `docs/plans/import-timestamp-accuracy.md`

## 做法（草案，待委員會評估）
### 1. 把切句邏輯搬到共用模組（行為不變）
- `mergeSegmentsIntoSentences` 從 `whisper-transcribe.ts` 移到 `netlify/shared/sentenceSegmentation.ts`，正式流程改 import
- 目的：離線對照用的就是正式程式；以固定輸入的回歸測試確認輸出完全不變

### 2. 伺服器診斷功能 `transcribe-diagnostic`（背景函式，只供擁有者在教材詳情頁手動觸發）
- **輸入**：`idToken`、`materialId`；音檔網址由伺服器從該使用者的教材文件讀取（不接受任意網址，避免 SSRF）
- **呼叫**（各自獨立、互不影響）：
  - OpenAI `whisper-1`：`verbose_json`，`timestamp_granularities[]=segment` 和 `word`，`language=en`
  - Groq `whisper-large-v3`：先帶 `word`＋`segment`；若回 400 不支援，改只帶 `segment`，並記下錯誤（實測 Groq 是否支援 word）
- **輸出**：寫到 `artifacts/{appId}/users/{uid}/transcriptionDiagnostics/{materialId}`
  - 欄位：`status`、`startedAt`、`finishedAt`；每家各一個子文件（避免單一文件超過 1MB）：`segments: [{text,start,end}]`、`words: {w: string[], s: number[], e: number[]}`、`error`、`model`、`durationMs`
  - 新的獨立集合，不寫教材、不寫轉錄任務
- **觸發**：教材詳情頁標題列 ⋯ 選單（或網址加 `?diag=1` 才顯示）「時間軸診斷」→ 顯示進度 → 完成後「下載診斷資料」
  - 下載的 JSON = 兩家原始資料＋這份教材目前的 `sentences` 時間（含 `originalStartTime`／`originalEndTime`）
  - 擁有者把 JSON 附到對話給 Claude
- 費用：OpenAI 約 US$0.006／分鐘（9 分鐘約 US$0.05）；Groq 在免費額度內

### 3. 標註工具（不進 repo，Claude 用 Artifact 做）
- 音檔：擁有者附的 mp3 轉成 128kbps（符合 Artifact 15MB 上限）。轉檔前後用互相關比對確認時間軸偏差 < 5ms，不合格就改用分段原檔
- 每個邊界顯示：目前時間、音量分析建議的停頓位置（Claude 用 ffmpeg 先算好）、波形
  - 播放：邊界前 2 秒、邊界後 2 秒
  - 操作：±0.05 微調；標成「句首」「句尾」「正確」「修正後」
- 每份音檔 10～15 個邊界（含句首、句尾，挑一般句、強制切的句、片頭音樂旁的句），共 30～40 個
- 匯出 JSON（只有時間與句子編號）→ 附回對話

### 4. 評分程式與基準資料（進 repo）
- `netlify/shared/timestampEval.ts`：輸入「切句結果」與「人工標註邊界」，輸出：
  - 句首／句尾的平均絕對誤差
  - 偏早／偏晚的比例
  - 誤差 > 0.2 秒的比例
  - 一句含兩句、一句被切斷的次數
- `tests/fixtures/timestamp-baseline/*.json`：**只存時間數字與句子編號**，不存音檔與全文（版權；repo 公開）；原始轉錄 JSON 不進 repo
- 測試：評分程式本身的單元測試＋「現行切句在基準上的分數」固定成回歸測試（之後改切句不可變差）

### 5. 離線對照（不改正式功能）
- 現況：OpenAI segment＋現行切句
- D：OpenAI word 時間切句——在 segment 內依句末標點的字切；字的時間在停頓處被拉長時，以下一個字的起點修正
- H：Groq segment（＋word，若支援）＋現行切句
- 報告給擁有者：三者的分數、失敗例子；**贏過現況才另開 PR 正式採用**（屆時再決定）

## 驗收條件
1. 切句搬到共用模組後，固定輸入的輸出與搬移前完全相同 ✅
2. 診斷函式：不接受任意網址；只讀自己的教材；兩家各自失敗不影響另一家；Groq 不支援 word 時自動改 segment 並記錄 ✅
3. 診斷結果拆子文件，單一文件不超過 900KB（以 30 分鐘音檔估算）✅
4. 正式匯入流程（`whisper-transcribe`）行為不變 ✅
5. 詳情頁「時間軸診斷」只在 ⋯ 選單／`?diag=1` 出現；完成後可下載 JSON ✅（原始碼）＋ 👀
6. 評分程式：已知輸入的誤差計算正確 ✅
7. 👀 擁有者在正式版對 David Jones 教材按「時間軸診斷」→ 下載 JSON → 附到對話

## 手動試用步驟
1. 正式版（或預覽網站用 Email 測試帳號）打開 David Jones 教材
2. ⋯ →「時間軸診斷」→ 等 1～3 分鐘完成 →「下載診斷資料」
3. 把 JSON 附到對話；之後依 Claude 給的標註工具連結標 10～15 個邊界並匯出

## 不要做的事
- 不改正式匯入的切句與轉錄（只有贏過現況才另開 PR）
- 不改寫教材資料；不新增套件；原始轉錄與音檔不進公開 repo

## 資料相容與備份
- 新增獨立集合 `transcriptionDiagnostics`，不碰既有資料；不需備份

## 新增套件
無

## 需要擁有者決定的問題（草案）
1. 診斷按鈕放 ⋯ 選單，還是只有網址 `?diag=1` 才出現？（建議 ⋯ 選單，比較好找）
2. 診斷完成後資料保留多久？（建議下載後可手動刪除，不自動刪）

## 定案（委員會＋Codex 第一輪後，擁有者 2026-11-12 核准）
- 中級；登入的人都可用但只能診斷自己的教材（同一份 10 分鐘一次）；⋯ 選單；保留到擁有者按「刪除」
- 安全（Codex 🔴）：教材裡的 `audioUrl` 也要驗證（`isOwnAudioUrl`：本專案 bucket、自己的 uid／materialId 路徑、https、googleapis 主機）；下載不跟隨轉址；>25MB 不送；語音合成教材不提供
- Groq 降級（Codex）：「不認得參數」→ 拿掉參數；「不支援 word」→ 只帶 segment；其他 400 不重試；200 但沒有 words → `missing`
- 文件大小（Codex）：依 Firestore 規則計算，超過 800KB 分塊（`parts/{provider}-{n}`），下載時重組；失敗要結束狀態
- 評分（Codex）：擁有者標**連續區段**的每個句首／句尾（與候選切句無關）；同類邊界 1 秒內一對一配對（由近到遠），沒對到算 missed（計入 >0.2 秒比例），區段內多出的預測邊界算 extra
- 回歸測試（Codex）：切句用合成文字固定輸出；真實音檔評分在 Claude 環境離線跑，記錄重跑步驟
- D 的句尾（Codex）：不用下一個字的起點；字長超過 max(0.6, 2.5×中位數字長) 時，以「字的起點＋上限」截斷並標低可信度；時間倒退、零長度也標低可信度
- 標註音檔（Codex）：不轉檔，用無損方式把原始 mp3 切成每段 ≤ 5 分鐘並記錄在原檔的起點，前中後抽查偏差，匯出換算回原檔時間
- 其他採納：刪除診斷資料按鈕、標註工具自動存草稿與匯入匯出、先試標 1 分鐘 3 個邊界

## 決策紀錄
- 2026-11-12 擁有者：做時間軸第二階段；人工聽過確認基準；David Jones＋1～2 個音檔；中級

## 進度紀錄
- 2026-11-12 建立規劃；委員會（Gemini、Nemotron、DeepSeek；Poolside 已下架）＋Codex（7 項）完成；擁有者核准
- 2026-11-12 驗收測試 `a39145a`；實作：切句搬到 `netlify/shared/sentenceSegmentation.ts`、`transcribeDiagnostic.ts`＋背景函式 `transcribe-diagnostic`、`timestampEval.ts`、`wordSegmentation.ts`（D，離線用）、教材詳情頁 ⋯ →「時間軸診斷」對話框；check.sh 通過
- 2026-11-12 審查第 1 輪：Codex 3 項真問題已修（分塊整份覆寫、runOptimistic 原子取得執行權、前端卡住 20 分鐘可重來）；Gemini 無意見
- 2026-11-12 審查第 2 輪：Codex、Gemini 皆無意見；verify／guard 通過
- 2026-11-12 擁有者附 David Jones 診斷資料：**11/09 匯入時 134 句全是整數秒**（結尾整數、開頭整數 −0.1）；今天診斷（segment＋word）OpenAI segment 精度 0.01 秒。以擁有者修過的 15 句當粗略參考：匯入時句尾平均誤差 0.38 秒（14／15 超過 0.2、全部偏早）；OpenAI 今日 segment＋現行切句 0.19 秒（2／15）；Groq segment＋現行切句 6.49 秒（Groq 一段含多句）；D（Groq 字）0.70 秒；D（OpenAI 字）無法直接用（OpenAI 的字沒有標點，需和 segment 文字對齊）
- 2026-11-12 擁有者決定：先在診斷加「OpenAI 只要求 segment」確認整數秒的原因，再修正式匯入；已匯入的教材先不處理；人工標註暫停
- 2026-11-12 小 PR：診斷加 `openaiSegment`（驗收測試 `517e941`）
