# 規劃：UI 改版 ④｜勳章房與個人

- **級別**：中（擁有者 2026-10-27 決定；3 個元件約 600 行；只改畫面，不改資料、不改精熟／勳章門檻、不新增套件）
- **PR**：#16
- **狀態**：規劃中

## 目標
把最後兩個分頁「勳章房」「個人」改成 A「靜讀」設計（設計稿已經擁有者確認），完成後四個分頁都是新設計，並拿掉 App 外框剩下的舊色階與 768px 寬度分流。

1. **勳章房**（`BadgeMode`）
   - 標題「成就徽章」＋說明（文字不變）
   - **勳章總覽**：三枚印章（可用＝accent-soft、熟練＝accent、精通＝gold），下方「N 枚」＝目前達到該門檻的句型數（精熟 ≥10／≥40／≥100 句的句型數，累計計算：精通的句型也算在可用、熟練裡）
   - **下一枚勳章**：所有還沒精通的句型中，「距離下一個門檻句數最少」的那一個（同分取精熟句數多的，再同分取句型文字排序），顯示空心虛線印章＋句型＋「再精熟 N 句就是「X」」。沒有任何句型、或全部精通時不顯示這張卡
   - **所有句型・N**：每列＝句型（襯線）＋中文意思＋目前階段標籤（未滿 10 句不顯示）＋ 0～100 精熟長條（10、40 有刻度；精通時長條金色）＋「已精熟 N / 100」＋「還差 N 句到「X」」或「三枚勳章都已取得」
   - 排序：精熟句數多的在前，同分依句型文字排序（目前是 Firestore 回傳順序）
   - 拿掉每個句型的三格大圖示與英文「Achieved」
   - 空狀態「尚未開始任何句型」＋說明（文字不變）換新樣式；未登入、載入中換新樣式
   - 補上監聽失敗畫面（同 PR #15：「讀取句型失敗，請檢查網路後再試一次」＋「重試」）
   - 桌機：左欄（標題、總覽、下一枚）＋右欄（所有句型）
2. **個人**（`PersonalMode`）
   - 已登入：標題「設定與個人」；帳號區（頭像：有照片用照片，否則名字首字；名稱、Email／Anonymous User、「資料同步中」、匿名提示）→ 外觀（`SegmentedControl`，加小標「外觀」）→ 語音設定（中文／英文語音下拉＋試聽圓鈕＋提示）→ 登出（外框按鈕）→ 版本號
   - 未登入：「登入帳號／註冊新帳號」＋「跨裝置同步學習進度」、右上 Firebase 設定圖示鈕（`IconButton`，aria-label 用原本的 title「設定資料庫連線」；預設設定時維持提醒色＋閃爍，但減少動態時不閃）、預設資料庫提示、GitHub 登入、「或使用 Email」、暱稱／Email／密碼欄位（16px）、錯誤訊息、主按鈕、切換登入註冊、訪客；下方接外觀與語音設定
   - Firebase 設定對話框：沿用 `ConfirmDialog` 的對話框樣式（`role="dialog"`、`aria-modal`、Esc 關閉、焦點移到第一個欄位），文字不變
   - 桌機：已登入時左欄帳號卡（帳號＋登出＋版本），右欄設定；未登入時左欄登入表單、右欄設定
   - 文案：「語音設定 (TTS)」→「語音設定」；「✨ 自動選擇 (推薦)」→「自動選擇（推薦）」；其餘文字不變
3. **App 外框**（`App.tsx`）
   - 桌機側欄與手機分頁列的 `text-indigo-800`、`slate-600/400` 改語意 token（active＝ink／accent、其他＝muted）
   - 拿掉 `WIDE_TABS`：四個分頁都用 1200px
4. **共用**：這 2 個元件不再使用 `slate-`、`indigo-`、`red-`、`green-`、`orange-`、`emerald-`、`amber-` 等舊色階；不改任何登入／註冊／設定 handler、語音邏輯、Firestore 讀取

## 背景與使用情境
- 語言模型分頁（③a、③b）已上線；勳章房與個人還是舊樣式，App 外框也還留著舊色階與 768px 分流
- 勳章房是遊戲化成果的展示：要一眼看到「拿到幾枚」「下一枚差多少」，而不是 N 個句型 × 3 格重複圖示

