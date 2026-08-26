import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { fileURLToPath } from 'node:url';

// 'three' is a real npm dependency (package.json) with exports for
// './examples/jsm/*' and './addons/*', so it resolves locally with no
// alias needed. 'mind-ar-three' isn't a published package (the CDN build
// only ships a dist bundle under the 'mind-ar' name) — aliased to a local
// vendored copy instead of the jsdelivr CDN, which some networks block
// (that CDN dependency was breaking module loading for both AR engines).
const mindArThreePath = fileURLToPath(
  new URL('./public/vendor/mind-ar/mindar-image-three.prod.js', import.meta.url)
);

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
      'mind-ar-three': mindArThreePath
    }
  },
  build: {
    target: 'esnext'
  }
});
