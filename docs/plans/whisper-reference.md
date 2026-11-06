# 規劃：轉文字參考原句、語言模型複習錯 1 個字也算過

- **級別**：中（轉文字參數與通過門檻；不改資料、不加套件）
- **PR**：#31
- **狀態**：完成（等擁有者試用與 Merge）

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

## 做法（定案，2026-11-07 擁有者核准）
### 1. 轉文字帶原句，並同時送一次不帶原句的（防補字）
- 前端 `transcribeRecordingDetailed(file, { reference })`：影子跟讀傳教材句子、語言模型練習傳造句原句；複述不傳。localStorage `huanux_no_reference='1'` 可關閉（比較用）
- 後端 `transcribe-recording`：body 選填 `reference`；`normalizeReference`：非字串或空白 → 不帶；超過 600 字保留尾端（Whisper prompt 上限約 224 token）
- 有 `reference` 時，**同一段錄音同時跑兩條轉錄鏈**（`runReferencedTranscribe`）：一條帶 `prompt=reference`、一條不帶，共用 9 秒預算
- `chooseReferencedTranscript(withRef, plain)`（擁有者選「同時送兩次」）：
  - 兩條都成功：不帶原句那次的字數 **< 帶原句那次的 60%** → 判定「補了沒念的字」，改用不帶原句的結果（`check: 'padded'`）；否則用帶原句的結果（`check: 'ok'`）
  - 只有帶原句那條成功：用它，`check: 'unchecked'`，記 log（已知風險）
  - 只有不帶原句那條成功：用它，`referenced: false`
  - 都失敗：502，前端改用 Gemini（**不帶原句**）
  - 空白錄音防呆照舊；不帶原句那次是空字串 → 字數 0 → 判定補字 → 用空字串
- 回傳 `{ text, model, referenced, check }`；結果頁顯示「語音辨識：Whisper large-v3（參考原句）」

### 2. 語言模型複習錯 1 個字以內算通過
- `src/utils/scoring.ts`：`PATTERN_PASS_MAX_ERRORS = 1`、`PATTERN_STRICT_MAX_WORDS = 3`
- `canAccumulatePattern({ errors, targetCount })`：`errors === 0` 一定通過；`targetCount > 3` 且 `errors <= 1` 也通過；**原句 3 個字以內要全對**（擁有者選建議）；沒有 `targetCount` 時視為要全對（相容舊呼叫）
  - 空白作答：3 字以內錯數 ≥ 1 → 不過；4 字以上錯數 ≥ 4 → 不過（排除 Codex 指出的「1 字句不說話也過」）
- `canAccumulateWithHint` 跟著改（看過單字提示仍不加）；維持複習的「通過」用同一個判斷
- 結果畫面：0 錯「總分・一字不差」（保留）；1 錯且通過「差 1 個字，算通過」；不通過「有 N 個字不一致，熟練度未增加」
- 提示文案：「說出你造的那句話，錯 1 個字以內算通過」；原句 3 字以內「這句較短，要一字不差」（擁有者同意改守門測試）
- 題目品質檢查（`createVerifiedCue`）維持 `errors === 0`

### 3. CLAUDE.md、AGENTS.md（擁有者同意修改）
- 「語言模型練習評分是『精準背出原句』，不放寬相似度」→「語言模型練習評分以原句為準：轉文字參考原句（同時跑一次不帶原句防補字），錯 1 個字以內算通過，原句 3 個字以內要全對（擁有者 2026-11-07 決定）」

## 驗收條件
1. 後端：有 `reference` 時表單含 `prompt`，沒有時不含；`normalizeReference` 處理空白、非字串、超長保留尾端（✅）
2. `chooseReferencedTranscript`：兩條成功且字數相近 → 帶原句；不帶原句字數 < 60% → 不帶原句；不帶原句是空字串 → 空字串；只有一條成功的兩種情況（✅）
3. `runReferencedTranscribe`：兩條同時呼叫，一條帶 prompt、一條不帶（✅）
4. 前端：影子跟讀與語言模型練習傳原句、複述不傳；開關可關閉；Gemini 備援不帶原句（✅）
5. 錯 0／1 個字（原句 4 字以上）→ 通過；2 個字 → 不過；3 字以內錯 1 個字 → 不過；1 字句空白作答 → 不過；看過單字提示 → 不過；沒有 targetCount → 要全對（✅）
6. 結果畫面與提示文案（✅）
7. CLAUDE.md、AGENTS.md 已更新（✅）
8. 👀 擁有者那句（Elsewhere the Australian … Tasmania and Victoria）跟讀，辨識結果明顯接近原句、標示「參考原句」
9. 👀 語言模型複習：只念一半 → 不通過；整句念完錯 1 個字 → 通過

## 手動試用步驟
1. 用 Email 測試帳號登入預覽網站
2. 影子跟讀上次那句，看結果頁「語音辨識：Whisper large-v3（參考原句）」與錯字數
3. 語言模型練習：整句念完 → 應通過；故意只念前半句 → 不通過、逐字比對顯示漏念

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
- 2026-11-07：委員會（Gemini、Nemotron、Poolside、DeepSeek）與 Codex 第一輪後擁有者決定：同時送兩次辨識防補字；原句 3 個字以內要全對；AGENTS.md 一起改；守門測試文案改為新規則
  - 採納：評分時長不能當防補字訊號（Codex）；空白作答不可通過（Codex）；AGENTS.md 同步（Codex 🔴）；空字串 reference 視為無（Poolside）；超長保留尾端（Nemotron）
  - 駁回：avg_logprob 過高判照抄（Nemotron，沒有依據）；Gemini 也帶原句（Nemotron，生成式模型更容易照抄）；放寬影子跟讀門檻（擁有者未要求）

## 進度紀錄
- 2026-11-07：建立規劃文件，開草稿 PR，送委員會與 Codex 第一輪；擁有者核准
- 2026-11-07：驗收測試 `141d2b3`；之後只修正測試替身的型別宣告（`vi.fn` 參數），斷言未改；實作完成，check.sh 通過（946 測試）
- 2026-11-07：審查第 1 輪 Codex、Gemini 皆無意見；防作弊檢查標出 CLAUDE.md、AGENTS.md（擁有者同意修改）與 1 行守門文案斷言（擁有者同意改為新規則）
- 下一步：擁有者試用後 Merge；之後接 PR 3（原音語速）
