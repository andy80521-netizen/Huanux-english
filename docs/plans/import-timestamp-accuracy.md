# 規劃：匯入音檔時間軸精確度

- **級別**：大（擁有者 2026-11-08 指定大型委員會；涉及轉錄流程、可能重新評估規格附錄 B 已放棄的做法）
- **PR**：#35
- **狀態**：規劃中（本階段只做分析與委員會審查，不改程式）

## 目標
上傳真人 mp3（路徑一）後產生的逐句時間軸更準，具體指：
1. 句首不被切掉（第一個字完整）
2. 句尾不吃到下一句的開頭
3. 一個「句子」裡不會塞兩三句，也不會在句子中間被切斷
4. 校對畫面要手動修的句子變少；真的要修時更省力

## 背景與使用情境
- 擁有者把 podcast／新聞音檔（例：The Daily Aus）上傳後，逐句跟讀。時間軸不準 → 跟讀時聽到上一句尾巴或下一句開頭、句首被切、流暢度評分用的原音長度也跟著錯（`originalSec = endTime − startTime`）
- 擁有者的設計決策：**逐句斷句＋翻譯，不可摘要或改寫原文**；原音檔保留完整，不裁剪、不重新壓縮（規格 4.1.1）

## 目前的程式邏輯（2026-11-08 讀碼整理）

### 1. 匯入流程（`MaterialImportMode.tsx`）
1. 只收 mp3，≤ 24MB；先產生 `materialId`，音檔直接上傳 Storage 正式路徑
2. 建立 `transcriptionJobs/{materialId}`（`processing`），呼叫 Background Function `whisper-transcribe`（body：`audioUrl, idToken, resultDocPath`）
3. `onSnapshot` 等結果（5 分鐘逾時）→ 進入校對畫面（`MaterialReviewPanel`）
4. 確認後才翻譯（`translate-sentences`），存成 `Material`，`sentences[]` 每句有 `startTime`、`endTime`、`lowConfidence`

### 2. 轉錄與斷句（`netlify/functions/whisper-transcribe.ts`）
- **只用 OpenAI `whisper-1`**，`verbose_json`，`timestamp_granularities[]=segment`；不帶 `language`、不帶 `prompt`、沒有其他供應商備援
- `mergeSegmentsIntoSentences`：
  1. 依序把 Whisper 的 segment 接起來；**某個 segment 的文字以 `. ! ?`（可接引號）結尾**，且不是縮寫（Dr、Mr…）→ 一句結束
  2. 接滿 **4 個 segment** 還沒遇到句尾 → 強制切開並標 `lowConfidence`
  3. **語速異常**（一句 > 3 秒且每字 > 1.2 秒，常見於片頭音樂）→ 把它前面 10 秒內、≤ 5 字的短句文字併進來，時間只沿用異常句，標 `lowConfidence`
  4. 每句 `startTime − 0.1` 秒（允許與上一句重疊），`endTime` 不變；四捨五入到 0.01
- 句子的起訖**只能落在 Whisper segment 的邊界上**；segment 內部的時間位置完全不知道

### 3. 校對畫面（`MaterialReviewPanel.tsx`）
- 每句可改文字、輸入秒數、`−0.5`／`+0.5` 按鈕、播放這句、刪除／復原
- 沒有「合併到上一句」「拆成兩句」「聽句尾」、沒有波形
- `needsReview`（註解：「跟音量分析的真實停頓點誤差過大」）目前**沒有任何程式會設定**，是舊做法留下的欄位

### 4. 播放（跟讀、教材詳情、複述、句型「在教材中出現」）
- 設定 `audio.currentTime = startTime` 後播放，**靠 `timeupdate` 事件檢查 `currentTime >= endTime` 才暫停**（`ShadowingPracticeView.handleTimeUpdate`、`MaterialDetailView.handleTimeUpdate`、`RetellView.handleSegmentTimeUpdate`）；`PatternSightingsSection` 用 `#t=start,end`
- 跟讀的「聽聽看」（`shadowingPlayback.ts`）有依進度的保險計時器

### 5. 規格附錄 B「已放棄的做法（請勿重新引入）」中與本題相關的
- **Gemini A-2 時間軸抓取**、**Whisper `word` 顆粒度**、**`findPreciseBoundary`**、**不加起始緩衝**、**緩衝 1／0.5／0.2 秒**、**相鄰文字相同即刪除**
- ⚠️ **放棄的原因沒有記錄**（repo 歷史已整併，規格只列名稱）。下面任何會碰到這些做法的方向，都必須先由擁有者決定是否重新評估

## 精確度損失的可能來源（待委員會檢驗）

