# 規劃：UI 改版 ①｜設計系統與共用元件（A「靜讀」）

- **級別**：大（全站改版的第一階段、新增 2 個 npm 套件）
- **PR**：#7
- **狀態**：完成，等擁有者在預覽網站試用後 Merge

## 目標
建立 A「靜讀」方向的設計系統，讓全站在這個 PR 合併後就換上一致的新色調與字體，並把外框（頁首、分頁列、桌機側欄）改成新設計。各分頁內部的版面重排留給後續 PR ②～④。

完成後：
- 淺色、深色兩套語意色以 CSS 變數定義，全站共用
- 既有程式大量使用的 `slate`（約 1,500 處）、`indigo`（約 500 處）Tailwind 色階**改為新色調**，還沒重排的頁面也立刻換成新配色
- 字體：介面中文 Noto Sans TC；英文練習句與大數字 Newsreader（襯線）
- 主題模式「跟隨系統／淺色／深色」三選一，預設跟隨系統
- 外框：手機（< 1024px）全寬＋底部四分頁；桌機（≥ 1024px）左側導覽欄
- 共用元件：按鈕、圖示按鈕、進度條、分段選擇器

## 背景與使用情境
- 擁有者手機與桌機各半使用，主要不滿是「看起來陽春、沒質感」
- 2026-10-27 訪談定案：全部畫面、只改視覺與版面（功能與流程不動）、沉靜專注為底＋遊戲化點綴、深色跟隨系統、中文介面＋英文內容、動效分區、不做 streak
- 擁有者從三套視覺提案中選定 A「靜讀」
- 後續 PR：② 啟蒙的開始　③ 語言模型　④ 勳章房與其他

## 相關檔案
- `index.html`
- `package.json`
- `vite.config.ts`
- `src/index.tsx`
- `src/App.tsx`
- `src/components/PersonalMode.tsx`
- `src/components/ShadowingPracticeView.tsx`
- `src/components/WordDiffView.tsx`
- `src/components/MaterialListView.tsx`

## 做法

### 1. Tailwind 從 CDN 改為建置時產生（v3 → v4 升級）
- 移除 `index.html` 的 `cdn.tailwindcss.com`、行內 `tailwind.config`
- 新增 `tailwindcss`、`@tailwindcss/vite`（v4，同版本）；`vite.config.ts` 的 `plugins` 在 `react()` 前加 `tailwindcss()`，其他設定不動
- 新增 `src/styles/app.css`（`@import "tailwindcss"`），由 `src/index.tsx` 匯入
- `@custom-variant dark (&:where(.dark, .dark *))` 保留 class 制深色模式（本機試裝 4.3.3 已確認可 build）
- **v3 → v4 相容**（CDN 版是 v3，v4 有預設值改變）：
  - 裸 `border` 預設色：v3 淺灰、v4 文字色（約 140 處）→ `@layer base` 恢復 v3 預設
  - `ring` 預設寬度 3px → 1px（37 處）→ `--default-ring-width: 3px`
  - `<button>` 游標 → base 規則恢復 `cursor: pointer`
  - 尺寸改名（`shadow-sm`→`shadow-xs`、`shadow`→`shadow-sm`、`blur-sm`→`blur-xs`、`outline-none`→`outline-hidden`，約 100 處）→ 官方 `@tailwindcss/upgrade` 機械式改名，**單獨一個 commit**
  - `outline-none` 改 `outline-hidden` 後，強制色彩模式仍保留焦點外框（Codex 指出 `PersonalMode.tsx` 登入欄位的 `outline-none focus:ring-2`）
  - `animate-in`、`zoom-in-95` 等在現行 CDN 版本來就沒有作用（未載入外掛），維持原狀，不順手實作
  - 已全庫搜尋：沒有 `bg-${...}` 這類動態組合的 class，改建置時產生不會漏樣式
- **瀏覽器下限**：v4 需 Safari 16.4／Chrome 111／Firefox 128 以上；擁有者 iPhone 為 iOS 26.5.1，採用 v4

