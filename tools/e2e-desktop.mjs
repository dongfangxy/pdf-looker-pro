// Verifies the desktop shell: the native menu is built from the command table and
// follows the language, a file passed on the command line is opened, and window
// geometry survives a restart.
//
//   node tools/e2e-desktop.mjs [--exe=<path to packaged exe>]
import { _electron as electron } from 'playwright';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, '..');
const fixture = join(projectRoot, 'public', 'fixtures', 'test.pdf');
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
const packagedExe = resolveTarget();

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

// ELECTRON_RUN_AS_NODE makes the binary behave as plain Node; clear it.
const childEnv = { ...process.env };
delete childEnv.ELECTRON_RUN_AS_NODE;

function launch(extraArgs = []) {
  const base = packagedExe ? { executablePath: packagedExe, args: extraArgs } : { args: ['.', ...extraArgs], cwd: projectRoot, env: childEnv };
  return electron.launch(base);
}

console.log('=== 1. 原生菜单 ===');
let app = await launch();
try {
  let win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await win.waitForTimeout(1500);

  const menu = await app.evaluate(({ Menu }) => {
    const m = Menu.getApplicationMenu();
    if (!m) return null;
    const walk = (items) =>
      items.map((i) => ({
        label: i.label,
        type: i.type,
        accelerator: i.accelerator ?? null,
        submenu: i.submenu ? walk(i.submenu.items) : null,
      }));
    return walk(m.items);
  });
  check('应用菜单已安装', menu !== null && menu.length >= 5, menu ? `${menu.length} 个顶级菜单` : '无');
  const labels = (menu ?? []).map((m) => m.label);
  check('菜单含文件/视图/工具/批注', ['文件', '视图', '工具', '批注'].every((l) => labels.includes(l)), labels.join(', '));

  const flat = [];
  const collect = (items) => {
    for (const item of items) {
      flat.push(item);
      if (item.submenu) collect(item.submenu);
    }
  };
  collect(menu ?? []);
  check('菜单项由命令表驱动（含快捷键）', flat.some((i) => i.accelerator === 'CmdOrCtrl+O') && flat.some((i) => i.accelerator === 'CmdOrCtrl+S'), flat.filter((i) => i.accelerator).length + ' 个带快捷键');
  check('批注菜单含六种工具', flat.some((i) => i.label === '高亮') && flat.some((i) => i.label === '矩形框'), flat.filter((i) => ['高亮', '下划线', '删除线', '自由墨迹', '便签', '矩形框'].includes(i.label)).length + '/6');

  // Language switch must relabel the menu bar too.
  await win.click('#btn-settings');
  await win.waitForSelector('.modal-settings', { timeout: 5000 });
  await win.selectOption('.settings-select[data-key="language"]', 'en');
  await win.click('.modal-confirm');
  await win.waitForTimeout(500);
  await win.waitForTimeout(800);
  const enLabels = await app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.items.map((i) => i.label) ?? []);
  check('切换语言后菜单栏同步', enLabels.includes('File') && enLabels.includes('Annotate'), enLabels.join(', '));
  await win.click('#btn-settings');
  await win.waitForSelector('.modal-settings', { timeout: 5000 });
  await win.selectOption('.settings-select[data-key="language"]', 'zh-CN');
  await win.click('.modal-confirm');
  await win.waitForTimeout(500);
  await win.waitForTimeout(600);

  console.log('\n=== 2. 窗口标题 ===');
  await win.setInputFiles('#file-input', fixture);
  await win.waitForFunction(() => document.querySelectorAll('.page:not(.unrendered)').length > 0, { timeout: 30000 });
  await win.waitForTimeout(600);
  const title = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.getTitle() ?? '');
  check('原生窗口标题反映文档', title.includes('Test Fixture'), title);
  check('标题含应用名', title.includes('PDF Looker Pro'), title);

  console.log('\n=== 3. 渲染进程可见桌面桥 ===');
  const bridge = await win.evaluate(() => ({
    isDesktop: window.desktop?.isDesktop === true,
    platform: window.desktop?.platform ?? '',
    electron: window.desktop?.versions?.electron ?? '',
  }));
  check('预加载桥已暴露', bridge.isDesktop === true, `platform=${bridge.platform} electron=${bridge.electron}`);

  console.log('\n=== 4. 窗口状态记忆 ===');
  // A maximized window saved by an earlier run makes setBounds a no-op, so normalise
  // the state and let the un-maximize settle before resizing.
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    if (w.isMaximized()) w.unmaximize();
  });
  await win.waitForTimeout(900);
  const resized = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    w.setBounds({ x: 120, y: 90, width: 1024, height: 700 });
    return w.getBounds();
  });
  await win.waitForTimeout(700);
  check('窗口已调整尺寸', Math.abs(resized.width - 1024) <= 2 && Math.abs(resized.height - 700) <= 2, resized.width + 'x' + resized.height);

  // Confirm the close handshake completes so the final geometry is written. With no
  // unsaved annotations the renderer confirms immediately and the app exits.
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close());
  await new Promise((r) => setTimeout(r, 1800));
  let stillRunning = true;
  try {
    await app.evaluate(() => 1);
  } catch {
    stillRunning = false;
  }
  check('关闭握手完成并退出', stillRunning === false, stillRunning ? '仍在运行' : '已退出');
} finally {
  await app.close().catch(() => undefined);
}

console.log('\n=== 5. 重启后恢复几何 ===');
app = await launch();
try {
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await win.waitForTimeout(1200);
  const bounds = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.getBounds() ?? null);
  check('窗口几何被恢复', bounds !== null && Math.abs(bounds.width - 1024) <= 12 && Math.abs(bounds.height - 700) <= 12, bounds ? bounds.width + 'x' + bounds.height + ' @ ' + bounds.x + ',' + bounds.y : '\u65e0');
} finally {
  await app.close().catch(() => undefined);
}

console.log('\n=== 6. 命令行传入 PDF 即打开 ===');
app = await launch([fixture]);
try {
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  let pages = 0;
  try {
    await win.waitForFunction(() => document.querySelectorAll('.page').length > 1, { timeout: 30000 });
    pages = await win.evaluate(() => document.querySelectorAll('.page').length);
  } catch {
    pages = 0;
  }
  check('命令行文件被打开（文件关联路径）', pages === 24, `页数=${pages}`);
  const title2 = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.getTitle() ?? '');
  check('标题反映该文件', title2.includes('Test Fixture'), title2);
} finally {
  await app.close().catch(() => undefined);
}

console.log(`\n=== 结果: ${passed} 通过 / ${failed} 失败 ===`);
if (failed > 0) {
  console.log('失败项:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exitCode = 1;
}
