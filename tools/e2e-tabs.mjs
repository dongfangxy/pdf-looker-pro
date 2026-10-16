// Verifies multi-document tabs: opening, switching, per-tab state isolation, closing.
//
//   node tools/e2e-tabs.mjs [baseUrl]
import { chromium } from 'playwright';
import { resolve } from 'node:path';

const BASE = process.argv[2] ?? 'http://127.0.0.1:4173';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const SMALL = resolve('public/fixtures/test.pdf');
const LARGE = resolve('public/fixtures/large.pdf');

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
// Closing a tab that holds unsaved annotations asks for confirmation first.
page.on('dialog', (dialog) => void dialog.accept());

const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));
const consoleErrors = [];
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text());
});

const tabs = () => page.locator('.doc-tab-label').allTextContents();
const activeTab = () => page.locator('.doc-tab.active .doc-tab-label').textContent();

async function openDocument(file, expectedPages) {
  await page.setInputFiles('#file-input', file);
  await page.waitForFunction((n) => document.querySelectorAll('.page').length === n, expectedPages, { timeout: 60000 });
  await page.waitForTimeout(700);
}

await page.goto(`${BASE}/?debug=p5`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(800);

console.log('\n=== 1. 初始状态 ===');
check('启动时只有一个空标签', (await page.locator('.doc-tab').count()) === 1, `${await page.locator('.doc-tab').count()}`);
check('空标签可新建', (await page.locator('#tab-new').count()) === 1);

console.log('\n=== 2. 打开文档 ===');
await openDocument(SMALL, 24);
check('空标签被复用而不是新开一个', (await page.locator('.doc-tab').count()) === 1, (await tabs()).join(' | '));
check('标签标题为文档名', (await activeTab()).includes('24 pages'), await activeTab());

await openDocument(LARGE, 200);
check('打开第二个文档会增加标签', (await page.locator('.doc-tab').count()) === 2, (await tabs()).join(' | '));
check('新文档成为活动标签', (await activeTab()).includes('200 pages'), await activeTab());
check('页码总数跟随活动标签', (await page.locator('#page-total').textContent()) === '/ 200', await page.locator('#page-total').textContent());

console.log('\n=== 3. 每个标签独立视图状态 ===');
{
  // Zoom and page the second document, then switch away and back.
  await page.click('#btn-zoom-in');
  await page.waitForTimeout(500);
  await page.fill('#page-input', '7');
  await page.press('#page-input', 'Enter');
  await page.waitForTimeout(800);
  const second = await page.evaluate(() => ({
    zoom: document.querySelector('#zoom-label').textContent,
    total: document.querySelector('#page-total').textContent,
  }));

  await page.locator('.doc-tab').first().click();
  await page.waitForTimeout(1500);
  const first = await page.evaluate(() => ({
    zoom: document.querySelector('#zoom-label').textContent,
    total: document.querySelector('#page-total').textContent,
    pages: document.querySelectorAll('.page').length,
  }));
  check('切到第一个标签后页数正确', first.total === '/ 24' && first.pages === 24, JSON.stringify(first));
  check('两个标签的缩放互不相同', first.zoom !== second.zoom, `文档1=${first.zoom} 文档2=${second.zoom}`);

  await page.locator('.doc-tab').nth(1).click();
  await page.waitForTimeout(1500);
  const restored = await page.evaluate(() => ({
    zoom: document.querySelector('#zoom-label').textContent,
    total: document.querySelector('#page-total').textContent,
  }));
  check('切回后恢复该标签自己的缩放', restored.zoom === second.zoom, `${restored.zoom} vs ${second.zoom}`);
  check('切回后恢复该标签自己的页数', restored.total === second.total, `${restored.total}`);
}

console.log('\n=== 4. 批注按标签隔离 ===');
{
  await page.locator('.doc-tab').first().click();
  await page.waitForTimeout(1400);
  await page.evaluate(() => window.__addRect(1, 80, 80, 140, 70, 'rect'));
  await page.waitForTimeout(400);
  const onFirst = await page.evaluate(() => ({
    count: window.__store().count,
    overlays: document.querySelectorAll('.annot').length,
  }));
  check('文档1 有 1 条批注', onFirst.count === 1 && onFirst.overlays === 1, JSON.stringify(onFirst));

  await page.locator('.doc-tab').nth(1).click();
  await page.waitForTimeout(1400);
  const onSecond = await page.evaluate(() => ({
    count: window.__store().count,
    overlays: document.querySelectorAll('.annot').length,
  }));
  check('文档2 看不到文档1 的批注', onSecond.count === 0 && onSecond.overlays === 0, JSON.stringify(onSecond));

  await page.locator('.doc-tab').first().click();
  await page.waitForTimeout(1400);
  const backAgain = await page.evaluate(() => window.__store().count);
  check('切回文档1 批注仍在', backAgain === 1, `${backAgain}`);
}

console.log('\n=== 5. 标签的关闭 ===');
{
  await page.locator('.doc-tab').nth(1).locator('.doc-tab-close').click();
  await page.waitForTimeout(1400);
  check('关闭第二个标签后只剩一个', (await page.locator('.doc-tab').count()) === 1, (await tabs()).join(' | '));
  check('剩余的是文档1', (await activeTab()).includes('24 pages'), await activeTab());
  check('文档1 的批注未受影响', (await page.evaluate(() => window.__store().count)) === 1);

  await page.locator('.doc-tab').first().locator('.doc-tab-close').click();
  await page.waitForTimeout(1400);
  check('关闭最后一个标签后留下空标签', (await page.locator('.doc-tab').count()) === 1);
  const empty = await page.evaluate(() => ({
    pages: document.querySelectorAll('.page').length,
    total: document.querySelector('#page-total').textContent,
    title: document.querySelector('#doc-title').textContent,
  }));
  check('空标签不残留旧文档', empty.pages === 0 && empty.total === '/ –', JSON.stringify(empty));
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
