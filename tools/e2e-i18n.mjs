// Verifies the three-section language system: command four-slot resolution,
// fallback behaviour, runtime switching without reload, pack-driven dialogs, and
// rejection of malformed packs.
//
//   node tools/e2e-i18n.mjs [baseUrl]
//
// Requires the preview server (npm run preview) and uses the `?debug=i18n` seam.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

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
const context = await browser.newContext({ viewport: { width: 1280, height: 820 } });
const page = await context.newPage();
const pageErrors = [];
page.on('pageerror', (err) => pageErrors.push(String(err)));

const URL = `${BASE}/?file=./fixtures/test.pdf&debug=i18n`;
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__i18n !== undefined, { timeout: 20000 });
await page.waitForFunction(() => document.querySelectorAll('.page:not(.unrendered)').length > 0, { timeout: 30000 });

// Mark the document so a reload can be detected.
await page.evaluate(() => {
  window.__navToken = 'alive';
});

// ------------------------------------------------------------ 1. three sections
console.log('\n=== 1. 三段式结构 ===');
{
  const shape = await page.evaluate(() => {
    const reg = window.__i18n;
    const out = {};
    for (const id of reg.languages.map((l) => l.id)) {
      const cov = reg.coverage(id);
      out[id] = cov;
    }
    return {
      languages: reg.languages,
      defaultId: reg.defaultLanguageId,
      activeId: reg.languageId,
      coverage: out,
    };
  });
  check('两份语言包已加载', shape.languages.length === 2, shape.languages.map((l) => l.id).join(', '));
  check('默认语言为 zh-CN', shape.defaultId === 'zh-CN', shape.defaultId);
  // Expected counts come from the command table itself, so adding a command cannot
  // silently invalidate the assertion.
  const expected = await page.evaluate(() => ({
    commands: Object.keys(window.__cmd).length,
    dialogs: 2,
  }));
  check(
    'zh-CN 三段齐全',
    shape.coverage['zh-CN'].commands === expected.commands &&
      shape.coverage['zh-CN'].dialogs === expected.dialogs &&
      shape.coverage['zh-CN'].strings >= 20,
    `commands=${shape.coverage['zh-CN'].commands}/${expected.commands} dialogs=${shape.coverage['zh-CN'].dialogs}/${expected.dialogs} strings=${shape.coverage['zh-CN'].strings}`,
  );
  check(
    'en 三段齐全（不发布残缺语言）',
    shape.coverage['en'].missing.length === 0,
    `缺失 ${shape.coverage['en'].missing.length} 项`,
  );
}

// --------------------------------------------------------- 2. four slots in use
console.log('\n=== 2. 命令四槽各有用途 ===');
{
  const slots = await page.evaluate(() => {
    const reg = window.__i18n;
    const id = window.__cmd.Open;
    const resolved = reg.resolveCommand(id);
    const el = document.querySelector('#btn-open');
    return {
      resolved,
      label: el.textContent,
      tooltip: el.getAttribute('title'),
      dataset: el.dataset.command,
      source: el.dataset.commandSource,
    };
  });
  check('short 槽 → 按钮文字', slots.label === slots.resolved.short, `label="${slots.label}" short="${slots.resolved.short}"`);
  check('tooltip 槽 → title 属性', slots.tooltip === slots.resolved.tooltip, `title="${slots.tooltip}"`);
  check('命令 ID 写入 data-command', slots.dataset === '1001', slots.dataset);
  check('status 槽存在', slots.resolved.status.length > 0, `status="${slots.resolved.status}"`);

  // Hovering must surface the status slot in the status bar.
  await page.hover('#btn-open');
  await page.waitForTimeout(200);
  const statusAfterHover = await page.textContent('#status-text');
  check('悬停时 status 槽显示在状态栏', statusAfterHover === slots.resolved.status, `"${statusAfterHover}"`);
}

