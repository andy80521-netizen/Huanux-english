#!/usr/bin/env bash
# 離線驗證：型別檢查 → 單元測試 → build。不需網路、不需金鑰。
# Claude 本機循環與 GitHub Actions 都跑同一支，全部通過才算成功（exit 0）。
# ⚠️ AI 不得修改此檔（見 CLAUDE.md）。
set -euo pipefail

echo "== 1/3 型別檢查 =="
npx tsc --noEmit

echo "== 2/3 單元測試 =="
npx vitest run

echo "== 3/3 Build =="
npx vite build --logLevel warn

echo "✅ 全部通過"
