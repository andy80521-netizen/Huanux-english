# 規劃：匯入音檔時間軸精確度

- **級別**：大（擁有者 2026-11-08 指定大型委員會；涉及轉錄流程、可能重新評估規格附錄 B 已放棄的做法）
- **PR**：#35
- **狀態**：PR-A 已合併（PR #35）；PR-G 完成待擁有者試用（PR #36）

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

## 委員會審查整合（2026-11-08，第一輪＋質詢；待擁有者核准）

成員：Codex（兩輪）、Gemini 3.8 Flash、Nemotron、DeepSeek、Grok。Poolside 呼叫失敗（模型已下架）。

### 第一輪補上的精確度來源（已對照程式碼確認）
- **校對畫面自己的播放也晚停**（Codex、DeepSeek、Grok）：`MaterialReviewPanel` 一樣只靠 `timeupdate`；擁有者在這裡決定要不要改時間，播放誤差會被寫進教材
- **`timeupdate` 不是 iOS 專屬**，所有瀏覽器大約都是每 250ms 觸發一次；多播的量（以音檔時間計）約是 0.25 × 播放速度（Grok）
- **設定 `currentTime` 後沒等 `seeked` 就 `play()`**：手機上 seek 可能還沒完成，句首被切或從錯的位置開始，容易被誤判成 Whisper 誤差（Grok）
- **縮寫判斷只認整段完全等於 Dr／Mr…**：`U.S.`、`a.m.`、`No.`、小數、省略號都會判錯；「4 段強制切」只看段數不看時長（Grok）
- **空結果**：Whisper 沒有 segment 時寫入 `completed` 且沒有句子，使用者卡在無法存檔的校對畫面（Nemotron、DeepSeek、Grok）
- P5（VBR seek）本次無人實測，不可當已確認原因

### 共識
1. **A 播放停止精準化最優先**，範圍要完整：跟讀、教材詳情、**校對畫面**、複述、句型「在教材中出現」、結果頁「聽聽看」（`createListenPlayer` 目前保險計時多加 500ms）
   - 每次回呼都以實際 `currentTime` 判斷；`setTimeout`（剩餘時間 ÷ 播放速度）＋接近時 `requestAnimationFrame`＋`timeupdate` 保險；緩衝、seek、暫停、變速時重新排程；換句／離開時清掉舊回呼（Codex）
   - 設定起點後等 `seeked`（逾時仍播放）再播；跟讀仍須保留「點擊當下解鎖、錄音真的開始才播」的順序
2. **G 校對工具（不含波形）**：`−0.1`／`+0.1`、「聽句尾」（`endTime − 1.5` 播到 `endTime + 0.5`）、「合併到上一句」（文字以空白接、時間取聯集、`lowConfidence` 取或）、「拆成兩句」（以游標拆文字；時間先放中點、兩句都標 `lowConfidence`，由人調整，不用字元比例假裝準）
3. **加 `language=en`**（匯入只收英文 mp3）
4. **I 不做**；不在詳情頁改既有教材時間
5. **先建立基準再動轉錄策略**：只有人耳標註的邊界能證明「準」，固定的 Whisper 回應只能做回歸測試
6. **流暢度的原音長度維持 `endTime − startTime`**，任何播放寬限都不計入

### 分歧與我的建議
| 議題 | 各方說法 | 我的建議與理由 |
|---|---|---|
| A 之後句尾「變短」要不要加播放寬限 | Grok 第一輪：`min(endTime+0.12, 下一句 startTime)`；Nemotron 贊成；Gemini：`min(endTime+0.10, 下一句 startTime−0.03)`；Codex、DeepSeek、Grok 第二輪：先不加 | **先不加，停在 `endTime`**。已對照程式碼驗證 Codex／Grok 的計算：Whisper 的 segment 通常首尾相接，下一句存的起點＝本句終點 − 0.1，套這兩個公式反而會比 `endTime` **早 0.1～0.13 秒停**，正好切掉句尾。偏早的句子用 G 修；有基準後若句尾系統性偏早，再請你決定是否加可關閉的寬限 |
| D（`word` 顆粒度） | Gemini、DeepSeek：允許重新評估；Nemotron：暫不；Codex、Grok：只准離線對照，贏過現況才進產品 | **只做離線對照**。保守用法仍會失敗：整段平移、靜音被算進字長、音樂上的幻覺字、縮寫／小數的句點、word 與 segment 文字對不齊；而且 P1 最常見的「沒有句點的段」它修不到 |
| Groq 是否支援 word | 第一輪多數引用規劃中「不支援」；Codex：官方 API Reference 列出支援 | **不確定**。API Reference 列出支援，另一頁寫不支援，2026-09 有 `whisper-large-v3-turbo` 回 400 的回報。要用小檔實際探測，不能憑文件 |
| D 與 H 一起對照還是分開 | Nemotron、DeepSeek：分開；Gemini、Grok、Codex：同一批音檔一起收集，分開分析 | **一起收集、分開分析**（Codex）：同一批音檔同時收 OpenAI 與 Groq 的原始回應，比「segment vs. word 切句」和「供應商差異」兩件事 |
| 語速異常併句的時間 | Grok 第一輪：改用碎片起點；Gemini：間隔 ≤ 0.8 秒才用碎片起點；其他人：不改 | **不改**。碎片時間落在片頭音樂上時，改了會把最多 10 秒音樂收回句子；間隔門檻分不出「音樂上的錯置文字」和「真的說出的短句」（Codex）。可在校對畫面顯示被捨棄的碎片起點，讓你一鍵採用（Grok） |
| 縮寫表擴充、4 段強制切改成「時長或段數」 | Grok 提議；其他人未反對 | **有基準後再做**，屬於轉錄 PR；規格寫明「後處理規則順序固定」，改規則需要你同意 |

