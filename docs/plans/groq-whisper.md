# 規劃：語音轉文字改用 Groq Whisper large-v3（PR B）

- **級別**：大（擁有者 2026-10-30 決定；改到評分的資料來源與重要 AI 指令）
- **PR**：#23
- **狀態**：規劃中

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

## 做法
- 新共用檔 `netlify/shared/transcribe.ts`（純函式，可測）：
  - `GROQ_TRANSCRIBE_MODEL = 'whisper-large-v3'`
  - `isLikelyNoSpeech(segments)`：所有片段 `no_speech_prob ≥ 0.6` 且 `avg_logprob ≤ -1`（或沒有片段）→ true
  - `cleanWhisperText(text, segments)`：沒有人聲 → ''；否則回傳 trim 後的文字（已知幻覺句只在沒有人聲時清掉）
  - `extensionFor(mimeType)`：沿用現有規則（Groq 與 OpenAI 都依副檔名判斷格式）
- `transcribe-recording.ts`：驗證登入（不變）→ Groq（逾時 15 秒）→ 失敗（含 429、5xx、逾時、未設定金鑰）改 OpenAI `whisper-1` → 都失敗回 502；回傳 `{ text, model }`；每次成功記錄 `[transcribe] 成功：<model> <ms>ms`
- `src/services/gemini.ts`：`transcribeRecordingDetailed` 改為先呼叫 `transcribe-recording`，失敗才呼叫 `ai-text` 的 Gemini；`huanux_force_whisper` 測試開關不再需要（Whisper 已是主力）→ 改為 `huanux_force_gemini`，方便比較
- `prompts.ts`：改寫 `TRANSCRIBE_PROMPT`（見「這次要做」第 4 點）

## 驗收條件
1. ✅ `isLikelyNoSpeech`／`cleanWhisperText`：沒有片段、全部高 no_speech、混合、正常句；「Thank you.」在沒有人聲時清掉、有人聲時保留（`tests/transcribe.test.ts`）
2. ✅ 前端順序：先打 `transcribe-recording`，成功就不呼叫 Gemini；失敗才呼叫 `ai-text` transcribe；兩者都失敗丟出原本的錯誤訊息；回傳的模型名稱正確（`tests/transcribeOrder.test.ts`，用 `vi.mock` 替身 Firebase 與 `fetch`，不新增套件）
3. ✅ 伺服器順序：Groq 成功就不打 OpenAI；Groq 失敗（429／逾時／沒金鑰）改 OpenAI；傳給 Groq 的參數含 `model=whisper-large-v3`、`language=en`、`temperature=0`、`response_format=verbose_json`，且**不含 `prompt`**（同上，替身 `fetch`）
4. ✅ `TRANSCRIBE_PROMPT` 含「不要修正文法」「不要補字」「聽不清楚不要猜」「沒有人聲回傳空白」等要求（文案守門）
5. ✅ `transcriberLabel('whisper-large-v3')` → 「Whisper large-v3」（既有測試已涵蓋）
6. 👀 預覽網站：影子跟讀、語言模型複習、複述練習的結果頁都顯示「語音辨識：Whisper large-v3」
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
- 2026-10-30：擁有者同意第 4 項（加強轉錄指令）與第 5 項（英美拼字視為同字，PR C）

## 進度紀錄
- 2026-10-30：建立分支 `ai/groq-whisper` 與規劃文件
