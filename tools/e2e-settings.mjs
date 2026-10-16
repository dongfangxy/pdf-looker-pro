// Verifies the Settings entry, the colour themes, Ctrl+wheel zoom and the annotation
// colour palette.
//
//   node tools/e2e-settings.mjs [baseUrl]
import { chromium } from 'playwright';

/**
 * Runs a toolbar command.
 *
 * Commands that are not currently on the bar are still reachable: the reader opens
 * the customisation list and clicks the name there, which is what this does.
 */
async function clickCommand(page, selector) {
  const state = await page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return { found: false };
    return { found: true, visible: el.offsetParent !== null, command: el.dataset.command ?? null };
  }, selector);
  if (!state.found) throw new Error(`no element for ${selector}`);
  if (state.visible) {
    await page.click(selector);
    return;
  }
  // Opening the menu when it is already open would close it, so check first.
  const alreadyOpen = await page.evaluate(() => !document.querySelector('#overflow-menu').classList.contains('hidden'));
  if (!alreadyOpen) {
    await page.click('#btn-more');
    await page.waitForTimeout(300);
  }
  await page.click(`#overflow-menu .more-run[data-command="${state.command}"]`);
}

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
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));
const consoleErrors = [];
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text());
});

await page.goto(`${BASE}/?file=./fixtures/test.pdf`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('.page:not(.unrendered)').length > 0, { timeout: 30000 });
await page.waitForTimeout(700);

const openSettings = async () => {
  await page.click('#btn-settings');
  await page.waitForSelector('.modal-settings', { timeout: 5000 });
};

console.log('\n=== 1. 语言选择器已移入设置 ===');
{
  check('工具栏不再有语言下拉', (await page.locator('#ui-language').count()) === 0);
  await openSettings();
  const hasLanguage = (await page.locator('.settings-select[data-key="language"]').count()) === 1;
  const langOptions = await page.locator('.settings-select[data-key="language"] option').allTextContents();
  check('设置中有语言选择', hasLanguage, langOptions.join(' / '));
  check('语言选项完整', langOptions.length >= 2, `${langOptions.length} 项`);
  await page.click('.modal-cancel');
  await page.waitForTimeout(300);
}

console.log('\n=== 2. 设置对话框内容 ===');
{
  await openSettings();
  const rows = await page.locator('.settings-row').count();
  const keys = await page.locator('.settings-select').evaluateAll((els) => els.map((e) => e.dataset.key));
  const toggles = await page.locator('.settings-toggle').evaluateAll((els) => els.map((e) => e.dataset.key));
  check('设置项数量合理', rows >= 6, `${rows} 项`);
  check('含主题选项', keys.includes('theme'), keys.join(','));
  check('含默认视图与缩放', keys.includes('defaultViewMode') && keys.includes('defaultZoomMode'), keys.join(','));
  check('含开关项', toggles.includes('showStatusBar'), toggles.join(','));
  check('恢复默认按钮存在', (await page.locator('.modal-reset').count()) === 1);
  await page.click('.modal-cancel');
  await page.waitForTimeout(300);
}

console.log('\n=== 3. 颜色主题 ===');
{
  const expected = {
    dark: { bg: 'rgb(58, 58, 60)', dark: true },
    light: { bg: 'rgb(241, 242, 245)', dark: false },
    sepia: { bg: 'rgb(236, 226, 207)', dark: false },
    contrast: { bg: 'rgb(0, 0, 0)', dark: true },
  };
  for (const [theme, want] of Object.entries(expected)) {
    await openSettings();
    await page.selectOption('.settings-select[data-key="theme"]', theme);
    await page.click('.modal-confirm');
    await page.waitForTimeout(400);
    const got = await page.evaluate(() => ({
      attr: document.documentElement.dataset.theme,
      body: getComputedStyle(document.body).backgroundColor,
      fg: getComputedStyle(document.body).color,
      page: getComputedStyle(document.querySelector('.page')).backgroundColor,
    }));
    check(`主题 ${theme} 生效`, got.attr === theme && got.body === want.bg, `${got.attr} bg=${got.body} fg=${got.fg}`);
    // The paper must read as paper in every theme: a bright surface, distinct from the
    // chrome. Sepia deliberately uses a warm off-white rather than pure white.
    const rgb = (got.page.match(/\d+/g) ?? []).map(Number);
    const bright = rgb.length >= 3 && rgb.slice(0, 3).every((c) => c >= 240);
    check(`主题 ${theme} 下纸张为浅色表面`, bright && got.page !== got.body, got.page);
  }
  // Back to dark.
  await openSettings();
  await page.selectOption('.settings-select[data-key="theme"]', 'dark');
  await page.click('.modal-confirm');
  await page.waitForTimeout(400);
  check('可切回深色主题', (await page.evaluate(() => document.documentElement.dataset.theme)) === 'dark');
}

