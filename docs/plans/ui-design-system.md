# 規劃：UI 改版 ①｜設計系統與共用元件（A「靜讀」）

- **級別**：大（全站改版的第一階段、新增 2 個 npm 套件）
- **PR**：#（開 PR 後填入）
- **狀態**：規劃中

## 目標
建立 A「靜讀」方向的設計系統，讓全站在這個 PR 合併後就換上一致的新色調與字體，並把外框（頁首、分頁列、桌機側欄）改成新設計。各分頁內部的版面重排留給後續 PR ②～④。

完成後：
- 淺色、深色兩套色彩以 CSS 變數定義，全站共用
- 既有程式中大量使用的 `slate`（約 1,500 處）、`indigo`（約 500 處）Tailwind 色階，**改為對應到新色調**，所以還沒重排的頁面也會立刻換成新配色，不會出現新舊混雜的過渡期
- 字體：介面中文用 Noto Sans TC；英文練習句與數字用 Newsreader（襯線）
- 主題模式改為「跟隨系統／淺色／深色」三選一，預設跟隨系統
- 外框：手機維持底部四個分頁；桌機（寬度 ≥ 1024px）改為左側導覽欄，不再是 512px 寬的手機框
- 共用元件：按鈕、圖示按鈕、進度條、分段選擇器，供後續 PR 使用

## 背景與使用情境
- 擁有者手機與桌機各半使用，主要不滿是「看起來陽春、沒質感」
- 2026-10-27 訪談定案：全部畫面、只改視覺與版面（功能與流程不動）、沉靜專注為底＋遊戲化點綴、深色跟隨系統、中文介面＋英文內容、動效分區（練習中克制，結果頁／熟練度／勳章房豐富）、不做 streak
- 擁有者從三套視覺提案中選定 A「靜讀」（霧綠底、玉綠主色、英文襯線字）
- 後續 PR：② 啟蒙的開始　③ 語言模型　④ 勳章房與其他

## 相關檔案
- `index.html`
- `package.json`
- `vite.config.ts`
- `src/index.tsx`
- `src/App.tsx`
- `src/components/PersonalMode.tsx`
- `src/components/ShadowingPracticeView.tsx`
- `src/components/ConfirmDialog.tsx`

## 做法

### 1. Tailwind 從 CDN 改為建置時產生
- 移除 `index.html` 的 `cdn.tailwindcss.com` 與行內 `tailwind.config`
- 新增 `tailwindcss`、`@tailwindcss/vite`（v4），在 `vite.config.ts` 的 `plugins` 加入 `tailwindcss()`
- 新增 `src/styles/app.css`：`@import "tailwindcss"`，在 `src/index.tsx` 匯入
- 保留現有行為：`darkMode: 'class'` → `@custom-variant dark (&:where(.dark, .dark *))`；保留自訂的 `slate-850`
- 理由：CDN 版官方不建議用於正式環境（每次開啟都在瀏覽器即時產生樣式、深色模式會閃一下）

### 2. 設計 token（`src/styles/app.css`）
語意色以 CSS 變數定義在 `:root`（淺色）與 `.dark`（深色），再透過 `@theme` 提供給 Tailwind（`bg-ground`、`bg-surface`、`text-ink`、`text-muted`、`bg-accent` 等）：

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
| warn | 念錯的字 | #B4530A | #F2A65A |
| danger | 錯誤訊息 | #B42318 | #F28B82 |

- **既有色階重新對應**：在 `@theme` 覆寫 `--color-indigo-50…950` 為玉綠色階、`--color-slate-50…950` 為帶綠的中性灰色階（兩組都要淺到深單調遞增，維持既有 `dark:` 搭配的對比關係）
- 其他色（red、amber、emerald 等，合計約 500 處）本 PR 不動，留到各頁 PR 改用語意 token
- 文字對比：所有「文字／底色」組合需達 4.5:1（大字 3:1），由自動測試檢查

### 3. 字體
- `index.html` 改載入 Google Fonts：Newsreader（400、500、italic 400）＋ Noto Sans TC（400、500、700），移除 Inter
- `font-sans` = Noto Sans TC；新增 `font-reading` = Newsreader（英文練習句與大數字用）
- 本 PR 只套用到外框與 `ShadowingPracticeView` 的英文句子（驗證字體效果）；其餘頁面在 ②～④ 套用

### 4. 主題模式三選一
- 新增 `src/utils/theme.ts`（純函式，可測試）：
  - `type ThemeMode = 'system' | 'light' | 'dark'`
  - `parseThemeMode(raw)`：讀取 localStorage 的 `themeMode`，無效值 → `'system'`
  - `resolveIsDark(mode, systemPrefersDark)`
- `App.tsx`：以 `themeMode` 取代 `isDarkMode`；`'system'` 時監聽 `matchMedia('(prefers-color-scheme: dark)')` 的變化即時切換
- **舊設定處理**：舊版每次開啟都會把 `isDarkMode` 寫回 localStorage，無法分辨是使用者選的還是預設值，所以**不沿用**，一律從「跟隨系統」開始，並移除舊的 `isDarkMode` 鍵（擁有者已決定預設跟隨系統）
- **避免閃爍**：`index.html` 的 `<head>` 加一段小腳本，在 React 掛載前就依 `themeMode` 與系統設定加上 `dark` class
- 深色 class 改掛在 `<html>`（目前掛在 App 內的 div），讓 `body` 底色、捲軸、`color-scheme` 一致
- `PersonalMode.tsx`：現有兩鍵切換改為三鍵分段選擇器（跟隨系統／淺色／深色），props 由 `isDarkMode/setIsDarkMode` 改為 `themeMode/setThemeMode`