### 2. 設計 token（`src/styles/app.css`）
**語意色**：值寫在 `:root`（淺）與 `.dark`（深）的 CSS 變數，再以 `@theme { --color-ground: var(--ground); … }` 提供 `bg-ground`、`text-ink` 等 class：

| token | 用途 | 淺色 | 深色 |
|---|---|---|---|
| ground | 頁面底色 | #EEF1EC | #0F1916 |
| surface | 主要內容面 | #FBFCFA | #16231F |
| surface-2 | 次要面板、側欄 | #F6F8F5 | #1B2925 |
| ink | 主要文字 | #1D2B28 | #E7EEEA |
| muted | 次要文字 | #5B6B66 | #9DB0A8 |
| line | 分隔線 | #E3E9E5 | #22302C |
| accent | 主色（玉綠） | #1F7A5C | #5CC8A0 |
| on-accent | 主色上的文字 | #FFFFFF | #0E1A16 |
| accent-soft | 主色淡底 | #DCEBE3 | #1E3A31 |
| gold | 熟練度增長、成就 | #8A6416 | #E2B356 |
| warn | 念錯的字 | **#9C4A08**（原 #B4530A 在 ground 上僅 4.41:1，已調深） | #F2A65A |
| danger | 錯誤訊息 | #B42318 | #F28B82 |

**既有色階**：`--color-indigo-50…950`、`--color-slate-50…950` 改為玉綠／帶綠中性灰，**靜態一組，不隨深色模式切換**（既有寫法已是 `bg-slate-50 dark:bg-slate-950`，若色階再隨 `.dark` 變亮會變亮兩次）。約束：
- 淺到深相對亮度單調遞減；`slate-850` 保留名稱、色值改到新 800 與 900 之間
- 錨點對齊語意色：`slate-950`≈深色 ground、`slate-900`≈深色 surface、`slate-50`≈淺色 ground、`indigo-600`＝淺色 accent、`indigo-400`≈深色 accent、`indigo-50`≈淺色 accent-soft
- 定稿色票（2026-10-27）：

| 階 | indigo（玉綠） | slate（帶綠中性灰） |
|---|---|---|
| 50 | #EBF5F0 | #EEF1EC |
| 100 | #D5EBE0 | #E3E9E5 |
| 200 | #ACD8C4 | #D2DBD6 |
| 300 | #7FC4A8 | #B5C2BC |
| 400 | #4FB48C | #8A9B94 |
| 500 | #2E9874 | #5B6B66 |
| 600 | #1F7A5C | #4A5B56 |
| 700 | #17634A | #384843 |
| 800 | #124E3B | #263632 |
| 850 | — | #1B2925 |
| 900 | #0E3B2D | #16231F |
| 950 | #082219 | #0F1916 |

其他色（red、amber、emerald 等約 500 處）本 PR 不動，留到各頁 PR 改用語意 token。

### 3. 字體
- Google Fonts：Noto Sans TC **可變字重 400–900**（現有 `font-black` 73 處、`font-bold` 351 處，只載 400/500/700 會出現假粗體）＋ Newsreader 可變字重；`display=swap`、`preconnect`；移除 Inter
- `--font-sans: "Noto Sans TC", "PingFang TC", "Microsoft JhengHei", system-ui, sans-serif`
- `--font-reading: "Newsreader", Georgia, "Times New Roman", serif`
- 本 PR 只在 `ShadowingPracticeView` 的英文句 `<p>` 加 `font-reading lang="en"`、`font-black` 改 `font-medium`（中文翻譯不套襯線）；其餘頁面在 ②～④ 套用

### 4. 主題模式三選一
- `src/utils/theme.ts`（純函式，測試注入 storage）：
  - `parseThemeMode(raw)`：只接受完全等於 `system`／`light`／`dark`，其他（null、空字串、`"dark"` 帶引號、大寫、多空白）→ `system`
  - `resolveIsDark(mode, systemPrefersDark)`
  - `readThemeMode(storage)`、`writeThemeMode(storage, mode)`：寫純字串（不用 `JSON.stringify`），寫入時一併移除舊 `isDarkMode`；storage 拋錯（Safari 無痕、配額滿）時不拋出，維持 `system`
