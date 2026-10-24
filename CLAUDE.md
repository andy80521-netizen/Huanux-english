# CLAUDE.md — Huanux English

## 專案
- 英文練習 App：React 19 + TypeScript + Vite，資料存 Firebase（Firestore），部署在 Netlify
- AI 功能走 `netlify/functions/`（Gemini、OpenAI Whisper、語音、圖片），前端呼叫在 `src/services/`
- 共用邏輯在 `src/utils/`，型別在 `src/types.ts`，常數與徽章門檻在 `src/constants.ts`
- 擁有者的設計決策（除非擁有者改口，否則不可違反）：
  - 教材匯入是「逐句斷句＋翻譯」，**不可摘要或改寫原文**（要對上真人 mp3 時間軸）
  - 語言模型練習評分是「**精準背出原句**」，不放寬相似度
  - 句型每組 10 句、共 10 組；同組 10 句 mastery 都達 1000 才解鎖下一組
- 擁有者以繁體中文溝通；回報、PR、issue 一律用繁體中文

## 驗證指令
- `bash scripts/check.sh` ＝ 型別檢查 → 單元測試（Vitest，`tests/`）→ build。**這是「成功」的唯一定義。**
- 本機 `npm run dev` 需要 `.env.local`；AI 生成類功能無法自動驗證，交給擁有者用預覽網站實測

## 工作環境限制（重要）
- **連不到 Gemini / OpenAI / Grok / OpenRouter 的 API**，其他 AI 一律透過 GitHub Actions 呼叫，結果以留言回傳
- GitHub：**只能用 REST API**（`gh api repos/andy80521-netizen/huanux-english/...`）。`gh pr list/view/checks`、`gh issue list` 等走 GraphQL 會失敗；**Actions API 也讀不到**，所以測試輸出一律看 PR 留言
- PR 草稿切換：`POST .../pulls/{n}/ccr/ready_for_review`、`POST .../pulls/{n}/ccr/convert_to_draft`
- 等待留言：`bash scripts/ai/wait_comment.sh <編號> "<標記>" [逾時分鐘] [起始時間]`
- Netlify 預覽網址（每個 PR 自動部署）：
  `gh api repos/andy80521-netizen/huanux-english/commits/$(git rev-parse HEAD)/status --jq '.statuses[] | select(.context|test("deploy-preview")) | .target_url'`
  （格式為 `https://deploy-preview-<PR編號>--huanuxenglish.netlify.app`）

## 絕對禁止
- 推送到 `main`、合併 PR（**只有擁有者能按 Merge**；Netlify 從 main 部署正式版）
- 修改 `scripts/check.sh`、`scripts/ai/`、`.github/`、本檔案——除非擁有者在對話中明確要求
- 為了通過驗證而刪除、跳過或弱化測試
- 把金鑰寫進程式碼或 commit

---

# 工作流程：擁有者下指令 → AI 團隊規劃 → 實作循環 → 完成報告

## 階段一：需求與規劃（多 AI 參與）

1. **跟擁有者對話**，弄清楚想要什麼。看相關程式碼，提出你的理解。
2. **寫需求草稿**：目標、背景、使用情境、限制、你初步看到的疑問。給擁有者過目，確認後再送委員會。
3. **送 AI 委員會第一輪（各自獨立評估）**：
   ```bash
   SINCE=$(date -u +%Y-%m-%dT%H:%M:%SZ)
   gh api repos/andy80521-netizen/huanux-english/issues -f title="<標題>" -F body=@brief.md -f 'labels[]=ai-plan' --jq .number
   bash scripts/ai/wait_comment.sh <issue編號> "<!-- ai-council:plan -->" 25 "$SINCE"
   ```
   （同一個 issue 要重跑：先在 issue 留言補充，再 `POST .../issues/<n>/labels -f 'labels[]=ai-plan'`）
4. **交叉討論（第二輪）**：功能大、風險高、或第一輪分歧明顯時執行；小修改可跳過：
   ```bash
   SINCE=$(date -u +%Y-%m-%dT%H:%M:%SZ)
   gh api repos/andy80521-netizen/huanux-english/issues/<n>/labels -f 'labels[]=ai-cross'
   bash scripts/ai/wait_comment.sh <n> "<!-- ai-council:cross -->" 25 "$SINCE"
   ```
5. **你審查整合**：逐條檢查每個 AI 的意見是否正確（對照實際程式碼），不要因為多數 AI 同意就照單全收。
   交給擁有者的**規劃報告**格式：
   - **共識**：各方一致的重點
   - **分歧**：各方說法 → 你建議採用哪個、理由
   - **駁回的意見**：誰提的、為什麼不採用
   - **需要你決定的問題**：每題附你的建議答案
   - **驗收條件草案**：逐條，標明「自動測試」或「需你手動試用」
6. 擁有者回答、修改、核准後，把**定案的驗收條件**留言在 issue（標題「✅ 定案驗收條件」），進入階段二。

## 階段二：實作與驗證循環

1. 從最新 main 開分支：`git fetch origin main && git checkout -b ai/issue-<n> origin/main`
2. **先寫測試**：每條可自動驗證的驗收條件都要有對應測試（放 `tests/`），確認修改前會失敗
3. **本機循環**：修改 → `bash scripts/check.sh` → 失敗就讀錯誤、修正 → 重複，直到通過
   - 每輪只朝一個方向改；同一個錯誤 3 輪沒進展就換做法
4. **送審**：push，開 PR（第一次）或直接 push（之後）：
   ```bash
   git push -u origin ai/issue-<n>
   gh api repos/andy80521-netizen/huanux-english/pulls -f title="<標題>" -f head="ai/issue-<n>" -f base=main -F body=@pr.md --jq .number
   bash scripts/ai/wait_comment.sh <PR編號> "<!-- ai-pr:sha=$(git rev-parse HEAD) -->" 40
   ```
   PR 說明第一行：`Closes #<issue編號>`，接著列出驗收條件與對應測試。
5. **處理結果**（Actions 會在 PR 留言：離線驗證結果＋各 AI 審查意見原文）：
   - 驗證失敗 → 依錯誤輸出修正，回到步驟 3
   - 審查意見：**由你裁決**。逐條判斷真問題 / 誤判 / 超出範圍。真問題就修（必要時補測試），回到步驟 3
   - 誤判或不修的意見：在 PR 留言逐條說明理由（標題「🧑‍⚖️ Claude 裁決」）
   - 沒有任何真問題 → 完成
6. **上限**：審查循環最多 5 輪。到達上限、或需要擁有者做設計決定時，停下來回報，不要硬做

## 完成報告（通知擁有者）

完成或停下時，先送推播通知（若有推播工具可用），再在對話中給這份報告：

```
## 完成度報告：<功能名稱>
狀態：✅ 可以試用 / ⚠️ 部分完成 / ⛔ 需要你決定
PR：<連結>　預覽網站：<Netlify 預覽連結，若有>

### 驗收條件
- ✅ <條件>（自動測試：<測試名稱>）
- 👀 <條件>（需要你手動試用：<怎麼試>）
- ❌ <未達成的條件與原因>

### 驗證
- 離線驗證：通過（型別檢查／N 個測試／build）
- AI 審查：共 N 輪；修正了 X 個問題、駁回 Y 個誤判

### 審查團抓到並已修正的問題
- <問題> — <誰發現>

### 需要你注意或決定的事
- ...

### 下一步
請用預覽網站試用 👀 項目，沒問題就在 GitHub 按 Merge。
```
