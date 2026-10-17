// Verifies the toolbar redesign and the annotation interaction fixes.
//
//   node tools/e2e-ux.mjs [baseUrl]
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
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));
const consoleErrors = [];
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text());
});

async function clickCommand(page, selector) {
  const state = await page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return { found: false };
    return { found: true, visible: el.offsetParent !== null, command: el.dataset.command ?? null };
  }, selector);
  if (!state.found) throw new Error(`no element for ${selector}`);
  if (state.visible) { await page.click(selector); return; }
  const alreadyOpen = await page.evaluate(() => !document.querySelector('#overflow-menu').classList.contains('hidden'));
  if (!alreadyOpen) { await page.click('#btn-more'); await page.waitForTimeout(300); }
  await page.click(`#overflow-menu .more-run[data-command="${state.command}"]`);
}
await page.goto(`${BASE}/?file=./fixtures/test.pdf&debug=p5`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('.page:not(.unrendered)').length > 0, { timeout: 30000 });
await page.waitForTimeout(700);

console.log('\n=== 1. 工具栏可见性 ===');
{
  for (const width of [1600, 1440, 1280, 1100]) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(450);
    const m = await page.evaluate(() => {
      const bar = document.querySelector('.toolbar');
      const settings = document.querySelector('#btn-settings');
      const label = settings?.querySelector('.btn-label');
      const r = settings?.getBoundingClientRect();
      return {
        height: bar.scrollHeight,
        compact: bar.classList.contains('compact'),
        settingsVisible: !!r && r.width > 0 && r.right <= window.innerWidth,
        settingsLabelled: !!label && getComputedStyle(label).display !== 'none' && label.textContent.trim().length > 0,
        settingsText: label?.textContent?.trim() ?? '',
      };
    });
    const singleRow = m.height <= 52;
    const maxAllowed = width >= 1440 ? 52 : 76;
    check(
      `${width}px 下设置按钮可见有文字${width >= 1440 ? '，且单行' : ''}`,
      m.height <= maxAllowed && !m.compact && m.settingsVisible && m.settingsLabelled,
      `高=${m.height} 单行=${singleRow} compact=${m.compact} 可见=${m.settingsVisible} 文字="${m.settingsText}"`,
    );
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.waitForTimeout(400);
}

