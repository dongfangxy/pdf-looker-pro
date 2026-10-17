// Verifies the A-tier viewer additions: actual size, fit visible, the fourth view mode,
// zoom-to and go-to-page dialogs, and view history.
//
//   node tools/e2e-viewmodes.mjs [baseUrl]
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
await page.waitForTimeout(900);

const zoom = () => page.evaluate(() => window.__viewer.getState().scale);
const mode = () => page.evaluate(() => window.__viewer.mode);
const layout = () => page.evaluate(() => window.__viewer.layoutMode);
const visiblePages = () =>
  page.evaluate(() =>
    [...document.querySelectorAll('.page')].filter((el) => el.offsetParent !== null).length,
  );

console.log('\n=== 1. 实际大小 ===');
await page.click('#btn-zoom-actual');
await page.waitForTimeout(600);
{
  const scale = await zoom();
  check('点击“实际”得到 100%', Math.abs(scale - 1) < 0.001, `${Math.round(scale * 100)}%`);
  check('缩放模式为 actual', (await mode()) === 'actual', await mode());
  const label = await page.evaluate(() => document.querySelector('#zoom-label').textContent);
  check('缩放标签显示 100%', label.trim() === '100%', label);
}

console.log('\n=== 2. 符合可见区域 ===');
{
  // Render the page so the content measurement has something to measure, then compare.
  await page.click('#btn-fit-width');
  await page.waitForTimeout(700);
  const fitWidth = await zoom();
  await page.click('#btn-fit-visible');
  await page.waitForTimeout(1200);
  const fitVisible = await zoom();
  // Verify the formula against the measured box rather than assuming the fixture has
  // margins: a full-bleed page legitimately fits visible at the same scale as fit-width.
  const measured = await page.evaluate(async () => {
    const geo = window.__viewer.pageGeometry(1);
    const box = await window.__contentBox(1);
    return { box, pageWidth: geo.pageWidth };
  });
  // Derive the usable width from the fit-width result instead of hard-coding the
  // viewer's paddings: fit-width already reports availW / paperWidth.
  const availW = fitWidth * measured.pageWidth;
  const expected = (availW - 12) / measured.box.width;
  check('符合可见区域按实测内容宽度计算', Math.abs(fitVisible - expected) < 0.02,
    `内容 ${measured.box.width.toFixed(0)}pt / 页宽 ${measured.pageWidth.toFixed(0)}pt -> ${Math.round(expected*100)}%`);
  const hasMargins = measured.box.width < measured.pageWidth - 8;
  check(hasMargins ? '有白边时可见模式大于宽度模式' : '满版页面两种模式一致',
    hasMargins ? fitVisible > fitWidth : Math.abs(fitVisible - fitWidth) < 0.03,
    `白边=${hasMargins} 可见 ${Math.round(fitVisible*100)}% 宽度 ${Math.round(fitWidth*100)}%`);
  check('缩放模式为 fit-visible', (await mode()) === 'fit-visible', await mode());
}

console.log('\n=== 3. 四种视图模式 ===');
await page.click('#btn-fit-page');
await page.waitForTimeout(700);
{
  // 连续-对开 is hidden behind the overflow menu by default.
  await page.evaluate(() => window.__setViewMode('spread-continuous'));
  await page.waitForTimeout(700);
  check('连续-对开的布局类已应用', (await page.evaluate(() => document.querySelector('#pages').classList.contains('mode-spread-continuous'))) === true);
  const all = await visiblePages();
  check('连续-对开显示所有页面', all === 24, `${all} 页可见`);
  const perRow = await page.evaluate(() => {
    const pages = [...document.querySelectorAll('.page')].filter((el) => el.offsetParent !== null);
    if (pages.length < 2) return 0;
    const firstTop = Math.round(pages[0].getBoundingClientRect().top);
    return pages.filter((el) => Math.abs(Math.round(el.getBoundingClientRect().top) - firstTop) < 4).length;
  });
  check('连续-对开每行两页', perRow === 2, `每行 ${perRow} 页`);

  await page.evaluate(() => window.__setViewMode('spread'));
  await page.waitForTimeout(700);
  check('对开布局类已应用', (await page.evaluate(() => document.querySelector('#pages').classList.contains('mode-spread'))) === true);
  const spaced = await visiblePages();
  check('对开只显示一组（两页）', spaced === 2, `${spaced} 页可见`);
  check('对开的两页是相邻页', (await page.evaluate(() => {
    const pages = [...document.querySelectorAll('.page')].filter((el) => el.offsetParent !== null);
    const nums = pages.map((el) => Number(el.dataset.page)).sort((a, b) => a - b);
    return nums.length === 2 && nums[1] === nums[0] + 1;
  })) === true);

  await page.evaluate(() => window.__setViewMode('single'));
  await page.waitForTimeout(500);
  check('单页只显示一页', (await visiblePages()) === 1);
  await page.evaluate(() => window.__setViewMode('continuous'));
  await page.waitForTimeout(500);
  check('连续显示所有页面', (await visiblePages()) === 24);
  check('布局模式回到 continuous', (await layout()) === 'continuous', await layout());
}

