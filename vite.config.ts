import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { documentUrlMiddleware } from './electron/url-middleware.js';

export default defineConfig({
  base: './',
  plugins: [react(), {
    name: 'swallow-dev-readiness',
    configureServer(server) {
      server.middlewares.use(documentUrlMiddleware());
      const nonce = process.env.SWALLOW_DEV_TOKEN;
      if (!nonce) return;
      server.middlewares.use((request, response, next) => {
        if (request.url !== '/__swallow-ready') { next(); return; }
        response.setHeader('Content-Type', 'text/plain');
        response.end(`swallow-ready:${nonce}`);
      });
    },
  }],
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
});