- **舊設定**：舊版每次開啟都寫回 `isDarkMode`，無法分辨是否為使用者選擇 → 不沿用，一律從「跟隨系統」開始（擁有者已決定）
- `App.tsx`：刪除 `isDarkMode` state 與寫回 `isDarkMode` 的 effect；`useState(() => readThemeMode(localStorage))` **惰性初始化**（不先用預設值再在 effect 改，避免蓋掉 head 腳本的結果）；`system` 時訂閱 `matchMedia` 的 `change`，cleanup 移除；結果寫到 `document.documentElement` 的 `dark` class 與 `style.colorScheme`；移除內層 div 的 `dark` class
- **避免閃爍**（Codex、Grok 指出單有 class 不夠，CSS 是模組載入的）：`index.html` `<head>` 最前面：
  - 同步行內腳本（try/catch）：邏輯與 `parseThemeMode`／`resolveIsDark` 相同，給 `<html>` 加 `dark`、設 `color-scheme`
  - 行內 `<style>`：`html{background:#EEF1EC;color-scheme:light}` `html.dark{background:#0F1916;color-scheme:dark}`（與 token 同值，註明要一起改），取代現在寫死的 `#f1f5f9`／`#020617`
  - 自動測試確認腳本裡的色值與 `app.css` 的 ground 一致
- `PersonalMode.tsx`：props 改 `themeMode/setThemeMode`；兩鍵改 `SegmentedControl` 三選一，綁 `themeMode`（系統深色＋選跟隨系統時，亮的是「跟隨系統」）

### 5. 外框（`App.tsx`）
- 移除 `max-w-lg`、`md:rounded-2xl`、`md:my-4`、`md:h-[calc(100%-2rem)]`、`md:border` 的手機框；高度用 `h-dvh`
- 手機（< 1024px，用 CSS `lg:` 斷點，不用 JS 量寬度）：頂部頁首（字標＋同步錯誤）＋底部四分頁；選中＝accent＋粗體，移除 `-translate-y-1` 跳動；分頁按鈕高 ≥ 44px；`pb-safe` 移到 `app.css`，`index.html` viewport 加 `viewport-fit=cover`
- 桌機（≥ 1024px）：左側 232px 導覽欄（字標＋四分頁），**不顯示頂部頁首**；同步錯誤改顯示在內容區頂端（文案不變）；內容區 `flex-1 min-w-0 min-h-0`，內部置中最大 768px（`--content-max` 變數，②～④ 調整）；捲動仍由各頁自己處理
- 分頁 `aria-current="page"`、淺深色都看得到的 `focus-visible` 框；分頁文字不變

### 6. 共用元件（`src/components/ui/`）
- `Button`（primary／secondary／ghost；md／lg；最小 44px；預設 `type="button"`；primary 用 `bg-accent text-on-accent`）
- `IconButton`（`aria-label` 必填，44×44）
- `ProgressBar`（`value`、`max`、可選 `gain`；百分比計算抽成純函式並 clamp：`max<=0`、負值、超過上限、`gain>value` 都不溢出；`role="progressbar"` 與 aria 值）
- `SegmentedControl`（`role="radiogroup"`／`role="radio"`＋`aria-checked`、左右方向鍵切換）
- 本 PR 只在外框與個人頁主題切換使用；不新增 React 元件測試套件（要新套件），元件邏輯以純函式測試

### 7. 動效基礎
- `--ease-out`、`--dur-fast`（150ms）、`--dur-base`（240ms）
- `prefers-reduced-motion: reduce`：轉場與裝飾動畫降到近 0，**但保留 `animate-spin` 載入圖示**（否則評分中看起來像當掉）

