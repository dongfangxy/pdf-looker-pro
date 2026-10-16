// Verifies annotation style presets: built-ins, applying, saving, deleting, persistence.
//
//   node tools/e2e-styles.mjs [baseUrl]
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

/** Runs a toolbar command, using the customisation list when it is not on the bar. */
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
const openMenu = async () => {
  await page.click('#btn-more');
  await page.waitForTimeout(280);
};

await page.goto(`${BASE}/?file=./fixtures/test.pdf`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('.page:not(.unrendered)').length > 0, { timeout: 30000 });
await page.waitForTimeout(800);

console.log('\n=== 1. 内置样式 ===');
{
  await openMenu();
  const rows = await page.locator('#style-list .style-row').count();
  const names = await page.locator('#style-list .style-name').allTextContents();
  check('每种批注都有一条内置样式', rows >= 13, `${rows} 条`);
  check('内置样式有名称', names.every((n) => n.trim().length > 0), names.slice(0, 5).join(' / '));
  const builtinDeletes = await page.locator('#style-list .style-del').count();
  check('内置样式不可删除', builtinDeletes === 0, `${builtinDeletes} 个删除按钮`);
}

console.log('\n=== 2. 应用样式 ===');
{
  const target = page.locator('#style-list .style-row').nth(4);
  const name = await target.locator('.style-name').textContent();
  await target.click();
  await page.waitForTimeout(400);
  const applied = await page.evaluate(() => ({
    tool: document.querySelector('#scroll-container')?.getAttribute('data-tool'),
    color: document.querySelector('#annot-color')?.value,
    menuClosed: document.querySelector('#overflow-menu').classList.contains('hidden'),
  }));
  check('应用样式后菜单关闭', applied.menuClosed === true);
  check('应用样式切换了工具', applied.tool !== null && applied.tool !== 'select', `tool=${applied.tool}`);
  check('应用样式设置了颜色', /^#[0-9a-f]{6}$/i.test(applied.color), `${applied.color} (${name})`);

  await openMenu();
  const activeCount = await page.locator('#style-list .style-row.active').count();
  check('应用过的样式被标记', activeCount === 1, `${activeCount}`);
  // Return to the pointer before touching the page: the applied preset may be a
  // drawing tool, and clicking with it would start an annotation (or open a prompt).
  await page.click('#tool-pointer');
  await page.waitForTimeout(250);
  await page.click('#scroll-container', { position: { x: 700, y: 400 } });
  await page.waitForTimeout(300);
}

console.log('\n=== 3. 保存自定义样式 ===');
{
  // Pick a tool and a colour, then save them as a preset.
  await openMenu();
  await clickCommand(page, '#annot-rect');
  await page.waitForTimeout(300);
  await page.click('#btn-color');
  await page.waitForTimeout(300);
  await page.locator('#color-popup .swatch').nth(5).click();
  await page.waitForTimeout(250);
  const chosen = await page.inputValue('#annot-color');
  await page.click('#scroll-container', { position: { x: 700, y: 500 } });
  await page.waitForTimeout(300);

  await openMenu();
  await page.click('#style-save');
  await page.waitForSelector('.modal', { timeout: 5000 });
  await page.fill('.modal-input', '我的绿色矩形');
  await page.click('.modal-confirm');
  await page.waitForTimeout(600);

  await openMenu();
  const names = await page.locator('#style-list .style-name').allTextContents();
  const rows = await page.locator('#style-list .style-row').count();
  check('自定义样式已加入列表', names.includes('我的绿色矩形'), names.slice(-2).join(' / '));
  check('列表条数增加', rows >= 14, `${rows}`);
  const customDeletes = await page.locator('#style-list .style-del').count();
  check('自定义样式可删除', customDeletes === 1, `${customDeletes}`);

  // Apply it from a different tool and confirm the colour comes back.
  await page.click('#tool-pointer');
  await page.waitForTimeout(250);
  await page.click('#btn-color');
  await page.waitForTimeout(250);
  await page.locator('#color-popup .swatch').nth(1).click();
  await page.waitForTimeout(250);
  await page.click('#scroll-container', { position: { x: 700, y: 600 } });
  await page.waitForTimeout(300);

  await openMenu();
  await page.locator('#style-list .style-row', { hasText: '我的绿色矩形' }).click();
  await page.waitForTimeout(400);
  const restored = await page.evaluate(() => ({
    color: document.querySelector('#annot-color')?.value,
    tool: document.querySelector('#scroll-container')?.getAttribute('data-tool'),
  }));
  check('应用自定义样式恢复颜色', restored.color === chosen, `${restored.color} vs ${chosen}`);
  check('应用自定义样式恢复工具', restored.tool === 'rect', `tool=${restored.tool}`);
}

console.log('\n=== 4. 持久化 ===');
{
  const stored = await page.evaluate(() => localStorage.getItem('pdfreader.settings.v1'));
  check('自定义样式写入存储', stored !== null && stored.includes('我的绿色矩形'), String(stored).slice(0, 80));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  await openMenu();
  const names = await page.locator('#style-list .style-name').allTextContents();
  check('刷新后自定义样式仍在', names.includes('我的绿色矩形'), names.slice(-2).join(' / '));

  await page.locator('#style-list .style-row', { hasText: '我的绿色矩形' }).locator('.style-del').click();
  await page.waitForTimeout(500);
  const afterDelete = await page.locator('#style-list .style-name').allTextContents();
  check('删除后从列表移除', !afterDelete.includes('我的绿色矩形'), `${afterDelete.length} 条`);
  const storedAfter = await page.evaluate(() => localStorage.getItem('pdfreader.settings.v1'));
  check('删除同步到存储', !String(storedAfter).includes('我的绿色矩形'), '');
}

console.log('\n=== 5. 错误检查 ===');
check('无未捕获页面错误', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));
check('无控制台错误', consoleErrors.length === 0, consoleErrors.slice(0, 2).join(' | '));

await browser.close();
console.log(`\n=== 结果: ${passed} 通过 / ${failed} 失败 ===`);
if (failed > 0) {
  console.log('失败项:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exitCode = 1;
}
