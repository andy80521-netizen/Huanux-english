#!/usr/bin/env bash
# 防作弊檢查：確保驗證沒有被繞過或弱化。在 GitHub Actions 對每個 PR 執行。
# 用法：bash scripts/ai/guard.sh <base-ref> [head-ref]   例：bash scripts/ai/guard.sh origin/main pr-head
# 只讀取 git 差異，不執行 PR 裡的任何程式，因此可以安全地在 pull_request_target 中執行。
# 輸出 Markdown 報告到 stdout；發現問題時 exit 1。
# 這不是阻擋擁有者：擁有者看過說明後仍可自行 Merge。目的是讓任何弱化驗證的修改「一定被看見」。
# ⚠️ AI 不得修改此檔（見 CLAUDE.md）。
set -uo pipefail

BASE="${1:-origin/main}"
HEAD_REF="${2:-HEAD}"
PROTECTED='^(scripts/check\.sh|scripts/ai/|\.github/|CLAUDE\.md|AGENTS\.md|\.gemini/|vitest\.config\.)'
problems=()

# 1. 受保護的檔案被新增、修改、刪除或改名
while IFS=$'\t' read -r status path rest; do
  [ -z "${status:-}" ] && continue
  target="${rest:-$path}"
  if [[ "$path" =~ $PROTECTED || "$target" =~ $PROTECTED ]]; then
    problems+=("修改了受保護的檔案（$status）：\`$target\`")
  fi
done < <(git diff --name-status "$BASE...$HEAD_REF")

# 2. 刪除或改名測試檔
while IFS=$'\t' read -r status path rest; do
  [[ "$status" =~ ^[DR] && "$path" == tests/* ]] && problems+=("刪除或改名測試檔（$status）：\`$path\`")
done < <(git diff --name-status "$BASE...$HEAD_REF" -- tests)

# 3. 新增 .skip / .only / xit / xdescribe
skips=$(git diff -U0 "$BASE...$HEAD_REF" -- tests src | grep -E '^\+' | grep -v '^+++' \
  | grep -nE '\b(it|test|describe)\.(skip|only)\b|\b(xit|xtest|xdescribe)\(' || true)
[ -n "$skips" ] && problems+=("新增了跳過或限定測試的語法（.skip / .only）：
\`\`\`
$skips
\`\`\`")

# 4. 測試數量變少
count() { git grep -hE '^\s*(it|test)(\.each\([^)]*\))?\(' "$1" -- tests 2>/dev/null | wc -l | tr -d ' '; }
head_n=$(count "$HEAD_REF")
base_n=$(count "$BASE")
[ "$head_n" -lt "$base_n" ] && problems+=("測試數量從 $base_n 減少為 $head_n")

# 5. 新增或移除 npm 套件（不算違規，但一定要讓擁有者看到）
deps=$(git diff "$BASE...$HEAD_REF" -- package.json | grep -E '^[+-]\s+"[^"]+": "[^"]+",?$' | grep -v '"version"' || true)

echo "### 🛡️ 防作弊檢查"
if [ ${#problems[@]} -eq 0 ]; then
  echo "✅ 通過（測試數量：base $base_n → 本 PR $head_n）"
else
  echo "❌ 發現 ${#problems[@]} 個需要擁有者確認的項目："
  for p in "${problems[@]}"; do echo "- $p"; done
  echo
  echo "_如果這些修改是你明確要求的，看過後仍可自行 Merge。_"
fi
if [ -n "$deps" ]; then
  echo; echo "**📦 package.json 相依套件變動：**"; echo '```diff'; echo "$deps"; echo '```'
fi
[ ${#problems[@]} -eq 0 ]
