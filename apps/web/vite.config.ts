import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    // REST 與 SSE 都走同源的 /api,由 dev server 轉給後端,cookie 才不會跨站
    proxy: { '/api': { target: 'http://localhost:8787', changeOrigin: false } },
  },
});
