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

## 需要擁有者決定的問題（委員會後整理）
（待整理）

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
