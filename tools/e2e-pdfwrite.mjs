// Verifies that annotations written into the PDF survive a round trip.
//
// The written file is read back two ways: by pdf.js — an independent implementation, so a
// mistake in the writer cannot be hidden by a matching mistake in the reader — and by this
// project's own parser, which is what restores the private entries.
//
//   node tools/e2e-pdfwrite.mjs [baseUrl]
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

console.log('\n=== 1. 准备批注 ===');
await page.evaluate(() => {
  const store = window.__store();
  const base = { page: 1, color: '#e0342f' };
  store.add({ ...base, kind: 'rect', rect: { x: 80, y: 90, w: 200, h: 60 }, strokeWidth: 2 });
  store.add({ ...base, kind: 'ellipse', rect: { x: 80, y: 200, w: 160, h: 80 }, strokeDash: true });
  store.add({ ...base, kind: 'arrow', strokes: [[{ x: 80, y: 320 }, { x: 260, y: 360 }]] });
  store.add({ ...base, kind: 'ink', strokes: [[{ x: 90, y: 420 }, { x: 140, y: 450 }, { x: 200, y: 410 }]] });
  store.add({ ...base, kind: 'note', rect: { x: 300, y: 90, w: 20, h: 20 }, note: 'sticky 便签' });
  store.add({ ...base, kind: 'textbox', rect: { x: 90, y: 500, w: 220, h: 60 }, note: 'typed 文本框', fontSize: 14 });
  store.add({ ...base, kind: 'highlight', rects: [{ x: 100, y: 600, w: 180, h: 14 }], color: '#ffd400' });
  store.add({ ...base, kind: 'measure-distance', strokes: [[{ x: 100, y: 680 }, { x: 300, y: 680 }]], color: '#2f6bd8' });
  store.add({
    ...base,
    kind: 'measure-area',
    rect: { x: 100, y: 720, w: 200, h: 90 },
    strokes: [[{ x: 100, y: 720 }, { x: 300, y: 720 }, { x: 300, y: 810 }, { x: 100, y: 810 }]],
    color: '#1f9d55',
  });
  store.add({ ...base, kind: 'rect', page: 2, rect: { x: 60, y: 60, w: 120, h: 40 } });
});
await page.waitForTimeout(500);
check('已放置 10 条批注', (await page.evaluate(() => window.__store().count)) === 10);

console.log('\n=== 2. 写入并检查结构 ===');
{
  const structural = await page.evaluate(async () => {
    const bytes = await window.__writePdf();
    const text = new TextDecoder('latin1').decode(bytes);
    const original = new TextDecoder('latin1').decode(
      new Uint8Array(await (await fetch('./fixtures/test.pdf')).arrayBuffer()),
    );
    return {
      size: bytes.length,
      source: original.length,
      startsWithHeader: text.startsWith('%PDF-'),
      prefixIntact: text.startsWith(original.slice(0, 2000)),
      eofCount: (text.match(/%%EOF/g) ?? []).length,
      originalEofs: (original.match(/%%EOF/g) ?? []).length,
      hasPrev: /\/Prev\s+\d+/.test(text),
      hasAnnots: /\/Annots\s+\d+\s+\d+\s+R/.test(text),
    };
  });
  check('写出的文件比原文件大', structural.size > structural.source, `${structural.source} -> ${structural.size} 字节`);
  check('增量合理，未重写全文', structural.size - structural.source < structural.source * 0.5, `+${structural.size - structural.source} 字节`);
  check('文件头仍是 %PDF-', structural.startsWithHeader);
  check('原文件前缀逐字节未改动', structural.prefixIntact);
  check('新增一段 %%EOF（增量更新）', structural.eofCount === structural.originalEofs + 1, `${structural.originalEofs} -> ${structural.eofCount}`);
  check('新交叉引用带 /Prev', structural.hasPrev);
  check('页面获得 /Annots 引用', structural.hasAnnots);
}

console.log('\n=== 3. pdf.js 独立读回 ===');
const roundTrip = await page.evaluate(async () => {
  const bytes = await window.__writePdf();
  return window.__loadPdfAnnotations(bytes);
});
check('pdf.js 能解析写出的文件', Array.isArray(roundTrip) && roundTrip.length === 10, `${roundTrip?.length ?? 0} 条`);

const countOf = (subtype) => roundTrip.filter((a) => a.subtype === subtype).length;
const expected = { Square: 2, Circle: 1, Line: 2, Ink: 1, Text: 1, FreeText: 1, Highlight: 1, Polygon: 1 };
for (const [subtype, n] of Object.entries(expected)) {
  check(`读回 /${subtype} ${n} 条`, countOf(subtype) === n, `${countOf(subtype)}`);
}
check('第 2 页的批注也写入了', roundTrip.filter((a) => a.page === 2).length === 1);

