import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  publicDir: 'node_modules/three/examples/jsm/libs/draco/gltf',
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
