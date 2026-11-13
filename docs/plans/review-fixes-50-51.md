# 規劃：自動跟讀（PR #50）與句子解析（PR #51）機制／運作漏洞審查與修正

- **級別**：中（擁有者 2026-11-13 要求開委員會審查程式機制漏洞與運作漏洞，再整合成修改規劃）
- **PR**：#52
- **狀態**：規劃中（委員會審查）

## 目標
兩個功能都已 Merge 上線。請委員會**直接審查下列程式碼**，找出機制漏洞（狀態機、競態、資料一致性、權限、清理）與運作漏洞（逾時、備援、錯誤處理、iPhone 行為、成本），整合後再修正。

## 背景
- 擁有者原話：「重新檢視程式碼是否有機制漏洞或是運作漏洞」→「開委員會一起審查程式機制漏洞和運作漏洞，將委員會結果再整合成修改規劃」
- 設計依據：`docs/plans/auto-shadowing.md`、`docs/plans/sentence-analysis.md`（含擁有者決定，不可違反）
- 環境：Netlify 同步函式上限 60 秒（官方文件；本站實際值未實測）；Firestore 規則不在 repo（使用者子樹 `artifacts/{appId}/users/{uid}/**` 前端可讀寫）；App 沒有 ErrorBoundary；擁有者主要用 iPhone（iOS 26）

## 相關檔案
- `src/components/SentenceAnalysisPanel.tsx`
- `src/services/sentenceAnalysis.ts`
- `src/utils/sentenceAnalysis.ts`
- `netlify/shared/sentenceAnalysis.ts`
- `netlify/shared/aiKeys.ts`
- `netlify/functions/ai-text.ts`
- `src/utils/autoShadowing.ts`
- `src/components/ShadowingPracticeView.tsx`
- `src/components/MaterialListView.tsx`

## Claude 初步審查發現（請委員會驗證、補充、反駁）

### 句子解析（PR #51）
1. 🟠 **Groq 輸出被截斷或 JSON 不合格時不會改用 Gemini**：`callQualityTextTimed` 只在 Groq 丟例外時改用 Gemini；`max_completion_tokens` 2500 含推理 token，長句可能回傳半截 JSON → `normalizeSentenceAnalysis` 失敗 → 直接回錯誤，重試多半一樣
   - 修法：`callGroq` 檢查 `finish_reason === 'length'` 視為失敗；`ai-text` 解析／正規化失敗且是 Groq 產出時，在剩餘時間內改用 Gemini 再試一次；輸出上限提高到 4096
2. 🟠 **讀取存檔時沒有驗證結構**：`loadSentenceAnalysis` 只檢查 `overview` 是字串；其他欄位不是陣列時畫面 `.length`／`.map` 會丟例外，沒有 ErrorBoundary → 整個跟讀畫面白屏
   - 修法：前端讀取後用白名單正規化（非陣列當空、字串截斷）
3. 🟡 **「再存一次」失敗沒有任何提示**；「句子已變更」的原因只存在面板 state，錄音後重新掛載就消失，又出現無效的「再存一次」
   - 修法：服務層記下未存結果的原因；重試結果明確顯示
4. 🟡 **錯誤訊息誤導**：沒登入或編號異常 →「讀取失敗，請檢查網路」；句子超過 1000 字 →「輸入格式不正確」
5. 🟡 **格式版本號前後端各一份**（`ANALYSIS_VERSION`）：只改一邊會讓所有解析永遠顯示「舊的解析」→ 補測試確保一致
6. 🟡 **記憶體快取沒有綁帳號**：同分頁換帳號時沒清（教材 ID 不同，實際不會撞，但應該清）

### 自動跟讀（PR #50）
- Claude 重點檢查（停止各階段、停止與 onstop 競態、麥克風失敗、只前進一次、錄音播完才倒數、Wake Lock）沒發現新漏洞
- 已知限制：「沒有聲音」沿用原本跟讀的音量門檻（`averageVolume >= 20`），很小聲＋耳機可能被判成沒有聲音

