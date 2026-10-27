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
   - 補上監聽失敗畫面（同 PR #15：「讀取句型失敗，請檢查網路後再試一次」＋「重試」）。重試會重建訂閱（`retryKey` 放進 effect 依賴），這是「不改 Firestore 讀取」的唯一例外（Codex）；已有資料時才失敗則保留畫面
   - 換帳號時先清空句型再訂閱，避免短暫顯示前一個帳號的資料（DeepSeek）
   - 句型與中文 `break-words`；精熟句數超過 100 時長條以 100% 為上限（DeepSeek、Gemini）
   - 桌機：左欄（標題、總覽、下一枚，`sticky` 固定）＋右欄（所有句型），整頁一起捲動（Nemotron）
2. **個人**（`PersonalMode`）
   - 已登入：標題「設定與個人」；帳號區（頭像：有照片用照片，否則名字首字；名稱、Email／Anonymous User、「資料同步中」、匿名提示）→ 外觀（`SegmentedControl`，加小標「外觀」）→ 語音設定（中文／英文語音下拉＋試聽圓鈕＋提示）→ 登出（外框按鈕）→ 版本號
   - 未登入：「登入帳號／註冊新帳號」＋「跨裝置同步學習進度」、右上 Firebase 設定圖示鈕（`IconButton`，aria-label 用原本的 title「設定資料庫連線」；預設設定時用 `warn` 提醒色＋`motion-safe:animate-pulse`，減少動態時不閃）、預設資料庫提示（`warn` 淡底）、GitHub 登入、「或使用 Email」、暱稱／Email／密碼欄位（16px）、錯誤訊息、主按鈕、切換登入註冊、訪客；下方接外觀與語音設定
   - Firebase 設定對話框：`ConfirmDialog` 是 `alertdialog` 且按鈕固定，不能直接用（Nemotron、Poolside、DeepSeek）→ 在 `PersonalMode` 內就地改寫：沿用它的外觀（遮罩、圓角卡片、token），加 `role="dialog"`、`aria-modal`、`aria-labelledby`（標題「Firebase 設定」）、Esc 關閉、開啟時焦點到關閉鈕（不自動聚焦輸入框，避免手機彈出鍵盤，同 ③b 速覽卡）；不做完整焦點陷阱（`ConfirmDialog` 也沒有），文字不變
   - 桌機：已登入時左欄帳號卡（帳號＋登出＋版本），右欄設定；未登入時左欄登入表單、右欄設定
   - 文案：「語音設定 (TTS)」→「語音設定」；「✨ 自動選擇 (推薦)」→「自動選擇（推薦）」；其餘文字不變
3. **App 外框**（`App.tsx`）
   - 桌機側欄 active：`bg-accent-soft text-ink dark:text-accent`；手機分頁列 active：`text-accent`；其他：`text-muted`（取代 `text-indigo-800`、`slate-600/400`）（DeepSeek）
   - 拿掉 `WIDE_TABS`：四個分頁都用 1200px；同步錯誤條的 `max-w-3xl` 也改成與內容同寬 1200px（DeepSeek）
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
  - `badgeSummary(patterns)` → `{ usable, proficient, mastered }` 句型數（累計：精熟 ≥10／≥40／≥100 各自計數）
  - `nextBadge(patterns)` → `{ pattern, tier, target, remaining } | null`（tier 為「可用／熟練／精通」文字）
  - `badgeRows(patterns)` → 排好序的列資料（mastered、目前階段文字或 null、下一個門檻或 null、remaining）
  - 排序與同分：`localeCompare(…, 'en')` 固定語系，測試結果不隨瀏覽器變（DeepSeek）
  - 精熟句數一律用既有 `getMasteredCount`；門檻 10／40／100 在 `patternStage.ts` 抽成 `STAGE_THRESHOLDS` 常數，`getPatternStage` 改用它但值與判斷不變。列的階段文字自行由門檻判斷（未滿 10 不顯示，不用 `getPatternStage` 的「學習中」）
- 讀取狀態用純函式 `patternLoadReducer`（`src/utils/loadState.ts`）：`subscribe`→載入中、`snapshot`→完成、`error`→有資料時保留、沒資料時失敗、`retry`→回到載入中並遞增 `retryKey`。`BadgeMode` 用它，讓「重試」可以用測試驗行為（Codex）
- `BadgeMode` 用 `useMemo` 算總覽與列（DeepSeek）
- `BadgeMode` 只負責讀取與畫面；`PersonalMode` 只換樣式與結構，handler 一行不改
- 印章做成小元件（SVG 圓環＋內圈＋文字），未取得＝虛線空心

