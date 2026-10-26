// ⚠️ 受保護檔案（見 CLAUDE.md）：測試範圍以這份設定為準。
// Vitest 會優先採用 vitest.config.ts，因此 vite.config.ts 裡的 test 設定（例如 exclude）不會生效，
// 避免透過修改 vite.config.ts 悄悄排除測試。
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    passWithNoTests: false,
  },
});
