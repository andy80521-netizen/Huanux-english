# 規劃：UI 改版 ②a｜啟蒙的開始：教材列表、詳情、跟讀、評分結果

- **級別**：大（全站改版第二階段，動到每天最常用的畫面；不改資料、不新增套件）
- **PR**：#8
- **狀態**：完成，等擁有者在預覽網站試用後 Merge

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
- `src/components/ui/IconButton.tsx`
- `src/utils/scoring.ts`
- `src/components/MaterialImportMode.tsx`

## 做法

### 1. 版面寬度
- `App.tsx` 目前所有分頁內容最大 768px。改為依分頁決定：「啟蒙的開始」桌機最大 1200px，其他分頁維持 768px 到各自的 PR
- 這個分頁裡還沒改版的畫面維持 768px：`MaterialImportMode` 的匯入畫面、`MaterialDetailView` 在 `retellTarget` 時顯示的 `RetellView`，各自外面包一層 `mx-auto w-full max-w-3xl`（不改它們內部）
- 字體：`--font-reading` 補上中文後備字（`"Newsreader", "Noto Sans TC", Georgia, serif`），教材標題若是中文不會掉到不合適的字型（Grok）

### 2. 教材列表（`MaterialListView.tsx`）
- 標題「我的教材庫」＋教材數量；「匯入新教材」改用 `Button`
- 卡片：16:9 封面在上（產生中、無封面兩種狀態保留，換成新色）；英文標題 `font-reading`；日期與「完成數 / 總句數 句畢業」；`ProgressBar`
- 刪除改成卡片右上的淺灰 `IconButton`（`aria-label="刪除教材"`），仍需確認
- 卡片結構：`<article>` 外框（非互動）；卡片主體（封面＋標題＋進度）是一顆 `<button type="button">` 進詳情；刪除 `IconButton` 與它**同層**、絕對定位在右上，不放進那顆 button 裡（避免按鈕巢狀，Codex、Grok、DeepSeek）；Enter／Space 開詳情，刪除只開確認視窗
- 進度改用 `materialProgress(m.sentences)`，取代元件內手寫的計數
- 檔案內自帶的另一份 `ConfirmDialog` 改用共用的 `src/components/ConfirmDialog.tsx`（文案、行為相同）
- 手機 1 欄、`sm` 2 欄、`lg` 3 欄

### 3. 教材詳情（`MaterialDetailView.tsx`、`RetellSection.tsx`）
- 頂部：返回、垃圾桶（刪除句數徽章）用 `IconButton`
- 封面區、標題（`font-reading`）、整體進度（`ProgressBar`）
- 封面風格改用 `SegmentedControl`；「產生封面／重新產生封面」改成 ghost 按鈕；錯誤訊息用 danger
- 「已學句型比對」與 `RetellSection` 放進同一張卡片，以分隔線區隔；`RetellSection` 新增 `embedded` prop，拿掉自己的外框避免雙層卡片；狀態文字、按鈕文字不變
- 整體進度用 `materialProgress(material.sentences)`，與列表一致
- 句子卡：序號（用未刪除句子的顯示序 `activeIndices.indexOf(i) + 1`，與跟讀頁一致）、標籤（已精熟＝gold、低信心度＝warn、含句型＝accent-soft）、英文 `font-reading lang="en"`、中文 muted；熟練度細條＋數字取代「Mastery: 640」
- 操作列（由左到右）：熟練度｜刪除（淺灰 `IconButton`，只剩 1 句時 disabled 並保留 `title="至少需保留 1 句"`）、萃取（gold ghost，僅 `mastery >= 1000`；萃取中的轉圈與全部禁用保留）、播放（外框圓鈕）、跟讀（實心主按鈕）；窄手機時熟練度一行、按鈕一行
- 封面三種狀態都保留：有封面、產生中（5 分鐘內）、其他（無封面、逾時、失敗；失敗另有錯誤訊息）
- **文案縮短（擁有者 2026-10-27 同意）**：「萃取語言模型」→「萃取」、「已萃取・重新萃取」→「重新萃取」（保留原本的 `title` 提示說明）
- 垃圾桶視窗、刪除確認、`PatternQuickCard`、`ExtractPreviewDialog` 只換成新色
- 桌機（`lg`）：左欄 360px 固定（封面、標題、進度、封面工具、比對與複述卡片），右欄句子列表；手機單欄

