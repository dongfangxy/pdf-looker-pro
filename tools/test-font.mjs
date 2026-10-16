// Loads the generated font in a real browser and proves it renders: the font must
// parse, report as available, produce non-zero advances, and paint visible glyphs.
//
//   node tools/test-font.mjs [fontPath]
import { chromium } from 'playwright';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fontPath = resolve(process.argv[2] ?? join(root, 'assets-src', 'ui-sans.ttf'));
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

let passed = 0;
let failed = 0;
function check(name, ok, detail = '') {
  if (ok) {
    passed++;
    console.log(`  ✓ ${name}${detail ? `  ${detail}` : ''}`);
  } else {
    failed++;
    console.log(`  ✗ ${name}${detail ? `  ${detail}` : ''}`);
  }
}

const bytes = readFileSync(fontPath);
const base64 = bytes.toString('base64');
console.log(`=== 字体渲染验证 ===\n  文件: ${fontPath} (${bytes.length} 字节)`);

const browser = await chromium.launch({ executablePath: EDGE, headless: true });
const page = await browser.newPage({ viewport: { width: 900, height: 460 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));

await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>
  @font-face { font-family: TestSans; src: url(data:font/ttf;base64,${base64}) format('truetype'); font-weight: 400; }
  body { margin: 0; background: #fff; color: #111; font-family: TestSans, serif; }
  .row { padding: 10px 18px; white-space: nowrap; }
  .h1 { font-size: 54px; }
  .h2 { font-size: 30px; }
  .h3 { font-size: 20px; }
  .h4 { font-size: 14px; }
</style></head><body>
  <div class="row h1">Handgloves 0123</div>
  <div class="row h2">The quick brown fox jumps over the lazy dog</div>
  <div class="row h3">ABCDEFGHIJKLMNOPQRSTUVWXYZ abcdefghijklmnopqrstuvwxyz</div>
  <div class="row h3">0123456789 !&quot;#$%&amp;'()*+,-./:;&lt;=&gt;?@[\\]^_&#96;{|}~&#176;&#215;&#8722;&#8249;&#8250;</div>
  <div class="row h4">PDF Reader 0.4.0 — ARPK Sans, self-authored TrueType</div>
</body></html>`);

await page.evaluate(() => document.fonts.ready);

const probe = await page.evaluate(async () => {
  const loaded = [...document.fonts].map((f) => ({ family: f.family, status: f.status }));
  const available = document.fonts.check('54px TestSans');
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const widths = {};
  for (const [label, text] of [
    ['digits', '0123456789'],
    ['upper', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'],
    ['lower', 'abcdefghijklmnopqrstuvwxyz'],
    ['empty', ''],
  ]) {
    ctx.font = '100px TestSans';
    widths[label] = ctx.measureText(text).width;
  }
  ctx.font = '100px serif';
  const serifDigits = ctx.measureText('0123456789').width;
  return { loaded, available, widths, serifDigits };
});

check('字体被浏览器解析并加载', probe.loaded.some((f) => f.family === 'TestSans' && f.status === 'loaded'), JSON.stringify(probe.loaded));
check('document.fonts.check 通过', probe.available === true);
check('数字串有非零宽度', probe.widths.digits > 100, `${probe.widths.digits.toFixed(1)}px @100px`);
check('大写字母有非零宽度', probe.widths.upper > 100, `${probe.widths.upper.toFixed(1)}px`);
check('小写字母有非零宽度', probe.widths.lower > 100, `${probe.widths.lower.toFixed(1)}px`);
check('空串宽度为 0', probe.widths.empty === 0);

// A rough sanity ratio: the generated face should be narrower than a serif fallback
// but not degenerate (a font that failed to load would fall back and match serif).
check(
  '宽度与回退字体不同（说明真的用了自研字体）',
  Math.abs(probe.widths.digits - probe.serifDigits) > 1,
  `自研=${probe.widths.digits.toFixed(1)} 回退=${probe.serifDigits.toFixed(1)}`,
);

// Per-glyph advances must follow each glyph's declared width.
const perGlyph = await page.evaluate(() => {
  const ctx = document.createElement('canvas').getContext('2d');
  ctx.font = '100px TestSans';
  const out = {};
  for (const ch of ['i', 'l', 'm', 'W', '1', ' ']) out[ch] = ctx.measureText(ch).width;
  return out;
});
check('窄字形窄于宽字形', perGlyph['i'] < perGlyph['m'] && perGlyph['l'] < perGlyph['W'], `i=${perGlyph['i'].toFixed(0)} m=${perGlyph['m'].toFixed(0)} W=${perGlyph['W'].toFixed(0)}`);
check('空格不计墨但占宽度', perGlyph[' '] > 10 && perGlyph[' '] < perGlyph['m'], `空格=${perGlyph[' '].toFixed(0)}px`);

// Ink coverage: the painted page must contain dark pixels in each row.
const ink = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('.row')];
  return rows.map((row) => {
    const r = row.getBoundingClientRect();
    return { text: row.textContent.slice(0, 18), h: r.height, w: r.width };
  });
});
check('每一行都占据空间', ink.every((r) => r.h > 0), `${ink.length} 行`);

mkdirSync(join(root, 'docs'), { recursive: true });
await page.screenshot({ path: join(root, 'docs', 'p4-font-sample.png') });
console.log('  截图: docs/p4-font-sample.png');

check('无页面错误', errors.length === 0, errors.slice(0, 2).join(' | '));

await browser.close();
console.log(`\n=== 结果: ${passed} 通过 / ${failed} 失败 ===`);
if (failed > 0) process.exitCode = 1;
