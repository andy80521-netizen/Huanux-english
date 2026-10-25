#!/usr/bin/env bash
# 防作弊檢查：確保驗證沒有被繞過或弱化。在 GitHub Actions 對每個 PR 執行。
# 用法：bash scripts/ai/guard.sh <base-ref> [head-ref]   例：bash scripts/ai/guard.sh origin/main pr/head
# 只讀取 git 差異，不執行 PR 裡的任何程式，因此可以安全地在 pull_request_target 中執行。
# 輸出 Markdown 報告到 stdout。
#   ❌ 違規：exit 1（擁有者看過說明後仍可自行 Merge，目的是讓弱化驗證的修改「一定被看見」）
#   ⚠️ 注意：不影響結果，但 Claude 必須在完成報告中逐條說明
# ⚠️ AI 不得修改此檔（見 CLAUDE.md）。
set -uo pipefail

BASE="${1:-origin/main}"
HEAD_REF="${2:-HEAD}"
RANGE="$BASE...$HEAD_REF"
PROTECTED='^(scripts/check\.sh|scripts/ai/|\.github/|CLAUDE\.md|AGENTS\.md|\.gemini/|vitest\.config\.|\.npmrc|\.yarnrc|netlify\.toml)'
problems=()
warnings=()
added() { git diff -U0 "$RANGE" -- "$@" | grep -E '^\+' | grep -v '^+++' || true; }
removed() { git diff -U0 "$RANGE" -- "$@" | grep -E '^-' | grep -v '^---' || true; }

# 1. 受保護的檔案被新增、修改、刪除或改名
while IFS=$'\t' read -r status path rest; do
  [ -z "${status:-}" ] && continue
  target="${rest:-$path}"
  if [[ "$path" =~ $PROTECTED || "$target" =~ $PROTECTED ]]; then
    problems+=("修改了受保護的檔案（$status）：\`$target\`")
  fi
done < <(git diff --name-status "$RANGE")

# 2. 刪除、改名或改變型態的測試檔
while IFS=$'\t' read -r status path rest; do
  [[ "$status" =~ ^[DRT] && "$path" == tests/* ]] && problems+=("刪除、改名或改變型態的測試檔（$status）：\`$path\`")
done < <(git diff --name-status "$RANGE" -- tests)

# 3. 跳過、限定或反轉測試的語法
skips=$(added tests src | grep -nE '\b(it|test|describe|suite)\.(skip|only|skipIf|runIf|todo|fails)\b|\b(xit|xtest|xdescribe)\(' || true)
[ -n "$skips" ] && problems+=("新增了跳過、限定或反轉測試的語法：
\`\`\`
$skips
\`\`\`")

# 4. 測試數量變少
count() { git grep -hoE '\b(it|test)(\.each\([^)]*\))?\(\s*['"'"'"`]' "$1" -- tests 2>/dev/null | wc -l | tr -d ' '; }
head_n=$(count "$HEAD_REF"); base_n=$(count "$BASE")
[ "$head_n" -lt "$base_n" ] && problems+=("測試數量從 $base_n 減少為 $head_n")

# 5. npm 安裝階段可執行的腳本、非官方套件來源
lifecycle=$(added package.json | grep -E '"(pre|post)?(install|uninstall|prepare|prepublish|prepack|postpack|publish)"\s*:' || true)
[ -n "$lifecycle" ] && problems+=("package.json 新增或修改了安裝階段會自動執行的腳本：
\`\`\`
$lifecycle
\`\`\`")
badsrc=$(added package-lock.json | grep -E '"resolved"\s*:' | grep -vE '"https://registry\.npmjs\.org/' || true)
[ -n "$badsrc" ] && problems+=("package-lock.json 出現非 npm 官方來源的套件：
\`\`\`
$(echo "$badsrc" | head -10)
\`\`\`")

# 6. ⚠️ 注意：可能削弱測試的修改（不判定違規，但必須說明）
mocks=$(added tests | grep -nE '\bvi\.(mock|doMock|spyOn|stubGlobal|stubEnv)\b' || true)
[ -n "$mocks" ] && warnings+=("測試新增了 mock／spy，請確認沒有把「被測試的程式本身」換成假的：
\`\`\`
$mocks
\`\`\`")
exp_del=$(removed tests | grep -cE '\bexpect\(' || true)
exp_add=$(added tests | grep -cE '\bexpect\(' || true)
[ "$exp_del" -gt 0 ] && warnings+=("測試刪除了 $exp_del 行斷言（新增 $exp_add 行），請確認不是把斷言改弱")
trivial=$(added tests | grep -nE 'expect\(\s*(true|false|1|0|null|undefined|"[^"]*"|'"'"'[^'"'"']*'"'"')\s*\)' || true)
[ -n "$trivial" ] && warnings+=("出現對常數的斷言（永遠成立或失敗）：
\`\`\`
$trivial
\`\`\`")
tsoff=$(added src tests netlify | grep -nE '@ts-(nocheck|ignore|expect-error)|eslint-disable' || true)
[ -n "$tsoff" ] && warnings+=("新增了關閉型別檢查或 lint 的註解：
\`\`\`
$tsoff
\`\`\`")
envsniff=$(added src netlify | grep -nE 'VITEST|import\.meta\.vitest|NODE_ENV\s*[!=]==?\s*["'"'"']test|\bvitest\b' || true)
[ -n "$envsniff" ] && warnings+=("程式碼（非測試）新增了偵測測試環境的判斷，可能讓程式在測試時走不同路徑：
\`\`\`
$envsniff
\`\`\`")
viteconf=$(git diff --name-only "$RANGE" -- 'vite.config.*' 'tsconfig*.json' || true)
[ -n "$viteconf" ] && warnings+=("修改了建置或型別設定：$(echo $viteconf | sed 's/ /、/g')")

# 7. 相依套件變動（不算違規，一定要讓擁有者看到）
deps=$(git diff "$RANGE" -- package.json | grep -E '^[+-]\s+"[^"]+": "[^"]+",?$' | grep -v '"version"' || true)

echo "### 🛡️ 防作弊檢查"
if [ ${#problems[@]} -eq 0 ]; then
  echo "✅ 沒有違規（測試數量：base $base_n → 本 PR $head_n）"
else
  echo "❌ 發現 ${#problems[@]} 個違規，需要擁有者確認："
  for p in "${problems[@]}"; do echo "- $p"; done
fi
if [ ${#warnings[@]} -gt 0 ]; then
  echo; echo "⚠️ ${#warnings[@]} 個注意事項（Claude 必須在完成報告中說明）："
  for w in "${warnings[@]}"; do echo "- $w"; done
fi
if [ -n "$deps" ]; then
  echo; echo "**📦 package.json 相依套件或腳本變動：**"; echo '```diff'; echo "$deps"; echo '```'
fi
[ ${#problems[@]} -gt 0 ] && { echo; echo "_如果這些修改是你明確要求的，看過後仍可自行 Merge。_"; exit 1; }
exit 0