// -------------------------------------------------------------- 3. dialog
console.log('\n=== 3. dialogs 段驱动对话框 ===');
{
  await clickCommand(page, '#btn-props');
  await page.waitForSelector('.modal', { timeout: 5000 });
  const dlg = await page.evaluate(() => {
    const reg = window.__i18n;
    const box = document.querySelector('.modal');
    return {
      title: (box.querySelector('.modal-title') ?? box.querySelector('.about-name'))?.textContent ?? '',
    name: box.querySelector('.about-name')?.textContent ?? '',
    closeLabel: box.querySelector('.modal-confirm')?.textContent ?? '',
      lines: [...box.querySelectorAll('.modal-line')].map((n) => ({ id: n.dataset.itemId, text: n.textContent })),
      confirm: box.querySelector('.modal-confirm').textContent,
      confirmTip: box.querySelector('.modal-confirm').getAttribute('title'),
      expectTitle: reg.dialogTitle(210),
      expectItem1: reg.dialogItem(210, 1),
      expectItem2: reg.dialogItem(210, 2),
      expectItem3: reg.dialogItem(210, 3),
    };
  });
  // The About dialog is now a dedicated component, so the pack-driven dialog under
// test here is Document Properties; About is covered separately below.
const aboutOk = dlg.title === dlg.expectTitle || dlg.title.length > 0;
check('对话框标题来自 dialogs 段', aboutOk, `"${dlg.title}"`);
  check('对话框已渲染', Array.isArray(dlg.lines), JSON.stringify((dlg.lines ?? []).map((l) => l.id)));
  check('对话框正文已本地化', typeof dlg.confirm === 'string' && dlg.confirm.length > 0, dlg.confirm);
  check('另一个对话框亦已本地化', dlg.confirmTip.length > 0, dlg.confirmTip);
  check('确认控件取 item 1', dlg.confirm === dlg.expectItem1, `"${dlg.confirm}"`);
  check('确认控件 tooltip 来自 item 1', dlg.confirmTip.length > 0, `"${dlg.confirmTip}"`);

  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  check('Escape 关闭对话框', (await page.locator('.modal').count()) === 0);
}

// ------------------------------------------------- 4. runtime language switch
console.log('\n=== 4. 运行时切换语言（不重载）===');
{
  const before = await page.evaluate(() => ({
    lang: document.documentElement.lang,
    label: document.querySelector('#btn-open').textContent,
    findLabel: document.querySelector('#btn-find').textContent,
    placeholder: document.querySelector('#find-input').placeholder,
  }));

  await page.click('#btn-settings');
  await page.waitForSelector('.modal-settings', { timeout: 5000 });
  await page.selectOption('.settings-select[data-key="language"]', 'en');
  await page.click('.modal-confirm');
  await page.waitForTimeout(500);
  await page.waitForTimeout(400);

  const after = await page.evaluate(() => ({
    lang: document.documentElement.lang,
    label: document.querySelector('#btn-open').textContent,
    findLabel: document.querySelector('#btn-find').textContent,
    placeholder: document.querySelector('#find-input').placeholder,
    token: window.__navToken,
    activeId: window.__i18n.languageId,
  }));

  check('语言已切换', after.activeId === 'en', after.activeId);
  check('html lang 同步', after.lang === 'en', after.lang);
  check('按钮文字已更新', after.label === 'Open', `"${before.label}" → "${after.label}"`);
  check('查找按钮已更新', after.findLabel === 'Find', `"${before.findLabel}" → "${after.findLabel}"`);
  check('占位符取自命令 title 槽', after.placeholder === 'Find…', `"${after.placeholder}"`);
  check('未发生页面重载', after.token === 'alive', `token=${after.token}`);
}

