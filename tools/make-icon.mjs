// Generates the application icon: rasterises an icon drawn here at the sizes
// Windows asks for, then assembles them into a multi-resolution .ico.
//
//   node tools/make-icon.mjs [out.ico]
//
// The artwork is authored in this file; nothing is taken from a third party. SVG is
// rasterised by the browser that is already used for verification, so no image
// library is needed.
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outPath = resolve(process.argv[2] ?? join(root, 'build', 'icon.ico'));
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

/** Sizes Windows picks from a single .ico. 256 is stored as a PNG entry. */
const SIZES = [16, 24, 32, 48, 64, 128, 256];

/**
 * The icon: a rounded tile, a page with a folded corner, and a bookmark ribbon.
 * Drawn at 256x256 so every smaller size downsamples cleanly.
 */
const ICON_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256">
  <defs>
    <linearGradient id="tile" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#4f8cf7"/>
      <stop offset="1" stop-color="#2f6bd8"/>
    </linearGradient>
  </defs>
  <rect x="8" y="8" width="240" height="240" rx="52" fill="url(#tile)"/>
  <path d="M72 44h78l44 44v112a20 20 0 0 1-20 20H72a20 20 0 0 1-20-20V64a20 20 0 0 1 20-20z"
        fill="#ffffff"/>
  <path d="M150 44l44 44h-32a12 12 0 0 1-12-12z" fill="#c9dcff"/>
  <rect x="80" y="118" width="82" height="11" rx="5.5" fill="#9fb6d8"/>
  <rect x="80" y="142" width="96" height="11" rx="5.5" fill="#9fb6d8"/>
  <rect x="80" y="166" width="64" height="11" rx="5.5" fill="#9fb6d8"/>
  <path d="M96 78h34v62l-17-14-17 14z" fill="#e0342f"/>
</svg>`;

const browser = await chromium.launch({ executablePath: EDGE, headless: true });
const page = await browser.newPage({ viewport: { width: 256, height: 256 }, deviceScaleFactor: 1 });
await page.setContent(
  `<!doctype html><html><head><meta charset="utf-8"><style>
     html,body{margin:0;padding:0;background:transparent}
     #icon{width:256px;height:256px;display:block}
   </style></head><body><div id="icon">${ICON_SVG}</div></body></html>`,
);
await page.waitForTimeout(200);

const images = [];
for (const size of SIZES) {
  await page.setViewportSize({ width: size, height: size });
  await page.evaluate((s) => {
    const el = document.getElementById('icon');
    el.style.width = `${s}px`;
    el.style.height = `${s}px`;
    const svg = el.querySelector('svg');
    if (svg) {
      svg.setAttribute('width', String(s));
      svg.setAttribute('height', String(s));
    }
  }, size);
  await page.waitForTimeout(60);
  const data = await page.locator('#icon').screenshot({ omitBackground: true, type: 'png' });
  images.push({ size, data });
}
await browser.close();

// ---- ICO assembly ----
// ICONDIR (6 bytes) + ICONDIRENTRY (16 bytes each) + image payloads. Since Vista
// every entry may be a PNG, which is what is stored here.
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // type: icon
header.writeUInt16LE(images.length, 4);

let offset = 6 + images.length * 16;
const entries = [];
for (const image of images) {
  const entry = Buffer.alloc(16);
  // A dimension of 256 is encoded as 0.
  entry.writeUInt8(image.size >= 256 ? 0 : image.size, 0);
  entry.writeUInt8(image.size >= 256 ? 0 : image.size, 1);
  entry.writeUInt8(0, 2); // palette size
  entry.writeUInt8(0, 3); // reserved
  entry.writeUInt16LE(1, 4); // colour planes
  entry.writeUInt16LE(32, 6); // bits per pixel
  entry.writeUInt32LE(image.data.length, 8);
  entry.writeUInt32LE(offset, 12);
  offset += image.data.length;
  entries.push(entry);
}

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, Buffer.concat([header, ...entries, ...images.map((i) => i.data)]));

// ---- report ----
console.log(`已生成: ${outPath}`);
console.log(`  尺寸   : ${SIZES.join(', ')}`);
console.log(`  条目   : ${images.length}`);
for (const image of images) console.log(`    ${String(image.size).padStart(3)}px  ${String(image.data.length).padStart(6)} 字节`);
console.log(`  总计   : ${offset} 字节`);