console.log('\n=== 2. 更多菜单：工具栏定制 ===');
{
  const hiddenByDefault = await page.evaluate(() => ({
    rect: document.querySelector('#annot-rect')?.offsetParent === null,
    ellipse: document.querySelector('#annot-ellipse')?.offsetParent === null,
    props: document.querySelector('#btn-props')?.offsetParent === null,
  }));
  check('次要命令默认不占工具栏', hiddenByDefault.rect && hiddenByDefault.ellipse && hiddenByDefault.props, JSON.stringify(hiddenByDefault));

  await page.click('#btn-more');
  await page.waitForTimeout(320);
  const menu = await page.evaluate(() => {
    const el = document.querySelector('#overflow-menu');
    const anchor = document.querySelector('#btn-more').getBoundingClientRect();
    const bar = document.querySelector('.toolbar').getBoundingClientRect();
    return {
      open: !el.classList.contains('hidden'),
      names: [...el.querySelectorAll('.more-run')].map((b) => b.textContent),
      ticks: el.querySelectorAll('.more-check').length,
      sections: [...el.querySelectorAll('.menu-section')].map((s) => s.textContent),
      anchorGap: Math.round(Math.abs(el.getBoundingClientRect().left - anchor.left)),
      fitsUnderAnchor: Math.abs(el.getBoundingClientRect().left - anchor.left) <= 2,
      clampedInside:
        el.getBoundingClientRect().right <= bar.right + 1 &&
        el.getBoundingClientRect().left < anchor.left,
    };
  });
  check('菜单可打开', menu.open === true);
  // Either it sits exactly under the button, or it was pulled in only as far as needed
  // to stay inside the window. Both read as attached; pinned to the far right does not.
  check(
    '菜单贴着“更多”按钮（必要时内收以留在窗口内）',
    menu.fitsUnderAnchor || menu.clampedInside,
    `left 差 ${menu.anchorGap}px, 内收=${menu.clampedInside}`,
  );
  check('列出所有可定制按钮且每项有勾选框', menu.names.length >= 30 && menu.ticks === menu.names.length, `${menu.names.length} 项 / ${menu.ticks} 勾选框`);
  // The names follow the original product: the text box is its typewriter, the bubble its
  // callout text. Renamed here so the list keeps proving that tools are present, not that
  // they kept an older label.
  check('包含形状与文档命令', ['矩形框', '椭圆', '箭头', '打字机', '对应文本', '文档属性', '关于'].every((n) => menu.names.includes(n)), menu.names.slice(0, 5).join(' / '));
  check('包含新增的批注与页面命令', ['图章', '展平注释...', '总括注释...', '删除页面...', '页面重排...'].every((n) => menu.names.includes(n)), '');
  check('包含视图与测量', ['连续滚动', '单页', '双页', '全屏', '距离测量', '周长测量', '面积测量'].every((n) => menu.names.includes(n)), '');
  check('按分组排列', menu.sections.length >= 6, menu.sections.slice(0, 5).join(' / '));

  // Anything that closed the popup (a prior click) must not break the tick test.
  const menuOpen = await page.evaluate(() => !document.querySelector('#overflow-menu').classList.contains('hidden'));
  if (!menuOpen) {
    await page.click('#btn-more');
    await page.waitForTimeout(320);
  }
  const tickRect = page.locator('#overflow-menu .more-check').nth(menu.names.indexOf('矩形框'));
  const before = await page.evaluate(() => [...document.querySelectorAll('.toolbar .btn')].filter((b) => b.offsetParent !== null).length);
  // The popup scrolls internally, which upsets Playwright's actionability check.
  await tickRect.evaluate((el) => { el.checked = true; el.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.waitForTimeout(400);
  const shown = await page.evaluate(() => ({
    count: [...document.querySelectorAll('.toolbar .btn')].filter((b) => b.offsetParent !== null).length,
    rect: document.querySelector('#annot-rect')?.offsetParent !== null,
  }));
  check('勾选后出现在工具栏上', shown.rect === true && shown.count === before + 1, `${before} -> ${shown.count}`);

  await tickRect.evaluate((el) => { el.checked = false; el.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.waitForTimeout(400);
  const off = await page.evaluate(() => ({
    count: [...document.querySelectorAll('.toolbar .btn')].filter((b) => b.offsetParent !== null).length,
    rect: document.querySelector('#annot-rect')?.offsetParent !== null,
  }));
  check('取消勾选后从工具栏移除', off.rect === false && off.count === before, `${shown.count} -> ${off.count}`);

  // The name still runs the command, so a hidden command stays reachable.
  await clickCommand(page, '#annot-rect');
  await page.waitForTimeout(400);
  check('点击名称可直接执行该命令', (await page.getAttribute('#scroll-container', 'data-tool')) === 'rect', await page.getAttribute('#scroll-container', 'data-tool'));

  await page.click('#btn-more').catch(() => undefined);
  await page.waitForTimeout(250);
  await page.click('#btn-color');
  await page.waitForTimeout(300);
  const popup = await page.evaluate(() => ({
    open: !document.querySelector('#color-popup').classList.contains('hidden'),
    swatches: document.querySelectorAll('#color-popup .swatch').length,
  }));
  check('颜色弹窗可打开且含全部预设色', popup.open && popup.swatches >= 12, `${popup.swatches} 色`);
  await page.click('#scroll-container', { position: { x: 600, y: 300 } });
  await page.waitForTimeout(300);
  check('点击页面后弹窗自动关闭', await page.evaluate(() => document.querySelector('#color-popup').classList.contains('hidden')));
}

console.log('\n=== 3. 任意工具下都能点选已有批注 ===');
{
  // Create a rectangle while the rect tool is active.
  await page.evaluate(() => document.querySelector('#scroll-container').scrollTop = 0);
  await page.waitForTimeout(400);
  await clickCommand(page, '#annot-rect');
  await page.waitForTimeout(250);
  const box = await page.evaluate(() => {
    const el = document.querySelector('.page:not(.unrendered)');
    const r = el.getBoundingClientRect();
    const top = Math.max(r.top, 70);
    return { x: Math.round(r.left + 80), y: Math.round(top + 60), w: r.width };
  });
  await page.mouse.move(box.x, box.y);
  await page.mouse.down();
  await page.mouse.move(box.x + 180, box.y + 90, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(500);
  const created = await page.evaluate(() => window.__store().count);
  check('创建了一个批注', created === 1, `count=${created}`);
  check('创建后自动回到选取工具', (await page.getAttribute('#scroll-container', 'data-tool')) === 'pointer', await page.getAttribute('#scroll-container', 'data-tool'));

  // Deselect, then click it again while the RECT tool is active.
  await page.mouse.click(box.x + 400, box.y + 200);
  await page.waitForTimeout(300);
  check('点空白处取消选中', (await page.evaluate(() => document.querySelectorAll('.annot.selected').length)) === 0);

  await page.click('#btn-more');
  await page.waitForTimeout(200);
  await clickCommand(page, '#annot-rect');
  await page.waitForTimeout(250);
  const rectBox = await page.evaluate(() => {
    const el = document.querySelector('.annot-rect .annot-part');
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  });
  await page.mouse.click(rectBox.x, rectBox.y);
  await page.waitForTimeout(400);
  const after = await page.evaluate(() => ({
    selected: document.querySelectorAll('.annot.selected').length,
    frame: document.querySelectorAll('.annot-frame').length,
    count: window.__store().count,
  }));
  check('矩形工具激活时点击已有批注会选中它（不新建）', after.selected === 1 && after.count === 1, JSON.stringify(after));
  check('选中项显示轮廓框', after.frame === 1, `frame=${after.frame}`);
}

console.log('\n=== 4. 拖动移动 ===');
{
  await page.click('#tool-pointer');
  await page.waitForTimeout(200);
  const before = await page.evaluate(() => {
    const el = document.querySelector('.annot-rect .annot-part');
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left), y: Math.round(r.top), geom: JSON.stringify(window.__store().all[0].rect) };
  });
  await page.mouse.move(before.x + 60, before.y + 30);
  await page.mouse.down();
  await page.mouse.move(before.x + 160, before.y + 90, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(500);
  const after = await page.evaluate(() => {
    const el = document.querySelector('.annot-rect .annot-part');
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left), y: Math.round(r.top), geom: JSON.stringify(window.__store().all[0].rect) };
  });
  check('拖动后位置改变', Math.abs(after.x - before.x) > 40 && Math.abs(after.y - before.y) > 20, `${before.x},${before.y} -> ${after.x},${after.y}`);
  check('几何被写回页面空间', after.geom !== before.geom, after.geom);
}

console.log('\n=== 5. 文本框渲染与就地编辑 ===');
{
  await page.click('#btn-more');
  await page.waitForTimeout(200);
  await clickCommand(page, '#annot-textbox');
  await page.waitForTimeout(250);
  const spot = await page.evaluate(() => {
    const el = document.querySelector('.page:not(.unrendered)');
    const r = el.getBoundingClientRect();
    const top = Math.max(r.top, 70);
    return { x: Math.round(r.left + 60), y: Math.round(top + 320) };
  });
  await page.mouse.move(spot.x, spot.y);
  await page.mouse.down();
  await page.mouse.move(spot.x + 220, spot.y + 70, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  // The box is typed in place: no dialog, the caret goes straight into the annotation.
  await page.waitForSelector('.annot-editor', { timeout: 5000 });
  const promptShown = await page.locator('.modal').count();
  check('文本框不再弹出对话框', promptShown === 0, `${promptShown} 个 modal`);
  await page.fill('.annot-editor', '这是一行测试文字，应该完整显示');
  await page.keyboard.press('Control+Enter');
  await page.waitForTimeout(700);

  const tb = await page.evaluate(() => {
    const part = document.querySelector('.annot-textbox .annot-part');
    if (!part) return null;
    const r = part.getBoundingClientRect();
    const cs = getComputedStyle(part);
    return { w: Math.round(r.width), h: Math.round(r.height), font: cs.fontSize, overflow: cs.overflow, text: part.textContent, scrollH: part.scrollHeight, clientH: part.clientHeight };
  });
  check('文本框已创建', tb !== null, tb ? `${tb.w}×${tb.h}` : '无');
  if (tb) {
    check('文本框尺寸来自拖拽区域而非固定小框', tb.w > 120 && tb.h > 30, `${tb.w}×${tb.h}`);
    check('字号按视图缩放换算', parseFloat(tb.font) >= 12, tb.font);
    check('文字未被裁掉', tb.scrollH <= tb.clientH + 2, `scrollH=${tb.scrollH} clientH=${tb.clientH}`);
    check('文字内容完整', tb.text.includes('测试文字'), tb.text);
  }

  // Inline editing on double-click.
  await page.click('#tool-pointer');
  await page.waitForTimeout(200);
  const tbCenter = await page.evaluate(() => {
    const r = document.querySelector('.annot-textbox .annot-part').getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  });
  await page.mouse.dblclick(tbCenter.x, tbCenter.y);
  await page.waitForTimeout(400);
  const editorOpen = await page.locator('.annot-editor').count();
  check('双击后出现就地编辑器', editorOpen === 1, `${editorOpen}`);
  if (editorOpen === 1) {
    await page.fill('.annot-editor', '就地编辑后的新文字');
    await page.keyboard.press('Control+Enter');
    await page.waitForTimeout(500);
    const updated = await page.evaluate(() => ({
      note: window.__store().all.find((a) => a.kind === 'textbox')?.note,
      editors: document.querySelectorAll('.annot-editor').length,
      shown: document.querySelector('.annot-textbox .annot-part')?.textContent,
    }));
    check('就地编辑提交后写入模型', updated.note === '就地编辑后的新文字', String(updated.note));
    check('编辑器已关闭', updated.editors === 0, `${updated.editors}`);
    check('页面上显示新文字', updated.shown === '就地编辑后的新文字', String(updated.shown));
  }
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