| 編號 | 來源 | 影響 | 把握 |
|---|---|---|---|
| P1 | 句子邊界只能落在 segment 邊界：一個 segment 同時含「上一句結尾＋下一句開頭」時切不開；4 段強制切會切在句子中間 | 一句含兩句、句中被切斷 | 高（程式邏輯如此） |
| P2 | `whisper-1` segment 時間本身的誤差（停頓、音樂、背景聲處較大；起點常偏早、終點偏早或偏晚） | 句首切掉、句尾多／少 | 中（未實測量化） |
| P3 | 固定 −0.1 秒起始緩衝、結尾不加緩衝 | 句尾最後一個音被切 | 中 |
| P4 | 播放停止靠 `timeupdate`：iOS Safari 約每 250ms 才觸發一次 → 句尾**多播最多約 0.25 秒**（聽到下一句開頭），0.75 倍速時仍是同樣的觸發頻率 | 句尾吃到下一句 | 高（瀏覽器行為） |
| P5 | VBR mp3 若沒有 Xing／VBRI 索引，瀏覽器 seek 是估算的，越後面越偏；Whisper 的時間是解碼後的真實時間 → 時間軸正確但播放位置錯 | 後半段句子整體偏移 | 低～中（不確定擁有者的檔案是否 VBR） |
| P6 | 文字完全來自 Whisper：專有名詞、人名常錯（例：O'Rian's），跟讀評分以錯字為準；擁有者手上有原稿也無法提供 | 文字錯、評分不公平 | 高 |
| P7 | 沒有 `language=en`、沒有供應商備援；Groq `whisper-large-v3`（語音練習已在用）的文字通常較準 | 轉錄失敗或文字錯 | 中 |

## 候選做法（請委員會評估優先順序、風險與是否值得做）

### A. 播放停止精準化（不改資料，影響所有已存教材）
- 開始播放後依「(endTime − currentTime) ÷ playbackRate」排計時器，接近時用 `requestAnimationFrame` 逐格檢查並暫停；`timeupdate` 保留作保險
- 抽成共用純函式，套到跟讀、教材詳情、複述；`#t=` 片段播放一併改
- 針對 P4

### B. 依停頓吸附邊界（音量包絡）
- 匯入當下前端手上有**本機的 mp3 檔**（`File`），解碼不需要 Storage CORS
- 解碼成 16kHz 單聲道、算 10ms 音量包絡；每個句子邊界在 Whisper 時間 ±0.4 秒內找最安靜的位置（或語音起點），再加小緩衝
- 風險：長音檔在 iPhone 的記憶體（30 分鐘 16kHz 單聲道約 115MB）→ 可能要分段解碼；音樂墊底時找不到停頓
- ⚠️ 與附錄 B 的 `findPreciseBoundary`、`needsReview` 欄位很可能是同一類做法，**需擁有者決定是否重新評估**
- 針對 P2、P3

### C. segment 內切句（不用 word 顆粒度）
- segment 內部有句末標點時，依字元比例估計切點，再用 B 吸附到最近的停頓；取代「4 段強制切」
- 針對 P1

### D. Whisper `word` 顆粒度
- `whisper-1` 同一個請求可同時回傳 `word` 與 `segment`；可用字的時間在 segment 內切句（比 C 的字元比例準）
- 已知問題：字的時間在停頓、音樂處會被拉長
- ⚠️ 附錄 B 明列放棄，**需擁有者決定**；Groq 文件寫明不支援 `timestamp_granularities`
- 針對 P1

### E. 附原稿（選用）
- 上傳 mp3 時可另外貼上原稿：以原稿為句子文字（符合「不改寫原文」），用序列比對把 Whisper 的字對到原稿，再定出每句時間
- 沒貼原稿時流程照舊
- 針對 P6

### F. VBR 偵測
- 匯入時解析 mp3 開頭的幀標頭，偵測「VBR 且沒有索引」→ 提示擁有者（規格規定不重新壓縮，所以只能提示或另想辦法）
- 針對 P5

### G. 校對工具
- 微調加 `−0.1`／`+0.1`；「聽句尾」（從 end−1.5 播到 end+0.5）；「合併到上一句」「拆成兩句」
- 波形（只在匯入當下，用本機檔案）
- 針對 P1～P3 的人工修正成本

### H. 轉錄供應商
- 加 `language=en`；Groq `whisper-large-v3` 當主力、`whisper-1` 備援（或反之）——**哪個時間較準需要實測**，不能憑印象
- 針對 P7

### I. 舊教材重新對齊
- 會改寫既有 `Material.sentences` 的時間，**目前沒有備份工具** → 依 CLAUDE.md 本次不做；若要做須先另案建立備份