### 4. 跟讀練習（`ShadowingPracticeView.tsx`）
- 待錄音：頂部返回＋教材標題＋「第 N 句，共 M 句」＋細進度；英文句靠左 `font-reading`（PR ① 已換字），中文 muted；本句熟練度細條、原音長度、上次分數（`lastScores.total`，沒有就不顯示）；耳機提醒改成一行淡字（保持被動提示）；「開始跟讀」大按鈕在底部
- 錄音中：小呼吸燈＋「正在播放並同步錄音中...」；緩衝倒數維持數字＋「我念完了」
- 評分中：維持載入圖示與文字
- **桌機右側本集句子列表**：新 prop `onJump(index)`（`index` 是 `material.sentences` 的實際位置），由 `MaterialDetailView` 傳入 `setPracticeIndex`；列出未刪除句子（序號、英文單行截斷、熟練度細條），目前那句反白；主區與右側列表各自捲動
- **跳句的各種狀態**（Codex 🔴、Grok）：
  - 待錄音、評分完成、評分失敗：直接切換
  - 錄音中、緩衝倒數中：中止錄音並切換（擁有者已同意）；換句時**同時暫停教材原音**（現行換句只停錄音，原音會繼續播放）
  - **評分中：列表暫時不能點**（見「需要擁有者決定」），避免舊句的評分結果畫到新句上、兩次整陣列寫入互相覆蓋
  - 另加防護：每次換句或離開時遞增 `scoringTokenRef`，`runScoring` 回來時若已換句，仍寫入那次錄音所屬的句子，但不更新畫面、不自動播放錄音
- 手機不顯示句子列表
- 保留：`handleStart` 在任何 `await` 前用 `SILENT_AUDIO` 解鎖 iPhone 播放；耳機提醒全文；緩衝提示「教材播放完畢，您可以繼續補完發音」

### 5. 評分結果（`ShadowingPracticeView.tsx`、`WordDiffView.tsx`）
- 版面：大號 `font-reading` 總分＋「總分，通過／未通過」；右側內容、流暢度細條；未通過原因文字（既有判斷）用 warn
- 熟練度：評分時呼叫一次 `nextShadowingMastery(舊值, scores)`，**同一份結果**同時用於寫入 Firestore 與畫面（存進 state），不在資料庫更新回來後重算（Codex、Grok）。`gain` 是新舊值差：980＋90 → 1000、gain 20；已是 1000 → gain 0
- `ProgressBar` 用 `value=新值`、`gain=gain`、`max=1000`；gain 為 0 時不顯示金色段與 +N
- 逐字比對：漏念改 warn 色＋底線、念錯改 warn 色＋刪除線（括號內念的字保留），多念維持灰色小字；說明改成「底線＝漏念　刪除線＝念錯（括號內是你念的）　灰色＋＝多念」（見文案清單）
- 「你實際念的內容」、「重播我的錄音」、「再念一次」、「下一句」、最後一句的完成提示：文字不變，換新樣式
- **動效（結果頁，豐富但短）**：
  - 總分從 0 跑到實際分數（約 700ms，ease-out）
  - 熟練度條先停在舊值，再補上金色 +N 段（延遲約 300ms）
  - 通過時總分旁少量金色光點淡入淡出一次（純 CSS、不擋操作）
  - 系統「減少動態效果」時直接顯示最終數字與條狀（分數跑動是 JS，CSS 規則管不到，要另外讀 `matchMedia`）；計時器在離開、換句時清除
  - 按鈕在動畫期間就能點；光點 `pointer-events-none`
- 練習中（待錄音、錄音中）只有呼吸燈與倒數，不加其他動畫

### 6. 共用
- `ConfirmDialog.tsx`：換新樣式（surface、danger 按鈕、`IconButton` 風格），API 不變；`LibraryMode`、語言模型頁也在用，同步受惠
- 新增純函式（可測試）：
  - `src/utils/materialProgress.ts`：`materialProgress(sentences)` → `{ total, completed }`（只算未刪除句子；mastery ≥ 1000 算完成）
  - `src/utils/shadowingMastery.ts`：`nextShadowingMastery(current, scores)` → `{ mastery, gain }`。未通過（`isShadowingPass` 為 false）→ `{ current, 0 }`；通過 → `mastery = Math.min(1000, current + total)`、`gain = mastery - current`（完全沿用現行運算，包括舊值超過 1000 且通過時會寫成 1000 的既有行為）
  - `src/utils/countUp.ts`：`countUpValue(from, to, progress)`：progress 夾在 0～1，ease-out 公式 `1 - (1 - t)^3`，回傳 `Math.round`；from > to 時遞減
  - 舊資料 `mastery` 缺少或非數字時視為 0

