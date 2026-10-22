import { defineConfig } from 'vite';

// The dashboard is built into out/web, which the hook receiver serves. In `npm run dev`, /api goes to a receiver on 47821.
export default defineConfig({
  root: 'src/renderer',
  publicDir: '../../public',
  build: { outDir: '../../out/web', emptyOutDir: true, target: 'es2023' },
  server: { port: 5173, proxy: { '/api': 'http://127.0.0.1:47821' } },
});
