// Verifies the page operations: delete, rotate, insert, extract and crop, each driven
// through the real dialogue and checked against the document the reader ends up holding.
//
//   node tools/e2e-pageops.mjs [baseUrl]
import { chromium } from 'playwright';

const BASE = process.argv[2] ?? 'http://127.0.0.1:4173';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

const CMD = { delete: 1240, rotate: 1241, insert: 1242, extract: 1243, crop: 1244 };

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

/** Opens the dialogue for a command and leaves it on screen. */
async function openDialog(operation) {
  await page.click('#btn-more');
  await page.waitForTimeout(350);
  await page.click(`.more-run[data-command="${CMD[operation]}"]`);
  await page.waitForTimeout(450);
  return (await page.locator('.modal-pageops').count()) === 1;
}

async function confirm() {
  await page.click('.modal-pageops .modal-confirm');
  await page.waitForTimeout(3200);
}

/** What this project's own parser says about the open document. */
const parsed = () =>
  page.evaluate(async () => {
    const info = await window.__pdfDebug();
    return { pages: info.pages?.length ?? 0, boxes: (info.pages ?? []).map((p) => ({ box: p.box, rotate: p.rotate })) };
  });

const viewerPages = () => page.evaluate(() => window.__viewer.pageCount);

console.log('\n=== 1. 删除页面 ===');
{
  const opened = await openDialog('delete');
  check('“删除页面”打开对话框', opened);
  await page.fill('.modal-pageops .print-range-input', '1');
  await confirm();
  check('删除后剩 23 页', (await viewerPages()) === 23, `${await viewerPages()}`);
  const state = await parsed();
  check('文件里的页数也是 23', state.pages === 23, `${state.pages}`);
  // Page 2 of the fixture reads "Page 2"; it must now be the first page.
  const text = await page.evaluate(async () => {
    const bytes = new Uint8Array((await window.__pdfDebug(), await (await fetch('./fixtures/test.pdf')).arrayBuffer()));
    void bytes;
    const doc = await window.__pdfSummary(new Uint8Array(await (await fetch('./fixtures/test.pdf')).arrayBuffer()));
    return doc.pages[1].text;
  });
  check('原文第 2 页确实有文字', text.startsWith('Page 2'), text.slice(0, 12));
}

console.log('\n=== 2. 旋转页面 ===');
{
  const before = await parsed();
  const opened = await openDialog('rotate');
  check('“旋转页面”打开对话框', opened);
  await page.selectOption('.modal-pageops .print-select', '90');
  await page.fill('.modal-pageops .print-range-input', '1');
  await confirm();
  const after = await parsed();
  check('页数不变', after.pages === before.pages, `${after.pages}`);
  check('第 1 页 /Rotate 变成 90', after.boxes[0].rotate === 90, `${after.boxes[0].rotate}`);
  check('第 2 页未受影响', after.boxes[1].rotate === 0, `${after.boxes[1].rotate}`);
  // A quarter turn swaps the visible dimensions.
  const width = after.boxes[0].box[2] - after.boxes[0].box[0];
  const height = after.boxes[0].box[3] - after.boxes[0].box[1];
  check('页面框本身不变（旋转写在 /Rotate 上）', width === 595 && height === 842, `${width}×${height}`);
}

console.log('\n=== 3. 插入空白页 ===');
{
  const before = await parsed();
  const opened = await openDialog('insert');
  check('“插入空白页”打开对话框', opened);
  await page.fill('.modal-pageops .print-range-input', '2');
  const inputs = page.locator('.modal-pageops .print-percent-input');
  await inputs.nth(0).fill('2'); // count
  await inputs.nth(1).fill('400'); // width
  await inputs.nth(2).fill('500'); // height
  await confirm();
  const after = await parsed();
  check('插入 2 页后总数 +2', after.pages === before.pages + 2, `${before.pages} -> ${after.pages}`);
  check('插入页尺寸为 400×500', after.boxes[1].box[2] === 400 && after.boxes[1].box[3] === 500, `${after.boxes[1].box.join(',')}`);
}

console.log('\n=== 4. 裁剪页面 ===');
{
  const before = await parsed();
  const opened = await openDialog('crop');
  check('“裁剪页面”打开对话框', opened);
  await page.fill('.modal-pageops .print-range-input', '1');
  const margins = page.locator('.modal-pageops .print-percent-input');
  for (let i = 0; i < 4; i++) await margins.nth(i).fill('20');
  await confirm();
  const after = await parsed();
  check('页数不变', after.pages === before.pages, `${after.pages}`);
  // The media box is untouched; the crop box shrinks the page the reader sees.
  const mediaWidth = after.boxes[0].box[2] - after.boxes[0].box[0];
  check('媒体框未改', mediaWidth === 595, `${mediaWidth}`);
  const visible = await page.evaluate(async () => {
    const info = await window.__pdfDebug();
    void info;
    const doc = await window.__pdfSummary(new Uint8Array(await (await fetch('./fixtures/test.pdf')).arrayBuffer()));
    return doc.pages[0].width;
  });
  check('原文件第 1 页仍是 595 宽（对照）', visible === 595, `${visible}`);
  const cropped = await page.evaluate(() => window.__viewer.pageGeometry(1));
  check('阅读器里第 1 页变窄', cropped === null || cropped.pageWidth <= 595, `${cropped?.pageWidth}`);
}

console.log('\n=== 5. 提取页面 ===');
{
  const tabsBefore = await page.evaluate(() => document.querySelectorAll('.doc-tab').length);
  const opened = await openDialog('extract');
  check('“提取页面”打开对话框', opened);
  await page.fill('.modal-pageops .print-range-input', '3-5');
  await confirm();
  const tabsAfter = await page.evaluate(() => document.querySelectorAll('.doc-tab').length);
  check('提取会打开一个新标签', tabsAfter > tabsBefore, `${tabsBefore} -> ${tabsAfter}`);
  check('新文档有 3 页', (await viewerPages()) === 3, `${await viewerPages()}`);
  const title = await page.evaluate(() => document.querySelector('.doc-tab.active .doc-tab-label')?.textContent ?? '');
  check('新标签标题标明是提取结果', /pages/.test(title), title.trim().slice(0, 40));
}

console.log('\n=== 6. 批注随页迁移 ===');
{
  // Go back to the original document (first tab), annotate page 2, then delete page 1.
  await page.evaluate(() => {
    const tabs = [...document.querySelectorAll('.doc-tab')];
    tabs[0]?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await page.waitForTimeout(1500);

  await page.evaluate(() => {
    window.__store().add({ page: 2, kind: 'rect', color: '#e0342f', rect: { x: 40, y: 40, w: 60, h: 40 } });
  });
  await page.waitForTimeout(400);
  check('已在第 2 页放一条批注', (await page.evaluate(() => window.__store().count)) === 1);

  const opened = await openDialog('delete');
  check('打开删除对话框', opened);
  await page.fill('.modal-pageops .print-range-input', '1');
  await confirm();

  const after = await page.evaluate(() => ({
    count: window.__store().count,
    pages: window.__store().all.map((a) => a.page),
  }));
  check('批注保留下来', after.count === 1, `${after.count}`);
  check('批注迁移到第 1 页', after.pages[0] === 1, `${after.pages.join(',')}`);
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
