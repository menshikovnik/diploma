import fs from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: '0.0.0.0',
    https: {
      cert: fs.readFileSync(new URL('./certs/dev-cert.pem', import.meta.url)),
      key: fs.readFileSync(new URL('./certs/dev-key.pem', import.meta.url)),
    },
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
});