## 驗收條件
1. ✅ `badgeSummary`：累計計算、0 句與剛好 10／40／100 的邊界（`tests/badges.test.ts`）
2. ✅ `nextBadge`：挑距離最小、同分規則、全部精通或沒有句型回傳 null（同上）
3. ✅ `badgeRows`：排序、remaining 與 next 文字資料、精通列（同上）
4. ✅ 文案守門：既有文案保留、新文案存在、「Achieved」「(TTS)」「✨」移除（`tests/uiCopyBadgesProfile.test.ts`）
5. ✅ 色階禁令：`BadgeMode`、`PersonalMode`、`App.tsx` 不再出現舊色階（同上）
6. ✅ 結構：`App.tsx` 不再有 `WIDE_TABS`／`max-w-3xl`；Firebase 設定對話框有 `role="dialog"`、`aria-modal`；設定鈕閃爍用 `motion-safe:`；`BadgeMode` 的 onSnapshot 錯誤回呼會更新畫面、`retryKey` 在 effect 依賴裡（同上）
6a. ✅ `patternLoadReducer`：首次失敗→離開載入中顯示失敗；重試→載入中且 `retryKey` 加 1；重試成功→完成；再次失敗→仍可重試；已有資料時失敗→保留資料（`tests/loadState.test.ts`）（Codex）
7. ✅ `getPatternStage` 判斷不變（既有 `tests/patterns.test.ts`）
8. 👀 勳章房手機／桌機、淺色／深色版面與設計稿一致
9. 👀 個人頁已登入、未登入、Firebase 設定對話框（Esc 關閉）手機／桌機正常
10. 👀 語音下拉與試聽、外觀切換、登出照常運作
11. 👀 本機假資料預覽：模擬勳章房讀取失敗→按重試恢復（正式環境不易製造失敗，由 Claude 自檢截圖）

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
- 2026-10-27：建立分支 `ai/ui-badges-profile` 與規劃文件，開草稿 PR #16；委員會（Gemini Lite、Nemotron、Poolside、DeepSeek；Grok 本輪未出現）＋Codex 第一輪全部回覆，已整合

## 委員會整合（第一輪）
### 採納
- 重試要能驗行為，允許重建訂閱（Codex 🟠）→ `patternLoadReducer`＋測試
- `ConfirmDialog` 是 alertdialog，不能直接套用 → 就地改寫對話框，只沿用外觀與無障礙屬性（Nemotron、Poolside、DeepSeek）
- 提醒色 orange 在禁令內 → 改用既有 `warn` token；閃爍改 `motion-safe:`（DeepSeek、Nemotron）
- `App.tsx` 同步錯誤條也有 `max-w-3xl` → 改 1200px（DeepSeek）
- 側欄 active 深淺色分別用 ink／accent（DeepSeek）
- 排序固定 `'en'` 語系；長字換行；長條上限 100%；換帳號先清空；`useMemo`（DeepSeek、Gemini、Nemotron）
- 列的階段標籤不能直接用 `getPatternStage`（它有「學習中」）（DeepSeek、Nemotron）
- 桌機左欄 sticky、整頁捲動（Nemotron）
### 駁回或不做
- 新增共用 `Dialog` 元件並讓 `ConfirmDialog` 改用它（Nemotron）— 超出範圍，會動到已上線的刪除確認
- 印章內放 ★◆● 符號（Nemotron）— 設計稿是階段文字
- 移除設定鈕閃爍（Poolside）— 規劃是保留提醒、只在減少動態時停
- 「App.tsx 其他分頁也有舊色階」（Poolside）— 誤判，`App.tsx` 剩下的舊色階只在導覽列
- 「N 枚」是以總精熟句數計（Poolside 提問）— 規劃已寫明以句型數計，與現有每個句型各自三個里程碑一致
- 句型分頁／虛擬捲動、`localStorage` try/catch、焦點陷阱（Poolside、DeepSeek）— 超出範圍，handler 不改
- 自動聚焦設定輸入框（規劃原文）— 改成聚焦關閉鈕，避免手機彈鍵盤（DeepSeek）
### 觀察（不在本 PR 處理）
- 「資料同步中」是固定文字，不代表真的同步狀態（DeepSeek）
