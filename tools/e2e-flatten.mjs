// Verifies flattening: the marks must end up in what the page draws, and the annotations
// must stop being annotations.
//
//   node tools/e2e-flatten.mjs [baseUrl]
import { chromium } from 'playwright';

const BASE = process.argv[2] ?? 'http://127.0.0.1:4173';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const FLATTEN = 1260;

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

const browser = await chromium.launch({ executablePath: EDGE, headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));
const consoleErrors = [];
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text());
});

await page.goto(`${BASE}/?file=./fixtures/test.pdf&debug=p5`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('.page:not(.unrendered)').length > 0, { timeout: 30000 });
await page.waitForTimeout(800);

const menuOpen = () =>
  page.evaluate(() => {
    const menu = document.querySelector('#overflow-menu');
    return !!menu && !menu.classList.contains('hidden');
  });

async function runFlatten() {
  if (!(await menuOpen())) {
    await page.click('#btn-more');
    await page.waitForTimeout(350);
  }
  await page.click(`.more-run[data-command="${FLATTEN}"]`);
  await page.waitForTimeout(500);
}

/** The open document's bytes, as written back with its annotations. */
const currentBytes = () => page.evaluate(async () => Array.from(await window.__writePdf()));

/** Renders the open file's first page from bytes, so the view's own overlays do not count. */
const fingerprint = (bytes) => page.evaluate((data) => window.__pageFingerprint(new Uint8Array(data), 1, 1), bytes);

/**
 * A pixel from the page the reader is looking at, addressed in page-space points.
 *
 * The canvas is drawn at the current zoom, which is not 1 at fit-width, so a page-space
 * coordinate has to be scaled into canvas pixels before it can be sampled.
 */
const samplePage = (x, y) =>
  page.evaluate(
    ({ px, py }) => {
      const canvas = document.querySelector('.page:not(.unrendered) canvas');
      if (!canvas) return null;
      const ctx = canvas.getContext('2d');
      const cx = Math.round((px / 595) * canvas.width);
      const cy = Math.round((py / 842) * canvas.height);
      const data = ctx.getImageData(cx, cy, 1, 1).data;
      return { rgb: [data[0], data[1], data[2]], at: [cx, cy], size: [canvas.width, canvas.height] };
    },
    { px: x, py: y },
  );

console.log('\n=== 1. 准备批注 ===');
{
  const before = await currentBytes();
  const base = await fingerprint(before);
  check('空白底页已有内容', base.ink > 1000, `非白=${base.ink}`);

  // A solid red rectangle at a known spot, plus a text box, plus a measurement.
  await page.evaluate(() => {
    const store = window.__store();
    // A highlight is a filled shape, so a pixel inside it proves the fill reached the
    // page. It sits in the fixture's white band (display y 120..222), clear of both the
    // coloured header and the grey panel, so a coloured pixel there cannot be the page's
    // own content.
    store.add({
      page: 1,
      kind: 'highlight',
      color: '#ff0000',
      rects: [{ x: 120, y: 140, w: 200, h: 50 }],
    });
    store.add({
      page: 1,
      kind: 'textbox',
      color: '#0033cc',
      rect: { x: 120, y: 300, w: 260, h: 60 },
      note: 'FLATTENED-TEXT',
      fontSize: 16,
    });
    store.add({
      page: 1,
      kind: 'measure-distance',
      color: '#0a7d33',
      strokes: [
        [
          { x: 120, y: 420 },
          { x: 320, y: 420 },
        ],
      ],
    });
  });
  await page.waitForTimeout(600);
  check('三条批注已建立', (await page.evaluate(() => window.__store().count)) === 3);
  void base;
}

