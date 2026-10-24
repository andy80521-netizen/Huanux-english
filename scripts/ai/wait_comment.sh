#!/usr/bin/env bash
# 等待 issue / PR 出現含有指定標記的新留言，印出留言內容。
# 用法：bash scripts/ai/wait_comment.sh <issue或PR編號> <標記文字> [逾時分鐘=25] [只看此時間之後的留言 ISO8601]
# 例：  bash scripts/ai/wait_comment.sh 12 "<!-- ai-council:plan -->"
#       bash scripts/ai/wait_comment.sh 15 "<!-- ai-pr:sha=$(git rev-parse HEAD) -->"
# 只用 REST API（Claude 工作環境不支援 GitHub GraphQL 與 Actions API）。
# ⚠️ AI 不得修改此檔（見 CLAUDE.md）。
set -euo pipefail

N="$1"; MARK="$2"; TIMEOUT_MIN="${3:-25}"; SINCE="${4:-1970-01-01T00:00:00Z}"
REPO="${GITHUB_REPO:-andy80521-netizen/huanux-english}"
deadline=$(( $(date +%s) + TIMEOUT_MIN * 60 ))

while :; do
  body=$(gh api --paginate "repos/$REPO/issues/$N/comments?per_page=100" \
    --jq "[.[] | select(.created_at >= \"$SINCE\") | select(.body | contains(\"$MARK\"))] | last | .body // empty" 2>/dev/null | tail -c 70000 || true)
  if [ -n "$body" ]; then
    printf '%s\n' "$body"
    exit 0
  fi
  # 委員會失敗時會留下 error 標記
  err=$(gh api --paginate "repos/$REPO/issues/$N/comments?per_page=100" \
    --jq "[.[] | select(.created_at >= \"$SINCE\") | select(.body | contains(\"<!-- ai-council:error -->\"))] | last | .body // empty" 2>/dev/null || true)
  if [ -n "$err" ]; then
    printf '%s\n' "$err"
    exit 2
  fi
  if [ "$(date +%s)" -ge "$deadline" ]; then
    echo "逾時：$TIMEOUT_MIN 分鐘內沒有等到「$MARK」" >&2
    exit 1
  fi
  sleep 30
done