## 驗收條件
1. `parseThemeMode`：`null`、`''`、`'true'`、`'Dark'`、`'"dark"'`、`'system '` → `system`；三個合法值原樣回傳；`resolveIsDark` 三模式 × 系統深淺 6 種組合正確 → ✅自動測試（`tests/theme.test.ts`）
2. `writeThemeMode` 寫入純字串、移除 `isDarkMode`；storage 拋錯時不拋出、讀取回 `system` → ✅自動測試（同上）
3. 語意色對比：ink/muted/accent/gold/warn/danger 在 ground/surface/surface-2 上、on-accent 在 accent 上，淺深兩套皆 ≥ 4.5:1（WCAG 公式、不四捨五入）→ ✅自動測試（`tests/themeContrast.test.ts`，解析 `app.css`）
4. 色階：indigo、slate（含 slate-850）淺到深單調遞減 → ✅自動測試（同上）
5. 既有常見配對對比 ≥ 4.5:1：白字在 `indigo-600`／`indigo-700`（主要按鈕與 hover）、`indigo-400` 在 `slate-900`／`slate-950`、`slate-500` 在白底與 `slate-50`、`slate-400` 在 `slate-900`、`slate-800` 在 `slate-50`、`indigo-800` 在 `indigo-50` → ✅自動測試（同上）
6. `index.html` 沒有 `cdn.tailwindcss.com`、沒有 Inter；head 腳本與行內 style 的 ground 色值與 `app.css` 一致 → ✅自動測試（同上）
7. `ProgressBar` 百分比純函式邊界值 → ✅自動測試（`tests/progressBar.test.ts`）
8. `bash scripts/check.sh` 通過 → ✅
9. 寬 390px 與 1023px：只有底部四分頁、無側欄；可切換，選中有標示且不跳動 → 👀
10. 寬 1024px 與 1440px：只有左側欄、無頂部頁首、無橫向捲軸；縮回 1023px 切回底欄 → 👀
11. 主題：選跟隨系統後改系統深淺，不重新整理也跟著變，且選擇器停在「跟隨系統」；選淺／深後重新整理維持、系統改了也不覆蓋 → 👀
12. 深色（含「已存深色但系統淺色」）重新整理、清快取＋網路限速時，第一畫面不閃白 → 👀
13. 既有頁面功能、文案不變，沒有看不清的字（特別是跟讀評分區的綠字／琥珀字與念錯的字）→ 👀
14. 減少動態效果時分頁切換無動畫，評分中的載入圖示仍在轉 → 👀
15. iPhone 底部橫條不擋住分頁 → 👀
16. 鍵盤 Tab 可走到分頁與主題選擇器，焦點框清楚；主題選擇器可用方向鍵 → 👀

## 手動試用步驟
1. 預覽網站用 **Email 測試帳號**登入（無法用 GitHub 登入；連正式 Firebase）
2. 手機：四個分頁各點一次；進一份教材 → 跟讀一句，看英文句是襯線字、中文翻譯不是（**不需要念到通過**，避免改到正式資料的熟練度）
3. 個人頁：主題分別選淺色、深色、跟隨系統；選跟隨系統時到手機設定切換深淺色再回 App
4. 深色模式下重新整理數次，觀察有沒有閃白
5. 桌機瀏覽器：確認左側導覽欄；把視窗拉窄確認切回底部分頁
6. 各頁快速瀏覽，看不清楚的字或怪配色請截圖

## 不要做的事
- 不改功能、流程、文案（主題開關除外）；不動 Firestore
- 不重排各分頁內部版面（②～④）
- 不新增動畫函式庫、不新增測試套件
- 不動其他 localStorage 鍵（`voicePrefs`、`guest_vocab`、`guest_courses`、`firebase_config`）
- 不改 `netlify.toml`、`scripts/`、`.github/`、`vitest.config.ts` 等受保護檔案

## 資料相容與備份
- 新程式能否讀取舊格式資料：不涉及 Firestore
- 是否改寫既有資料：否（只移除瀏覽器 localStorage 的 `isDarkMode`）
- Merge 前的備份方式：不需要

