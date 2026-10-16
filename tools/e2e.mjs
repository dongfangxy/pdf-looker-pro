// End-to-end verification for the reader, driven through a real browser so that
// pointer-drag interactions (hand panning, snapshot rubber band) are exercised,
// which click-only tooling cannot do.
//
//   node tools/e2e.mjs [baseUrl]
//
// Requires the preview server to be running (npm run preview).
import { chromium } from 'playwright';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
const context = await browser.newContext({
  viewport: { width: 1200, height: 800 },
  acceptDownloads: true,
  deviceScaleFactor: 1,
});
const page = await context.newPage();

const pageErrors = [];
page.on('pageerror', (err) => pageErrors.push(String(err)));
const consoleErrors = [];
page.on('console', (msg) => {
  if (msg.type() === 'error') consoleErrors.push(msg.text());
});

async function openDoc(file) {
  await page.goto(`${BASE}/?file=${file}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelectorAll('.page').length > 1, { timeout: 30000 });
  await page.waitForFunction(() => document.querySelectorAll('.page:not(.unrendered)').length > 0, { timeout: 30000 });
}

// ---------------------------------------------------------------- 1. baseline
console.log('\n=== 1. 载入与虚拟化 ===');
await openDoc('./fixtures/test.pdf');
{
  const info = await page.evaluate(() => ({
    total: document.querySelectorAll('.page').length,
    rendered: document.querySelectorAll('.page:not(.unrendered)').length,
    thumbs: document.querySelectorAll('.thumb').length,
    outline: document.querySelectorAll('.outline-label').length,
    title: document.querySelector('#doc-title')?.textContent ?? '',
    total2: document.querySelector('#page-total')?.textContent ?? '',
  }));
  check('打开 24 页文档', info.total === 24, `页数=${info.total}`);
  check('页面虚拟化：只光栅化视口附近', info.rendered > 0 && info.rendered <= 6, `已渲染=${info.rendered}/24`);
  check('缩略图全部生成', info.thumbs === 24, `缩略图=${info.thumbs}`);
  check('大纲节点已解析', info.outline === 9, `节点=${info.outline}`);
  check('标题读取正确', info.title.includes('Test Fixture'), info.title);
}

// ---------------------------------------------------------------- 2. 查找
console.log('\n=== 2. 查找与高亮 ===');
await page.click('#btn-find');
await page.fill('#find-input', 'Self-authored test fixture');
// Enter performs an immediate search rather than waiting for the debounce.
const t0 = Date.now();
await page.press('#find-input', 'Enter');
let highlighted = 0;
try {
  await page.waitForFunction(() => document.querySelectorAll('.textLayer .highlight').length > 0, { timeout: 25000 });
  highlighted = await page.evaluate(() => document.querySelectorAll('.textLayer .highlight').length);
} catch {
  highlighted = 0;
}
const findMs = Date.now() - t0;
{
  const count = (await page.textContent('#find-count')) ?? '';
  check('查找命中并高亮', highlighted > 0, `${highlighted} 处高亮，耗时 ${findMs} ms`);
  check('匹配计数显示为 n/total', /^\d+\/\d+$/.test(count.trim()), `#find-count="${count.trim()}"`);

  const multi = await page.evaluate(() => {
    const m = (document.querySelector('#find-count')?.textContent ?? '').match(/\/(\d+)/);
    return m ? Number(m[1]) : 0;
  });
  check('命中数量与 24 页相符', multi === 24, `总匹配=${multi}`);

  // The highlight must stay in flow: an out-of-flow span would displace the rest.
  const inFlow = await page.evaluate(() => {
    const h = document.querySelector('.textLayer .highlight');
    if (!h) return null;
    return { position: getComputedStyle(h).position, cls: h.className };
  });
  check('高亮 span 保持在文档流内', inFlow !== null && inFlow.position !== 'absolute', `position=${inFlow?.position}`);
  check('高亮带 appended 类', (inFlow?.cls ?? '').includes('appended'), inFlow?.cls ?? '');

  // Current match is marked distinctly.
  const selected = await page.evaluate(() => document.querySelectorAll('.textLayer .highlight.selected').length);
  check('当前命中单独标记', selected >= 1, `selected=${selected}`);

  // Navigation advances the counter.
  const before = await page.textContent('#find-count');
  await page.click('#find-next');
  await page.waitForTimeout(700);
  const after = await page.textContent('#find-count');
  check('下一个匹配推进计数', before !== after, `${before?.trim()} → ${after?.trim()}`);

  await page.click('#find-close');
  await page.waitForTimeout(300);
  const cleared = await page.evaluate(() => document.querySelectorAll('.textLayer .highlight').length);
  check('关闭查找栏清除高亮', cleared === 0, `剩余高亮=${cleared}`);
}

// ---------------------------------------------------------------- 3. 工具
console.log('\n=== 3. 工具模式 ===');
for (const [id, name] of [
  ['#tool-hand', 'hand'],
  ['#tool-zoom', 'zoom'],
  ['#tool-snapshot', 'snapshot'],
  ['#tool-select', 'select'],
]) {
  await page.click(id);
  await page.waitForTimeout(120);
  const state = await page.evaluate(() => ({
    tool: document.querySelector('#scroll-container')?.getAttribute('data-tool'),
    active: [...document.querySelectorAll('.toolbar [data-section="sectionTools"] .btn')]
      .filter((b) => b.classList.contains('active'))
      .map((b) => b.id),
    cursor: getComputedStyle(document.querySelector('#scroll-container')).cursor,
    textPE: getComputedStyle(document.querySelector('.textLayer')).pointerEvents,
  }));
  check(`切换到 ${name}`, state.tool === name, `data-tool=${state.tool}`);
  check(`${name} 按钮唯一高亮`, state.active.length === 1 && state.active[0] === id.slice(1), state.active.join(','));
  check(
    `${name} 文字层指针行为正确`,
    name === 'select' ? state.textPE === 'auto' : state.textPE === 'none',
    `pointer-events=${state.textPE}`,
  );
}
{
  const cursors = await page.evaluate(async () => {
    const out = {};
    for (const [id, key] of [['#tool-hand', 'hand'], ['#tool-zoom', 'zoom'], ['#tool-snapshot', 'snapshot'], ['#tool-select', 'select']]) {
      document.querySelector(id).click();
      await new Promise((r) => setTimeout(r, 60));
      out[key] = getComputedStyle(document.querySelector('#scroll-container')).cursor;
    }
    return out;
  });
  check('手形光标', cursors.hand === 'grab', cursors.hand);
  check('放大镜光标', cursors.zoom === 'zoom-in', cursors.zoom);
  check('快照光标', cursors.snapshot === 'crosshair', cursors.snapshot);
}

// ---------------------------------------------------------------- 4. 手形平移
console.log('\n=== 4. 手形拖拽平移 ===');
await page.click('#tool-hand');
await page.waitForTimeout(150);
{
  await page.evaluate(() => {
    document.querySelector('#scroll-container').scrollTop = 0;
  });
  await page.waitForTimeout(200);
  const beforeTop = await page.evaluate(() => document.querySelector('#scroll-container').scrollTop);
  await page.mouse.move(650, 500);
  await page.mouse.down();
  await page.mouse.move(650, 220, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const afterTop = await page.evaluate(() => document.querySelector('#scroll-container').scrollTop);
  check('拖动改变滚动位置', afterTop > beforeTop, `scrollTop ${beforeTop} → ${afterTop}`);
  const panningClass = await page.evaluate(() => document.querySelector('#scroll-container').classList.contains('panning'));
  check('拖动结束后清除 panning 状态', panningClass === false);
}

// ---------------------------------------------------------------- 5. 放大镜
console.log('\n=== 5. 放大镜点击缩放 ===');
await page.click('#tool-zoom');
await page.waitForTimeout(150);
{
  const before = Number((await page.textContent('#zoom-label'))?.replace('%', '') ?? '0');
  await page.mouse.click(650, 400);
  await page.waitForTimeout(500);
  const after = Number((await page.textContent('#zoom-label'))?.replace('%', '') ?? '0');
  check('点击放大', after > before, `${before}% → ${after}%`);
  await page.keyboard.down('Alt');
  await page.mouse.click(650, 400);
  await page.keyboard.up('Alt');
  await page.waitForTimeout(500);
  const back = Number((await page.textContent('#zoom-label'))?.replace('%', '') ?? '0');
  check('Alt+点击缩小', back < after, `${after}% → ${back}%`);
}

// ---------------------------------------------------------------- 6. 快照
console.log('\n=== 6. 快照导出 ===');
await page.click('#tool-snapshot');
// Fit-page so an entire page fits the viewport and the drag region is unambiguous.
await page.click('#btn-fit-page');
await page.waitForTimeout(900);
{
  const dir = mkdtempSync(join(tmpdir(), 'pdfreader-e2e-'));
  const downloadPromise = page.waitForEvent('download', { timeout: 20000 }).catch(() => null);

  const box = await page.evaluate(() => {
    const vh = window.innerHeight;
    for (const el of document.querySelectorAll('.page:not(.unrendered)')) {
      const r = el.getBoundingClientRect();
      const visible = Math.min(r.bottom, vh) - Math.max(r.top, 60);
      if (r.width > 100 && visible > 300) {
        return { x: r.left, y: Math.max(r.top, 60), w: r.width, h: Math.min(r.bottom, vh) - Math.max(r.top, 60), inView: true };
      }
    }
    return { x: 0, y: 0, w: 0, h: 0, inView: false };
  });
  check('找到视口内的可用页面区域', box.inView === true, `${Math.round(box.x)},${Math.round(box.y)} ${Math.round(box.w)}×${Math.round(box.h)}`);
  const x1 = Math.round(box.x + box.w * 0.2);
  const y1 = Math.round(box.y + box.h * 0.1);
  const x2 = Math.round(box.x + box.w * 0.8);
  const y2 = Math.round(box.y + box.h * 0.35);

  await page.mouse.move(x1, y1);
  await page.mouse.down();
  await page.mouse.move(x2, y2, { steps: 10 });
  const rubberVisible = await page.evaluate(() => document.querySelectorAll('.snap-rubber').length);
  await page.mouse.up();

  const download = await downloadPromise;
  await page.waitForTimeout(400);

  check('拖动时出现选框', rubberVisible === 1, `rubber=${rubberVisible}`);
  check('松开后触发下载', download !== null, download ? await download.suggestedFilename() : '无下载事件');
  check('拖动结束后移除选框', (await page.evaluate(() => document.querySelectorAll('.snap-rubber').length)) === 0);

  if (download) {
    const file = join(dir, await download.suggestedFilename());
    await download.saveAs(file);
    const buf = readFileSync(file);
    const isPng = buf[0] === 0x89 && buf.toString('latin1', 1, 4) === 'PNG';
    const w = buf.readUInt32BE(16);
    const h = buf.readUInt32BE(20);
    check('导出为有效 PNG', isPng, `${w}×${h}, ${buf.length} 字节`);
    // Region was 60% x 25% of the page at >=2x supersampling.
    check('导出尺寸与选区相符', w > 200 && h > 150, `${w}×${h}`);
    const status = (await page.textContent('#status-text')) ?? '';
    check('状态栏报告导出尺寸', status.includes('快照'), status);
  }
}

// ---------------------------------------------------------------- 7. 快捷键
console.log('\n=== 7. 快捷键 ===');
{
  await page.click('#tool-select');
  await page.keyboard.press('Control+0');
  await page.waitForTimeout(400);
  const mode = await page.evaluate(() => document.querySelector('#btn-fit-width').classList.contains('primary'));
  check('Ctrl+0 切回适应宽度', mode === true);

  await page.keyboard.press('End');
  await page.waitForTimeout(900);
  const endPage = await page.inputValue('#page-input');
  check('End 跳到末页', endPage === '24', `page-input=${endPage}`);

  await page.keyboard.press('Home');
  await page.waitForTimeout(900);
  check('Home 回到首页', (await page.inputValue('#page-input')) === '1');
}

// ---------------------------------------------------------------- 8. 进度
console.log('\n=== 8. 进度记忆 ===');
{
  await page.fill('#page-input', '7');
  await page.press('#page-input', 'Enter');
  await page.waitForTimeout(1200);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelectorAll('.page:not(.unrendered)').length > 0, { timeout: 30000 });
  await page.waitForTimeout(600);
  const restored = await page.inputValue('#page-input');
  check('重载后恢复到第 7 页', restored === '7', `page-input=${restored}`);
}

// ---------------------------------------------------------------- 9. 错误
console.log('\n=== 9. 错误检查 ===');
check('无未捕获页面错误', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
check('无控制台错误', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));

await browser.close();

console.log(`\n=== 结果: ${passed} 通过 / ${failed} 失败 ===`);
if (failed > 0) {
  console.log('失败项:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exitCode = 1;
}
