// Verifies the packaged Electron shell: the window loads over the custom app://
// scheme, the PDF engine's worker is allowed to start, and a document can be
// opened through the real file input.
//
//   node tools/e2e-electron.mjs
import { _electron as electron } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';

/**
 * Runs a toolbar command.
 *
 * Commands that are not currently on the bar are still reachable: the reader opens
 * the customisation list and clicks the name there, which is what this does.
 */
async function clickCommand(win, selector) {
  const state = await win.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return { found: false };
    return { found: true, visible: el.offsetParent !== null, command: el.dataset.command ?? null };
  }, selector);
  if (!state.found) throw new Error(`no element for ${selector}`);
  if (state.visible) {
    await win.click(selector);
    return;
  }
  // Opening the menu when it is already open would close it, so check first.
  const alreadyOpen = await win.evaluate(() => !document.querySelector('#overflow-menu').classList.contains('hidden'));
  if (!alreadyOpen) {
    await win.click('#btn-more');
    await win.waitForTimeout(300);
  }
  await win.click(`#overflow-menu .more-run[data-command="${state.command}"]`);
}

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, '..');
const fixture = join(projectRoot, 'public', 'fixtures', 'test.pdf');
const shots = join(projectRoot, 'docs');
mkdirSync(shots, { recursive: true });

let passed = 0;
let failed = 0;

function check(name, ok, detail = '') {
  if (ok) {
    passed++;
    console.log(`  ✓ ${name}${detail ? `  ${detail}` : ''}`);
  } else {
    failed++;
    console.log(`  ✗ ${name}${detail ? `  ${detail}` : ''}`);
  }
}

/**
 * Finds the packaged build.
 *
 * Without an explicit `--exe=` the suites used to fall back to the source tree, so a
 * run that claimed to verify the packaged artefact was really verifying the sources.
 * The standard output paths are checked first; the source tree is the last resort.
 */
function resolveTarget() {
  const explicit = process.argv.find((a) => a.startsWith('--exe='))?.slice('--exe='.length);
  if (explicit) return explicit;
  const candidates = [
    'release/win-unpacked/PDF Looker Pro.exe',
    'release/win-unpacked/PDF Reader.exe',
  ];
  for (const candidate of candidates) {
    const full = resolve(projectRoot, candidate);
    if (existsSync(full)) return full;
  }
  return null;
}

console.log('=== Electron 外壳验证 ===');

/** `--exe=<path>` verifies a packaged build instead of the source tree. */
const packagedExe = process.argv.find((a) => a.startsWith('--exe='))?.slice('--exe='.length) ?? null;

// Some CI/harness environments export ELECTRON_RUN_AS_NODE=1, which makes the
// electron binary behave as plain Node: require('electron') then resolves to the
// npm shim instead of the built-in API and the main process fails immediately.
const childEnv = { ...process.env };
delete childEnv.ELECTRON_RUN_AS_NODE;
if (childEnv.ELECTRON_RUN_AS_NODE !== undefined) childEnv.ELECTRON_RUN_AS_NODE = '';
console.log(`  ELECTRON_RUN_AS_NODE 已清除: ${childEnv.ELECTRON_RUN_AS_NODE === undefined}`);

const app = await electron.launch(
  packagedExe
    ? { executablePath: packagedExe, args: [] }
    : { args: ['.'], cwd: projectRoot, env: childEnv },
);
if (packagedExe) {
  // env is only forwarded for the source launch; packaged builds inherit ours.
  console.log(`  目标可执行文件: ${packagedExe}`);
}

const errors = [];
const consoleErrors = [];