console.log('\n=== 4. Ctrl + 滚轮缩放 ===');
{
  const readZoom = () => page.evaluate(() => document.querySelector('#zoom-label').textContent);
  const scrollBefore = await page.evaluate(() => document.querySelector('#scroll-container').scrollTop);
  const box = await page.evaluate(() => {
    const r = document.querySelector('.page').getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(Math.max(r.top, 60) + 100) };
  });
  const before = await readZoom();
  await page.mouse.move(box.x, box.y);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -240);
  await page.waitForTimeout(500);
  const zoomedIn = await readZoom();
  await page.mouse.wheel(0, 240);
  await page.waitForTimeout(500);
  const zoomedOut = await readZoom();
  await page.keyboard.up('Control');
  check('Ctrl+向上滚动放大', zoomedIn !== before, `${before} -> ${zoomedIn}`);
  check('Ctrl+向下滚动缩小', zoomedOut !== zoomedIn, `${zoomedIn} -> ${zoomedOut}`);
  check('缩放后滚动位置仍有效', (await page.evaluate(() => document.querySelector('#scroll-container').scrollTop)) >= 0, `起始 ${scrollBefore}`);

  // A plain wheel must still scroll rather than zoom.
  const zoomBeforePlain = await readZoom();
  await page.mouse.wheel(0, 300);
  await page.waitForTimeout(400);
  check('不按 Ctrl 时滚轮仍然滚动而不缩放', (await readZoom()) === zoomBeforePlain, `${zoomBeforePlain} -> ${await readZoom()}`);
}

console.log('\n=== 5. 批注颜色预设 ===');
{
  await page.click('#btn-color');
  await page.waitForTimeout(300);
  const swatches = await page.locator('#color-popup .swatch').count();
  check('预设色板已渲染', swatches >= 8, `${swatches} 个`);
  const colors = await page.locator('#color-popup .swatch').evaluateAll((els) => els.map((e) => e.dataset.color));
  const hasCommon = ['#000000', '#e0342f', '#1f9d55', '#2f6bd8', '#ffd400'].every((c) => colors.includes(c));
  check('包含黑红绿蓝黄等常见色', hasCommon, colors.join(' '));
  await clickCommand(page, '#annot-rect');
  await page.waitForTimeout(200);
  // Selecting a tool opens the overflow menu, which closes other popups.
  if (await page.evaluate(() => document.querySelector('#color-popup').classList.contains('hidden'))) {
    await page.click('#btn-color');
    await page.waitForTimeout(300);
  }
  await page.locator('#color-popup .swatch').nth(1).click();
  await page.waitForTimeout(250);
  const picked = await page.inputValue('#annot-color');
  check('点击色板会切换当前颜色', picked === colors[1], `${picked}`);
  const active = await page.locator('#color-popup .swatch.active').count();
  check('选中色板有高亮标记', active === 1, `${active}`);
}

console.log('\n=== 6. 设置持久化 ===');
{
  await openSettings();
  await page.selectOption('.settings-select[data-key="pageGap"]', 'roomy');
  await page.check('.settings-toggle[data-key="showStatusBar"]');
  await page.click('.modal-confirm');
  await page.waitForTimeout(400);
  const roomy = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--page-gap').trim());
  check('页面间距设置生效', roomy === '24px', roomy);
  const stored = await page.evaluate(() => localStorage.getItem('pdfreader.settings.v1'));
  check('设置写入存储', stored !== null && stored.includes('roomy'), String(stored).slice(0, 90));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);
  const restored = await page.evaluate(() => ({
    gap: getComputedStyle(document.documentElement).getPropertyValue('--page-gap').trim(),
    theme: document.documentElement.dataset.theme,
  }));
  check('刷新后设置恢复', restored.gap === '24px', JSON.stringify(restored));
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
