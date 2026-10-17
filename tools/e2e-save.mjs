// Verifies that Ctrl+S saves straight back into the file that was opened, without a
// dialog, and that the document is then considered saved.
//
// Deliberately uses only real interactions -- a command-line open, a mouse drag, the real
// keyboard shortcut -- so it exercises the packaged application with no debug seams.
//
//   node tools/e2e-save.mjs [--exe=<path>]
import { _electron as electron } from 'playwright';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, '..');

function resolveTarget() {
  const explicit = process.argv.find((a) => a.startsWith('--exe='))?.slice('--exe='.length);
  if (explicit) return explicit;
  for (const candidate of ['release/win-unpacked/PDF Looker Pro.exe', 'release/win-unpacked/PDF Reader.exe']) {
    const full = resolve(projectRoot, candidate);
    if (existsSync(full)) return full;
  }
  return null;
}

let passed = 0;
let failed = 0;
const failures = [];
function check(name, ok, detail = '') {
  if (ok) {
    passed++;
    console.log(`  ok ${name}${detail ? `  ${detail}` : ''}`);
  } else {
    failed++;
    failures.push(name);
    console.log(`  FAIL ${name}${detail ? `  ${detail}` : ''}`);
  }
}

console.log('=== 保存到原文件验证 ===');

const workspace = mkdtempSync(join(tmpdir(), 'plp-save-'));
const target = join(workspace, 'save-target.pdf');
copyFileSync(resolve(projectRoot, 'public', 'fixtures', 'test.pdf'), target);
const originalSize = statSync(target).size;
console.log(`  测试文件: ${target}  ${originalSize} 字节`);

const childEnv = { ...process.env };
delete childEnv.ELECTRON_RUN_AS_NODE;

const packagedExe = resolveTarget();
const app = await electron.launch(
  packagedExe
    ? { executablePath: packagedExe, args: [target] }
    : { args: ['.', target], cwd: projectRoot, env: childEnv },
);
const win = await app.firstWindow();

await win.waitForFunction(() => document.querySelectorAll('.page:not(.unrendered)').length > 0, { timeout: 45000 });
await win.waitForTimeout(1000);
check('通过命令行参数打开了文档', true, await win.title());

await win.click('#annot-ink');
await win.waitForTimeout(300);
const box = await win.evaluate(() => {
  const r = document.querySelector('.page:not(.unrendered)').getBoundingClientRect();
  return { x: Math.round(r.left + 60), y: Math.round(Math.max(r.top, 70) + 120), w: 200, h: 80 };
});
await win.mouse.move(box.x, box.y);
await win.mouse.down();
await win.mouse.move(box.x + box.w, box.y + box.h, { steps: 12 });
await win.mouse.up();
await win.waitForTimeout(900);

await win.click('#tool-pointer');
await win.waitForTimeout(250);

const beforeTitle = await win.evaluate(() => document.querySelector('#doc-title')?.textContent ?? '');
check('保存前标题带未保存标记', beforeTitle.includes('*'), beforeTitle);

await win.keyboard.press('Control+S');
await win.waitForTimeout(3000);

const afterTitle = await win.evaluate(() => document.querySelector('#doc-title')?.textContent ?? '');
const status = await win.evaluate(() => document.querySelector('#status-text')?.textContent ?? '');
check('Ctrl+S 后未保存标记消失', !afterTitle.includes('*'), afterTitle);
check('状态栏报告已保存', /已保存|Saved/.test(status), status);

const afterSize = statSync(target).size;
check('原文件被原地覆盖并变大', afterSize > originalSize, `${originalSize} -> ${afterSize} 字节`);

const diskText = readFileSync(target, 'latin1');
check('磁盘上仍是合法 PDF', diskText.startsWith('%PDF-') && diskText.includes('%%EOF'));
check('墨迹批注已写入磁盘', /\/Subtype \/Ink/.test(diskText));

const dialogs = await win.evaluate(() => document.querySelectorAll('.modal').length);
check('保存过程没有弹出对话框', dialogs === 0, `${dialogs}`);

await app.close();
console.log(`\n=== 结果: ${passed} 通过 / ${failed} 失败 ===`);
if (failed > 0) {
  for (const f of failures) console.log(`  - ${f}`);
  process.exitCode = 1;
}
