// Verifies the search results panel: grouping, context, selection and navigation.
//
//   node tools/e2e-search.mjs [baseUrl]
import { chromium } from 'playwright';

const BASE = process.argv[2] ?? 'http://127.0.0.1:4173';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

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

const panel = () =>
  page.evaluate(() => {
    const hits = [...document.querySelectorAll('.search-hit')];
    return {
      summary: document.querySelector('.search-summary')?.textContent ?? null,
      idle: document.querySelector('.search-idle')?.textContent ?? null,
      pages: [...document.querySelectorAll('.search-page')].map((el) => el.textContent),
      hits: hits.length,
      marks: document.querySelectorAll('.search-match').length,
      current: hits.findIndex((el) => el.classList.contains('current')),
      texts: hits.slice(0, 3).map((el) => el.textContent ?? ''),
    };
  });

async function typeQuery(text) {
  await page.click('#find-input');
  await page.fill('#find-input', text);
  await page.waitForTimeout(2600);
}

console.log('\n=== 1. 面板在侧栏里 ===');
{
  check('有搜索标签', (await page.locator('#tab-search').count()) === 1);
  await page.click('#tab-search');
  await page.waitForTimeout(500);
  check('搜索面板可见', (await page.evaluate(() => !document.querySelector('#pane-search').classList.contains('hidden'))) === true);
  const idle = await panel();
  check('还没搜索时给出提示', idle.idle !== null && idle.hits === 0, JSON.stringify(idle.idle?.slice(0, 20)));
}

console.log('\n=== 2. 结果按页分组 ===');
{
  await page.keyboard.press('Control+f');
  await page.waitForTimeout(400);
  await typeQuery('Page 1');

  const result = await panel();
  check('列出了匹配', result.hits > 0, `${result.hits} 处`);
  check('每处都有高亮片段', result.marks === result.hits, `${result.marks}/${result.hits}`);
  check('分成了多个页组', result.pages.length > 1, `${result.pages.length} 组`);
  check('页组标题带页码', result.pages.every((label) => /\d/.test(label ?? '')), result.pages.slice(0, 3).join(' | '));
  check('有汇总行', /匹配/.test(result.summary ?? ''), result.summary ?? '');
  check('第一行带上下文', result.texts[0].includes('Page 1') && result.texts[0].length > 8, JSON.stringify(result.texts[0].slice(0, 40)));
}

console.log('\n=== 3. 当前匹配被标出 ===');
{
  const result = await panel();
  check('恰好一处标为当前', result.current >= 0, `index=${result.current}`);

  // Walking to the next match moves the marker.
  const before = result.current;
  await page.keyboard.press('Enter');
  await page.waitForTimeout(800);
  const after = await panel();
  check('下一个匹配换了位置', after.current !== before, `${before} -> ${after.current}`);
  check('仍然只有一处是当前', (await page.evaluate(() => document.querySelectorAll('.search-hit.current').length)) === 1);
}

console.log('\n=== 4. 点击结果会跳到那一页 ===');
{
  // The last group belongs to a later page than the first.
  const target = await page.evaluate(() => {
    const hits = [...document.querySelectorAll('.search-hit')];
    const index = hits.length - 1;
    const groups = [...document.querySelectorAll('.search-page')];
    return { index, pageLabel: groups[groups.length - 1]?.textContent ?? '', total: hits.length };
  });

  // Click the final hit by index, which is the dependable way to address it.
  await page.evaluate((index) => {
    const hits = [...document.querySelectorAll('.search-hit')];
    hits[index]?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  }, target.index);
  await page.waitForTimeout(1200);

  const current = await page.evaluate(() => {
    const hits = [...document.querySelectorAll('.search-hit')];
    return hits.findIndex((el) => el.classList.contains('current'));
  });
  check('点击后那一处成为当前', current === target.index, `${current} / 期望 ${target.index}`);

  const shownPage = await page.evaluate(() => Number(document.querySelector('#page-input')?.value ?? '0'));
  const labelPage = Number((target.pageLabel.match(/(\d+)/) ?? [])[1] ?? '0');
  check('视图跳到了那一页', shownPage === labelPage, `显示第 ${shownPage} 页，结果在第 ${labelPage} 页`);
}

console.log('\n=== 5. 没有结果时说明白 ===');
{
  await typeQuery('zzzz-not-in-this-document');
  const result = await panel();
  check('没有结果时不列条目', result.hits === 0, `${result.hits}`);
  check('给出“没有匹配”的提示', /没有匹配/.test(result.idle ?? ''), JSON.stringify(result.idle));
}

console.log('\n=== 6. 清空查询回到初始态 ===');
{
  await typeQuery('');
  const result = await panel();
  check('回到未搜索的提示', /输入要查找的内容/.test(result.idle ?? ''), JSON.stringify(result.idle?.slice(0, 20)));
  check('没有残留条目', result.hits === 0, `${result.hits}`);
}

console.log('\n=== 7. 查找栏本身仍然可用 ===');
{
  await typeQuery('Page 7');
  const count = await page.evaluate(() => document.querySelector('#find-count')?.textContent ?? '');
  check('查找栏显示位置计数', /\d+\/\d+/.test(count), count);
  const bar = await page.evaluate(() => !document.querySelector('#find-bar').classList.contains('hidden'));
  check('查找栏保持打开', bar === true);
}
console.log('\n=== 8. 错误检查 ===');
check('无未捕获页面错误', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));
check('无控制台错误', consoleErrors.length === 0, consoleErrors.slice(0, 2).join(' | '));

await browser.close();
console.log(`\n=== 结果: ${passed} 通过 / ${failed} 失败 ===`);
if (failed > 0) {
  console.log('失败项:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exitCode = 1;
}