### 駁回的意見
- **在 Whisper prompt 寫「Please transcribe accurately with standard punctuation」**（Gemini）：Whisper 的 prompt 會被當成「前文」而不是指令；PR #33 剛遇過長 prompt 引起幻覺
- **伺服器端用 ffmpeg.wasm 或裝 torch／torchaudio 做強制對齊**（Nemotron）：需要新增套件或下載模型；本專案不新增套件，而且自動對齊結果不能當真值
- **教材詳情頁「單筆重新轉錄」覆寫 `sentences[]`**（Nemotron）：會改寫既有資料，目前沒有備份工具
- **起點緩衝改成「間隔的一半」**（Gemini）：屬於附錄 B 已放棄的「緩衝」類，且沒有實測依據
- **成本試算（每月 $50～200）、具體毫秒門檻當成既定事實**（Nemotron 等）：沒有根據；門檻要你聽過例子後才定案
- **用 `mp3-frame-parser` 套件**（Nemotron）：新增套件；要做 F 也只需自己解析標頭

### 建議的 PR 順序
1. **PR-A 播放停止精準化**（不改資料，所有教材立刻受益）
2. **PR-G 校對工具**（±0.1、聽句尾、合併、拆句）＋ `language=en`＋空結果的明確錯誤訊息
3. **基準建立**：匯入流程加「下載原始轉錄資料」診斷功能（預設隱藏，不含金鑰、token）；你挑 2～3 個真實音檔標 30～40 個邊界；我在工作環境用 ffmpeg 解碼、算音量幫你定位，並把資料做成回歸測試（短片段，完整逐字稿不進公開 repo）
4. **D／H 對照**（需你同意重新評估附錄 B 的 word 顆粒度，只做離線）→ 依結果決定要不要改轉錄
5. 之後再評估：E 附原稿（必須是逐字稿；對上率低於門檻就整段退回）、F VBR 偵測（先量測前中後段 seek 誤差，超過 0.3 秒才做）、B 音量吸附（目前不准）

## 做法（擁有者 2026-11-08 核准）

### 本 PR：PR-A 播放停止精準化（不改資料）
- 新增 `src/utils/segmentEnd.ts`：
  - `watchSegmentEnd(media, endTime, onEnd, deps?)`：每次回呼以實際 `currentTime` 判斷；剩餘時間 ÷ 播放速度排 `setTimeout`，最後 150ms 改逐格（`requestAnimationFrame`）檢查；`timeupdate` 保險；`playing`／`seeked`／`ratechange` 重新排程、`pause` 時停止計時、`ended` 視為結束；回傳取消函式
  - 頁面隱藏（鎖屏、切 App）時直接暫停並回報 `hidden`（擁有者決定）
  - `seekSegmentStart(media, startTime)`：音檔還沒載入時間資訊（`readyState < 1`）時，等 `loadedmetadata` 再設定起點，避免 seek 被忽略；`play()` 仍在點擊當下呼叫（iPhone 手勢）
- 停止點就是 `endTime`，**不加寬限**（擁有者決定）；流暢度的原音長度不變
- 套用：跟讀（錄音時原音到句尾進入 6 秒緩衝）、教材詳情播放這句、校對畫面播放這句、複述「重聽這一段」、句型「在教材中出現」、結果頁「聽聽看」的原音

### PR-G（下一個 PR）：校對與已存教材的時間修正
- 校對畫面微調從 ±0.5 改成 **±0.2**（擁有者決定，取代 ±0.5）；「聽句尾」、「合併到上一句」、「拆成兩句」
- **教材詳情頁每一句都能修正時間**，介面和校對畫面相同（擁有者決定）：
  - 只寫入按「儲存」的那一句；用交易寫入，不蓋掉同時寫入的熟練度
  - 第一次修改時另存原始時間（新的選填欄位），提供「還原原始時間」
  - 同步更新句型「在教材中出現」裡存的時間副本
