// Verifies the document-level creation paths: a blank document, a document from an image,
// and page reordering.
//
//   node tools/e2e-newdoc.mjs [baseUrl]
import { chromium } from 'playwright';
import { crc32, deflateSync } from 'node:zlib';

const BASE = process.argv[2] ?? 'http://127.0.0.1:4173';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

const CMD = { blank: 1250, image: 1251, reorder: 1252 };

let passed = 0;
let failed = 0;
const failures = [];
function check(name, ok, detail = '') {
  if (ok) {
    passed++;
    console.log(`  ✓ ${name}${detail ? `  ${detail}` : ''}`);
  } else {
    failed++;
    failures.push(name);
    console.log(`  ✗ ${name}${detail ? `  ${detail}` : ''}`);
  }
}

/** A solid-colour PNG, so the image path is exercised with a real decodable file. */
function makePng(width, height, rgb) {
  const chunk = (type, data) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([length, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 3 + 1);
    raw[row] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      raw[row + 1 + x * 3] = rgb[0];
      raw[row + 2 + x * 3] = rgb[1];
      raw[row + 3 + x * 3] = rgb[2];
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const browser = await chromium.launch({ executablePath: EDGE, headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));
const consoleErrors = [];
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text());
});

const menuOpen = () =>
  page.evaluate(() => {
    const menu = document.querySelector('#overflow-menu');
    return !!menu && !menu.classList.contains('hidden');
  });

/** Opens the overflow menu if it is not already open, then runs a command. */
async function openCommand(operation) {
  if (!(await menuOpen())) {
    await page.click('#btn-more');
    await page.waitForTimeout(350);
  }
  await page.click(`.more-run[data-command="${CMD[operation]}"]`);
  await page.waitForTimeout(450);
}

const parsed = () =>
  page.evaluate(async () => {
    const info = await window.__pdfDebug();
    return {
      pages: info.pages?.length ?? 0,
      boxes: (info.pages ?? []).map((p) => p.box),
      error: info.pageError ?? null,
    };
  });

await page.goto(`${BASE}/?file=./fixtures/test.pdf&debug=p5`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('.page:not(.unrendered)').length > 0, { timeout: 30000 });
await page.waitForTimeout(800);

console.log('\n=== 1. 三个命令都在「更多」里 ===');
{
  if (!(await menuOpen())) {
    await page.click('#btn-more');
    await page.waitForTimeout(350);
  }
  const found = await page.evaluate(
    (ids) => ids.map((id) => document.querySelectorAll(`.more-run[data-command="${id}"]`).length),
    Object.values(CMD),
  );
  check('新建/从图像/重排 三条命令可达', found.every((n) => n === 1), JSON.stringify(found));
  if (await menuOpen()) {
    await page.click('#btn-more');
    await page.waitForTimeout(250);
  }
}

console.log('\n=== 2. 新建空白文档 ===');
{
  await openCommand('blank');
  check('打开页数对话框', (await page.locator('.modal-narrow').count()) === 1);
  await page.fill('.modal-narrow input', '4');
  await page.press('.modal-narrow input', 'Enter');
  await page.waitForTimeout(2500);

  check('新文档有 4 页', (await page.evaluate(() => window.__viewer.pageCount)) === 4, `${await page.evaluate(() => window.__viewer.pageCount)}`);
  const state = await parsed();
  check('解析器也读到 4 页', state.pages === 4, `${state.pages}`);
  check('页面尺寸为 Letter', state.boxes[0].join(',') === '0,0,595,842', state.boxes[0].join(','));
  check('标题是未命名', (await page.evaluate(() => document.querySelector('.doc-tab.active .doc-tab-label')?.textContent ?? '')).includes('未命名'));

  // A blank page must actually be blank: rendering it should find no ink.
  const canvasInk = await page.evaluate(() => {
    const canvas = document.querySelector('.page:not(.unrendered) canvas');
    if (!canvas) return null;
    const ctx = canvas.getContext('2d');
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let nonWhite = 0;
    for (let i = 0; i < data.length; i += 4 * 61) if (data[i] < 250) nonWhite++;
    return nonWhite;
  });
  check('新页渲染后是空白', canvasInk === 0, `非白采样=${canvasInk}`);
}

