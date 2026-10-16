import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
    // pdf.js ships a large worker; keep it as a separate chunk instead of inlining.
    chunkSizeWarningLimit: 2000,
  },
  server: {
    // Bind IPv4 loopback explicitly: Node resolves `localhost` to ::1 first on
    // Windows, which makes 127.0.0.1 unreachable for scripted/headless checks.
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
  },
  preview: {
    host: '127.0.0.1',
    port: 4173,
    strictPort: true,
  },
});
