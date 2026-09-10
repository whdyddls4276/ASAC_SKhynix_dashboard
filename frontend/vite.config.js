import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  publicDir: 'public',
  server: {
    hmr: false,
    proxy: {
      // RAG 도메인 Q&A는 backend(8000)로 흡수됨 — 별도 assistant 서버(8002) 불필요
      '/chat/assistant': { target: 'http://localhost:8000', changeOrigin: true },
      '/chat':           { target: 'http://localhost:8000', changeOrigin: true },
      '/report':         { target: 'http://localhost:8000', changeOrigin: true },
      '/health':         { target: 'http://localhost:8000', changeOrigin: true },
      '/candidate-units': { target: 'http://localhost:8000', changeOrigin: true },
      // 데이터 파일(.csv/.json, 하위폴더 포함) → 백엔드 /api/data/ 로 전달
      '^/.*\\.(csv|json)$': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        rewrite: (path) => `/api/data${path}`,
      },
    },
  },
})
