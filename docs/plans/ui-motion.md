# 規劃：UI 改版 ⑤｜動效與微互動

- **級別**：中（擁有者 2026-10-27 決定；只改畫面與動畫，「新勳章」由練習前後的數字算出，不寫任何資料、不改規則、不新增套件）
- **PR**：#18
- **狀態**：規劃中

## 目標
改版 ①～④ 後的自檢顯示「動效與微互動」最弱：換畫面是瞬間切換、高光時刻沒有儀式感。這輪補上四件事（設計稿已經擁有者確認）：

1. **頁面轉場**
   - 切換四個主分頁、教材列表↔詳情↔匯入、句型庫↔句型詳情、今日複習↔句型庫：新畫面淡入＋上浮 8px，200ms，`--ease-out-soft`
   - 做法：共用 `PageEnter` 容器（`key` 改變就重播 `animate-page-in`）；動畫結束值用 `transform: none`，不留下會影響 `position: fixed` 對話框的 transform
   - **卡片輕壓**：教材卡、句型卡、今日複習卡按下時縮到 0.985（`active:`）；有刪除鈕的卡片只在按「標題連結」時縮，按刪除鈕不縮（用 `has-[[data-card-link]:active]`）
2. **高光時刻（本組練習完成）**
   - 新純函式 `sessionHighlights(sentences, groupIndex, startById, afterById)` → `{ newTier: { tier, mastered } | null, groupCompleted }`
     - 練習前精熟句數：有起始值的句子用起始值，其他用目前值；練習後：用這次真的寫入的值（`sessionAfter`），沒有才用目前值
     - `newTier`：這次跨過的最高門檻（10／40／100，`STAGE_THRESHOLDS`）；沒跨過為 null
     - `groupCompleted`：本組 10 句練習後全部 1000、練習前不是
   - 有 `newTier` 時，在「本組練習完成」標題下方顯示印章卡：印章「蓋」下（放大旋轉→落定、外圈漣漪、金色光暈）＋「新勳章」「熟練」「這個句型已精熟 N 句」
   - `groupCompleted` 時在長條下方顯示「第 N 組 10 句全部精熟」（金色、淡入）
   - 只播一次，約 600ms
3. **解鎖新組**（造句練習完成）：既有「已解鎖第 N 組！」卡片彈出（0.9→1.04→1）、鎖環打開、七顆金點散開；文字不變
4. **勳章房進場**：標題→三枚印章（依序縮放浮現，間隔 70ms）→每列間隔 60ms 上浮；長條從 0 長到目前值（700ms）；印章下的數字從 0 數到目前值（沿用 `countUpValue`）。只在這次開啟 App 後第一次進入勳章房時播放（模組層級旗標，不存資料）
5. **減少動態**：沿用 `app.css` 既有的全域規則（動畫時間降到 0.01ms）；數字跑動另外判斷 `prefersReducedMotion()`，直接顯示終值

## 背景與使用情境
- 原始需求要求從「動效、微互動」自檢並持續優化；①～④ 完成後擁有者選了這四項
- 高光時刻放在使用者剛完成練習的那一刻，正是成就感最強的時候；勳章房只是回顧，所以進場動畫只播一次

## 設計依據
- 設計畫布「Huanux 視覺方向提案」第九列（⑤）：頁面轉場、高光時刻、解鎖新組、列表進場與數字

## 相關檔案
- `src/styles/app.css`
- `src/App.tsx`
- `src/components/MaterialImportMode.tsx`
- `src/components/LanguageModelMode.tsx`
- `src/components/TodayReviewView.tsx`
- `src/components/LanguageModelPracticeView.tsx`
- `src/components/BadgeMode.tsx`
- `src/components/ui/BadgeSeal.tsx`
- `src/utils/groupMastery.ts`
- `src/utils/patternStage.ts`

## 驗收條件
1. ✅ `sessionHighlights`：沒跨門檻→null；跨 10／40／100；一次跨兩個取最高；起始值與寫入值優先序；未通過檢查的句子不算；整組精熟只在「練習前不是、練習後是」時為 true（`tests/sessionHighlights.test.ts`）
2. ✅ 文案：`TodayReviewView` 含「新勳章」「這個句型已精熟 」「 10 句全部精熟」；「已解鎖第 」「 組！」仍在（`tests/uiCopyMotion.test.ts`）
3. ✅ 動畫定義：`app.css` 有 `page-in`、`stamp`、`ripple`、`pop-in`、`unlock`、`burst` keyframes，`page-in` 結束值是 `transform: none`；減少動態的全域規則仍在（同上）
4. ✅ 接線：`App.tsx`、`MaterialImportMode`、`LanguageModelMode` 使用 `PageEnter`；三種卡片有輕壓；`BadgeMode` 有只播一次的旗標與數字跑動（同上）
5. 👀 手機與桌機：切分頁、進出詳情有轉場且不閃；對話框（刪除確認、速覽卡、Firebase 設定）位置正常
6. 👀 本機假資料預覽：本組練習完成跨過門檻時出現印章卡、整組精熟出現金色文字；造句完成出現解鎖動畫；勳章房第一次進入有進場、切走再回來不重播
7. 👀 開啟系統「減少動態」：以上全部直接顯示結果

## 手動試用步驟
1. 預覽網站用 **Email 測試帳號**登入
2. 切換四個分頁；教材列表點進詳情再返回；句型庫點進詳情再返回
3. 今日複習練完一組（若剛好跨過 10／40／100 句會看到印章卡）
4. 勳章房：第一次進入看進場，切到別頁再回來應該不重播
5. 手機開啟「減少動態」再看一次

## 不要做的事
- 不改任何資料、精熟／解鎖規則、AI 呼叫
- 不新增套件（不用動畫函式庫）
- 不改既有文案（只新增上列 3 段）

## 資料相容與備份
- 只讀不寫，不需要備份

## 新增套件
- 無

## 決策紀錄
- 2026-10-27：擁有者選擇做 ⑤ 的頁面轉場、高光時刻、列表進場與數字；核准設計稿、3 段新文案、級別「中」

## 進度紀錄
- 2026-10-27：建立分支 `ai/ui-motion` 與規劃文件