## 請委員會重點審查
- 上面 6 點是否成立、嚴重度、修法是否正確
- **Claude 沒看到的漏洞**，特別是：
  - 自動跟讀的狀態機（`autoShadowing.ts`）與元件接線（`ShadowingPracticeView.tsx`）在 iPhone 上的時序：解鎖、換句 effect、`sentenceReady`、錄音播放結束、倒數、背景／鎖屏
  - 句子解析的交易寫入、刪除教材（`deleteMaterialWithAnalyses`）、進行中請求與未存結果（服務層 Map）、面板卸載／重新掛載
  - 後端：截止時間（`withDeadline`、`callGeminiFreeThenPaid` 的 deadline）、提示詞注入、輸入驗證、成本
- 每項請給：嚴重度、觸發條件、後果、建議修法（具體到檔案／函式）


## 委員會＋Codex 審查結果整合（2026-11-13，待擁有者核准）
成員：Gemini 3.8 Flash、Nemotron、DeepSeek 有回覆；Poolside 已下架。Codex：7 項（4 🟠、3 🟡）。
Claude 初步 6 點：Codex 與三位委員**全部確認成立**。

### 要修的項目（依嚴重度）
| # | 嚴重度 | 問題 | 誰提出 | 修法（檔案／函式） |
|---|---|---|---|---|
| 1 | 🟠 | Groq 截斷或 JSON 不合格不會改用 Gemini | Claude、Codex、全體 | `callGroq` 回報 `finish_reason`；`callQualityTextTimed` 新增選用 `validate(text)`：Groq 截斷或驗證失敗 → 用**同一個截止時間**改用 Gemini；Gemini 結果也驗證；`ANALYSIS_MAX_TOKENS` 提高到 4096 |
| 2 | 🟠 | 讀出存檔沒驗證結構 → 白屏 | Claude、Codex、全體 | `src/utils/sentenceAnalysis.ts` 新增 `sanitizeStoredAnalysis`（存檔專用，保留已存的 chunks，不重新切）；壞資料回 null＝當作沒有解析、可重新解析；**不寫回** Firestore |
| 3 | 🟠 | 錄音中麥克風音軌意外結束，當成正常錄完送評分，自動跟讀照樣前進 | **Codex（新）** | `handleStart` 為本次音軌掛 `ended`、錄音器掛 `error`：中止、不評分；自動模式 `stopAuto('mic')`（顯示「點一下繼續」），手動顯示「麥克風中斷了，請再試一次」；`cleanupAudio` 移除監聽 |
| 4 | 🟠 | 解析請求網路斷掉時永遠卡在「解析中」 | **Codex、DeepSeek（新）** | `analyzeAndSaveSentence` 前端 65 秒截止（超過就失敗、清掉進行中紀錄）；只在紀錄仍是同一個請求時才清（不會清掉之後的重試） |
| 5 | 🟡 | 「再存一次」沒有回饋；不能重存的原因在重新掛載後消失 | Claude、Codex、全體 | 服務層存 `{ rec, result }`；`retrySave` 處理每種結果與例外；不能重存（句子變了、刪了）只給「重新解析」 |
| 6 | 🟡 | 錯誤訊息誤導（沒登入、編號異常、句子超過 1000 字） | Claude、Codex、全體 | 服務層丟出可分類的錯誤；面板分別提示；後端長句回「句子太長，無法解析（上限 1000 字）」 |
| 7 | 🟡 | 格式版本號前後端各一份 | Claude、全體 | 前端常數移到 `src/utils/sentenceAnalysis.ts`；測試比對兩邊相等（前後端不能互相 import，不做共用檔） |
| 8 | 🟡 | 記憶體快取沒綁帳號 | Claude、全體 | 三個 Map 的 key 加上 uid |
| 9 | 🟡 | 刪除教材時進行中的解析回來後留下孤兒「未存結果」 | **DeepSeek（新）** | 教材已刪除（`missing-material`）不放進未存結果 |
| 10 | 🟡 | 刪除教材後清重逢紀錄或音檔失敗，畫面說「刪除失敗」但教材其實已刪 | **DeepSeek（新，原有問題）** | `MaterialListView.handleDelete`：後續清理各自 try/catch，只提示「教材已刪除，部分檔案清理失敗」 |
| 11 | 🟡 | iPhone 有時只送 `pagehide` 不送 `visibilitychange`，自動跟讀殘留 | **DeepSeek（新）** | 自動模式期間也監聽 `pagehide` → `stopAuto('hidden')` |
| 12 | 🟡 | 解析面板沒有錯誤防護，任何顯示錯誤都會讓整個跟讀畫面白屏 | Gemini、Nemotron | 只包住解析面板的小型 ErrorBoundary（顯示「解析內容格式異常，可以重新解析」），不改其他畫面 |
| 13 | ⚪ | 小修：收合再展開仍顯示舊錯誤；重新解析前沒清掉舊的未存結果；刪除計畫沒去重；自動模式 `handleStart` 因「準備中」提早結束時流程會卡住 | DeepSeek、Gemini | 各自一行修正；`handleStart` 在自動模式提早結束時 `stopAuto('prepare')` |

