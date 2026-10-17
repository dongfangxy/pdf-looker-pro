// Verifies saved searches: naming, persistence, re-running, replacing and forgetting.
//
//   node tools/e2e-savedsearch.mjs [baseUrl]
import { chromium } from 'playwright';

const BASE = process.argv[2] ?? 'http://127.0.0.1:4173';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const SAVE = 1292;
const KEY = 'pdfreader.searches.v1';

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

const ready = async () => {
  await page.waitForFunction(() => document.querySelectorAll('.page:not(.unrendered)').length > 0, { timeout: 30000 });
  await page.waitForTimeout(800);
};

await page.goto(`${BASE}/?file=./fixtures/test.pdf&debug=p5`, { waitUntil: 'domcontentloaded' });
await ready();
await page.evaluate((key) => window.localStorage.removeItem(key), KEY);
await page.reload({ waitUntil: 'domcontentloaded' });
await ready();

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
  await page.waitForTimeout(500);
}

const savedList = () =>
  page.evaluate(() => ({
    names: [...document.querySelectorAll('.search-saved-name')].map((el) => el.textContent ?? ''),
    queries: [...document.querySelectorAll('.search-saved-query')].map((el) => el.textContent ?? ''),
    stored: JSON.parse(window.localStorage.getItem('pdfreader.searches.v1') ?? '[]'),
  }));

async function saveAs(name) {
  await runCommand(SAVE);
  await page.waitForTimeout(400);
  await page.fill('.modal input', name);
  await page.click('.modal .primary');
  await page.waitForTimeout(700);
}

console.log('\n=== 1. 保存一次搜索 ===');
{
  await page.click('#btn-find');
  await page.waitForTimeout(400);
  await page.fill('#find-input', 'Page 7');
  await page.waitForTimeout(2600);
  await page.click('#tab-search');
  await page.waitForTimeout(500);
  check('保存前列表为空', (await savedList()).names.length === 0);

  await saveAs('每周复查');
  const saved = await savedList();
  check('面板里出现保存的搜索', saved.names.includes('每周复查'), JSON.stringify(saved.names));
  check('记下了关键词', saved.queries.includes('Page 7'), JSON.stringify(saved.queries));
  check('写进了本地存储', saved.stored.length === 1, `${saved.stored.length}`);
  check('存储里带着选项', saved.stored[0]?.caseSensitive === false && saved.stored[0]?.entireWord === false);
}

console.log('\n=== 2. 点一下就重跑 ===');
{
  // Clear the bar first, so a restored query can only come from the saved search.
  await page.fill('#find-input', '');
  await page.waitForTimeout(2600);
  const cleared = await page.evaluate(() => document.querySelectorAll('.search-hit').length);
  check('清空后没有结果', cleared === 0, `${cleared}`);

  await page.click('.search-saved-name');
  await page.waitForTimeout(2800);

  const query = await page.evaluate(() => document.querySelector('#find-input')?.value ?? '');
  check('关键词被填回查找栏', query === 'Page 7', query);
  const hits = await page.evaluate(() => document.querySelectorAll('.search-hit').length);
  check('结果重新出现', hits > 0, `${hits} 处`);
}

console.log('\n=== 3. 同名保存是替换，不是重复 ===');
{
  await saveAs('每周复查');
  const saved = await savedList();
  check('仍然只有一条', saved.names.filter((n) => n === '每周复查').length === 1, JSON.stringify(saved.names));
  check('存储里也只有一条', saved.stored.length === 1, `${saved.stored.length}`);
}

console.log('\n=== 4. 可以删掉 ===');
{
  await page.click('.search-saved-forget');
  await page.waitForTimeout(600);
  const saved = await savedList();
  check('面板里没有了', saved.names.length === 0, JSON.stringify(saved.names));
  check('存储里也没有了', saved.stored.length === 0, `${saved.stored.length}`);
  const status = await page.evaluate(() => document.querySelector('#status-text')?.textContent ?? '');
  check('状态栏说明了结果', /删除/.test(status), status);
}

console.log('\n=== 5. 保存的搜索能跨会话留下 ===');
{
  await saveAs('留在下次');
  const before = await savedList();
  check('先存下来', before.names.includes('留在下次'));

  await page.reload({ waitUntil: 'domcontentloaded' });
  await ready();
  await page.click('#tab-search');
  await page.waitForTimeout(600);

  const after = await savedList();
  check('重新加载后还在', after.names.includes('留在下次'), JSON.stringify(after.names));
}

console.log('\n=== 6. 空关键词不保存 ===');
{
  // The reload above left the find bar closed.
  await page.click('#btn-find');
  await page.waitForTimeout(400);
  await page.fill('#find-input', '');
  await page.waitForTimeout(2600);
  await runCommand(SAVE);
  await page.waitForTimeout(600);
  const modals = await page.locator('.modal').count();
  check('没有为空的搜索弹出命名框', modals === 0, `${modals}`);
  const status = await page.evaluate(() => document.querySelector('#status-text')?.textContent ?? '');
  check('提示先输入内容', /查找/.test(status), status);
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
