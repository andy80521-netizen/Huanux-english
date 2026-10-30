# 規劃：語音轉文字改用 Groq Whisper large-v3（PR B）

- **級別**：大（擁有者 2026-10-30 決定；改到評分的資料來源與重要 AI 指令）
- **PR**：#23
- **狀態**：已核准，實作中

## 目標
擁有者回報：影子跟讀與語言模型複習「念得對，但辨識出來的字是錯的」。

### 原因（Claude 分析，2026-10-29～30）
- 目前轉錄順序：前端先呼叫 `ai-text` 的 `transcribe`（Gemini，免費 `gemini-3.6-flash` → 免費 `3.1-flash-lite`／`3.5-flash-lite` → 付費）→ 全部失敗才用 `transcribe-recording`（OpenAI `whisper-1`）
- 免費額度一緊（429 視為可重試）就降到 Flash-Lite 轉錄；GitHub 上的 AI 審查也大量使用 Gemini，可能搶同一份額度
- Gemini 是生成式模型，`TRANSCRIBE_PROMPT` 只說「逐字轉錄」，聽不清楚時容易猜出通順的句子、修正文法或補字
- PR A（#22）已在結果頁顯示實際轉錄模型，方便驗證

### 這次要做
1. **主力改為 Groq `whisper-large-v3`**（專用語音辨識；Netlify 已有 `GROQ_API_KEY`；免費開發者方案每分鐘 20 次、每天 2,000 次、每小時 7,200 秒音訊）
2. **新順序**：Groq `whisper-large-v3` → OpenAI `whisper-1`（現有、付費、很便宜）→ Gemini（最後備援）
   - 前兩層都在 `transcribe-recording` 函式裡（同一次請求、伺服器端依序嘗試）；前端只有在這個函式整個失敗時才改用 `ai-text` 的 Gemini
3. **空白錄音防呆**：Whisper 遇到沒有人聲的錄音常會輸出「Thank you.」「Thanks for watching!」等幻覺字句
   - 以 Groq 的 `verbose_json` 回傳的每段 `no_speech_prob`、`avg_logprob` 判斷：所有片段都很可能沒有人聲（`no_speech_prob` 高且 `avg_logprob` 低）→ 視為空白（回傳空字串，畫面顯示「(未偵測到語音)」）
   - 已知幻覺句（Thank you／Thanks for watching／Bye 等）只在「同時」判斷為沒有人聲時才清掉，不誤刪真的念了 thank you 的句子
4. **加強 Gemini 備援的轉錄指令**（`TRANSCRIBE_PROMPT`）：照實轉錄、不修正文法、不補字、不改寫、聽不清楚不要猜、沒有人聲回傳空白、只輸出英文原文
5. 回傳模型名稱沿用 PR A：`whisper-large-v3`（顯示「Whisper large-v3」）、`whisper-1`、`gemini-…`
6. 不把原句當成提示交給任何轉錄模型（避免分數灌水）；Whisper 的 `prompt` 參數不使用；`language: 'en'`、`temperature: 0`

### 影響範圍
- 影子跟讀、語言模型複習、**複述練習**（`RetellView` 也用 `transcribeRecording`，一起受益）
- 不改評分公式、門檻、熟練度、比對規則；不改資料

## 背景與使用情境
- 擁有者 2026-10-30 比較選項後選擇 Groq Whisper large-v3（免費、金鑰已有）
- 其他選項（Azure 發音評估、Cloudflare Whisper、Google STT、瀏覽器內建）見對話紀錄

## 相關檔案
- `netlify/functions/transcribe-recording.ts`
- `netlify/functions/ai-text.ts`
- `netlify/shared/prompts.ts`
- `netlify/shared/aiKeys.ts`
- `src/services/gemini.ts`
- `src/utils/transcriber.ts`
- `src/components/RetellView.tsx`
- `src/components/PatternPracticeSessionView.tsx`
- `src/components/RetellFeedbackPanel.tsx`

## 做法（委員會第一輪後修訂）
### 伺服器：`transcribe-recording.ts`
- **總時間預算 9 秒**（Netlify 同步函式的上限各說法不同，舊預設 10 秒；`netlify.toml` 不可改，所以一律以 10 秒內完成設計）（Codex、Grok、Gemini）
  - 驗證登入 → Groq（最多 6 秒，`AbortController`）→ 失敗時**只有剩餘時間 ≥ 3 秒**才試 OpenAI（在 9 秒截止時取消）→ 否則立刻回 502，讓前端改用 Gemini，不會等到平台強制中斷
  - Groq 與 OpenAI 各自 try/catch：任一層回傳 HTML、網路中斷、逾時、429、5xx、沒金鑰都會繼續下一層，不會被外層 catch 跳過（Grok）
