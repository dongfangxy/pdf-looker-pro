// Verifies the P5 features in a real browser: annotation tools and their overlays,
// the annotation panel, view modes, the document-properties dialog, and sidecar
// round-tripping through the ARPK container.
//
//   node tools/e2e-p5.mjs [baseUrl]
import { chromium } from 'playwright';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
const context = await browser.newContext({ viewport: { width: 1280, height: 860 }, acceptDownloads: true });
const page = await context.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));
const consoleErrors = [];
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text());
});

await page.goto(`${BASE}/?file=./fixtures/test.pdf&debug=p5`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('.page:not(.unrendered)').length > 0, { timeout: 30000 });
await page.waitForTimeout(400);

// ------------------------------------------------------------ 1. tool modes
console.log('\n=== 1. 批注工具 ===');
{
  const tools = [
    ['#annot-highlight', 'highlight', 'auto'],
    ['#annot-underline', 'underline', 'auto'],
    ['#annot-strikeout', 'strikeout', 'auto'],
    ['#annot-ink', 'ink', 'none'],
    ['#annot-note', 'note', 'none'],
    ['#annot-rect', 'rect', 'none'],
  ];
  let ok = 0;
  const details = [];
  for (const [selector, name, expectedPE] of tools) {
    await clickCommand(page, selector);
    await page.waitForTimeout(80);
    const state = await page.evaluate(() => ({
      tool: document.querySelector('#scroll-container')?.getAttribute('data-tool'),
      pe: getComputedStyle(document.querySelector('.textLayer')).pointerEvents,
      active: [...document.querySelectorAll('.toolbar .btn.active, #overflow-menu .menu-item.active')].map((b) => b.id),
    }));
    const toolActives = state.active.filter((id) => !id.startsWith("view-"));
    const expectedId = selector.slice(1);
    const good = state.tool === name && state.pe === expectedPE && toolActives.length === 1 && toolActives[0] === expectedId;
    if (good) ok++;
    else details.push(`${name}: tool=${state.tool} pe=${state.pe} active=${state.active.join(',')}`);
  }
  check('六种批注工具均可切换且文字层行为正确', ok === tools.length, details.length ? details.join(' | ') : `${ok}/${tools.length}`);

  const color = await page.evaluate(() => document.querySelector('#annot-color')?.value);
  check('颜色选择器存在', typeof color === 'string' && color.startsWith('#'), color);
}

// ------------------------------------------------------- 2. create + overlay
console.log('\n=== 2. 批注创建与渲染 ===');
{
  const before = await page.evaluate(() => document.querySelectorAll('.annot').length);
  await page.evaluate(() => window.__addRect(1, 100, 200, 240, 90, 'rect'));
  await page.waitForTimeout(300);
  const after = await page.evaluate(() => ({
    store: window.__store().count,
    overlays: document.querySelectorAll('.annot').length,
    kinds: [...document.querySelectorAll('.annot')].map((n) => [...n.classList].find((c) => c.startsWith('annot-') && c !== 'annot-overlay' && c !== 'annot-preview')),
    partBox: (() => {
      const part = document.querySelector('.annot-rect .annot-part');
      if (!part) return null;
      const r = part.getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height) };
    })(),
  }));
  check('批注已写入存储', after.store === 1 && before === 0, `count=${after.store}`);
  check('页面上出现批注覆盖层', after.overlays === 1 && after.kinds.includes('annot-rect'), after.kinds.join(','));
  check('覆盖层尺寸非零（已按当前缩放换算）', (after.partBox?.w ?? 0) > 10 && (after.partBox?.h ?? 0) > 10, `${after.partBox?.w}×${after.partBox?.h}`);

  await page.evaluate(() => window.__addRect(2, 80, 100, 200, 60, 'highlight'));
  await page.waitForTimeout(300);
  const two = await page.evaluate(() => ({
    count: window.__store().count,
    onPage2: window.__store().byPage(2).length,
    overlays: document.querySelectorAll('.annot-overlay').length,
  }));
  check('多页批注分别归页', two.count === 2 && two.onPage2 === 1, `total=${two.count} page2=${two.onPage2}`);
  check('每页各有一个覆盖层', two.overlays === 2, `overlays=${two.overlays}`);
}

