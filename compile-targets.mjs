import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { createCanvas, loadImage } from 'canvas';
import { Compiler } from 'mind-ar/src/image-target/compiler.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function compile() {
  const compiler = new Compiler();
  
  const imgPath = path.join(__dirname, 'public', 'assets', 'card.png');
  console.log('Loading image from:', imgPath);
  
  const img = await loadImage(imgPath);
  const canvas = createCanvas(img.width, img.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);
  
  console.log('Compiling image targets...');
  await compiler.compileImageTargets([canvas], (progress) => {
    process.stdout.write(`\rProgress: ${Math.round(progress * 100)}%`);
  });
  
  const buffer = await compiler.exportData();
  const outPath = path.join(__dirname, 'public', 'assets', 'targets.mind');
  fs.writeFileSync(outPath, Buffer.from(buffer));
  console.log(`\ntargets.mind compiled! Size: ${buffer.byteLength} bytes -> ${outPath}`);
}

compile().catch(err => {
  console.error('Compilation failed:', err);
  process.exit(1);
});