- **兩層 Whisper 都用 `response_format=verbose_json`** 並套用同一個空白錄音防呆（OpenAI `whisper-1` 也回傳片段的 `no_speech_prob`、`avg_logprob`）（Codex）
- 防呆規則（`netlify/shared/transcribe.ts`）：
  - 有片段且**每一段**都 `no_speech_prob ≥ 0.6` 且 `avg_logprob ≤ -1` → 視為沒有人聲，回傳空字串
  - 片段缺少欄位或沒有片段資訊 → 視為有人聲，照常回傳文字（不誤刪）（Grok）
  - 門檻先用 0.6／-1，實機試用若有「念了卻變空白」再放寬並補測試
- **太短的錄音**（解碼後小於 2,000 bytes）不打任何外部服務，直接回傳 `{ text: '', model: '' }`（Grok）
- 參數：`model`、`language=en`、`temperature=0`、`response_format=verbose_json`；**不傳 `prompt`**；副檔名只看 MIME 主類型（去掉 `;codecs=…`）（Gemini、Grok）
- 回傳 `{ text, model }`；**空字串是合法結果**
- 日誌只記模型與毫秒，不記轉錄文字或音檔（Grok）

### 伺服器：`ai-text.ts` 的 Gemini 備援
- 只用 `gemini-3.6-flash`（免費）與付費 Flash，**不再落到 Flash-Lite**（這次要避開的就是小模型猜句）（Grok）
- Gemini 回傳空字串視為合法的「沒有人聲」，回傳 `{ text: '', model }`；只有沒有回應、格式錯誤才算失敗（Codex）
- `TRANSCRIBE_PROMPT` 改寫：照實轉錄、不要修正文法、不要補字或改寫、聽不清楚不要猜、沒有人聲就回傳空白、只輸出英文原文、不加引號或說明

### 前端：`src/services/gemini.ts`
- `transcribeRecordingDetailed`：先打 `transcribe-recording`；成功（含空字串）就直接用；失敗才打 `ai-text` Gemini
- `transcribe-recording` 回 **413（錄音太大）時不改打 Gemini**（Gemini 上限一樣），直接顯示「錄音太長，請縮短後再試」（Grok、Gemini）
- `huanux_force_whisper` 測試開關移除；新增 `huanux_force_gemini`（只在測試時用來比較）
- 前端接受 `text === ''`：練習頁顯示既有的「(未偵測到語音)」、不累加熟練度（現有行為）；複述沿用既有錯誤「沒有辨識到內容，請再說一次」，不送 AI 回饋、不存紀錄

### 前端：複述練習（`RetellView`）
- 改用 `transcribeRecordingDetailed`，在「你說的（語音辨識）」旁顯示「語音辨識：…」；只顯示當次，不存進歷史紀錄（不改資料）（Codex）
- 錄音加 `audioBitsPerSecond: 64000`：3 分鐘約 1.5 MB，避免超過 4 MB 上限；語音 64 kbps 已足夠清楚（Gemini）

## 驗收條件
1. ✅ 空白防呆：沒有片段資訊→保留文字；全部高 no_speech 且低 logprob→空白；混合→保留；「Thank you.」在沒有人聲時清掉、有人聲時保留；太短的錄音不打外部服務（`tests/transcribe.test.ts`）
2. ✅ 前端順序：先打 `transcribe-recording`，成功（含空字串）就不呼叫 Gemini；失敗才呼叫 Gemini；413 不改打 Gemini；兩者都失敗丟出錯誤；回傳模型正確（`tests/transcribeOrder.test.ts`，`vi.mock` 替身 Firebase 與 `fetch`，不新增套件）
3. ✅ 伺服器：Groq 成功就不打 OpenAI；Groq 失敗（429／5xx／非 JSON／逾時／沒金鑰）改 OpenAI；**Groq 逾時 6 秒後 OpenAI 也卡住 → 9 秒內回 502**；剩餘不足 3 秒不試 OpenAI；兩層參數含 `language=en`、`temperature=0`、`response_format=verbose_json` 且**不含 `prompt`**；OpenAI 路徑也套用空白防呆（同上，替身 `fetch`＋假計時器）
3a. ✅ Gemini 備援：模型清單不含 flash-lite；回傳空字串視為成功（同上）
4. ✅ `TRANSCRIBE_PROMPT` 含「不要修正文法」「不要補字」「聽不清楚不要猜」「沒有人聲回傳空白」等要求（文案守門）
5. ✅ `transcriberLabel('whisper-large-v3')` → 「Whisper large-v3」（既有測試已涵蓋）
6. 👀 預覽網站：影子跟讀、語言模型複習、複述練習的結果頁都顯示「語音辨識：Whisper large-v3」（若顯示別的，先確認 Netlify 的 `GROQ_API_KEY` 有開放給 Deploy Previews）
7. 👀 同一句念 3 次，比較改版前後「您念的內容」：念對的字應該被正確辨識
8. 👀 靜音對照：按下錄音後不出聲，結果應為「(未偵測到語音)」而不是「Thank you.」

