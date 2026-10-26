# 規劃：評分比對正規化修正（v3.11 補強）

- **級別**：中（修改評分判定邏輯；不改 Firestore 資料結構、不新增套件）
- **PR**：#6
- **狀態**：審查中

## 目標
v3.11 改成「單字比對」後，補審查（PR #4，Codex／DeepSeek）發現正規化會**誤判對錯**。修正後：
- 念對的不會被判錯（縮寫的不同展開念法）
- 念錯的不會被判對（所有格、負號、小數點、原句中的口頭禪）
- 逐字比對顯示原句原本的寫法
- 熟練度累加與維持複習的核心判斷有自動測試保護

## 背景與使用情境
- 句型練習（語言模型）：`errors === 0`（一字不差）才累加熟練度；維持複習 3 句中 ≥ 2 句一字不差才通過，沒全對的句子熟練度降為 750
- 影子跟讀：內容 ≥ 70 且總分 ≥ 70 才累加熟練度
- 錄音由 Whisper 轉成文字（通常保留縮寫與阿拉伯數字，例如 `I'd`、`25`），再與原句逐字比對
- 補審查實測重現的問題（`compareWords` 的 errors）：

| 原句 | 使用者念 | 目前 | 應該 |
|---|---|---|---|
| `I'd already left` | `I had already left` | 1 | 0 |
| `He's been here` | `He has been here` | 1 | 0 |
| `This is John's book` | `This is John is book` | 0 | ≥ 1 |
| `The value is -5` | `The value is five` | 0 | ≥ 1 |
| `It costs 3.14 dollars` | `It costs three fourteen dollars` | 0 | ≥ 1 |
| `Um, I think so.` | `I think so` | 0 | ≥ 1 |

## 相關檔案
- `src/utils/scoring.ts`
- `src/utils.ts`
- `src/components/WordDiffView.tsx`
- `src/components/PatternPracticeSessionView.tsx`
- `src/components/ShadowingPracticeView.tsx`
- `src/components/TodayReviewView.tsx`
- `src/services/maintenance.ts`
- `tests/scoring.test.ts`

## 擁有者已決定（2026-10-27）
1. 縮寫：`'d` 念 had 或 would 都算對；`'s`（he's、it's 等代名詞／疑問詞／there／here／that 後）念 is 或 has 都算對；縮寫本身與完整念法互相算對（`I'm` ＝ `I am`）。**所有格**（`John's`）不展開，必須照念
2. 數字：負號、小數點要念出來才算對（`-5` ＝ minus／negative five；`3.14` ＝ three point one four）
3. 口頭禪（um、uh…）：只忽略**使用者**念出來的；原句裡有的要照念
4. 逐字比對顯示原句原本的寫法（`I'm`、`25`），不是正規化後的小寫展開
5. 補上核心邏輯測試：維持複習（3 句中 2 句全對才通過、沒全對降 750）、`errors === 0` 才累加

## 做法（委員會第一輪後修訂）
1. **token 化**：新增 `tokenizeForCompare(text, side)`，每個 token 為 `{ alts: string[]; src: number; kind?: 'filler' | 'numAnd' }`（`src`＝原句第幾個字）。比對時兩邊 `alts` **有交集**就算相同
2. **縮寫表**（scoring.ts 自有，不修改 `utils.ts` 的 `expandContractions`）：
   - `'m`→am、`'re`→are、`'ll`→will、`'ve`→have、`n't`→not（`can't`→can not、`won't`→will not、`let's`→let us）
   - `'d`→{would, had}；前一個字是 how／where／what／why／who 時另接受 did（`How'd`＝How did）
   - `'s`：前一個字是代名詞／疑問詞／there／here／that／it 時 →{is, has}；其他字視為所有格，保留成一個字（`john's`）
3. **數字**：先把 `−`（U+2212）、`–` 等換成 `-`，在清除標點**之前**辨識完整數值，分開兩種格式：無逗號整數 `\d+`、合法千分位 `\d{1,3}(,\d{3})+`，可接負號與小數（前後須是字的邊界）：
   - 負號 → {minus, negative}；小數點 → point ＋逐位數字；整數支援到 999,999,999
4. **編輯距離加上「免費」規則**（其餘每個替換／漏念／多念仍各算 1 錯）：
   - 使用者多念的口頭禪（um、uh…）不算錯；原句裡的口頭禪兩邊都保留，**使用者漏念算 1 錯**，兩邊都有則 0 錯
   - 數字念法中 hundred／thousand／million 後、下一個數字字之前的 `and`（`numAnd`）兩邊都可有可無；其他位置的 `and` 照常比對
5. **其他符號**：`&` → and、`%` → percent（兩邊一致）
6. **逐字顯示**：`WordDiff` 加上 `src`／原字；`WordDiffView` 以原句的字為單位顯示（一個原字展開成多個 token 時，任一 token 錯就整個原字標錯，括號內顯示使用者念的）；多念的字單獨顯示；免費的口頭禪不顯示
7. **相容**：`normalizeForCompare()` 保留現有行為（既有測試不修改）；`compareWords()` 改用新 token 化
8. **效能保護**：使用者 token 超過「原句 token × 3 ＋ 20」時截斷（避免語音辨識異常輸出造成大量計算）
9. **測試**：`applyMaintenanceResult` 的判斷抽成純函式 `computeMaintenanceOutcome(data, results, now)`（未到期或無維持資料回傳 null），Firestore 交易只負責讀寫；`errors === 0` 的判斷抽成 `canAccumulatePattern(scores)`

