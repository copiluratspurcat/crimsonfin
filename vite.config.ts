import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// `npm run dev` proxies to a local gateway by default. To try the UI against a
// remote gateway, set CRIMSONFIN_GATEWAY (e.g. https://device.tailnet.ts.net:8443).
// The gateway only accepts mutations from its own origin, so the dev proxy
// presents that origin; sign in through the dev page as usual.
const gateway = process.env.CRIMSONFIN_GATEWAY || 'http://127.0.0.1:8099';
const proxy = {
  target: gateway, changeOrigin: true, secure: true,
  configure: (server: any) => server.on('proxyReq', (req: any) => {
    if (req.getHeader('origin')) req.setHeader('origin', new URL(gateway).origin);
  })
};

export default defineConfig({
  plugins: [react()],
  root: 'web',
  // The player chunk is ~620 kB, almost all hls.js; it loads on demand, so allow it without a warning.
  build: { outDir: '../dist', emptyOutDir: true, sourcemap: false, chunkSizeWarningLimit: 700 },
  server: {
    port: 5173,
    proxy: { '/api': proxy, '/jellyfin': proxy }
  }
});
