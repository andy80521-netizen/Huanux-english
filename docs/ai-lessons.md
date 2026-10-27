# AI 協作經驗紀錄

Claude 每完成一個功能就更新這份文件；開工前先讀。累積約 5 個功能後，依「委員表現」調整委員名單。

## 專案地雷
<!-- 容易出錯的地方、隱藏的相依關係、環境差異 -->
- 預覽網站（Netlify deploy preview）連的是**正式 Firebase**（`src/firebase.ts` 寫死專案），試用一律用測試帳號
- 預覽網站的 Netlify functions 使用正式的 Gemini／OpenAI 金鑰，試用會產生 API 費用
- 預覽網站**無法用 GitHub 登入**（每個 PR 網址不同，不在 Firebase 授權網域）；手動試用一律用 **Email 測試帳號**
- push 後幾秒內就轉正式審查，PR 驗證與防作弊檢查可能都變成 skipped；`gh_ai.py wait` 會自動偵測並關閉再重開 PR 重新觸發
- Gemini Flash 免費版經常 HTTP 503（過載，PR #2、#4 都發生）；委員會與 Gemini 審查會自動重試，仍失敗時依序改用其他 Gemini 模型（可用 variable `AI_GEMINI_FALLBACK` 調整），審查最後才改用 DeepSeek
- 2026-10-27 起 Gemini 指定 `gemini-3.8-flash`（免費版最新 Flash），不用 `gemini-flash-latest` 別名（依 Google 更新紀錄，別名當時指向 3.5 Flash，該模型 10/8 起被導向 3.6 Flash）；回覆會附上 Google 回報的實際模型。Pro／Argon 只能付費
- main 已設保護規則（必須透過 PR）：2026-10-27 有工作階段在 repo 剛加入、尚未讀到 CLAUDE.md 時直接推送到 main（ceb931e）
- Codex 審查偶爾卡在「Running」超過 30 分鐘（PR #3）；超過 15 分鐘就推送新版本或再留言 `@codex review` 一次
- 只改 `docs/` 的推送不會重建預覽網站（`netlify.toml`），所以預覽網址可能停在上一個程式版本，這是正常的
- 2026-10-27 起 Tailwind 為 v4 建置（`src/styles/app.css`），不再用 CDN。v4 與舊 v3 同名但大小不同：`shadow-sm`、`blur-sm`、`backdrop-blur-sm`、`outline-none` 要用 `-xs`／`outline-hidden`；`flex-shrink-*`、`flex-grow-*` 已移除（改 `shrink-*`、`grow-*`）。官方 `@tailwindcss/upgrade` 在沒有 v3 設定檔時不會做這些改名，要自己處理並對照 build 出來的 CSS
- `indigo`／`slate` 色階已改成 A「靜讀」的玉綠／帶綠中性灰（靜態、不隨深色模式變），新程式優先用語意色 `bg-ground`、`text-ink`、`bg-accent` 等
- `ShadowingPracticeView` 的「Cleanup on unmount」effect 依賴 `recordedBlobUrl`，**每次錄音結束都會重跑**，不是只在離開時跑；要在離開時才做的事（例如換句計數）必須放在 `[]` 依賴的 effect
- 會讓使用者在非同步流程中途換畫面的功能（例如跳句），要逐一檢查每個 `await`（`getUserMedia`、`audioCtx.resume`、轉錄、寫入）回來後是否已過期
- 畫面自檢可用本機假資料預覽：另建 vite 設定，把 `../firebase`、`firebase/firestore`、`firebase/storage`、`services/gemini` 換成模擬模組，Chromium 加 `--use-fake-device-for-media-stream` 可跑完整錄音流程；Tailwind 要用 `@source` 指到 repo 的 `src`
- 本機 build 沒有 `GEMINI_API_KEY` 時整頁空白（Gemini SDK 載入時就拋錯），本機截圖要用 `GEMINI_API_KEY=placeholder… npx vite build`；沙盒連不到 Google Fonts 與 Firebase，截圖會是備援字體＋未登入畫面