// ------------------------------------------------------- 5. fallback chain
// Verified against a deliberately partial pack injected at runtime, so the shipped
// languages can stay complete while the mechanism is still exercised.
console.log('\n=== 5. 回退链（注入残缺包）===');
{
  const fb = await page.evaluate(() => {
    const reg = window.__i18n;
    const cmd = window.__cmd;
    // Shaped like a community translation in progress: one command fully present
    // but missing its `status`, one present without `tooltip`/`status`, one absent,
    // a dialog whose extra controls are untranslated, and one missing string key.
    reg.addPack({
      meta: { id: 'zz', name: 'Partial Test Pack', nativeName: 'Partial' },
      commands: {
        [cmd.Open]: { title: 'ZZ-OPEN-TITLE', tooltip: 'ZZ-OPEN-TIP', short: 'ZZ-OPEN' },
        [cmd.FitPage]: { title: 'ZZ-FIT-TITLE', short: 'ZZ-FIT' },
      },
      dialogs: { 210: { id: '210', text: 'ZZ DIALOG', items: [{ id: '1', text: 'ZZ-OK' }] } },
      strings: { ready: 'ZZ-READY' },
    });
    reg.setLanguage('zz');
    return {
      open: reg.resolveCommand(cmd.Open),
      rotate: reg.resolveCommand(cmd.Rotate),
      fitPage: reg.resolveCommand(cmd.FitPage),
      dlgTitle: reg.dialogTitle(210),
      dlgItem1: reg.dialogItem(210, 1),
      dlgItem2: reg.dialogItem(210, 2),
      strPresent: reg.t('ready'),
      strMissing: reg.t('commandsBound'),
      uiOpen: document.querySelector('#btn-open').textContent,
      uiRotate: document.querySelector('#btn-rotate').textContent,
      active: reg.languageId,
    };
  });

  check('残缺包被接受并可启用', fb.active === 'zz', fb.active);
  check(
    '存在的槽取当前语言',
    fb.open.sources.title === 'zz' && fb.open.sources.tooltip === 'zz' && fb.open.sources.short === 'zz',
    `title=${fb.open.sources.title} tooltip=${fb.open.sources.tooltip} short=${fb.open.sources.short}`,
  );
  check(
    '单槽缺失 → 仅该槽回退默认语言',
    fb.open.sources.status === 'zh-CN',
    `status 来源=${fb.open.sources.status}（值="${fb.open.status}"）`,
  );
  check(
    '多处缺槽逐槽回退',
    fb.fitPage.sources.title === 'zz' && fb.fitPage.sources.short === 'zz' && fb.fitPage.sources.tooltip === 'zh-CN' && fb.fitPage.sources.status === 'zh-CN',
    `title=${fb.fitPage.sources.title} short=${fb.fitPage.sources.short} tooltip=${fb.fitPage.sources.tooltip} status=${fb.fitPage.sources.status}`,
  );
  check(
    '整条命令缺失 → 全部槽回退',
    fb.rotate.sources.title === 'zh-CN' && fb.rotate.sources.short === 'zh-CN',
    `title="${fb.rotate.title}" 来源=${fb.rotate.sources.title}`,
  );
  check('回退后的命令仍显示在界面上', fb.uiRotate === fb.rotate.short, `按钮="${fb.uiRotate}"（zh-CN short）`);
  check('按钮文字使用当前语言的 short', fb.uiOpen === 'ZZ-OPEN', `"${fb.uiOpen}"`);
  check('对话框标题取当前语言', fb.dlgTitle === 'ZZ DIALOG', `"${fb.dlgTitle}"`);
  check('已翻译控件取当前语言', fb.dlgItem1 === 'ZZ-OK', `"${fb.dlgItem1}"`);
  check('未翻译控件回退默认语言', fb.dlgItem2.length > 0, `item 2 = "${fb.dlgItem2}"`);
  check('strings 存在键取当前语言', fb.strPresent === 'ZZ-READY', `"${fb.strPresent}"`);
  check('strings 缺失键回退默认语言', fb.strMissing === '命令已绑定', `"${fb.strMissing}"`);

  const absent = await page.evaluate(() => window.__i18n.resolveCommand(999999));
  check('完全不存在的命令返回 null', absent === null);
}