## 新增套件（需擁有者核准）
- `tailwindcss`、`@tailwindcss/vite`（v4，devDependencies）— 擁有者 2026-10-27 核准

## 委員會意見整合（第一輪，2026-10-27）
成員：Gemini（主模型過載，由 Flash Lite 回答）、Nemotron、Poolside、DeepSeek、Grok、Codex。全部回覆。

**採納**
- warn 淺色對比不足 4.5:1（Codex、DeepSeek；Claude 實算 4.41）→ 改 #9C4A08
- 色階靜態、不隨 `.dark` 切換；`bg-indigo-600 text-white` 等既有配對納入對比測試（Codex、Grok）
- 防閃爍要有首屏可生效的行內背景＋惰性初始化 state（Codex、Grok）
- `outline-none` 在 v4 語意改變，改 `outline-hidden`（Codex）
- 瀏覽器下限需擁有者確認（Codex）
- 字重不足造成假粗體（DeepSeek、Grok）→ 可變字重
- 主題值不可用 `JSON.stringify` 存、storage 例外要接住（Grok）
- 桌機不顯示頂部頁首、同步錯誤移到內容區（DeepSeek、Grok）
- `viewport-fit=cover`、減少動態時保留載入圖示、字體 fallback 鏈、`color-scheme`、`matchMedia` cleanup（多位）
- `SegmentedControl` 鍵盤操作、`ProgressBar` 邊界 clamp（Nemotron、DeepSeek、Grok）

**駁回**
- 先跑 codemod 把 slate/indigo 改語意 token（Nemotron）— 範圍過大，②～④ 各頁改版時處理
- 1024px 斷點加遲滯（Nemotron）— CSS 斷點不會抖動，沒有實際問題
- `ProgressBar` 改通用多段陣列（Nemotron）— 目前只有熟練度 +N 一個用途
- 新增元件測試套件（Nemotron）— 需新套件，改用純函式測試
- 內容區放寬到 896px（Nemotron）— 各頁仍是窄版設計，放寬會拉長卡片；保留 768px 變數由 ②～④ 調整
- `@custom-variant` 不支援（Poolside）— 誤判，本機已可 build
- 舊 `isDarkMode` 要遷移（Gemini）— 擁有者已決定不沿用

## 決策紀錄
- 2026-10-27 擁有者：UI 改版範圍全部畫面，只改視覺＋版面，功能流程不動；手機桌機各半；沉靜＋遊戲化點綴；深色跟隨系統；中文介面＋英文內容；動效分區；不做 streak；分四個 PR
- 2026-10-27 擁有者：選定 A「靜讀」視覺方向
- 2026-10-27 擁有者：Tailwind 改正式安裝；主題改三選一；桌機跟讀頁右側顯示本集句子列表（屬於 PR ②，點句子可跳到該句）
- 2026-10-27 擁有者核准規劃：iPhone iOS 26.5.1 → 採用 Tailwind v4；桌機不顯示頂部頁首、同步錯誤移到內容區頂端；768–1023px 全寬＋底部分頁可接受

## 進度紀錄
- 2026-10-27：建立分支與規劃文件，開草稿 PR #7；本機試裝 Tailwind v4 可 build
- 2026-10-27：委員會＋Codex 第一輪全部回覆，已整合；擁有者核准；色票定稿
- 2026-10-27：驗收測試 commit `223fe14`（修改前失敗，3 個測試檔）
- 2026-10-27：實作完成（`2419ffd` 建置與 token、`2876306` v4 機械式改名 113 處、`572714d` 外框／主題／元件）；check.sh 通過；本機 Playwright 實測主題保存、跟隨系統、重新整理不閃白、1023/1024 斷點、減少動態效果皆符合
- 2026-10-27：審查第 1 輪：Codex 無意見、Gemini（Flash Lite 備援）無意見；verify／guard 通過（guard 注意事項：vite.config.ts 加入 tailwindcss() 外掛，屬計畫內）
- 下一步：擁有者在預覽網站手動試用 👀 項目後 Merge；接著開 PR ②（啟蒙的開始）
