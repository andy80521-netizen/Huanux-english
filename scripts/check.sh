#!/usr/bin/env bash
# 離線驗證：型別檢查 → 單元測試 → build。不需網路、不需金鑰。
# Claude 本機循環與 GitHub Actions 都跑同一支，全部通過才算成功（exit 0）。
# ⚠️ AI 不得修改此檔（見 CLAUDE.md）。
set -euo pipefail

echo "== 1/3 型別檢查 =="
npx tsc --noEmit

echo "== 2/3 單元測試 =="
# 明確指定受保護的 vitest.config.ts；任何被跳過（skip/skipIf/runIf）或 todo 的測試都視為失敗
LOG=$(mktemp)
npx vitest run --config vitest.config.ts 2>&1 | tee "$LOG"
SUMMARY=$(grep -E '^\s*Tests\s' "$LOG" | tail -1 || true)
if [ -z "$SUMMARY" ]; then
  echo "❌ 找不到測試結果摘要（測試可能被中途結束），不算通過"
  exit 1
fi
if echo "$SUMMARY" | grep -qE '\b(skipped|todo)\b'; then
  echo "❌ 有測試被跳過或標記為 todo，不算通過"
  exit 1
fi
# 實際執行的測試數不可少於檔案中宣告的數量（防止用 if 條件讓測試不被註冊）
TEST_PAT="\\b(it|test)(\\.each\\([^)]*\\))?\\(\\s*[\"'\`]"
DECLARED=$(grep -rhoE "$TEST_PAT" tests | wc -l | tr -d ' ')
EXECUTED=$(echo "$SUMMARY" | grep -oE '[0-9]+ passed' | grep -oE '[0-9]+' || echo 0)
if [ "$EXECUTED" -lt "$DECLARED" ]; then
  echo "❌ 實際執行 $EXECUTED 個測試，少於檔案中宣告的 $DECLARED 個，不算通過"
  exit 1
fi

echo "== 3/3 Build =="
npx vite build --logLevel warn

echo "✅ 全部通過"