console.log('\n=== 4. 几何与内容往返 ===');
{
  // Page 1 of the fixture is 595x842. Display y=90 h=60 -> PDF y 692..752.
  const square = roundTrip.find((a) => a.subtype === 'Square' && a.page === 1);
  const [x1, y1, x2, y2] = square?.rect ?? [];
  check(
    '矩形坐标正确翻转',
    Math.abs(x1 - 80) < 1 && Math.abs(y1 - 692) < 1 && Math.abs(x2 - 280) < 1 && Math.abs(y2 - 752) < 1,
    `[${[x1, y1, x2, y2].map((v) => Math.round(v ?? 0)).join(', ')}] 期望 [80, 692, 280, 752]`,
  );

  const note = roundTrip.find((a) => a.subtype === 'Text');
  check('便签文字保留（含中文）', note?.contents === 'sticky 便签', JSON.stringify(note?.contents));
  const textbox = roundTrip.find((a) => a.subtype === 'FreeText');
  check('文本框文字保留（含中文）', textbox?.contents === 'typed 文本框', JSON.stringify(textbox?.contents));

  const highlight = roundTrip.find((a) => a.subtype === 'Highlight');
  check('高亮写入 QuadPoints（4 角 × 2）', highlight?.quadPoints?.length === 8, `${highlight?.quadPoints?.length ?? 0} 个数`);

  const ink = roundTrip.find((a) => a.subtype === 'Ink');
  check('墨迹写入 InkList（3 点）', ink?.inkLists?.[0]?.length === 6, JSON.stringify(ink?.inkLists?.[0]?.length));

  const lines = roundTrip.filter((a) => a.subtype === 'Line');
  check('两条 /Line 都带线段坐标', lines.length === 2 && lines.every((l) => l.line?.length === 4), JSON.stringify(lines.map((l) => Array.from(l.line ?? []).map((v) => Math.round(v)))));

  const area = roundTrip.find((a) => a.subtype === 'Polygon');
  check('面积写入 4 个顶点', area?.vertices?.length === 8, `${area?.vertices?.length ?? 0} 个数`);

  // Read these from the written bytes: pdf.js normalises annotation fields into its
  // own representations, and the question here is what was actually written.
  const raw = await page.evaluate(async () => {
    const bytes = await window.__writePdf();
    const text = new TextDecoder('latin1').decode(bytes);
    return {
      colours: [...text.matchAll(/\/C\s*\[([^\]]*)\]/g)].map((m) => m[1].trim()),
      borders: [...text.matchAll(/\/BS\s*<<([^>]*)>>/g)].map((m) => m[1].trim()),
    };
  });
  check('颜色以 0..1 三元组写入', raw.colours.includes('0.878 0.204 0.184'), raw.colours.join(' | '));
  check('高亮写入了自己的颜色', raw.colours.some((c) => c.startsWith('1 0.831')), raw.colours.find((c) => c.startsWith('1')) ?? '');
  check('实线写为 /S /S', raw.borders.some((b) => /\/S \/S$/.test(b)), raw.borders[0] ?? '');
  check('虚线写为 /S /D', raw.borders.some((b) => /\/S \/D$/.test(b)), raw.borders.find((b) => /\/D$/.test(b)) ?? '');
}

console.log('\n=== 5. 自有解析器读回私有条目 ===');
{
  const mine = await page.evaluate(async () => {
    const bytes = await window.__writePdf();
    return window.__readPdfPrivate(bytes);
  });
  check('自有解析器找到 10 条批注对象', mine.length === 10, `${mine.length}`);
  const kinds = mine.map((a) => a.kind).sort();
  check(
    '私有 /PLP 保留了原始类型',
    kinds.join(',') === ['arrow', 'ellipse', 'highlight', 'ink', 'measure-area', 'measure-distance', 'note', 'rect', 'rect', 'textbox'].join(','),
    kinds.join(','),
  );
  const textbox = mine.find((a) => a.kind === 'textbox');
  check('私有条目保留字号', textbox?.fontSize === 14, `${textbox?.fontSize}`);
  const ellipse = mine.find((a) => a.kind === 'ellipse');
  check('私有条目保留虚线标记', ellipse?.strokeDash === true, `${ellipse?.strokeDash}`);
  const rect = mine.find((a) => a.kind === 'rect' && a.page === 1);
  check('私有条目保留线宽', rect?.strokeWidth === 2, `${rect?.strokeWidth}`);
}

console.log('\n=== 6. 写出的文件可再次打开 ===');
{
  const reopened = await page.evaluate(async () => {
    const bytes = await window.__writePdf();
    return window.__roundTripRender(bytes);
  });
  check('写出的文件可被再次打开', reopened.pages === 24, `页数=${reopened.pages}`);
  check('重新打开后页面可渲染', reopened.rendered > 0, `已渲染=${reopened.rendered}`);
  check('重新打开后第 1 页批注仍可读', reopened.annots === 9, `${reopened.annots}`);
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