### 5. 外框（`App.tsx`）
- 手機（< 1024px）：全寬，頂部頁首＋底部四分頁；分頁列用新樣式（選中＝accent 色＋粗體，不再上移跳動），保留 `pb-safe`
- 桌機（≥ 1024px）：左側 232px 導覽欄（Huanux 字標＋四個分頁，垂直排列）＋右側內容區；內容區暫時置中、最大寬度 768px，等 ②～④ 各頁改版後再放寬
- 同步錯誤提示改用 danger token
- 分頁按鈕補 `aria-current="page"`、可見的鍵盤焦點框

### 6. 共用元件（`src/components/ui/`）
- `Button`（variant：primary／secondary／ghost；size：md／lg；最小點擊區 44px）
- `IconButton`（必填 `aria-label`）
- `ProgressBar`（value／max，可選第二段「本次增加」，供熟練度 +N 使用）
- `SegmentedControl`（主題三選一使用）
- 本 PR 只在外框與個人頁使用，其餘頁面在 ②～④ 替換

### 7. 動效基礎
- 全域 `@media (prefers-reduced-motion: reduce)`：動畫與轉場時間降到近乎 0
- 定義兩組時間 token：`--ease-out`、`--dur-fast`（150ms）、`--dur-base`（240ms），給後續 PR 使用

## 驗收條件
1. 主題模式解析：`themeMode` 為 `system`/`light`/`dark` 以外或不存在 → 視為 `system`；`resolveIsDark` 在三種模式×系統深淺下回傳正確 → ✅自動測試（`tests/theme.test.ts`）
2. 色彩對比：`src/styles/app.css` 中 ink/muted/accent/gold/warn/danger 在 ground、surface、surface-2 上，以及 on-accent 在 accent 上，淺深兩套皆 ≥ 4.5:1 → ✅自動測試（`tests/themeContrast.test.ts`，直接解析 CSS 檔）
3. 重新對應的 `indigo`、`slate` 色階淺到深亮度單調遞減 → ✅自動測試（同上）
4. `index.html` 不再引用 `cdn.tailwindcss.com` → ✅自動測試（同上）
5. `bash scripts/check.sh` 通過（含 build）→ ✅
6. 手機寬度：底部四分頁可切換，選中分頁有明顯標示 → 👀手動試用
7. 桌機寬度（≥ 1024px）：左側導覽欄、內容不再是窄手機框 → 👀手動試用
8. 個人頁主題三選一：選「跟隨系統」時改作業系統深淺色，App 立即跟著變；選淺色／深色後重新整理仍維持 → 👀手動試用
9. 重新整理時不會先閃白再變深色（深色模式下）→ 👀手動試用
10. 既有頁面（教材列表、跟讀、語言模型、勳章房）功能照常，配色換成綠色系，沒有看不清的文字 → 👀手動試用
11. 系統開啟「減少動態效果」時，分頁切換沒有動畫 → 👀手動試用

## 手動試用步驟
1. 用預覽網站網址、以 **Email 測試帳號**登入（預覽網站無法用 GitHub 登入；連的是正式 Firebase）
2. 手機：四個分頁各點一次，確認畫面正常、底部分頁選中狀態清楚
3. 手機：進一份教材 → 跟讀一句，確認錄音、評分、下一句都正常；英文句子是襯線字
4. 個人頁：主題分別選淺色、深色、跟隨系統；選跟隨系統時到手機設定切換深淺色再回 App
5. 深色模式下重新整理頁面，觀察有沒有閃白
6. 桌機瀏覽器打開，確認左側導覽欄；把視窗拉窄到手機寬度，確認切回底部分頁
7. 各頁快速瀏覽，找有沒有看不清楚的文字或怪異配色，截圖回報

## 不要做的事
- 不改任何功能、流程、文案（主題開關除外）
- 不動 Firestore 資料結構
- 不重排各分頁內部版面（留給 ②～④）
- 不新增動畫函式庫（動效用 CSS 完成）
- 不改 `netlify.toml`、`scripts/`、`.github/` 等受保護檔案

## 資料相容與備份
- 新程式能否讀取舊格式資料：不涉及 Firestore
- 是否改寫既有資料：否（只移除瀏覽器 localStorage 的 `isDarkMode` 鍵）
- Merge 前的備份方式：不需要

## 新增套件（需擁有者核准）
- `tailwindcss`（v4）、`@tailwindcss/vite`（v4）— devDependencies。擁有者已於 2026-10-27 在對話中同意改為正式安裝

## 決策紀錄
- 2026-10-27 擁有者：UI 改版範圍全部畫面，只改視覺＋版面，功能流程不動；手機桌機各半；沉靜＋遊戲化點綴；深色跟隨系統；中文介面＋英文內容；動效分區；不做 streak；分四個 PR
- 2026-10-27 擁有者：選定 A「靜讀」視覺方向
- 2026-10-27 擁有者：Tailwind 改正式安裝；主題改三選一（跟隨系統／淺色／深色）；桌機跟讀頁右側顯示本集句子列表（屬於 PR ②，點句子可跳到該句）

## 進度紀錄
- 2026-10-27：建立分支與規劃文件，準備開草稿 PR 並召集委員會
