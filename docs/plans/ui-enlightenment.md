# 規劃：UI 改版 ②a｜啟蒙的開始：教材列表、詳情、跟讀、評分結果

- **級別**：大（全站改版第二階段，動到每天最常用的畫面；不改資料、不新增套件）
- **PR**：#（開 PR 後填入）
- **狀態**：規劃中

## 目標
把「啟蒙的開始」最常用的四個畫面改成 A「靜讀」的設計（設計稿已經擁有者確認，見下方「設計依據」），功能、流程、資料完全不變。

1. **教材列表**：AI 封面放大成卡片主角；英文標題用 Newsreader；「12 / 48 句畢業」細進度條；手機單欄、桌機三欄網格
2. **教材詳情**：封面＋標題＋整體進度在上；封面風格與重新產生封面收成一行；「已學句型比對」「複述練習」合併成一張分隔列卡片；句子卡英文襯線字、中文淡色，操作收成一排（刪除、萃取、播放、跟讀），「跟讀」是唯一實心主按鈕；熟練度改成細條＋數字（滿 1000 金色＋「已精熟」）；桌機左欄封面與工具、右欄句子列表
3. **跟讀練習**：照提案 A（英文句靠左大字、留白、底部大按鈕）；桌機右側顯示本集句子列表，點了跳到那一句
4. **評分結果**：大號襯線總分；內容／流暢度細條；逐字比對改用 warn 色；熟練度 +N 金色段；動效見下方

## 背景與使用情境
- 擁有者手機、桌機各半使用，跟讀是每天的主要練習
- PR ① 已上線：設計 token、v4 建置、外框、主題三選一、共用元件（`Button`、`IconButton`、`ProgressBar`、`SegmentedControl`）
- 2026-10-27 擁有者決定：PR ② 拆成 ②a（本 PR）與 ②b（匯入流程、複述練習頁 `RetellView`）

## 設計依據
- 設計畫布「Huanux 視覺方向提案」：第一列 A 靜讀（跟讀待錄音、評分結果、桌機跟讀）、第四列 ②（列表手機／桌機、詳情手機整頁／桌機深色）
- 色彩一律用 PR ① 的語意 token（`bg-ground`、`bg-surface`、`text-ink`、`text-muted`、`bg-accent`、`text-gold`、`text-warn`…），本 PR 涉及的元件不再使用 `slate-*`、`indigo-*`、`red-*`、`purple-*` 等色階 class

## 相關檔案
- `src/components/MaterialListView.tsx`
- `src/components/MaterialDetailView.tsx`
- `src/components/ShadowingPracticeView.tsx`
- `src/components/WordDiffView.tsx`
- `src/components/RetellSection.tsx`
- `src/components/ConfirmDialog.tsx`
- `src/App.tsx`
- `src/styles/app.css`
- `src/components/ui/ProgressBar.tsx`

## 做法

### 1. 版面寬度
- `App.tsx` 目前所有分頁內容最大 768px。改為依分頁決定：「啟蒙的開始」桌機最大 1200px（列表三欄、詳情兩欄、跟讀右側句子列表需要），其他分頁維持 768px 到各自的 PR

### 2. 教材列表（`MaterialListView.tsx`）
- 標題「我的教材庫」＋教材數量；「匯入新教材」改用 `Button`
- 卡片：16:9 封面在上（產生中、無封面兩種狀態保留，換成新色）；英文標題 `font-reading`；日期與「完成數 / 總句數 句畢業」；`ProgressBar`
- 刪除改成卡片右上的淺灰 `IconButton`（`aria-label="刪除教材"`），仍需確認
- 整張卡片可點進詳情：改成 `<button>` 或加上鍵盤可操作的方式（目前是 `div onClick`，鍵盤無法進入）
- 檔案內自帶的另一份 `ConfirmDialog` 改用共用的 `src/components/ConfirmDialog.tsx`（文案、行為相同）
- 手機 1 欄、`sm` 2 欄、`lg` 3 欄

