import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// `npm run dev` talks to a running tnc-server (cargo run in server/): the API, the AI proxy and
// the simulator page at /sim/ all come from it, so the iframe bridge stays same-origin.
const SERVER = process.env.TNC_SERVER ?? 'http://127.0.0.1:8426';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5426,
    proxy: {
      '/api': { target: SERVER, changeOrigin: false },
      '/sim': { target: SERVER, changeOrigin: false },
    },
  },
  build: { outDir: 'dist', sourcemap: true },
});
