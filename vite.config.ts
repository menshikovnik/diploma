import fs from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      {
        find: /^@mediapipe\/face_mesh$/,
        replacement: path.resolve(__dirname, 'src/shims/mediapipe-face-mesh.js'),
      },
    ],
  },
  server: {
    port: 5173,
    host: '0.0.0.0',
    watch: {
      ignored: ['**/backend/.venv/**', '**/backend/data/**', '**/backend/models/**'],
    },
    https: {
      cert: fs.readFileSync('./certs/dev-cert.pem'),
      key: fs.readFileSync('./certs/dev-key.pem'),
    },
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
});
