// Verifies merging: page order, what the pages contain, and that the result still parses.
//
//   node tools/e2e-merge.mjs [baseUrl]
import { chromium } from 'playwright';

const BASE = process.argv[2] ?? 'http://127.0.0.1:4173';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const MERGE = 1293;

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

/** Merges the fixture into itself at a position, then reads the result with pdf.js. */
const merge = (at) =>
  page.evaluate(async (position) => {
    const extra = new Uint8Array(await (await fetch('./fixtures/test.pdf')).arrayBuffer());
    const result = await window.__mergePdf(extra, position);
    const summary = await window.__pdfSummary(new Uint8Array(result.bytes));
    return {
      declared: result.pageCount,
      inserted: result.inserted,
      pages: summary.pageCount,
      first: summary.pages.slice(0, 3).map((p) => ({ text: p.text, width: p.width })),
      around: summary.pages.slice(23, 27).map((p) => p.text),
      size: result.bytes.length,
    };
  }, at);

console.log('\n=== 1. 插入到最前面 ===');
{
  const result = await merge(1);
  check('声明页数与实际一致', result.declared === result.pages, `${result.declared}/${result.pages}`);
  check('合并后是 48 页', result.pages === 48, `${result.pages}`);
  check('报告插入了 24 页', result.inserted === 24, `${result.inserted}`);
  check('第 1 页来自被合并的文档', result.first[0].text.startsWith('Page 1'), result.first[0].text.slice(0, 12));
  check('原来的第 1 页退到第 25 页', result.around[1].startsWith('Page 1'), result.around[1]?.slice(0, 12));
  check('页面尺寸保留', result.first[0].width === 595, `${result.first[0].width}`);
  check('文件没有小到可疑', result.size > 20000, `${result.size} 字节`);
}

console.log('\n=== 2. 追加到末尾 ===');
{
  const result = await merge(25);
  check('仍是 48 页', result.pages === 48, `${result.pages}`);
  check('原来的第 1 页仍在最前', result.first[0].text.startsWith('Page 1'), result.first[0].text.slice(0, 12));
  check('第 25 页开始是插入的内容', result.around[1].startsWith('Page 1'), result.around[1]?.slice(0, 12));
}

console.log('\n=== 3. 插到中间 ===');
{
  const result = await merge(3);
  check('页数不变仍是 48', result.pages === 48, `${result.pages}`);
  check('前两页仍是原文档的', result.first[0].text.startsWith('Page 1') && result.first[1].text.startsWith('Page 2'), `${result.first[0].text.slice(0, 8)} / ${result.first[1].text.slice(0, 8)}`);
  check('第 3 页起是被插入的文档', result.first[2].text.startsWith('Page 1'), result.first[2].text.slice(0, 12));
  check('原第 3 页挪到第 27 页', result.around[3].startsWith('Page 3'), result.around[3]?.slice(0, 12));
}

console.log('\n=== 4. 越界的位置被夹紧而不是报错 ===');
{
  const high = await merge(999);
  check('过大的位置等于追加', high.pages === 48, `${high.pages}`);
  const low = await merge(0);
  check('过小的位置等于插到最前', low.pages === 48 && low.first[0].text.startsWith('Page 1'), `${low.pages}`);
}

console.log('\n=== 5. 页面内容真的来自两个文档 ===');
{
  const render = await page.evaluate(async () => {
    const extra = new Uint8Array(await (await fetch('./fixtures/test.pdf')).arrayBuffer());
    const original = await window.__pageFingerprint(extra, 1, 1);
    const result = await window.__mergePdf(extra, 1);
    const merged = new Uint8Array(result.bytes);
    const insertedPage = await window.__pageFingerprint(merged, 1, 1);
    const basePage = await window.__pageFingerprint(merged, 25, 1);
    return { original, insertedPage, basePage };
  });
  check('插入的页与原文档逐像素一致', render.original.hash === render.insertedPage.hash, `${render.original.hash} vs ${render.insertedPage.hash}`);
  check('插入页有实际内容', render.insertedPage.ink > 10000, `非白=${render.insertedPage.ink}`);
  check('原文档的页也还在', render.basePage.ink > 10000, `非白=${render.basePage.ink}`);
  // Both are the fixture's first page, so they must match: the base page survived the
  // merge untouched. (An earlier version of this assertion expected them to differ, which
  // would have been a test asserting a bug.)
  check('原文档那一页原样保留', render.original.hash === render.basePage.hash, `${render.original.hash} vs ${render.basePage.hash}`);
}

console.log('\n=== 6. 浏览器里也能选择文件并合并 ===');
{
  const before = await page.evaluate(() => window.__viewer.pageCount);
  check('当前文档 24 页', before === 24, `${before}`);

  await page.click('#btn-more');
  await page.waitForTimeout(350);
  const opened = await page.evaluate(() => document.querySelectorAll('.more-run[data-command="1293"]').length);
  check('“合并文档”在“更多”菜单里', opened === 1, `${opened}`);

  const chooser = page.waitForEvent('filechooser', { timeout: 10000 });
  await page.click('.more-run[data-command="1293"]');
  const fileChooser = await chooser;
  await fileChooser.setFiles('public/fixtures/test.pdf');
  await page.waitForTimeout(800);

  // Position dialogue: append, so the page that was first stays first.
  await page.fill('.modal input', '25');
  await page.click('.modal .primary');
  await page.waitForTimeout(6000);

  const after = await page.evaluate(() => window.__viewer.pageCount);
  check('合并后变成 48 页', after === 48, `${after}`);
  const status = await page.evaluate(() => document.querySelector('#status-text')?.textContent ?? '');
  check('状态栏报告合并页数', /24/.test(status), status);
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