### 3. 教材詳情（`MaterialDetailView.tsx`、`RetellSection.tsx`）
- 頂部：返回、垃圾桶（刪除句數徽章）用 `IconButton`
- 封面區、標題（`font-reading`）、整體進度（`ProgressBar`）
- 封面風格改用 `SegmentedControl`；「產生封面／重新產生封面」改成 ghost 按鈕；錯誤訊息用 danger
- 「已學句型比對」與 `RetellSection` 放進同一張卡片，以分隔線區隔；狀態文字、按鈕文字不變
- 句子卡：序號、標籤（已精熟＝gold、低信心度＝warn、含句型＝accent-soft）、英文 `font-reading lang="en"`、中文 muted；熟練度細條＋數字取代「Mastery: 640」
- 操作列（由左到右）：熟練度｜刪除（淺灰 `IconButton`）、萃取（gold ghost，僅已精熟時）、播放（外框圓鈕）、跟讀（實心主按鈕）
- **文案縮短（擁有者 2026-10-27 同意）**：「萃取語言模型」→「萃取」、「已萃取・重新萃取」→「重新萃取」（保留原本的 `title` 提示說明）
- 垃圾桶視窗、刪除確認、`PatternQuickCard`、`ExtractPreviewDialog` 只換成新色
- 桌機（`lg`）：左欄 360px 固定（封面、標題、進度、封面工具、比對與複述卡片），右欄句子列表；手機單欄

### 4. 跟讀練習（`ShadowingPracticeView.tsx`）
- 待錄音：頂部返回＋教材標題＋「第 N 句，共 M 句」＋細進度；英文句靠左 `font-reading`（PR ① 已換字），中文 muted；本句熟練度細條、原音長度、上次分數（`lastScores.total`，沒有就不顯示）；耳機提醒改成一行淡字（保持被動提示）；「開始跟讀」大按鈕在底部
- 錄音中：小呼吸燈＋「正在播放並同步錄音中...」；緩衝倒數維持數字＋「我念完了」
- 評分中：維持載入圖示與文字
- **桌機右側本集句子列表**：新 prop `onJump(index)` 由 `MaterialDetailView` 傳入（`setPracticeIndex`）；列出未刪除句子（序號、英文單行、熟練度細條），目前那句反白；點擊時沿用既有換句邏輯（`useEffect([sentenceIndex])` 會中止進行中的錄音，擁有者 2026-10-27 同意）
- 手機不顯示句子列表

### 5. 評分結果（`ShadowingPracticeView.tsx`、`WordDiffView.tsx`）
- 版面：大號 `font-reading` 總分＋「總分，通過／未通過」；右側內容、流暢度細條；未通過原因文字（既有判斷）用 warn
- 熟練度：`ProgressBar` 以 `gain` 顯示本次增加（通過時 gain＝本次總分，未通過 gain＝0；數值與寫入 Firestore 的計算相同，抽成純函式共用）
- 逐字比對：漏念、念錯改用 warn 色＋底線，多念維持灰色小字；說明文字保留
- 「你實際念的內容」、「重播我的錄音」、「再念一次」、「下一句」、最後一句的完成提示：文字不變，換新樣式
- **動效（結果頁，豐富但短）**：
  - 總分從 0 跑到實際分數（約 700ms，ease-out）
  - 熟練度條先停在舊值，再補上金色 +N 段（延遲約 300ms）
  - 通過時總分旁少量金色光點淡入淡出一次（純 CSS、不擋操作）
  - 系統「減少動態效果」時直接顯示最終數字與條狀
- 練習中（待錄音、錄音中）只有呼吸燈與倒數，不加其他動畫

### 6. 共用
- `ConfirmDialog.tsx`：換新樣式（surface、danger 按鈕、`IconButton` 風格），API 不變；`LibraryMode`、語言模型頁也在用，同步受惠
- 新增純函式（可測試）：
  - `src/utils/materialProgress.ts`：`materialProgress(sentences)` → `{ total, completed }`（只算未刪除句子；mastery ≥ 1000 算完成）
  - `src/utils/shadowingMastery.ts`：`nextShadowingMastery(current, scores)` → `{ mastery, gain }`（與 `ShadowingPracticeView` 寫入的計算相同：通過才加，上限 1000），寫入與畫面都用它
  - `src/utils/countUp.ts`：`countUpValue(from, to, progress)`（ease-out，progress 0～1 夾住，回傳整數）

