import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig({
  plugins: [
    viteSingleFile() // Inlines ALL JS/CSS directly into index.html
  ],
  server: {
    host: '0.0.0.0',
    port: 3002, // run on 3002 directly
    allowedHosts: true
  },
  resolve: {
    alias: {
      'three': 'https://cdn.jsdelivr.net/npm/three@0.149.0/build/three.module.js',
      'three/examples/jsm/loaders/GLTFLoader.js': 'https://cdn.jsdelivr.net/npm/three@0.149.0/examples/jsm/loaders/GLTFLoader.js',
      'three/addons/renderers/CSS3DRenderer.js': 'https://cdn.jsdelivr.net/npm/three@0.149.0/examples/jsm/renderers/CSS3DRenderer.js',
      'mind-ar-three': 'https://cdn.jsdelivr.net/npm/mind-ar@1.2.5/dist/mindar-image-three.prod.js'
    }
  },
  optimizeDeps: {
    exclude: ['mind-ar', 'three']
  },
  build: {
    target: 'esnext',
    rollupOptions: {
      external: [
        'three',
        'three/examples/jsm/loaders/GLTFLoader.js',
        'three/addons/renderers/CSS3DRenderer.js',
        'mind-ar-three'
      ]
    }
  }
});