## 驗收條件
1. `materialProgress`：空陣列、全刪除、含已刪除、`deleted` 未設定、mastery 999／1000／1001、mastery 缺少 → 正確計數 → ✅（`tests/materialProgress.test.ts`）
2. `nextShadowingMastery`：未通過 → gain 0；通過 640＋89 → 729／89；980＋90 → 1000／20；1000 → 1000／0；舊值 1500 且通過 → 1000（沿用現行）；與 `isShadowingPass` 一致 → ✅（`tests/shadowingMastery.test.ts`）
3. `countUpValue`：0、1、中間值（精確數值）、progress 超出範圍、from > to → ✅（`tests/countUp.test.ts`）
4. 文案守門：既有按鈕與提示文字仍在（開始跟讀、我念完了、再念一次、下一句、重播我的錄音、重新錄一次、重試評分、已完成本教材所有句子、您實際念的內容、匯入新教材、立即匯入、確認刪除、跟讀、複述、重新比對、比對已學句型、產生封面、重新產生封面、寫實攝影、日系動漫、至少需保留 1 句）；舊文案「萃取語言模型」「已萃取・重新萃取」「紅底＝漏念」不得殘留 → ✅（`tests/uiCopy.test.ts`）
5. 色階禁令：`MaterialListView`、`MaterialDetailView`、`ShadowingPracticeView`、`WordDiffView`、`RetellSection`、`ConfirmDialog` 不再使用 `slate-`、`indigo-`、`red-`、`purple-`、`emerald-`、`amber-`、`green-`、`orange-` 色階 class（不掃 `app.css`、`App.tsx`）→ ✅（同上）
6. 熟練度寫入走共用函式：`ShadowingPracticeView` 使用 `nextShadowingMastery(`，不再出現 `Math.min(1000, sentence.mastery` → ✅（同上）
7. `bash scripts/check.sh` 通過 → ✅
8. 手機：列表、詳情、跟讀、評分結果與設計稿一致；所有按鈕可點、點擊區夠大 → 👀
9. 桌機：列表三欄、詳情兩欄、跟讀右側句子列表；點列表中的句子會跳過去 → 👀
10. 跳句：原音播放中點別句 → 原音停止、不評分；緩衝倒數中點別句 → 倒數消失、不評分；評分中 → 列表不能點 → 👀
11. 評分結果動效：分數跑動、金色 +N 段補上、通過時光點；開啟「減少動態效果」直接顯示結果 → 👀
12. 淺色、深色都沒有看不清的字 → 👀
13. 鍵盤：Tab 可走到列表卡片與刪除鈕（兩者分開）、句子操作與跟讀按鈕，焦點框清楚；Enter 開詳情，刪除只開確認視窗 → 👀
14. 匯入畫面與複述練習頁維持原本寬度與樣子（②b 才改）→ 👀

## 手動試用步驟
1. 預覽網站用 **Email 測試帳號**登入（連正式 Firebase；試用會產生 Gemini／Whisper 費用與熟練度寫入）
2. 列表：看卡片、刪除鈕（按下後取消即可）；桌機確認三欄
3. 進一份教材詳情：封面風格切換、比對與複述卡片、句子卡的播放與跟讀；有已精熟的句子時看萃取鈕
4. 跟讀一句到評分結果，看分數跑動、熟練度金色段、逐字比對；按「再念一次」「下一句」
5. 桌機：跟讀頁右側點別的句子；原音播放中、倒數中各點一次別句，確認原音停止、不會評分；評分中確認列表不能點
6. 手機設定開「減少動態效果」再看一次評分結果
7. 淺色、深色各看一次

## 不要做的事
- 不改錄音、評分、熟練度計算與寫入、萃取、封面、比對、複述的邏輯（只抽出共用純函式，行為相同）
- 不改 Firestore 資料結構；不新增套件
- 不動匯入流程頁、`MaterialReviewPanel`、`ExtractPreviewDialog` 內部版面、`RetellView`（留給 ②b）
- 除了「文案變更清單」裡的項目，不改文案（包括「您實際念的內容」維持「您」）