- `language=en`；Whisper 沒有回傳句子時顯示明確錯誤

### 之後
- 量測基準（擁有者稍後決定是否標註）→ D（`word` 顆粒度，擁有者同意只做離線對照）與 H 對照 → E／F

## 驗收條件（PR-A）
1. 假音檔 1 倍速、`timeupdate` 每 250ms 才觸發：句尾 10.00 → 暫停時 `currentTime` ≤ 10.05 ✅ `segmentEnd.test.ts`
2. 0.75、1.25 倍速同樣 ≤ 10.05（以音檔時間計）✅
3. 播放中暫停（緩衝）→ 不提早結束；恢復後仍準時停 ✅
4. 播放中往回 seek → 舊的計時作廢，依新位置重排 ✅
5. 取消後不暫停、不回報；`ended` 事件視為結束 ✅
6. 頁面隱藏 → 暫停並回報 `hidden` ✅
7. 音檔還沒載入時間資訊 → 等 `loadedmetadata` 才設定起點；已載入 → 立刻設定 ✅
8. 六個播放入口都改用 `watchSegmentEnd` ✅（原始碼檢查）
9. 「聽聽看」原音既有行為不變（`shadowingSpeed.test.ts` 等既有測試）✅
10. 👀 iPhone 與電腦各播幾句：句尾不再聽到下一句開頭；鎖屏時原音暫停

## 手動試用步驟（PR-A）
1. 預覽網站用 Email 測試帳號登入，打開一份上傳 mp3 的教材
2. 教材詳情頁按幾句的「播放」：句尾停住，不會聽到下一句開頭
3. 跟讀：錄音中原音播到句尾停止、出現倒數；把原音速度切到 0.75 再試一次
4. 結果頁「聽聽看」按「原音」與「重疊播放」
5. 跟讀錄音中鎖屏再解鎖：原音已暫停、流程照常結束
6. 複述「重聽這一段」、句型詳情頁「在教材中出現」的播放

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
- 2026-11-08 擁有者核准：
  1. 附錄 B 的 `word` 顆粒度**只做離線對照**，贏過現況才進產品
  2. 播放**不加寬限**；校對微調從 ±0.5 改成 **±0.2**；**教材詳情頁每一句都能修正時間**，介面與校對相同（只寫入那一句、交易寫入、另存原始時間可還原、同步更新重逢紀錄的時間副本）
  3. 頁面隱藏（鎖屏、切 App）時**直接暫停**
  4. 量測基準：擁有者稍後決定（不影響 PR-A、PR-G）
  5. 匯入固定 `language=en`
  6. PR 順序照建議：PR-A → PR-G → 基準 → D／H 對照 → E／F

## 進度紀錄
- 2026-11-08：讀碼整理現況、列出可能來源與候選做法；開草稿 PR，送委員會＋Codex 第一輪
- 2026-11-08：第一輪完成（Poolside 失敗）；針對性質詢 Q1～Q4 完成（Codex 第一次回覆「需要建立環境」，改用審查形式後回覆）；整合報告給擁有者。擁有者核准（見決策紀錄）
- 2026-11-08：開始 PR-A（播放停止精準化）
- 2026-11-08：驗收測試 `68e9623`；實作 `segmentEnd.ts` 並接到六個播放入口，check.sh 通過（998 個測試）。Chromium 實測（12 句、1／0.75 倍速）：舊做法句尾多播 36～187ms，新做法 1～17ms
- 2026-11-08：審查 4 輪（Codex 3 項真問題已修：Hooks 位置、校對播放中改句尾、排程累積；Gemini 採用 1 項、誤判 4 項）。最終 Codex、Gemini 皆無意見。已知限制：跟讀鎖屏後緩衝倒數可能被背景節流，回到畫面才跑完。**下一步：擁有者試用 PR-A → Merge → 開 PR-G（校對 ±0.2、教材詳情頁修正時間、language=en、空結果錯誤訊息）**
- 2026-11-08：PR-A 由擁有者合併。開 PR-G：驗收測試 `6f1eccb`；`timeEdit.ts`（0.2 步距、聽句尾、合併、拆句、只改一句並另存原始時間）、共用 `TimeStepperField`、教材詳情頁「調整時間」（`SentenceTimeEditor`，交易寫入並同步重逢紀錄時間副本）、轉錄固定英文與空結果錯誤。校對畫面 `mt-0.5` 改寫成等值的 `mt-[0.125rem]`（驗收測試禁止檔案出現 `-0.5` 字樣）
- 2026-11-08：PR-G 審查 3 輪（Codex 4 項、Gemini 2 項已修；Gemini 誤判 2 項），最終皆無意見。附帶修正：跟讀寫入熟練度改為交易（只改那一句）。**下一步：擁有者試用 PR-G → Merge；之後是量測基準（擁有者決定是否標註）→ D／H 離線對照**