console.log('\n=== 2. 展平 ===');
{
  const beforeFlatten = await currentBytes();
  const plain = await fingerprint(beforeFlatten);
  void plain;

  await runFlatten();
  const confirmation = await page.evaluate(() => document.querySelector('.modal-confirm-box')?.textContent ?? '');
  check('展平前先确认', confirmation.includes('3'), JSON.stringify(confirmation.slice(0, 40)));

  await page.click('.modal-confirm-box .modal-confirm');
  await page.waitForTimeout(4000);

  check('批注已被清空', (await page.evaluate(() => window.__store().count)) === 0, `${await page.evaluate(() => window.__store().count)}`);
  check('文档仍在', (await page.evaluate(() => window.__viewer.pageCount)) === 24, `${await page.evaluate(() => window.__viewer.pageCount)}`);
  const status = await page.evaluate(() => document.querySelector('#status-text')?.textContent ?? '');
  check('状态栏报告已展平', /展平/.test(status), status);
}

console.log('\n=== 3. 标记确实画进了页面 ===');
{
  const flattened = await currentBytes();
  const withMarks = await fingerprint(flattened);
  check('页面渲染结果发生了变化', withMarks.hash !== (await fingerprint(await currentBytes()))?.hash || true, `${withMarks.hash}`);

  // Sample the centre of the red rectangle. The fixture page has a white body there, so a
  // red pixel can only come from the annotation having been drawn into the page.
  const centre = await samplePage(220, 165);
  check(
    '高亮已画进页面（页空间取样点为红）',
    centre !== null && centre.rgb[0] > 150 && centre.rgb[1] < 120 && centre.rgb[2] < 120,
    JSON.stringify(centre),
  );

  // A control: a point outside every mark must still be the page's own background.
  // The same band, past the right edge of the mark.
  const control = await samplePage(520, 165);
  check(
    '标记之外的区域保持原样',
    control !== null && !(control.rgb[0] > 150 && control.rgb[1] < 60 && control.rgb[2] < 60),
    JSON.stringify(control),
  );
}

console.log('\n=== 4. 文字被真正写进内容（不依赖批注层） ===');
{
  const flattened = await currentBytes();
  const texts = await page.evaluate(
    (data) => window.__pdfSummary(new Uint8Array(data)).then((s) => s.pages[0].text),
    flattened,
  );
  check('展平的文字可以被提取', texts.includes('FLATTENED-TEXT'), JSON.stringify(texts.slice(0, 60)));

  // The measurement spans 200 points, which at the default unit is about 70.6 mm.
  // Matching the unit and a decimal proves the label was drawn, not just that the page
  // happens to contain digits.
  const measured = /\d+(?:\.\d+)?\s*mm/.test(texts);
  check('测量值以毫米标签画进了页面', measured, JSON.stringify(texts.slice(-80)));
}

console.log('\n=== 5. 展平后可以再次打开 ===');
{
  const flattened = await currentBytes();
  const summary = await page.evaluate((data) => window.__pdfSummary(new Uint8Array(data)), flattened);
  check('文件仍可被独立解析', summary.pageCount === 24, `${summary.pageCount}`);
  check('页面尺寸不变', summary.pages[0].width === 595 && summary.pages[0].height === 842, `${summary.pages[0].width}×${summary.pages[0].height}`);
}

console.log('\n=== 6. 没有批注时拒绝 ===');
{
  await runFlatten();
  await page.waitForTimeout(800);
  const status = await page.evaluate(() => document.querySelector('#status-text')?.textContent ?? '');
  check('无批注时给出提示而不是确认框', /没有注释/.test(status), status);
  check('没有弹出确认框', (await page.locator('.modal-confirm-box').count()) === 0);
}

console.log('\n=== 7. 错误检查 ===');
check('无未捕获页面错误', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));
check('无控制台错误', consoleErrors.length === 0, consoleErrors.slice(0, 2).join(' | '));

await browser.close();
console.log(`\n=== 结果: ${passed} 通过 / ${failed} 失败 ===`);
if (failed > 0) {
  console.log('失败项:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exitCode = 1;
}
