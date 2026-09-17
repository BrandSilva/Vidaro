import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const DEV_CSP =
  "default-src 'self'; img-src 'self' https: data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self' ws://localhost:5173";

function devContentSecurityPolicy() {
  return {
    name: 'vidaro-dev-csp',
    apply: 'serve',
    transformIndexHtml(html) {
      return html.replace(/content="default-src[^"]*"/, `content="${DEV_CSP}"`);
    }
  };
}

export default defineConfig({
  base: './',
  publicDir: false,
  plugins: [react(), devContentSecurityPolicy()],
  server: {
    host: 'localhost',
    port: 5173,
    strictPort: true
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
    reportCompressedSize: false,
    chunkSizeWarningLimit: 2000
  }
});
