// Verifies that annotations survive a save and reopen as *editable* objects: they can be
// selected, they do not duplicate themselves on repeated saves, and a deletion is
// actually removed from the file.
//
// The bug this covers: the writer appended to `/Annots` without removing what it had
// written before, so every save duplicated every annotation and a deleted one came back.
//
//   node tools/e2e-save-reopen.mjs [baseUrl]
import { writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.argv[2] ?? 'http://127.0.0.1:4173';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const FILE = '_roundtrip.pdf';

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

const ready = async () => {
  await page.waitForFunction(() => document.querySelectorAll('.page:not(.unrendered)').length > 0, { timeout: 30000 });
  await page.waitForTimeout(1400);
};

const openFixture = async (file) => {
  await page.goto(`${BASE}/?file=./fixtures/${file}&debug=p5`, { waitUntil: 'domcontentloaded' });
  await ready();
};

/** Writes the current document with its annotations into the served fixtures folder. */
const saveAndStage = async () => {
  const bytes = await page.evaluate(async () => Array.from(new Uint8Array(await window.__writePdf())));
  writeFileSync(`public/fixtures/${FILE}`, Buffer.from(bytes));
  writeFileSync(`dist/fixtures/${FILE}`, Buffer.from(bytes));
  return bytes.length;
};

/**
 * Reads the annotations a saved file actually points at.
 *
 * `__writePdf` is a *write*: calling it to count would append another copy every time and
 * measure the test rather than the application. The staged file is fetched instead, and
 * `__importFromPdf` resolves the page's `/Annots`, so orphaned objects left behind by an
 * incremental update are not counted.
 */
const liveInFile = () =>
  page.evaluate(async (file) => {
    const response = await fetch(`./fixtures/${file}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    const found = await window.__importFromPdf(bytes);
    return found.map((a) => a.kind);
  }, FILE);

const topLevel = (kind) =>
  liveInFile().then((kinds) => kinds.filter((k) => k === kind).length);
const storeShape = () =>
  page.evaluate(() =>
    window.__store().all.map((a) => ({
      kind: a.kind,
      page: a.page,
      rect: a.rect ? { x: Math.round(a.rect.x), y: Math.round(a.rect.y), w: Math.round(a.rect.w), h: Math.round(a.rect.h) } : null,
    })),
  );

await openFixture('test.pdf');

console.log('\n=== 1. 存两条批注 ===');
{
  await page.evaluate(() => {
    const store = window.__store();
    store.defaultAuthor = 'Chengxi Zhang';
    store.add({ page: 1, kind: 'textbox', color: '#c0392b', rect: { x: 90, y: 120, w: 240, h: 70 }, note: '要替换的一段', fontSize: 13 });
    store.add({ page: 1, kind: 'highlight', color: '#ffd24a', rects: [{ x: 90, y: 220, w: 300, h: 24 }] });
  });
  await page.waitForTimeout(600);
  check('内存里两条', (await page.evaluate(() => window.__store().count)) === 2);

  const size = await saveAndStage();
  check('写出的文件像是合理的 PDF', size > 15000, `${size} 字节`);
  const live = await liveInFile();
  check('文件里指向两条批注', live.length === 2, JSON.stringify(live));
}

console.log('\n=== 2. 重开后仍然可以选中 ===');
{
  await openFixture(FILE);
  const shape = await storeShape();
  check('重开后读到两条', shape.length === 2, JSON.stringify(shape.map((s) => s.kind)));
  check('打字机的位置没变', JSON.stringify(shape.find((s) => s.kind === 'textbox')?.rect) === JSON.stringify({ x: 90, y: 120, w: 240, h: 70 }), JSON.stringify(shape.find((s) => s.kind === 'textbox')?.rect));

  await page.evaluate(() => {
    document.querySelector('#scroll-container').scrollTop = 0;
  });
  await page.waitForTimeout(500);

  const geom = await page.evaluate(() => {
    const box = document.querySelector('.page').getBoundingClientRect();
    return { x: box.x, y: box.y, scale: box.width / 595 };
  });
  // Centre of the text box, in page space, converted to the screen.
  await page.mouse.click(geom.x + (90 + 120) * geom.scale, geom.y + (120 + 35) * geom.scale);
  await page.waitForTimeout(700);

  const picked = await page.evaluate(() => ({
    selected: document.querySelectorAll('.annot.selected').length,
    grip: document.querySelectorAll('.annot-resize').length,
  }));
  check('点一下就选中了', picked.selected === 1, JSON.stringify(picked));
  check('选中后可以拖动/缩放', picked.grip === 1, `${picked.grip} 个把手`);
}


console.log('\n=== 2b. 文字工具点已有批注不会叠一个空框 ===');
{
  const before = await page.evaluate(() => window.__store().count);
  await page.click('#btn-more');
  await page.waitForTimeout(300);
  await page.click('.more-run[data-command="1111"]');
  await page.waitForTimeout(400);
  const geom = await page.evaluate(() => {
    const box = document.querySelector('.page').getBoundingClientRect();
    return { x: box.x, y: box.y, scale: box.width / 595 };
  });
  await page.mouse.click(geom.x + (90 + 120) * geom.scale, geom.y + (120 + 35) * geom.scale);
  await page.waitForTimeout(900);
  const after = await page.evaluate(() => ({
    count: window.__store().count,
    editing: document.querySelectorAll('textarea').length,
  }));
  check('没有多出一个批注', after.count === before, `${before} -> ${after.count}`);
  check('而是进入原地编辑', after.editing >= 1, `${after.editing} 个编辑框`);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  // Back to the pointer so the rest of the suite behaves like a reader's second visit.
  await page.evaluate(() => window.__viewer && document.querySelector('#scroll-container')?.focus?.());
  await page.click('#tab-annotations');
  await page.waitForTimeout(300);
}
console.log('\n=== 3. 反复保存不会把批注复制成两份 ===');
{
  await saveAndStage();
  await saveAndStage();
  await openFixture(FILE);
  const live = await liveInFile();
  const count = await page.evaluate(() => window.__store().count);
  check('保存两次后文件仍只指向两条', live.length === 2, JSON.stringify(live));
  check('重开后 store 里仍是两条，没有翻倍', count === 2, `${count}`);
}

console.log('\n=== 4. 删掉的批注真的从文件里消失 ===');
{
  await page.evaluate(() => {
    const store = window.__store();
    const box = store.all.find((a) => a.kind === 'textbox');
    if (box) store.remove(box.id);
  });
  await page.waitForTimeout(500);
  check('内存里剩一条', (await page.evaluate(() => window.__store().count)) === 1);

  await saveAndStage();
  await openFixture(FILE);
  const shape = await storeShape();
  check('保存并重开后只剩高亮', shape.length === 1 && shape[0]?.kind === 'highlight', JSON.stringify(shape.map((s) => s.kind)));
  const live = await liveInFile();
  check('文件里只指向高亮', JSON.stringify(live) === JSON.stringify(['highlight']), JSON.stringify(live));
}

console.log('\n=== 5. 删掉最后一条，页面不应再挂着批注 ===');
{
  await page.evaluate(() => {
    const store = window.__store();
    for (const item of [...store.all]) store.remove(item.id);
  });
  await page.waitForTimeout(500);
  await saveAndStage();
  await openFixture(FILE);

  check('重开后没有任何批注', (await page.evaluate(() => window.__store().count)) === 0);
  const live = await liveInFile();
  check('文件里不再指向任何批注', live.length === 0, JSON.stringify(live));
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