## 驗收條件
1. 上表 6 個情境的 errors 符合「應該」欄（✅ 自動測試）
2. `I'd like tea`／`I would like tea`、`I'm here`／`I am here`、`It's gone`／`It has gone`… 互相 0 錯（✅）
3. `-5`／`minus five`、`−5`／`negative five`、`3.14`／`three point one four`、`1,250`／`1250`／`one thousand two hundred fifty`／`one thousand two hundred and fifty` 雙向皆 0 錯；`999999999` 正確展開；`-5`／`five` ≥ 1 錯；一般句子漏念 and 仍算 1 錯（✅）
3b. `How'd you do that`／`How did you do that` 0 錯；`I'd`／`I did` ≥ 1 錯（✅）
4. 口頭禪：只有使用者有 → 0 錯；兩邊都有 → 0 錯；只有原句有 → 1 錯（✅）
5. `WordDiff` 顯示原句原字：原句 `I'm 25`、念 `I am twenty five` → 顯示 `I'm`、`25` 皆為正確（✅ 測試 diff 資料；👀 畫面）
6. 維持複習：3 句中 2 句全對 → 通過、level +1；全對的句子不變；沒全對的句子 mastery＝750 且移除 `nextAvailableAt`；只有 1 句全對 → 不通過、level 歸 0（✅ 純函式測試）
7. 句型練習只有 `errors === 0` 才算可累加（✅ 測試判斷函式）
8. 既有 42 個測試全部保留並通過；`bash scripts/check.sh` 通過（✅）
9. 預覽網站實際錄音：句型練習念對含縮寫的句子能累加、念錯一個字不累加並正確顯示逐字比對（👀）

## 手動試用步驟
1. 用 Email **測試帳號**登入預覽網站（預覽連正式 Firebase，不要用真實帳號）
2. 句型練習：挑一句含縮寫（例如 I'd、it's）的句子，用完整念法（I would）念 → 應顯示全對、熟練度增加
3. 同一句故意念錯一個字 → 黃色提示、熟練度不變；逐字比對顯示原句原字，錯的字有刪除線與你念的字
4. 影子跟讀：正常跟讀一句 → 逐字比對顯示原句寫法

## 不要做的事
- 不放寬「精準背出原句」：除上述擁有者決定的等價寫法外，不新增任何容錯
- 不改流暢度、內容分數、總分公式與門檻
- 不改 Firestore 資料格式、不改寫既有資料
- 不修改 `utils.ts` 的 `expandContractions`（其他地方若使用不受影響）

## 資料相容與備份
- 新程式能否讀取舊格式資料：不涉及（只改比對邏輯）
- 是否改寫既有資料：否（維持複習的降級行為與 v3.11 相同，只是判定更正確）
- Merge 前的備份方式：不需要

## 新增套件
- 無

## 需要委員評估的問題
1. 年份（2026：twenty twenty-six／two thousand twenty-six）、時間（3:30）、金額（$5）、序數（1st）要不要處理？Whisper 多半輸出阿拉伯數字，兩邊會一致
2. `'s` 用「前一個字」判斷代名詞是否足夠？有沒有更好的規則
3. 原字展開成多個 token 時，逐字顯示的分組方式

## 決策紀錄
- 2026-10-27 擁有者：上方「擁有者已決定」5 點照 Claude 建議
- 2026-10-27 擁有者核准規劃，另 3 題照建議：名詞後的 's 維持嚴格（`The dog's` 念 dog is 判錯）；年份／序數／金額這次不處理；`-5` 算 2 個字（漏念負號內容分數會下降）

## 進度紀錄
- 2026-10-27：建立規劃，送委員會與 Codex 評估
- 委員會第一輪：Nemotron ✅、Poolside ✅、DeepSeek ✅；Gemini Flash ❌ 503（備援修正 PR #5 尚未合併）
- Codex 3 項 🟠（全部採納）：使用者端刪口頭禪會讓兩邊都有 Um 時判錯 → 改為「使用者多念免費」；數字正則不支援無逗號四位數以上 → 分開兩種格式；可選 and 需要編輯距離支援 → 加免費規則、不全域刪 and
- 採納：Nemotron（U+2212 負號、輸入長度上限）、DeepSeek（How'd＝did、`src` 與多念分開顯示、既有 normalizeForCompare 測試不可破壞）、Poolside（抽純函式測試）
- 驗收測試 commit：`6c5b290`（`tests/scoringNormalize.test.ts`，24 個測試；提交時因模組不存在而失敗）
- 實作：`src/utils/scoring.ts`（tokenizeForCompare、集合比對、免費規則、原字分組顯示、canAccumulatePattern）、`src/utils/maintenanceLogic.ts`（computeMaintenanceOutcome，由 maintenance.ts 交易呼叫）、畫面文字改用常數
- `check.sh` 通過（66 個測試）；驗收測試自 `6c5b290` 後未修改
- 已知限制（不處理）：`5-6` 這類範圍寫法、`1990s` 這類數字加字尾保留原樣比對
- 下一步：Codex／Gemini 審查
