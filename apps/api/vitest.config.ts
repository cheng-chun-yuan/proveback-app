import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // contract 套件直接匯出 TS 原始碼,要交給 vite 轉譯
    server: { deps: { inline: ['@proveback/contract'] } },
  },
});
