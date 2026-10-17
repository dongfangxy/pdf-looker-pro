// Verifies the complete round trip: annotate, write into the PDF, re-open that file, and
// find the annotations there again — editable, with their styles intact.
//
//   node tools/e2e-pdfroundtrip.mjs [baseUrl]
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

await page.goto(`${BASE}/?file=./fixtures/test.pdf&debug=p5`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('.page:not(.unrendered)').length > 0, { timeout: 30000 });
await page.waitForTimeout(900);

console.log('\n=== 1. 在 PDF 上做批注 ===');
const placed = await page.evaluate(() => {
  const store = window.__store();
  store.add({ page: 1, kind: 'rect', color: '#e0342f', rect: { x: 80, y: 90, w: 200, h: 60 }, strokeWidth: 2 });
  store.add({ page: 1, kind: 'ellipse', color: '#2f6bd8', rect: { x: 80, y: 200, w: 160, h: 80 }, strokeDash: true });
  store.add({ page: 1, kind: 'ink', color: '#7c4dff', strokes: [[{ x: 90, y: 420 }, { x: 140, y: 450 }, { x: 200, y: 410 }]] });
  store.add({ page: 1, kind: 'note', color: '#f0b429', rect: { x: 300, y: 90, w: 20, h: 20 }, note: '便签内容' });
  store.add({ page: 1, kind: 'textbox', color: '#1f9d55', rect: { x: 90, y: 500, w: 220, h: 60 }, note: '文本框内容', fontSize: 15 });
  store.add({ page: 1, kind: 'highlight', color: '#ffd400', rects: [{ x: 100, y: 600, w: 180, h: 14 }] });
  store.add({ page: 2, kind: 'rect', color: '#e0342f', rect: { x: 60, y: 60, w: 120, h: 40 } });
  return store.count;
});
await page.waitForTimeout(400);
check('已做 7 条批注', placed === 7, `${placed}`);

console.log('\n=== 2. 写回后再读（同一份字节） ===');
const imported = await page.evaluate(async () => {
  const bytes = await window.__writePdf();
  return window.__importFromPdf(bytes);
});
check('读回同样多的批注', imported.length === 7, `${imported.length}`);

const byKind = new Map();
for (const item of imported) {
  const list = byKind.get(item.kind) ?? [];
  list.push(item);
  byKind.set(item.kind, list);
}
check(
  '类型全部保留',
  ['rect', 'ellipse', 'ink', 'note', 'textbox', 'highlight'].every((k) => byKind.has(k)) && (byKind.get('rect')?.length ?? 0) === 2,
  [...byKind.keys()].join(', '),
);

console.log('\n=== 3. 几何与样式逐项对照 ===');
{
  const rect = byKind.get('rect')?.find((r) => r.page === 1);
  check(
    '矩形几何一致',
    rect && Math.abs(rect.rect.x - 80) < 0.5 && Math.abs(rect.rect.y - 90) < 0.5 && Math.abs(rect.rect.w - 200) < 0.5 && Math.abs(rect.rect.h - 60) < 0.5,
    JSON.stringify(rect?.rect),
  );
  check('矩形颜色一致', rect?.color === '#e0342f', rect?.color);
  check('矩形线宽一致', rect?.strokeWidth === 2, `${rect?.strokeWidth}`);

  const ellipse = byKind.get('ellipse')?.[0];
  check('椭圆虚线标记保留', ellipse?.strokeDash === true, `${ellipse?.strokeDash}`);
  check('椭圆颜色一致', ellipse?.color === '#2f6bd8', ellipse?.color);

  const ink = byKind.get('ink')?.[0];
  check('墨迹 3 个点且坐标吻合', ink?.strokes?.[0]?.length === 3 && Math.abs(ink.strokes[0][0].x - 90) < 0.5 && Math.abs(ink.strokes[0][0].y - 420) < 0.5, JSON.stringify(ink?.strokes?.[0]));

  const note = byKind.get('note')?.[0];
  check('便签文字一致', note?.note === '便签内容', JSON.stringify(note?.note));

  const textbox = byKind.get('textbox')?.[0];
  check('文本框文字一致', textbox?.note === '文本框内容', JSON.stringify(textbox?.note));
  check('文本框字号一致', textbox?.fontSize === 15, `${textbox?.fontSize}`);

  const highlight = byKind.get('highlight')?.[0];
  check('高亮区域一致', highlight?.rects?.length === 1 && Math.abs(highlight.rects[0].y - 600) < 1, JSON.stringify(highlight?.rects));

  const page2 = byKind.get('rect')?.find((r) => r.page === 2);
  check('第 2 页的批注落在第 2 页', page2 !== undefined, `page=${page2?.page}`);
}

console.log('\n=== 4. 打开写出的文件，阅读器里能看到批注 ===');
{
  const reopened = await page.evaluate(async () => {
    const bytes = await window.__writePdf();
    const blob = new Blob([bytes], { type: 'application/pdf' });
    const file = new File([blob], 'roundtrip.pdf', { type: 'application/pdf' });

    // Drive the real file input, exactly as a reader would.
    const input = document.querySelector('#file-input');
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));

    // Wait for the new document to settle.
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 250));
      const count = window.__store().count;
      if (count > 0) return { count, dirty: document.querySelector('#doc-title')?.textContent ?? '' };
    }
    return { count: window.__store().count, dirty: document.querySelector('#doc-title')?.textContent ?? '' };
  });
  check('重新打开的文档里批注自动出现', reopened.count === 7, `${reopened.count}`);
  check('标题不显示未保存标记', !reopened.dirty.includes('*'), reopened.dirty);
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