## 手動試用步驟
1. 預覽網站用 **Email 測試帳號**登入（手機）
2. 影子跟讀念同一句 3 次，記下「語音辨識：…」與辨識結果
3. 語言模型複習念 3 句，同上
4. 複述練習錄一段，看辨識結果
5. 靜音對照：開始錄音後完全不出聲

## 不要做的事
- 不改評分、比對、門檻、熟練度
- 不把原句交給轉錄模型
- 不新增套件（Groq 用 `fetch` 呼叫 OpenAI 相容端點）

## 資料相容與備份
- 不改 Firestore，不需要備份

## 新增套件
- 無

## 成本與隱私
- Groq 免費額度內 0 元；OpenAI `whisper-1` 只在 Groq 失敗時使用（每分鐘約 US$0.006）
- 錄音會送到 Groq（與現在送 Gemini／OpenAI 相同性質）

## 決策紀錄
- 2026-10-30：擁有者選 Groq Whisper large-v3 為主力；拆成 PR A（小，#22 已合併）、PR B（大，本 PR）、PR C（中，英美拼字）
- 2026-10-30：擁有者核准整合後規劃；接受 Groq 額度用完或故障時改用付費 OpenAI `whisper-1`；預覽網站金鑰在試用時確認
- 2026-10-30：擁有者同意第 4 項（加強轉錄指令）與第 5 項（英美拼字視為同字，PR C）

## 進度紀錄
- 2026-10-30：建立分支 `ai/groq-whisper` 與規劃文件，開草稿 PR #23；委員會（Gemini、Nemotron、Grok；Poolside、DeepSeek 未出現）＋Codex 第一輪，已整合

## 委員會整合（第一輪）
### 採納
- 整條備援鏈的總時間預算（9 秒）、各層取消（Codex 🟠、Grok、Gemini）
- OpenAI 備援也要有空白防呆（Codex 🟠）
- 空字串是合法結果，與服務失敗分開（Codex 🟠）
- 複述頁也要接上模型名稱（Codex 🟠）
- Gemini 備援不再用 flash-lite；缺欄位不誤刪；太短的錄音不打外部服務；413 不改打 Gemini；日誌不記文字（Grok）
- 複述錄音限制位元率避免超過上限（Gemini）
### 駁回或不做
- `whisper-1` 顯示改成「Whisper 1」（Grok）— 現在已顯示「Whisper」與「Whisper large-v3」，分得出來；改的話要動 PR A 的驗收測試
- 前端排隊／每位使用者限流（Nemotron、Grok）— 個人練習用量遠低於每分鐘 20 次，之後若 429 變多再考慮
- 2026-10-30：驗收測試 commit `ed170e4`（`tests/transcribe.test.ts`、`tests/transcribeOrder.test.ts`），修改前失敗（推送前修正一處測試替身的型別宣告，斷言未變）
- 2026-10-30：實作完成：`netlify/shared/transcribe.ts`（轉錄鏈、空白防呆、時間預算）、`transcribe-recording.ts` 改為 Groq → OpenAI、`ai-text` 的 Gemini 備援不用 flash-lite 且接受空字串、`TRANSCRIBE_PROMPT` 改寫、前端順序改為 Whisper → Gemini（413 不重試）、複述顯示模型並限制 64 kbps；`check.sh` 通過（775 測試）
- 2026-10-30：審查第 1 輪（`31b2e68`）：Codex 🟠 Gemini 缺少文字的異常回應被當成「沒有人聲」→ 新增 `transcriptFromGeminiResponse`（有文字或正常結束才算成功），補 3 條測試（只新增）；Gemini 無意見；防作弊注意事項：`transcribeOrder.test.ts` mock 的是 Firebase、Firebase Storage、Gemini SDK 與 fetch／FileReader（外部依賴），被測的 `transcribeRecordingDetailed` 是真的