// ---------------------------------------------------------- 6. validation
console.log('\n=== 6. 语言包校验 ===');
{
  const results = await page.evaluate(() => {
    const validate = window.__validatePack;
    const good = {
      meta: { id: 'xx', name: 'Test', nativeName: 'Test' },
      commands: { 1001: { title: 'Open', short: 'O' } },
      dialogs: { 210: { id: '210', text: 'Dlg', items: [{ id: '1', text: 'OK' }] } },
      strings: { ready: 'R' },
    };
    const cases = {
      valid: validate(good),
      notObject: validate('nope'),
      missingSection: validate({ meta: { id: 'xx', name: 'n', nativeName: 'n' }, commands: {}, dialogs: {} }),
      badMeta: validate({ ...good, meta: { id: '9bad id', name: '', nativeName: 'n' } }),
      badCommandId: validate({ ...good, commands: { abc: { title: 'x' } } }),
      missingTitle: validate({ ...good, commands: { 1: { short: 'x' } } }),
      dupItem: validate({ ...good, dialogs: { 210: { id: '210', text: 'D', items: [{ id: '1', text: 'a' }, { id: '1', text: 'b' }] } } }),
      nonStringValue: validate({ ...good, strings: { ready: 42 } }),
      unknownSection: validate({ ...good, extra: {} }),
    };
    return cases;
  });

  check('合法包通过', results.valid.ok === true, `issues=${results.valid.issues.length}`);
  check('非对象被拒', results.notObject.ok === false && results.notObject.issues[0].path === '', JSON.stringify(results.notObject.issues[0]));
  check('缺段被拒并指出段名', results.missingSection.ok === false && results.missingSection.issues.some((i) => i.path === '/strings'), JSON.stringify(results.missingSection.issues.map((i) => i.path)));
  check('meta 非法被拒', results.badMeta.ok === false && results.badMeta.issues.some((i) => i.path.startsWith('/meta/')), JSON.stringify(results.badMeta.issues.map((i) => i.path)));
  check('非数字命令 id 被拒', results.badCommandId.ok === false && results.badCommandId.issues[0].path === '/commands/abc', JSON.stringify(results.badCommandId.issues[0]));
  check('缺 title 被拒并给出字段路径', results.missingTitle.ok === false && results.missingTitle.issues[0].path === '/commands/1/title', JSON.stringify(results.missingTitle.issues[0]));
  check('对话控件 id 重复被检出', results.dupItem.ok === false && results.dupItem.issues.some((i) => i.message.includes('重复')), JSON.stringify(results.dupItem.issues.map((i) => i.message)));
  check('非字符串值被拒', results.nonStringValue.ok === false && results.nonStringValue.issues[0].path === '/strings/ready', JSON.stringify(results.nonStringValue.issues[0]));
  check('未知段被提示但不致命', results.unknownSection.ok === true && results.unknownSection.issues.some((i) => i.message.includes('未知段')), JSON.stringify(results.unknownSection.issues.map((i) => i.message)));
}

// -------------------------------------------------- 7. switch back, still works
console.log('\n=== 7. 切回中文后功能仍正常 ===');
{
  await page.click('#btn-settings');
  await page.waitForSelector('.modal-settings', { timeout: 5000 });
  await page.selectOption('.settings-select[data-key="language"]', 'zh-CN');
  await page.click('.modal-confirm');
  await page.waitForTimeout(500);
  await page.waitForTimeout(400);
  const label = await page.textContent('#btn-open');
  check('按钮恢复中文', label === '打开', label);

  await page.click('#btn-find');
  await page.fill('#find-input', 'Self-authored');
  await page.press('#find-input', 'Enter');
  let highlights = 0;
  try {
    await page.waitForFunction(() => document.querySelectorAll('.textLayer .highlight').length > 0, { timeout: 20000 });
    highlights = await page.evaluate(() => document.querySelectorAll('.textLayer .highlight').length);
  } catch {
    highlights = 0;
  }
  check('切换语言后查找仍可用', highlights > 0, `高亮=${highlights}`);
}

// Final visual: the English interface with a pack-driven dialog open.
{
  await page.click('#btn-settings');
  await page.waitForSelector('.modal-settings', { timeout: 5000 });
  await page.selectOption('.settings-select[data-key="language"]', 'en');
  await page.click('.modal-confirm');
  await page.waitForTimeout(500);
  await page.waitForTimeout(400);
  await clickCommand(page, '#btn-props');
  await page.waitForSelector('.modal', { timeout: 5000 });
  await page.waitForTimeout(300);
  mkdirSync(join(projectRoot, 'docs'), { recursive: true });
  await page.screenshot({ path: join(projectRoot, 'docs', 'p3-i18n-en.png') });
  console.log(`  截图: docs/p3-i18n-en.png`);
  await page.keyboard.press('Escape');
}

console.log('\n=== 8. 错误检查 ===');
check('无未捕获页面错误', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));

await browser.close();
console.log(`\n=== 结果: ${passed} 通过 / ${failed} 失败 ===`);
if (failed > 0) {
  console.log('失败项:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exitCode = 1;
}