### 駁回的意見
- **iPhone 跳句後無法播放，第一句已精熟時改成請使用者再點一次**（Gemini）：點「自動跟讀」那一下已解鎖原音、錄音播放器與麥克風；之後**每一句**本來就不是點擊觸發，跳句不是特例；而且違反擁有者「已精熟自動略過」的決定。改列 👀 實機驗證
- **錄音播放換 src 後 iPhone 會擋**（Gemini）：手動跟讀早就這樣自動播放錄音，擁有者在 iPhone 用正常；被擋也有保險計時開始倒數
- **呼叫次數上限、成本守門**（Nemotron）：只有擁有者使用，按了才解析
- **前後端共用版本常數檔**（Nemotron）：前後端分開建置、目前沒有互相 import，改用測試比對
- **`withDeadline` 改 AbortController**（Nemotron）：Gemini SDK 呼叫不一定能中止；放棄等待已足夠，函式回應後平台會凍結
- **截止時間降到 45 秒**（DeepSeek）：驗證身分與讀取 JSON 只要幾百毫秒，50 秒仍留 10 秒
- **`sentenceReady` 重複、摘要依句子去重、advance 找不到句子**（Nemotron、DeepSeek）：已由階段檢查擋住；刪除句子是軟刪除，仍在陣列裡
- **提示詞注入 `</material>`**（Nemotron）：`asData` 已把 `<` `>` 全部換掉
- **交易刪除一半成功**（Nemotron）：交易是全部成功或全部失敗
- **Gemini 設定輸出上限**（Nemotron）：思考 token 也算，設了反而容易截斷 JSON（已有驗證＋備援）

## 需要擁有者決定的問題
1. **自動跟讀中按「聽聽看」**：目前會直接結束自動模式、不顯示摘要（DeepSeek 指出體驗不好）
   - A（建議）：自動跟讀進行中**隱藏**「聽聽看」（要聽就先按停止）
   - B：保留，按下去先停止並顯示摘要，再播放
2. **自動跟讀評分卡住（轉文字服務很久沒回）要不要加逾時**（DeepSeek）：建議**這次不做**——評分流程是手動與自動共用，改動範圍大；卡住時可以按停止
3. **錯誤防護範圍**：建議**只包住解析面板**；整個跟讀畫面的錯誤防護之後另外評估

## 驗收條件（草案，依委員會結果修訂）
1. Groq 截斷或 JSON 不合格 → 改用 Gemini，仍在 50 秒內 ✅
2. 存檔內容任何欄位型別錯誤 → 畫面不壞、可重新解析 ✅
3. 「再存一次」成功／失敗／句子已變更都有明確提示，重新掛載後仍正確 ✅
4. 錯誤訊息對應實際原因 ✅
5. 前後端格式版本號一致（測試） ✅
6. 換帳號清掉記憶體快取 ✅

## 不要做的事
- 不改擁有者已決定的設計（解析內容 A～G、按了才解析、預設收合；自動跟讀的節奏與略過規則）
- 不改 Firestore 既有資料

## 資料相容與備份
- 不改既有資料；不需要備份

## 新增套件
無

## 決策紀錄
- 2026-11-13 擁有者：開委員會審查兩個功能的程式機制與運作漏洞

## 進度紀錄
- 2026-11-13 建立審查規劃，送委員會第一輪
- 2026-11-13 委員會＋Codex 回覆，整合成修改規劃，待擁有者核准