## 文案變更清單（需擁有者核准）
| 位置 | 原本 | 改成 |
|---|---|---|
| 句子卡萃取鈕 | 萃取語言模型 | 萃取（已同意） |
| 句子卡萃取鈕（已萃取） | 已萃取・重新萃取 | 重新萃取（已同意） |
| 列表卡片進度 | 進度 12/48 句 | 12 / 48 句畢業 |
| 列表標題下 | （無） | N 份教材 |
| 詳情（新） | （無） | 48 句、12 句已畢業 |
| 句子卡熟練度 | Mastery: 640 | 細條＋640 |
| 跟讀頁標題 | 跟讀練習 (12/48) | 教材標題＋「第 12 句，共 48 句」 |
| 跟讀待錄音（新） | （無） | 熟練度、原音 4.2 秒、上次 86 分 |
| 評分總分下 | 總分 | 總分，通過／總分（未通過時沿用原本的原因文字） |
| 逐字比對說明 | 紅底＝漏念　刪除線＝念錯… | 底線＝漏念　刪除線＝念錯… |
| 耳機提醒 | 請戴上耳機練習。跟讀時會同時播放原音和錄音，沒戴耳機時麥克風會錄到原音，導致評分失準。 | 不變（只改成淡色一行） |

## 委員會意見整合（第一輪，2026-10-27）
成員：Gemini（Flash）、Nemotron、Poolside、DeepSeek、Grok、Codex。全部回覆。

**採納**
- 評分中跳句會讓舊結果畫到新句、整陣列寫入互相覆蓋（Codex 🔴、Grok）→ 評分中禁止跳句＋token 防護
- 錄音中跳句原音不會停（Codex）→ 換句時暫停原音
- gain 定義錯誤：應為新舊值差（Codex、Grok；Claude 確認）
- 卡片外層改 button 會包住刪除鈕（Codex、Grok、DeepSeek）→ 卡片主體 button 與刪除鈕同層
- 寬度要分層：匯入與複述頁維持 768px（Grok）
- 多處文案其實會變，需列清單給擁有者（Grok、DeepSeek）
- 襯線字缺中文後備（Grok）；`RetellSection` 雙層卡片（Grok、DeepSeek）；JS 分數跑動要另判減少動態（Grok、DeepSeek）；序號用顯示序、封面三態、刪除最後一句 disabled、萃取中狀態要保留（Grok）
- 色階禁令掃描範圍寫死檔案清單、文案守門加負向斷言（Grok）

**駁回**
- 錄音中也禁止點句子（DeepSeek 建議）— 擁有者已決定錄音中點別句直接中止並切換
- `ProgressBar` 加新 API 顯示 +N（無人堅持）— +N 文字放在結果頁，不改共用元件 API
- `ShadowingPracticeView` 的 objectURL 釋放（Gemini）— 現行程式已在換句與卸載時 revoke，非本 PR 範圍

## 資料相容與備份
- 新程式能否讀取舊格式資料：可以，不改資料結構
- 是否改寫既有資料：否（熟練度寫入的計算抽成函式，結果相同，由驗收 2 保證）
- Merge 前的備份方式：不需要

## 新增套件
- 無

## 決策紀錄
- 2026-10-27 擁有者：PR ② 拆成 ②a／②b；先畫列表與詳情設計稿；桌機跟讀頁點句子時中止進行中的錄音並切換
- 2026-10-27 擁有者核准規劃：評分中暫時不能跳句；文案變更清單全部同意
- 2026-10-27 擁有者：列表與詳情設計稿確認；「萃取語言模型」→「萃取」、「已萃取・重新萃取」→「重新萃取」；刪除句子按鈕改淺灰圖示

## 進度紀錄
- 2026-10-27：建立分支與規劃文件，開草稿 PR #8；委員會＋Codex 第一輪全部回覆，已整合；擁有者核准
- 2026-10-27：驗收測試 commit `dc41904`（修改前失敗）
- 2026-10-27：實作 `6c86af3`；本機用假資料預覽（Firebase、AI 轉錄換成模擬模組，Chromium 假麥克風）跑完列表→詳情→跟讀→錄音→倒數→評分完整流程，並實測跳句三種狀態、評分中鎖住、鍵盤操作、減少動態效果；過程中抓到一個自己造成的 bug（換句計數放在會隨 recordedBlobUrl 重跑的 effect，導致評分永遠不顯示），已修正
- 2026-10-27：審查第 1 輪：Codex 🔴 等待麥克風權限期間跳句會啟動舊錄音（真問題，`691b962` 修正並實測修正前後）；Gemini 無意見
- 2026-10-27：審查第 2 輪：Codex、Gemini 皆無意見；verify／guard 通過
- 下一步：擁有者在預覽網站試用後 Merge；接著開 PR ②b（匯入流程、複述練習頁）