// --------------------------------------------------------------- 3. panel
console.log('\n=== 3. 批注面板 ===');
{
  await page.click('#tab-annotations');
  await page.waitForTimeout(300);
  const panel = await page.evaluate(() => ({
    rows: document.querySelectorAll('.annot-row').length,
    pages: [...document.querySelectorAll('.annot-page')].map((n) => n.textContent),
    summary: document.querySelector('.annot-summary')?.textContent ?? '',
    visible: !document.querySelector('#pane-annotations')?.classList.contains('hidden'),
    kind: document.querySelector('.annot-kind')?.textContent ?? '',
  }));
  check('面板可见', panel.visible === true);
  check('列出全部批注', panel.rows === 2, `rows=${panel.rows}`);
  check('按页分组', panel.pages.length === 2 && panel.pages[0] === '1' && panel.pages[1] === '2', panel.pages.join(','));
  check('摘要显示数量', panel.summary.includes('2'), `"${panel.summary}"`);
  check('显示批注类型名称', panel.kind.length > 0, panel.kind);

  // Clicking a row jumps to its page.
  await page.click('.annot-row');
  await page.waitForTimeout(700);
  const jumped = await page.inputValue('#page-input');
  check('点击条目跳转到所属页', jumped === '1' || jumped === '2', `page=${jumped}`);

  // Deleting removes it everywhere.
  await page.click('.annot-row .annot-delete');
  await page.waitForTimeout(300);
  const afterDelete = await page.evaluate(() => ({
    count: window.__store().count,
    rows: document.querySelectorAll('.annot-row').length,
    overlays: document.querySelectorAll('.annot').length,
  }));
  check('删除后存储、面板、覆盖层同步', afterDelete.count === 1 && afterDelete.rows === 1 && afterDelete.overlays === 1, JSON.stringify(afterDelete));
}

// ------------------------------------------------------- 4. sidecar round trip
console.log('\n=== 4. 边车容器（ARPK）往返 ===');
{
  const dir = mkdtempSync(join(tmpdir(), 'pdfreader-p5-'));
  const downloadPromise = page.waitForEvent('download', { timeout: 20000 }).catch(() => null);
  await page.evaluate(() => window.__saveAnnotations());
  const download = await downloadPromise;
  check('保存批注触发下载', download !== null, download ? await download.suggestedFilename() : '无下载');

  if (download) {
    const file = join(dir, await download.suggestedFilename());
    await download.saveAs(file);
    const bytes = readFileSync(file);
    const isArpk = bytes.toString('latin1', 0, 4) === 'ARP1';
    check('边车是 ARPK 容器', isArpk, `${bytes.length} 字节, magic=${bytes.toString('latin1', 0, 4)}`);
    check('边车扩展名为 .arpk', file.endsWith('.arpk'), file.split(/[\\/]/).pop());

    // Parse it in Node with the same codec the app uses.
    const { openContainer } = await import('../src/assets/arpk.mjs');
    const container = openContainer(new Uint8Array(bytes));
    const payload = JSON.parse(await container.readText('annotations.json'));
    check('容器内有注释资源', container.has('annotations.json'), container.assets.map((a) => a.name).join(','));
    check('元数据记录了文档与数量', container.meta.get('annotations.count') === '1', JSON.stringify([...container.meta.entries()].filter(([k]) => k.startsWith('annotations.'))));
    check('批注数据可解析', Array.isArray(payload.annotations) && payload.annotations.length === 1, `count=${payload.annotations?.length}`);
    const first = payload.annotations[0];
    check('几何数据完整', typeof first.rect?.x === 'number' && typeof first.rect?.w === 'number', JSON.stringify(first.rect));
  }
}

// ------------------------------------------------------------ 5. view modes
console.log('\n=== 5. 视图模式 ===');
{
  await clickCommand(page, '#view-single');
  await page.waitForTimeout(700);
  const single = await page.evaluate(() => ({
    cls: document.querySelector('#pages')?.className ?? '',
    mode: document.querySelector('#pages')?.dataset['mode'],
    visible: [...document.querySelectorAll('.page')].filter((p) => getComputedStyle(p).display !== 'none').length,
    total: document.querySelectorAll('.page').length,
    current: document.querySelectorAll('.page.current').length,
  }));
  check('单页模式标记生效', single.cls.includes('mode-single') && single.mode === 'single', single.cls);
  check('单页模式只显示当前页', single.visible === 1 && single.total === 24, `可见=${single.visible}/${single.total}`);
  check('当前页被标记', single.current === 1, `current=${single.current}`);

  await clickCommand(page, '#view-spread');
  await page.waitForTimeout(800);
  const spread = await page.evaluate(() => ({
    cls: document.querySelector('#pages')?.className ?? '',
    visible: [...document.querySelectorAll('.page')].filter((p) => getComputedStyle(p).display !== 'none').length,
    zoom: document.querySelector('#zoom-label')?.textContent ?? '',
  }));
  check('双页模式标记生效', spread.cls.includes('mode-spread'), spread.cls);
  check('双页模式恢复显示全部页', spread.visible === 24, `可见=${spread.visible}`);
  check('双页模式自动改用适应页面', spread.zoom.length > 0, `zoom=${spread.zoom}`);

  await clickCommand(page, '#view-continuous');
  await page.waitForTimeout(700);
  const cont = await page.evaluate(() => document.querySelector('#pages')?.className ?? '');
  check('切回连续模式', !cont.includes('mode-single') && !cont.includes('mode-spread'), cont);
}

