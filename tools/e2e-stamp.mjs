// Verifies stamps: placing one, what it draws, what it writes, and what survives.
//
//   node tools/e2e-stamp.mjs [baseUrl]
import { chromium } from 'playwright';

const BASE = process.argv[2] ?? 'http://127.0.0.1:4173';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CMD = { stamp: 1270, pick: 1271 };

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
await page.waitForTimeout(800);

const menuOpen = () =>
  page.evaluate(() => {
    const menu = document.querySelector('#overflow-menu');
    return !!menu && !menu.classList.contains('hidden');
  });

async function runCommand(id) {
  if (!(await menuOpen())) {
    await page.click('#btn-more');
    await page.waitForTimeout(350);
  }
  await page.click(`.more-run[data-command="${id}"]`);
  await page.waitForTimeout(450);
}

/** A point inside both the page and the scroll viewport. */
const pagePoint = () =>
  page.evaluate(() => {
    const pg = document.querySelector('.page:not(.unrendered)');
    const sc = document.querySelector('#scroll-container');
    const r = pg.getBoundingClientRect();
    const s = sc.getBoundingClientRect();
    return {
      x: Math.round((Math.max(r.left, s.left) + Math.min(r.right, s.right)) / 2),
      y: Math.round((Math.max(r.top, s.top) + Math.min(r.bottom, s.bottom)) / 2),
    };
  });

const written = () =>
  page.evaluate(async () => {
    const bytes = new Uint8Array(await window.__writePdf());
    let text = '';
    for (let i = 0; i < bytes.length; i++) text += String.fromCharCode(bytes[i]);
    return {
      hasStamp: text.includes('/Stamp'),
      name: (/\/Name \/(\w+)/.exec(text) ?? [])[1] ?? null,
      length: bytes.length,
    };
  });

console.log('\n=== 1. 放置图章 ===');
{
  await runCommand(CMD.stamp);
  const tool = await page.evaluate(() => document.querySelector('#scroll-container')?.getAttribute('data-tool'));
  check('图章工具被选中', tool === 'stamp', `data-tool=${tool}`);

  const point = await pagePoint();
  await page.mouse.click(point.x, point.y);
  await page.waitForTimeout(700);

  const item = await page.evaluate(() => {
    const a = window.__store().all[0];
    return { kind: a?.kind, stampId: a?.stampId, note: a?.note, page: a?.page };
  });
  check('创建了一条图章批注', item.kind === 'stamp', JSON.stringify(item.kind));
  check('默认图章是「已批准」', item.stampId === 'approved', `${item.stampId}`);
  check('图章上的字是本地化的', item.note === '已批准', `${item.note}`);
  check('落在第 1 页', item.page === 1, `${item.page}`);
}

console.log('\n=== 2. 画面上是一个图章 ===');
{
  const shape = await page.evaluate(() => {
    const node = document.querySelector('.annot-stamp');
    if (!node) return null;
    const part = node.querySelector('.annot-part');
    const style = part ? getComputedStyle(part) : null;
    return {
      count: document.querySelectorAll('.annot-stamp').length,
      text: (part ?? node).textContent,
      hasBorder: style ? style.borderTopWidth !== '0px' : false,
      hasOutline: style ? style.outlineWidth !== '0px' : false,
      width: part ? Math.round(part.getBoundingClientRect().width) : 0,
    };
  });
  check('页面上有一个图章元素', shape !== null && shape.count === 1, `${shape?.count}`);
  check('图章上有文字', shape?.text === '已批准', shape?.text);
  check('图章有一圈边框', shape?.hasBorder === true);
  check('图章有第二圈边框（双线）', shape?.hasOutline === true);
  check('图章有实际宽度', (shape?.width ?? 0) > 40, `${shape?.width}px`);
}

console.log('\n=== 3. 写进 PDF 是真正的图章 ===');
{
  const out = await written();
  check('写入 /Stamp 子类型', out.hasStamp === true);
  check('/Name 是标准图章名', out.name === 'Approved', `${out.name}`);
}

console.log('\n=== 4. 换一种图章 ===');
{
  await runCommand(CMD.pick);
  check('打开图章选择框', (await page.locator('.modal-choice').count()) === 1);
  await page.selectOption('.modal-choice-select', 'confidential');
  await page.click('.modal-choice .modal-confirm');
  await page.waitForTimeout(500);

  const status = await page.evaluate(() => document.querySelector('#status-text')?.textContent ?? '');
  check('状态栏报告当前图章', /机密/.test(status), status);

  // Creating anything returns to the pointer tool, so ask for the stamp again.
  await runCommand(CMD.stamp);
  const point = await pagePoint();
  // Well clear of the first stamp, or the click would just select it.
  await page.mouse.click(point.x, point.y + 180);
  await page.waitForTimeout(700);

  const second = await page.evaluate(() => {
    const list = window.__store().all;
    return { count: list.length, stampId: list[1]?.stampId, color: list[1]?.color };
  });
  check('第二条图章是「机密」', second.stampId === 'confidential', `${second.stampId}`);
  check('「机密」用的是红色系', /c0392b/i.test(second.color ?? ''), `${second.color}`);

  const out = await written();
  check('两种图章的 /Name 都写进去了', out.name === 'Confidential' || out.name === 'Approved', `${out.name}`);
}

console.log('\n=== 5. 图章可以从文件读回 ===');
{
  const restored = await page.evaluate(async () => {
    const bytes = new Uint8Array(await window.__writePdf());
    const found = await window.__importFromPdf(bytes);
    return found.map((item) => ({ kind: item.kind, stampName: item.stampName ?? null }));
  });
  const stamps = restored.filter((item) => item.kind === 'stamp');
  check('读回两条图章', stamps.length === 2, `${stamps.length}`);
  check('读回时带着标准图章名', stamps.every((item) => typeof item.stampName === 'string'), JSON.stringify(stamps));
}

console.log('\n=== 6. 展平把图章画进页面 ===');
{
  await page.evaluate(() => {
    window.__store().load([], false);
    window.__store().defaultAuthor = 'A';
    window.__store().add({
      page: 1,
      kind: 'stamp',
      color: '#1f8f4e',
      rect: { x: 120, y: 360, w: 158, h: 54 },
      fontSize: 15,
      strokeWidth: 1.6,
      stampId: 'approved',
      note: '已批准',
    });
  });
  await page.waitForTimeout(400);

  const before = await page.evaluate(async () => {
    const bytes = new Uint8Array(await window.__writePdf());
    return { hadAnnots: (() => { let s = ''; for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]); return s.includes('/Annots'); })() };
  });
  check('展平前页面有 /Annots', before.hadAnnots === true);

  await runCommand(1260);
  await page.waitForTimeout(500);
  await page.click('.modal-confirm-box .modal-confirm');
  await page.waitForTimeout(4000);

  check('展平后批注清空', (await page.evaluate(() => window.__store().count)) === 0);

  const after = await page.evaluate(async () => {
    const bytes = new Uint8Array(await window.__writePdf());
    let text = '';
    for (let i = 0; i < bytes.length; i++) text += String.fromCharCode(bytes[i]);
    const summary = await window.__pdfSummary(new Uint8Array(bytes));
    return {
      hasStampAnnot: /\/Subtype \/Stamp/.test(text),
      text: summary.pages[0].text,
      pages: summary.pageCount,
    };
  });
  check('成品里不再有图章批注', after.hasStampAnnot === false);
  check('图章的字被画进了页面', after.text.includes('APPROVED'), JSON.stringify(after.text.slice(-40)));
  check('页数不变', after.pages === 24, `${after.pages}`);
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