console.log('\n=== 3. 从图像创建 ===');
{
  const png = makePng(40, 20, [220, 60, 40]);
  const chooser = page.waitForEvent('filechooser', { timeout: 10000 });
  await openCommand('image');
  const fileChooser = await chooser;
  await fileChooser.setFiles({ name: 'swatch.png', mimeType: 'image/png', buffer: png });
  await page.waitForTimeout(3000);

  check('得到一个单页文档', (await page.evaluate(() => window.__viewer.pageCount)) === 1, `${await page.evaluate(() => window.__viewer.pageCount)}`);
  const state = await parsed();
  check('页数与图像比例一致', state.boxes[0][2] === 40 && state.boxes[0][3] === 20, state.boxes[0].join(','));
  check('标题取自文件名', (await page.evaluate(() => document.querySelector('.doc-tab.active .doc-tab-label')?.textContent ?? '')).includes('swatch'));

  // The image must be drawn, and drawn in its own colour.
  const pixels = await page.evaluate(() => {
    const canvas = document.querySelector('.page:not(.unrendered) canvas');
    if (!canvas) return null;
    const ctx = canvas.getContext('2d');
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let nonWhite = 0;
    let sample = null;
    for (let i = 0; i < data.length; i += 4 * 37) {
      if (data[i] < 250) nonWhite++;
      if (sample === null && data[i] < 250) sample = [data[i], data[i + 1], data[i + 2]];
    }
    return { nonWhite, sample };
  });
  check('页面上画出了图像', (pixels?.nonWhite ?? 0) > 5, `非白采样=${pixels?.nonWhite}`);
  check('颜色接近原图', (pixels?.sample?.[0] ?? 0) > 150 && (pixels?.sample?.[1] ?? 255) < 140, JSON.stringify(pixels?.sample));
}

console.log('\n=== 4. 页面重排 ===');
{
  // Back to the fixture, whose pages are self-labelled "Page N".
  await page.evaluate(() => {
    [...document.querySelectorAll('.doc-tab')]
      .find((tab) => (tab.textContent ?? '').includes('Test Fixture'))
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await page.waitForTimeout(1800);
  check('回到测试文档', (await page.evaluate(() => window.__viewer.pageCount)) === 24, `${await page.evaluate(() => window.__viewer.pageCount)}`);

  await openCommand('reorder');
  check('打开重排对话框', (await page.locator('.modal-narrow').count()) === 1);
  const order = [3, 1, 2, ...Array.from({ length: 21 }, (_, i) => i + 4)];
  await page.fill('.modal-narrow input', order.join(','));
  await page.press('.modal-narrow input', 'Enter');
  await page.waitForTimeout(4000);

  check('页数不变', (await page.evaluate(() => window.__viewer.pageCount)) === 24, `${await page.evaluate(() => window.__viewer.pageCount)}`);

  // Read the text of the first three pages back through an independent parser.
  const texts = await page.evaluate(async () => {
    const bytes = await window.__writePdf();
    const summary = await window.__pdfSummary(bytes);
    return summary.pages.slice(0, 3).map((p) => p.text.slice(0, 6));
  });
  check('第 1 页变成原来的第 3 页', texts[0].startsWith('Page 3'), texts[0]);
  check('第 2 页是原来的第 1 页', texts[1].startsWith('Page 1'), texts[1]);
  check('第 3 页是原来的第 2 页', texts[2].startsWith('Page 2'), texts[2]);
}

console.log('\n=== 5. 重排时页数不匹配会被拒绝 ===');
{
  await openCommand('reorder');
  await page.fill('.modal-narrow input', '1,2');
  await page.press('.modal-narrow input', 'Enter');
  await page.waitForTimeout(1200);
  const status = await page.evaluate(() => document.querySelector('#status-text').textContent);
  check('页数不足时给出提示', /填写了 2 页/.test(status), status);
  check('文档未被改动', (await page.evaluate(() => window.__viewer.pageCount)) === 24);
}

console.log('\n=== 6. 错误检查 ===');
check('无未捕获页面错误', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));
check('无控制台错误', consoleErrors.length === 0, consoleErrors.slice(0, 2).join(' | '));

await browser.close();
console.log(`\n=== 结果: ${passed} 通过 / ${failed} 失败 ===`);
if (failed > 0) {
  console.log('失败项:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exitCode = 1;
}