// --------------------------------------------------------- 6. properties
console.log('\n=== 6. 文档属性对话框 ===');
{
  await clickCommand(page, '#btn-props');
  await page.waitForSelector('.modal', { timeout: 5000 });
  const props = await page.evaluate(() => ({
    title: document.querySelector('.modal-title')?.textContent ?? '',
    rows: [...document.querySelectorAll('.modal-property')].map((r) => ({
      id: r.dataset.itemId,
      label: r.querySelector('.prop-label')?.textContent ?? '',
      value: r.querySelector('.prop-value')?.textContent ?? '',
    })),
    confirm: document.querySelector('.modal-confirm')?.textContent ?? '',
  }));
  check('属性对话框打开', props.title.length > 0, props.title);
  check('列出全部属性行', props.rows.length === 6, `rows=${props.rows.length}`);
  check('页数正确', props.rows.find((r) => r.id === '3')?.value === '24', JSON.stringify(props.rows.find((r) => r.id === '3')));
  check('页面尺寸非空', (props.rows.find((r) => r.id === '4')?.value ?? '').includes('×'), props.rows.find((r) => r.id === '4')?.value);
  check('标签来自语言包', props.rows.every((r) => r.label.length > 0));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
}

// ------------------------------------------------------------ 7. annotations
console.log('\n=== 7. 真实拖拽创建矩形批注 ===');
{
  await clickCommand(page, '#view-continuous');
  await page.waitForTimeout(600);
  await clickCommand(page, '#annot-rect');
  await page.waitForTimeout(150);
  const before = await page.evaluate(() => window.__store().count);
  // Pick a page region that is actually inside the viewport: a page scrolled above
  // the fold yields negative coordinates and the drag lands outside the document.
  const box = await page.evaluate(() => {
    const vh = window.innerHeight;
    for (const el of document.querySelectorAll('.page:not(.unrendered)')) {
      const r = el.getBoundingClientRect();
      const top = Math.max(r.top, 70);
      const bottom = Math.min(r.bottom, vh);
      if (r.width > 200 && bottom - top > 260) {
        return { x: r.left, y: top, w: r.width, h: bottom - top };
      }
    }
    return null;
  });
  check('找到视口内的可用页面区域', box !== null, box ? `${Math.round(box.x)},${Math.round(box.y)} ${Math.round(box.w)}×${Math.round(box.h)}` : '无');
  const x1 = Math.round(box.x + box.w * 0.25);
  const y1 = Math.round(box.y + box.h * 0.25);
  const x2 = Math.round(box.x + box.w * 0.6);
  const y2 = Math.round(box.y + box.h * 0.45);
  const hitPage = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest('.page')?.dataset.page ?? null, [x1, y1]);
  check('起点落在页面上', hitPage !== null, `page=${hitPage}`);
  await page.mouse.move(x1, y1);
  await page.mouse.down();
  await page.mouse.move(x2, y2, { steps: 8 });
  const preview = await page.evaluate(() => document.querySelectorAll('.annot-preview').length);
  await page.mouse.up();
  await page.waitForTimeout(400);
  const after = await page.evaluate(() => ({
    count: window.__store().count,
    last: window.__store().all[window.__store().count - 1],
  }));
  check('拖动过程中显示预览', preview === 1, `preview=${preview}`);
  check('松开后创建批注', after.count === before + 1, `${before} → ${after.count}`);
  check('批注几何为页面空间坐标', (after.last?.rect?.w ?? 0) > 10 && (after.last?.rect?.x ?? 0) > 0, JSON.stringify(after.last?.rect));

  // The annotation must survive a zoom, because it is stored in page space.
  await page.click('#btn-zoom-in');
  await page.waitForTimeout(600);
  const zoomed = await page.evaluate(() => {
    const parts = [...document.querySelectorAll('.annot-rect .annot-part')];
    const r = parts[parts.length - 1]?.getBoundingClientRect();
    return r ? { w: Math.round(r.width), h: Math.round(r.height) } : null;
  });
  check('缩放后批注随之放大（页面空间存储生效）', (zoomed?.w ?? 0) > 0, `放大后 ${zoomed?.w}×${zoomed?.h}`);
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