## 想請委員會回答的問題
1. P1～P7 有沒有判斷錯的、漏掉的精確度來源？
2. A～H 的優先順序與拆 PR 方式（建議一個 PR 一個方向）？哪些「效益高、風險低」應該先做？
3. B（音量吸附）在 iPhone Safari 的可行性：記憶體、解碼時間、`decodeAudioData` 對大檔的限制；有沒有更好的做法（例如依 mp3 幀切塊解碼）
4. C（字元比例＋吸附）與 D（word 顆粒度）哪個較可靠？D 的已知失敗情況是什麼？
5. P5 VBR seek 誤差在 iOS Safari／Chrome 的實際程度；F 偵測後除了提示還能怎麼辦（不可重新壓縮原音檔）
6. E 的序列比對：Whisper 漏字、多字、數字寫法不同時的處理
7. 不能自動驗證「時間準不準」：怎麼設計可重複的驗收（例如人工標註幾段音檔的真實邊界，做成測試資料）

## 第二輪質詢（請針對以下 Q1～Q4 逐題回答）
**Q1：A 上線後句尾「變短」怎麼處理？**
Grok 指出：現在 `timeupdate` 晚停，等於替所有既有教材多播了約 0.1～0.25 秒；A 修好後，`endTime` 本身偏早的句子會聽起來句尾被切。Grok 建議播放器在 `min(endTime + 0.12, 下一句 startTime)` 停（不寫回資料）。規格附錄 B 曾放棄「緩衝 1／0.5／0.2 秒」（原因未記錄，可能指起始緩衝）。
請評估：(a) 播放端寬限 vs. 不加寬限 vs. 匯入時加句尾緩衝（會寫進新教材）各自的風險；(b) 跟讀流暢度用 `endTime − startTime` 當原音長度，寬限要不要計入。

**Q2：D（`word` 顆粒度）的實際可靠度與 Groq 支援**
Groq 文件互相矛盾：API Reference 寫 `timestamp_granularities[]` 支援 `word`／`segment`；Speech-to-Text 頁另有版本寫不支援；2026-09 有使用者回報 `whisper-large-v3-turbo` 回 400 `unknown param timestamp_granularities`。
請評估：(a) 若擁有者同意重新評估 D，「只在 segment 內有句末標點時，用 word 時間定切點；word 缺漏、時間異常（單字 > 1.5 秒、時間倒退）就保留原 segment 邊界並標 `lowConfidence`」這個保守用法，還有哪些失敗情況；(b) 是否應該先做 D 的離線對照再決定 H（換 Groq），還是兩者可以一起對照。

**Q3：在這個專案的限制下，「基準」要怎麼建立才可行？**
限制：Claude 的工作環境連不到 OpenAI／Groq；預覽網站的 Netlify Functions 用正式金鑰；擁有者可以把 mp3 檔案傳給 Claude；不新增 npm 套件（除非核准）。Codex 與 Grok 都建議先建立人工標註基準。
請提出具體、可執行的做法，例如：(a) 匯入時把 Whisper 原始回應（segment／word）存成可下載的 JSON 讓擁有者交給 Claude，Claude 在本機用固定回應跑 `mergeSegmentsIntoSentences` 的回歸測試；(b) 人工標註由誰做、標幾段、容差多少；(c) 有沒有不需要新增 npm 套件、在 Claude 工作環境（Python／pip 可用）就能做的參考對齊方式。

**Q4：語速異常併句的時間（Grok 提議改用碎片起點）**
目前程式刻意「時間只沿用異常句」：註解說明 Whisper 遇到片頭音樂時會把後面才講的短句文字提早標到音樂區段，碎片的時間落在音樂上。Grok 建議改用碎片的 `startTime`。請評估這個修改是否會讓片頭音樂重新被涵蓋進句子；有沒有兩全的判斷方式。

## 相關檔案
- `netlify/functions/whisper-transcribe.ts`
- `src/components/MaterialImportMode.tsx`
- `src/components/MaterialReviewPanel.tsx`
- `src/components/ShadowingPracticeView.tsx`
- `src/components/MaterialDetailView.tsx`
- `src/components/RetellView.tsx`
- `src/utils/shadowingPlayback.ts`
- `src/utils/shadowingAudio.ts`
- `netlify/shared/transcribe.ts`
- `src/types.ts`

## 做法
（委員會評估後整合，擁有者核准後填寫）

## 驗收條件
（待定案）

## 手動試用步驟
（待定案）

## 不要做的事
- 不摘要、不改寫原文；不裁剪、不重新壓縮原音檔
- 不改寫既有教材資料（沒有備份工具）
- 不新增 npm 套件（除非擁有者核准）
- 附錄 B 的做法未經擁有者決定前不重新引入

## 資料相容與備份
- 新程式能否讀取舊格式資料：必須能（只影響新匯入的教材；播放改善不改資料）
- 是否改寫既有資料：否
- Merge 前的備份方式：不需要（不改既有資料）

## 新增套件
- 預計不需要

## 決策紀錄
- 2026-11-08 擁有者：先釐清目前程式邏輯，再開大型委員會審查優化方式與功能，再報告

## 進度紀錄
- 2026-11-08：讀碼整理現況、列出可能來源與候選做法；開草稿 PR，送委員會＋Codex 第一輪
