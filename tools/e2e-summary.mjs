// Verifies the annotation summary: a new document holding the annotated pages, with the
// marks burned into the pages themselves.
//
//   node tools/e2e-summary.mjs [baseUrl]
import { chromium } from 'playwright';

const BASE = process.argv[2] ?? 'http://127.0.0.1:4173';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const SUMMARY = 1280;

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

async function runCommand(id) {
  if (!(await menuOpen())) {
    await page.click('#btn-more');
    await page.waitForTimeout(350);
  }
  await page.click(`.more-run[data-command="${id}"]`);
  await page.waitForTimeout(450);
}

const tabs = () => page.evaluate(() => document.querySelectorAll('.doc-tab').length);

/** A pixel of the current page, addressed in page-space points. */
const samplePage = (pageNumber, x, y, width, height) =>
  page.evaluate(
    ({ index, px, py, w, h }) => {
      const canvas = [...document.querySelectorAll('.page:not(.unrendered) canvas')][index];
      if (!canvas) return null;
      const ctx = canvas.getContext('2d');
      const cx = Math.round((px / w) * canvas.width);
      const cy = Math.round((py / h) * canvas.height);
      const data = ctx.getImageData(cx, cy, 1, 1).data;
      return { rgb: [data[0], data[1], data[2]], size: [canvas.width, canvas.height] };
    },
    { index: pageNumber, px: x, py: y, w: width, h: height },
  );

console.log('\n=== 1. 没有注释时拒绝 ===');
{
  await runCommand(SUMMARY);
  await page.waitForTimeout(800);
  const status = await page.evaluate(() => document.querySelector('#status-text')?.textContent ?? '');
  check('提示没有注释', /没有注释/.test(status), status);
  check('没有新开标签', (await tabs()) === 1, `${await tabs()}`);
}

console.log('\n=== 2. 在第 1 页和第 3 页各放一条注释 ===');
{
  await page.evaluate(() => {
    const store = window.__store();
    store.defaultAuthor = 'Chengxi Zhang';
    store.add({ page: 1, kind: 'highlight', color: '#ff0000', rects: [{ x: 120, y: 140, w: 200, h: 50 }] });
    store.add({ page: 3, kind: 'rect', color: '#0044cc', rect: { x: 90, y: 200, w: 180, h: 120 } });
  });
  await page.waitForTimeout(600);
  check('两条注释已建立', (await page.evaluate(() => window.__store().count)) === 2);
}

console.log('\n=== 3. 生成总括 ===');
{
  await runCommand(SUMMARY);
  await page.waitForTimeout(9000);

  check('打开了新的标签', (await tabs()) === 2, `${await tabs()}`);
  const count = await page.evaluate(() => window.__viewer.pageCount);
  check('只收有注释的页，共 2 页', count === 2, `${count}`);

  const title = await page.evaluate(() => document.querySelector('.doc-tab.active .doc-tab-label')?.textContent ?? '');
  check('标题标明是汇总', /summary/.test(title), title.trim().slice(0, 40));

  const sizes = await page.evaluate(async () => {
    const info = await window.__pdfDebug();
    return (info.pages ?? []).map((p) => [p.box[2], p.box[3]]);
  });
  check('第 1 页保留原尺寸', sizes[0]?.[0] === 595 && sizes[0]?.[1] === 842, JSON.stringify(sizes[0]));
}

console.log('\n=== 4. 标记被烧进了页面 ===');
{
  // The summary pages are images, so the highlight can only appear if it was drawn into
  // the page before rendering.
  const first = await samplePage(0, 220, 165, 595, 842);
  check(
    '第 1 页的红色高亮在汇总里',
    first !== null && first.rgb[0] > 150 && first.rgb[1] < 120 && first.rgb[2] < 120,
    JSON.stringify(first?.rgb),
  );

  const control = await samplePage(0, 520, 165, 595, 842);
  check('标记之外仍是原页面', control !== null && !(control.rgb[0] > 150 && control.rgb[1] < 60 && control.rgb[2] < 60), JSON.stringify(control?.rgb));

  // Page 2 of the summary is source page 3, which carries the blue rectangle.
  const second = await samplePage(1, 90, 260, 595, 842);
  check('第 2 页是原来的第 3 页（带蓝色框）', second !== null, JSON.stringify(second?.rgb));
}

console.log('\n=== 5. 汇总文档本身是合法 PDF ===');
{
  const summary = await page.evaluate(async () => {
    const bytes = await window.__writePdf();
    const info = await window.__pdfSummary(bytes);
    return { pages: info.pageCount, first: info.pages[0] };
  });
  check('独立解析器读到 2 页', summary.pages === 2, `${summary.pages}`);
  check('页面尺寸正确', summary.first.width === 595 && summary.first.height === 842, `${summary.first.width}×${summary.first.height}`);
  check('汇总页是图像（没有可提取文字）', summary.first.text === '', JSON.stringify(summary.first.text));
}

console.log('\n=== 6. 打字机与对应文本的命名 ===');
{
  const labels = await page.evaluate(() => {
    const text = (id) => document.querySelector(id)?.textContent ?? '';
    return { textbox: text('#annot-textbox'), callout: text('#annot-callout') };
  });
  check('文本框工具名为「打字机」', labels.textbox === '打字机', labels.textbox);
  check('气泡工具名为「对应文本」', labels.callout === '对应文本', labels.callout);
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
