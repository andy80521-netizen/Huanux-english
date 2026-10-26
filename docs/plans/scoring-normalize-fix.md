# 規劃：評分比對正規化修正（v3.11 補強）

- **級別**：中（修改評分判定邏輯；不改 Firestore 資料結構、不新增套件）
- **PR**：#6
- **狀態**：規劃中

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

## 做法（草案，請委員評估）
1. **每個字改成「可接受寫法的集合」**：正規化結果從 `string[]` 改成 `{ alts: string[]; src: number }[]`（`src` ＝ 原句第幾個字）。比對時兩邊的集合**有交集**就算相同（取代 `===`）。編輯距離演算法不變
2. **scoring.ts 自己的縮寫表**（不再呼叫 `utils.ts` 的 `expandContractions`，該函式保持不變）：
   - `'m`→am、`'re`→are、`'ll`→will、`'ve`→have、`n't`→not（`can't`→can not、`won't`→will not、`let's`→let us）
   - `'d`→{would, had}
   - `'s`：前一個字是代名詞／疑問詞／there／here／that／it 時 →{is, has}；其他字（名詞）視為所有格，保留成一個字（`john's`）
3. **數字**：在清除標點**之前**辨識完整數值 `-?\d{1,3}(,\d{3})*(\.\d+)?`：
   - 負號 → {minus, negative}；小數點 → point ＋逐位數字
   - 整數支援到 999,999,999（hundred／thousand／million）；英文念法中 hundred 後面的 and 可有可無
4. **口頭禪**：只在使用者那一邊移除
5. **其他符號**：`&` → and、`%` → percent（兩邊一致）
6. **逐字顯示**：`WordDiff` 加上原句原字；`WordDiffView` 以原句的字為單位顯示（一個原字展開成多個 token 時，任一 token 錯就把該原字標錯）
7. **測試**：把 `applyMaintenanceResult` 的判斷抽成純函式（例如 `computeMaintenanceOutcome(data, results, now)`），Firestore 交易只負責讀寫；補上單元測試

## 驗收條件
1. 上表 6 個情境的 errors 符合「應該」欄（✅ 自動測試）
2. `I'd like tea`／`I would like tea`、`I'm here`／`I am here`、`It's gone`／`It has gone`… 互相 0 錯（✅）
3. `-5`／`minus five`、`-5`／`negative five`、`3.14`／`three point one four`、`1,250`／`one thousand two hundred fifty`（含 and 版本）皆 0 錯；`-5`／`five` ≥ 1 錯（✅）
4. 使用者念的 um／uh 不扣分；原句有 Um 但使用者沒念要扣 1（✅）
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

## 進度紀錄
- 2026-10-27：建立規劃，送委員會與 Codex 評估