## 防作弊機制的已知限制（2026-10-25 多輪攻擊測試後）
- 「把斷言改弱」「mock 掉被測程式」「程式偵測測試環境」只能列為 ⚠️ 注意事項，無法自動判定是否作弊，要靠審查者與完成報告說明
- Claude 若繞過 `gh_ai.py` 直接用 `gh api` 留言，留言會被當成擁有者的發言（Claude 使用擁有者帳號）；只能靠規則遵守

## 常見誤判
<!-- 審查者反覆提出、但其實不成立的意見，以及原因 -->
- Gemini 審查偏寬鬆：PR #2 把未達成的驗收條件判為達成、PR #6 漏掉 3 項真問題；以 Codex 與 Claude 實測為準

## 委員表現
<!-- 每個功能一行：功能｜成員｜提出真問題數／誤判數｜備註 -->
| 功能 | 成員 | 真問題 | 誤判 | 備註 |
|---|---|---|---|---|
| 流程修正（PR #3） | Codex | 1 | 0 | 重試總耗時超過 job 上限（🟠）；第一次審查卡住 30 分鐘 |
| 評分正規化修正（PR #6，規劃） | Codex | 3 | 0 | 口頭禪兩邊都有會誤判、數字正則不支援無逗號、可選 and 需編輯距離支援 |
| 評分正規化修正（PR #6，規劃） | Nemotron／DeepSeek／Poolside | 4 | 0 | Unicode 負號、輸入上限、How'd＝did、既有測試相容 |
| 評分正規化修正（PR #6，審查） | Codex | 3 | 0 | 英數混合字放水（🔴）、constructor 撞內建屬性、複合縮寫 |
| 評分正規化修正（PR #6，審查） | Gemini（Flash Lite 備援） | 0 | 0 | 兩輪都說沒問題，漏掉 Codex 抓到的 3 項 |
| UI 改版①（PR #7，規劃） | Codex | 5 | 0 | warn 對比不足、既有色階配對要測、首屏底色與惰性初始化、v4 outline 語意、瀏覽器下限 |
| UI 改版①（PR #7，規劃） | Grok | 6 | 0 | 色階靜態、主題值勿用 JSON 存、桌機頁首去留、viewport-fit、字重、減少動態留載入圖示 |
| UI 改版①（PR #7，規劃） | DeepSeek | 3 | 0 | warn 對比、字重不足、v3/v4 取捨 |
| UI 改版①（PR #7，規劃） | Nemotron／Poolside／Gemini Lite | 2 | 2 | color-scheme、鍵盤操作；誤判：@custom-variant 不支援（Poolside）、要沿用舊 isDarkMode（Gemini） |
| UI 改版①（PR #7，審查） | Codex／Gemini Lite | 0 | 0 | 第 1 輪皆無意見 |
| UI 改版②a（PR #8，規劃） | Codex | 4 | 0 | 評分中跳句覆蓋（🔴）、跳句原音不停、gain 定義錯、按鈕巢狀 |
| UI 改版②a（PR #8，規劃） | Grok | 8 | 0 | 文案變更沒列清單、寬度分層、中文 fallback、舊熟練度來源、RetellSection 雙框、JS 動畫要另判減少動態等 |
| UI 改版②a（PR #8，規劃） | DeepSeek／Nemotron／Poolside／Gemini | 2 | 1 | RetellSection 雙框、色階遺漏；誤判：objectURL 未釋放（Gemini，現行已釋放） |
| UI 改版②a（PR #8，審查） | Codex | 1 | 0 | 等待麥克風權限期間跳句會啟動舊錄音（🔴） |
| UI 改版②a（PR #8，審查） | Gemini Lite | 0 | 0 | 兩輪皆無意見，漏掉 Codex 的 🔴 |
