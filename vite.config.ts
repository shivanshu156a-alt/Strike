import { defineConfig } from 'vite';

export default defineConfig({
  server: { host: '0.0.0.0' },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/three/')) return 'three-vendor';
        },
      },
    },
  },
});