## 設計依據
- 設計畫布「Huanux 視覺方向提案」第八列（④）：勳章房（手機淺色整頁、桌機深色）、個人已登入（手機淺色、桌機淺色）、個人未登入（手機深色整頁）
- 只用 PR ① 的語意 token 與共用元件（`Button`、`IconButton`、`SegmentedControl`、`ConfirmDialog` 樣式）

## 相關檔案
- `src/components/BadgeMode.tsx`
- `src/components/PersonalMode.tsx`
- `src/App.tsx`
- `src/utils/patternStage.ts`
- `src/components/ConfirmDialog.tsx`
- `src/components/ui/SegmentedControl.tsx`
- `src/components/ui/Button.tsx`
- `src/components/ui/IconButton.tsx`
- `src/components/LanguageModelListView.tsx`

## 做法
- 新增純函式 `src/utils/badges.ts`：
  - `badgeSummary(patterns)` → `{ usable, proficient, mastered }` 句型數（累計）
  - `nextBadge(patterns)` → `{ pattern, tier, remaining } | null`
  - `badgeRows(patterns)` → 排好序的列資料（mastered、tier、next、remaining）
  - 精熟句數一律用既有 `getMasteredCount`，門檻 10／40／100 與 `getPatternStage` 相同（抽成共用常數，不改值）
- `BadgeMode` 只負責讀取與畫面；`PersonalMode` 只換樣式與結構，handler 一行不改
- 印章做成小元件（SVG 圓環＋內圈＋文字），未取得＝虛線空心

## 驗收條件
1. ✅ `badgeSummary`：累計計算、0 句與剛好 10／40／100 的邊界（`tests/badges.test.ts`）
2. ✅ `nextBadge`：挑距離最小、同分規則、全部精通或沒有句型回傳 null（同上）
3. ✅ `badgeRows`：排序、remaining 與 next 文字資料、精通列（同上）
4. ✅ 文案守門：既有文案保留、新文案存在、「Achieved」「(TTS)」「✨」移除（`tests/uiCopyBadgesProfile.test.ts`）
5. ✅ 色階禁令：`BadgeMode`、`PersonalMode`、`App.tsx` 不再出現舊色階（同上）
6. ✅ 結構：`App.tsx` 不再有 `WIDE_TABS`／`max-w-3xl`；Firebase 設定對話框有 `role="dialog"`；`BadgeMode` 的 onSnapshot 錯誤回呼會更新畫面（同上）
7. ✅ `getPatternStage` 判斷不變（既有 `tests/patterns.test.ts`）
8. 👀 勳章房手機／桌機、淺色／深色版面與設計稿一致
9. 👀 個人頁已登入、未登入、Firebase 設定對話框（Esc 關閉）手機／桌機正常
10. 👀 語音下拉與試聽、外觀切換、登出照常運作

## 手動試用步驟
1. 預覽網站用 **Email 測試帳號**登入
2. 勳章房：確認三枚印章數字、下一枚勳章、句型排序與長條；切換深色看一次
3. 個人：切換外觀三種；換中文／英文語音並按試聽；登出後看登入畫面，按右上資料庫圖示開關設定對話框（Esc 可關）；重新用 Email 登入
4. 桌機寬度重複 2、3

## 不要做的事
- 不改勳章門檻、精熟計算、階段判斷
- 不改登入／註冊／匿名／GitHub／Firebase 設定的流程與文字（除了上列兩處）
- 不刪 `LibraryMode.tsx`（擁有者決定另開小 PR）
- 不新增套件

## 資料相容與備份
- 新程式能否讀取舊格式資料：是，只讀不寫
- 是否改寫既有資料：否
- Merge 前的備份方式：不需要

## 新增套件
- 無

## 決策紀錄
- 2026-10-27：擁有者核准 ④ 設計稿、文案變更、級別「中」；`LibraryMode.tsx` 等未使用的舊程式另開小 PR 刪除

## 進度紀錄
- 2026-10-27：建立分支 `ai/ui-badges-profile` 與規劃文件