## 驗收條件
1. `materialProgress`：空陣列、全刪除、含已刪除、恰好 1000、超過 1000 → 正確計數 → ✅（`tests/materialProgress.test.ts`）
2. `nextShadowingMastery`：通過才加、上限 1000、未通過 gain 0、已是 1000 時 gain 0 → 與 `isShadowingPass` 一致 → ✅（`tests/shadowingMastery.test.ts`）
3. `countUpValue`：0、1、中間值、progress 超出範圍、from > to → ✅（`tests/countUp.test.ts`）
4. 文案守門：本 PR 涉及元件中，既有按鈕與提示文字仍存在（開始跟讀、我念完了、再念一次、下一句、重播我的錄音、重新錄一次、重試評分、已完成本教材所有句子、匯入新教材、立即匯入、確認刪除、跟讀、複述、重新比對、比對已學句型、產生封面、重新產生封面、寫實攝影、日系動漫）；「萃取」「重新萃取」為新文案 → ✅（`tests/uiCopy.test.ts`，掃描原始碼字串）
5. 本 PR 涉及的元件不再使用 `slate-`、`indigo-`、`red-`、`purple-`、`emerald-`、`amber-`、`green-`、`orange-` 色階 class → ✅（同上）
6. `bash scripts/check.sh` 通過 → ✅
7. 手機：列表、詳情、跟讀、評分結果與設計稿一致；所有按鈕可點、點擊區夠大 → 👀
8. 桌機：列表三欄、詳情兩欄、跟讀右側句子列表；點列表中的句子會跳過去；錄音中點別句會中止錄音並切換 → 👀
9. 評分結果動效：分數跑動、金色 +N 段補上、通過時光點；開啟「減少動態效果」直接顯示結果 → 👀
10. 熟練度寫入 Firestore 的數值與改版前相同（通過才加、上限 1000）→ ✅（驗收 2）＋ 👀
11. 淺色、深色都沒有看不清的字 → 👀
12. 鍵盤 Tab 可走到列表卡片、句子操作與跟讀按鈕，焦點框清楚 → 👀

## 手動試用步驟
1. 預覽網站用 **Email 測試帳號**登入（連正式 Firebase；試用會產生 Gemini／Whisper 費用與熟練度寫入）
2. 列表：看卡片、刪除鈕（按下後取消即可）；桌機確認三欄
3. 進一份教材詳情：封面風格切換、比對與複述卡片、句子卡的播放與跟讀；有已精熟的句子時看萃取鈕
4. 跟讀一句到評分結果，看分數跑動、熟練度金色段、逐字比對；按「再念一次」「下一句」
5. 桌機：跟讀頁右側點別的句子；錄音中點別句確認會中止並切換
6. 手機設定開「減少動態效果」再看一次評分結果
7. 淺色、深色各看一次

## 不要做的事
- 不改錄音、評分、熟練度計算與寫入、萃取、封面、比對、複述的邏輯（只抽出共用純函式，行為相同）
- 不改 Firestore 資料結構；不新增套件
- 不動匯入流程頁、`MaterialReviewPanel`、`ExtractPreviewDialog` 內部版面、`RetellView`（留給 ②b）
- 除了已同意的「萃取」「重新萃取」，不改文案

## 資料相容與備份
- 新程式能否讀取舊格式資料：可以，不改資料結構
- 是否改寫既有資料：否（熟練度寫入的計算抽成函式，結果相同，由驗收 2 保證）
- Merge 前的備份方式：不需要

## 新增套件
- 無

## 決策紀錄
- 2026-10-27 擁有者：PR ② 拆成 ②a／②b；先畫列表與詳情設計稿；桌機跟讀頁點句子時中止進行中的錄音並切換
- 2026-10-27 擁有者：列表與詳情設計稿確認；「萃取語言模型」→「萃取」、「已萃取・重新萃取」→「重新萃取」；刪除句子按鈕改淺灰圖示

## 進度紀錄
- 2026-10-27：建立分支與規劃文件
