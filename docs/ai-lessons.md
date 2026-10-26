# AI 協作經驗紀錄

Claude 每完成一個功能就更新這份文件；開工前先讀。累積約 5 個功能後，依「委員表現」調整委員名單。

## 專案地雷
<!-- 容易出錯的地方、隱藏的相依關係、環境差異 -->
- 預覽網站（Netlify deploy preview）連的是**正式 Firebase**（`src/firebase.ts` 寫死專案），試用一律用測試帳號
- 預覽網站的 Netlify functions 使用正式的 Gemini／OpenAI 金鑰，試用會產生 API 費用
- 預覽網站**無法用 GitHub 登入**（每個 PR 網址不同，不在 Firebase 授權網域）；手動試用一律用 **Email 測試帳號**
- push 後幾秒內就轉正式審查，PR 驗證與防作弊檢查可能都變成 skipped；`gh_ai.py wait` 會自動偵測並關閉再重開 PR 重新觸發
- Gemini Flash 免費版經常 HTTP 503（過載，PR #2、#4 都發生）；委員會與 Gemini 審查會自動重試，仍失敗時依序改用 `gemini-flash-lite-latest`、`gemini-2.5-flash`（可用 variable `AI_GEMINI_FALLBACK` 調整），審查最後才改用 DeepSeek
- main 已設保護規則（必須透過 PR）：2026-10-27 有工作階段在 repo 剛加入、尚未讀到 CLAUDE.md 時直接推送到 main（ceb931e）
- Codex 審查偶爾卡在「Running」超過 30 分鐘（PR #3）；超過 15 分鐘就推送新版本或再留言 `@codex review` 一次
- 只改 `docs/` 的推送不會重建預覽網站（`netlify.toml`），所以預覽網址可能停在上一個程式版本，這是正常的

## 防作弊機制的已知限制（2026-10-25 多輪攻擊測試後）
- 「把斷言改弱」「mock 掉被測程式」「程式偵測測試環境」只能列為 ⚠️ 注意事項，無法自動判定是否作弊，要靠審查者與完成報告說明
- Claude 若繞過 `gh_ai.py` 直接用 `gh api` 留言，留言會被當成擁有者的發言（Claude 使用擁有者帳號）；只能靠規則遵守

## 常見誤判
<!-- 審查者反覆提出、但其實不成立的意見，以及原因 -->

## 委員表現
<!-- 每個功能一行：功能｜成員｜提出真問題數／誤判數｜備註 -->
| 功能 | 成員 | 真問題 | 誤判 | 備註 |
|---|---|---|---|---|
| 流程修正（PR #3） | Codex | 1 | 0 | 重試總耗時超過 job 上限（🟠）；第一次審查卡住 30 分鐘 |