console.log('\n=== 4. 缩放至对话框 ===');
{
  await page.click('#zoom-label');
  await page.waitForTimeout(400);
  check('点击百分比打开对话框', (await page.locator('.modal-narrow').count()) === 1);
  await page.fill('.modal-narrow input', '150');
  await page.press('.modal-narrow input', 'Enter');
  await page.waitForTimeout(700);
  check('输入 150 后缩放为 150%', Math.abs((await zoom()) - 1.5) < 0.01, `${Math.round((await zoom()) * 100)}%`);
  check('对话框已关闭', (await page.locator('.modal-narrow').count()) === 0);

  await page.click('#zoom-label');
  await page.waitForTimeout(300);
  await page.fill('.modal-narrow input', 'abc');
  await page.press('.modal-narrow input', 'Enter');
  await page.waitForTimeout(400);
  const status = await page.evaluate(() => document.querySelector('#status-text').textContent);
  check('无效输入被拒绝并提示', /有效/.test(status), status);
}

console.log('\n=== 5. 转到页面对话框 ===');
{
  await page.keyboard.press('Control+g');
  await page.waitForTimeout(400);
  check('Ctrl+G 打开转到页面对话框', (await page.locator('.modal-narrow').count()) === 1);
  await page.fill('.modal-narrow input', '7');
  await page.press('.modal-narrow input', 'Enter');
  await page.waitForTimeout(700);
  check('跳到第 7 页', (await page.evaluate(() => window.__viewer.page)) === 7);

  await page.keyboard.press('Control+g');
  await page.waitForTimeout(300);
  await page.fill('.modal-narrow input', '999');
  await page.press('.modal-narrow input', 'Enter');
  await page.waitForTimeout(400);
  const status = await page.evaluate(() => document.querySelector('#status-text').textContent);
  check('超出范围被拒绝并提示', /范围/.test(status), status);
}

console.log('\n=== 6. 上一视图 / 下一视图 ===');
{
  await page.evaluate(() => window.__viewer.gotoPage(1));
  await page.waitForTimeout(400);
  await page.evaluate(() => window.__viewer.gotoPage(12));
  await page.waitForTimeout(500);
  const before = await page.evaluate(() => window.__viewer.page);
  await page.keyboard.press('Alt+ArrowLeft');
  await page.waitForTimeout(600);
  const back = await page.evaluate(() => window.__viewer.page);
  check('上一视图回到之前的页', back !== before && back === 1, `${before} -> ${back}`);
  await page.keyboard.press('Alt+ArrowRight');
  await page.waitForTimeout(600);
  const forward = await page.evaluate(() => window.__viewer.page);
  check('下一视图前进回来', forward === before, `${back} -> ${forward}`);

  // Walk all the way back first: the history is deeper than one step, so a fixed
  // number of presses would not prove anything about the boundary.
  await page.evaluate(async () => {
    let guard = 0;
    while (window.__viewer.canGoBack && guard++ < 50) {
      window.__viewer.previousView();
      await new Promise((r) => setTimeout(r, 40));
    }
  });
  await page.keyboard.press('Alt+ArrowLeft');
  await page.waitForTimeout(500);
  const status = await page.evaluate(() => document.querySelector('#status-text').textContent);
  check('到最早视图时给出提示', /没有/.test(status), status);
}

console.log('\n=== 7. Ctrl+0 实际大小 ===');
{
  await page.keyboard.press('Control+0');
  await page.waitForTimeout(500);
  check('Ctrl+0 回到 100%', Math.abs((await zoom()) - 1) < 0.001, `${Math.round((await zoom()) * 100)}%`);
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
