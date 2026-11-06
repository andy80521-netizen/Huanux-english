# 規劃：轉文字參考原句、語言模型複習錯 1 個字也算過

- **級別**：中（轉文字參數與通過門檻；不改資料、不加套件）
- **PR**：#（開 PR 後補上）
- **狀態**：規劃中

## 目標
讓「母語者聽得懂」的念法能過關，使用者有成就感、願意繼續練：
1. 影子跟讀與語言模型練習的錄音轉文字，**把原句交給 Whisper 當參考**（`prompt`），發音接近的字（Tasmania、bushfire）不再被猜成別的常見字
2. 語言模型複習（含維持複習）**錯 1 個字以內也算過**、照常累加熟練度

## 背景（擁有者 2026-11-06）
- 實測影子跟讀：念得母語者聽得懂，Whisper 卻把 bushfire 聽成 supply、Tasmania 聽成 Australia；語言模型複習要求全對，一題一直卡著，「整體 app 讓人很挫敗，不想繼續練習」
- 擁有者決定：「給 Whisper 原句讓評分變寬沒問題」、語言模型複習「錯 1 個字也算過」，並同意更新 `CLAUDE.md` 的設計原則（原本是「精準背出原句，不放寬相似度」）
- PR #30 已修好錄音開頭被吃掉

## 相關檔案
- `netlify/shared/transcribe.ts`
- `netlify/functions/transcribe-recording.ts`
- `src/services/gemini.ts`
- `src/utils/scoring.ts`
- `src/utils/practiceCue.ts`
- `src/components/PatternPracticeSessionView.tsx`
- `src/components/ShadowingPracticeView.tsx`
- `CLAUDE.md`

## 做法（草案）
### 1. 轉文字帶原句
- 前端 `transcribeRecordingDetailed(file, { reference })`：影子跟讀傳教材句子、語言模型練習傳造句原句；複述不傳（沒有單一原句）
- 後端 `transcribe-recording`：body 新增選填 `reference`（≤ 500 字）；有值時 Groq／OpenAI 都加 `prompt=reference`（Whisper 的 prompt 上限約 224 token，超過截斷）
- 回傳加上 `referenced: boolean`；結果頁顯示「語音辨識：Whisper large-v3（參考原句）」
- Gemini 備援：**不帶原句**（生成式模型拿到原句更容易直接照抄），維持現狀
- 測試開關：localStorage `huanux_no_reference='1'` 可關閉參考（比較用）

### 2. 防「照抄原句」
Whisper 拿到 prompt 後，錄音不清楚、很短或沒講完時，可能直接吐出原句。防護：
- 沿用現有空白錄音防呆（`isLikelyNoSpeech`）：判定沒有人聲 → 空字串
- **合理性檢查**（前端，`src/utils/transcriptCheck.ts`）：帶原句的結果若和原句幾乎一樣，但「實際講話時間」太短 → 視為可疑，改用**不帶原句**再轉一次，用那次的結果評分
  - 實際講話時間：影子跟讀用 `userSpeechSec`、語言模型練習用評分時長
  - 門檻（草案）：講話時間 < 原句字數 × 0.15 秒（一般語速每字約 0.3～0.4 秒，0.15 是一半以下）
  - 待委員評估：門檻是否合理、有沒有更好的訊號（例如 Whisper 片段的 `avg_logprob`、`no_speech_prob`、片段時間總長）
- 第二次轉文字失敗 → 用第一次的結果，但記 log

### 3. 語言模型複習錯 1 個字也算過
- `canAccumulatePattern` 改為 `errors <= 1`（新常數 `PATTERN_PASS_MAX_ERRORS = 1`）；`canAccumulateWithHint` 跟著改（看過單字提示仍不加）
- 維持複習的 `isExact` 改名語意為「通過」（`errors <= 1` 且沒看單字提示）
- 結果畫面：0 錯顯示「一字不差」（金色）；1 錯顯示「差 1 個字，算通過」並照常顯示錯字標示；≥ 2 錯維持「有 N 個字不一致，熟練度未增加」
- 待委員評估：很短的句子（例如 3 個字）錯 1 個字等於錯三分之一，是否要排除（例如原句 ≤ 3 字仍需全對）
- 題目品質檢查（`createVerifiedCue`）維持 `errors === 0`（那是檢查題目是否明確，不是評分）

### 4. CLAUDE.md（擁有者同意修改）
- 「語言模型練習評分是『精準背出原句』，不放寬相似度」→「語言模型練習評分以原句為準，轉文字參考原句，錯 1 個字以內算通過（擁有者 2026-11-06 決定）」

## 待委員會評估的問題
1. Whisper `prompt` 帶原句的實際效果與風險（照抄、截斷、只講一半時補完）
2. 合理性檢查的門檻與訊號
3. 短句是否排除「錯 1 個字算過」
4. Gemini 備援是否也帶原句

## 驗收條件（初稿）
1. 後端：有 `reference` 時 Groq／OpenAI 的表單含 `prompt`，沒有時不含；`reference` 超長截斷、非字串忽略；回傳 `referenced`（✅）
2. 前端：影子跟讀與語言模型練習傳原句，複述不傳；開關可關閉（✅）
3. 合理性檢查：講話時間太短且結果等於原句 → 用不帶原句的結果；正常 → 用帶原句的結果；第二次失敗 → 用第一次（✅）
4. 錯 0、1 個字 → 累加熟練度；2 個字 → 不累加；看過單字提示 → 不累加（✅）
5. 維持複習：錯 1 個字算通過（✅）
6. 結果畫面文案（✅）
7. 👀 用擁有者那句（Elsewhere the Australian … Tasmania and Victoria）跟讀，辨識結果明顯接近原句

## 不要做的事
- 不把原句交給 Gemini 備援
- 不改影子跟讀的通過門檻（內容 ≥ 70 且總分 ≥ 70）
- 不改題目品質檢查的標準

## 資料相容與備份（改到 Firestore 資料結構時必填）
- 不涉及資料（已累積的熟練度不重算）

## 新增套件（若有，需擁有者核准）
無

## 決策紀錄
- 2026-11-06：擁有者決定轉文字參考原句、語言模型複習錯 1 個字也算過、同意更新 CLAUDE.md

## 進度紀錄
- 2026-11-07：建立規劃文件，開草稿 PR，送委員會與 Codex 第一輪