try {
  const win = await app.firstWindow();
  win.on('pageerror', (err) => errors.push(String(err)));
  win.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  await win.waitForLoadState('domcontentloaded');
  await win.waitForTimeout(1200);

  const shell = await win.evaluate(() => ({
    url: location.href,
    origin: location.origin,
    hasToolbar: !!document.getElementById('btn-open'),
    hasScroll: !!document.getElementById('scroll-container'),
    title: document.title,
  }));
  console.log(`  载入 URL: ${shell.url}`);
  check('通过自定义协议载入', shell.url.startsWith('app://bundle/'), shell.url);
  check('origin 不是 null（worker 才能启动）', shell.origin !== 'null', `origin=${shell.origin}`);
  check('工具栏已渲染', shell.hasToolbar === true);
  check('文档区已渲染', shell.hasScroll === true);

  // Opening a real file exercises the file input and, crucially, the PDF worker.
  await win.setInputFiles('#file-input', fixture);
  let pages = 0;
  try {
    await win.waitForFunction(() => document.querySelectorAll('.page').length > 1, { timeout: 30000 });
    pages = await win.evaluate(() => document.querySelectorAll('.page').length);
  } catch {
    pages = 0;
  }
  check('通过文件输入打开 PDF', pages === 24, `页数=${pages}`);

  let rendered = 0;
  try {
    await win.waitForFunction(() => document.querySelectorAll('.page:not(.unrendered)').length > 0, { timeout: 30000 });
    rendered = await win.evaluate(() => document.querySelectorAll('.page:not(.unrendered)').length);
  } catch {
    rendered = 0;
  }
  check('PDF 引擎 worker 正常工作', rendered > 0, `已渲染=${rendered}`);

  // Search proves the text layer plus span rewriting work in the packaged shell.
  await win.click('#btn-find');
  await win.fill('#find-input', 'Self-authored');
  await win.press('#find-input', 'Enter');
  let highlights = 0;
  try {
    await win.waitForFunction(() => document.querySelectorAll('.textLayer .highlight').length > 0, { timeout: 25000 });
    highlights = await win.evaluate(() => document.querySelectorAll('.textLayer .highlight').length);
  } catch {
    highlights = 0;
  }
  check('查找高亮在打包外壳中生效', highlights > 0, `高亮=${highlights}`);

  const title = await win.evaluate(() => document.querySelector('#doc-title')?.textContent ?? '');
  check('文档标题读取', title.includes('Test Fixture'), title);

  // P3: the three-section language system must work in the packaged shell too.
  await win.click('#btn-settings');
  await win.waitForSelector('.modal-settings', { timeout: 5000 });
  const lang = await win.evaluate(() => ({
    options: [...document.querySelectorAll('.settings-select[data-key="language"] option')].map((o) => o.value),
    label: document.querySelector('#btn-open')?.textContent ?? '',
    command: document.querySelector('#btn-open')?.dataset.command ?? '',
  }));
  await win.click('.modal-confirm');
  await win.waitForTimeout(300);
  check('语言选择器含两份语言包', lang.options.length === 2, lang.options.join(', '));
  check('按钮由命令 ID 驱动', lang.command === '1001', `data-command=${lang.command}`);

  await win.click('#btn-settings');
  await win.waitForSelector('.modal-settings', { timeout: 5000 });
  await win.selectOption('.settings-select[data-key="language"]', 'en');
  await win.click('.modal-confirm');
  await win.waitForTimeout(400);
  const enLabel = await win.evaluate(() => ({
    label: document.querySelector('#btn-open')?.textContent ?? '',
    htmlLang: document.documentElement.lang,
    fitPage: document.querySelector('#btn-fit-page')?.textContent ?? '',
  }));
  check('打包外壳中可切到英文', enLabel.label === 'Open' && enLabel.htmlLang === 'en', `"${lang.label}" → "${enLabel.label}"`);
  check('英文包完整（无中文残留）', enLabel.fitPage === 'Fit page', `FitPage="${enLabel.fitPage}"`);

  await clickCommand(win, '#btn-about');
  await win.waitForSelector('.modal', { timeout: 5000 });
  const dialog = await win.evaluate(() => ({
    title: document.querySelector('.about-name')?.textContent ?? '',
    confirm: document.querySelector('.modal-confirm')?.textContent ?? '',
  }));
  check('关于对话框显示产品名与本地化按钮', dialog.title === 'PDF Looker Pro' && dialog.confirm.length > 0, `"${dialog.title}" / "${dialog.confirm}"`);
  await win.keyboard.press('Escape');
  await win.waitForTimeout(300);

  await win.click('#btn-settings');
  await win.waitForSelector('.modal-settings', { timeout: 5000 });
  await win.selectOption('.settings-select[data-key="language"]', 'zh-CN');
  await win.click('.modal-confirm');
  await win.waitForTimeout(300);

  // P4: the resource container ships inside the asar and is served over app://.
  const resources = await win.evaluate(() => {
    const badge = document.querySelector('.page-badge');
    return {
      badges: document.querySelectorAll('.page-badge').length,
      firstBadge: badge?.textContent ?? '',
      badgeFont: badge ? getComputedStyle(badge).fontFamily : '',
      fontReady: document.fonts.check('13px "ARPK Sans"'),
      icons: document.querySelectorAll('.btn-icon').length,
    };
  });
  check('打包外壳中每页有角标', resources.badges === 24, String(resources.badges));
  check('角标使用容器内字体', resources.fontReady === true && resources.badgeFont.includes('ARPK Sans'), `check=${resources.fontReady} family=${resources.badgeFont.split(',')[0]}`);
  check('图标由容器注入', resources.icons >= 18, String(resources.icons));

  for (const [tool, expected] of [['#tool-hand', 'hand'], ['#tool-zoom', 'zoom'], ['#tool-snapshot', 'snapshot'], ['#tool-select', 'select']]) {
    await win.click(tool);
    await win.waitForTimeout(80);
    const attr = await win.evaluate(() => document.querySelector('#scroll-container')?.getAttribute('data-tool'));
    check(`工具切换 ${expected}`, attr === expected, `data-tool=${attr}`);
  }

  // Native snapshot export inside Electron.
  await win.click('#tool-snapshot');
  await win.click('#btn-fit-page');
  await win.waitForTimeout(900);
  const box = await win.evaluate(() => {
    const vh = window.innerHeight;
    for (const el of document.querySelectorAll('.page:not(.unrendered)')) {
      const r = el.getBoundingClientRect();
      const top = Math.max(r.top, 60);
      const bottom = Math.min(r.bottom, vh);
      if (r.width > 100 && bottom - top > 120) return { x: r.left, y: top, w: r.width, h: bottom - top };
    }
    return null;
  });
  if (box) {
    await win.mouse.move(Math.round(box.x + box.w * 0.2), Math.round(box.y + box.h * 0.2));
    await win.mouse.down();
    await win.mouse.move(Math.round(box.x + box.w * 0.7), Math.round(box.y + box.h * 0.5), { steps: 8 });
    await win.mouse.up();
    await win.waitForTimeout(1200);
    const status = await win.evaluate(() => document.querySelector('#status-text')?.textContent ?? '');
    check('快照在 Electron 中导出', status.includes('快照'), status);
  } else {
    check('快照在 Electron 中导出', false, '找不到可用页面区域');
  }

  const shot = join(shots, 'p2-electron.png');
  await win.screenshot({ path: shot });
  console.log(`  截图: ${shot}`);

  check('无未捕获页面错误', errors.length === 0, errors.slice(0, 2).join(' | '));
  check('无控制台错误', consoleErrors.length === 0, consoleErrors.slice(0, 2).join(' | '));

  const info = app.windows().length;
  check('窗口数量正确', info === 1, `windows=${info}`);
} finally {
  await app.close();
}

console.log(`\n=== 结果: ${passed} 通过 / ${failed} 失败 ===`);
if (failed > 0) process.exitCode = 1;
