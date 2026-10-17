// Verifies whole-document rewriting: the rebuilt file must open in an independent
// parser (pdf.js) with the pages, order, sizes and rotation the plan asked for.
//
//   node tools/e2e-rewrite.mjs [baseUrl]
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
await page.waitForTimeout(700);

/** Runs a rewrite in the page and reads the result back with pdf.js. */
const rewrite = (plan) =>
  page.evaluate(async (spec) => {
    const rewritten = await window.__rewritePdf(spec);
    const summary = await window.__pdfSummary(new Uint8Array(rewritten.bytes));
    return { size: rewritten.size, declared: rewritten.pageCount, ...summary };
  }, plan);

const baseline = await rewrite(Array.from({ length: 24 }, (_, i) => ({ sourceIndex: i })));

// Rendering both files and hashing the pixels is the honest identity test: if the
// drawing is identical, nothing in the object graph that matters was lost, whatever
// the byte count says.
const fingerprints = await page.evaluate(async () => {
  const original = new Uint8Array(await (await fetch('./fixtures/test.pdf')).arrayBuffer());
  const rewritten = await window.__rewritePdf(Array.from({ length: 24 }, (_, i) => ({ sourceIndex: i })));
  const bytes = new Uint8Array(rewritten.bytes);
  const before = await window.__pageFingerprint(original, 1, 1);
  const after = await window.__pageFingerprint(bytes, 1, 1);
  const later = await window.__pageFingerprint(bytes, 12, 1);
  const laterOriginal = await window.__pageFingerprint(original, 12, 1);
  return { before, after, later, laterOriginal, originalSize: original.length, rewrittenSize: rewritten.size };
});

console.log('\n=== 1. 原样重写 ===');
check('声明页数与实际一致', baseline.declared === baseline.pageCount, `${baseline.declared}/${baseline.pageCount}`);
check('页数保持 24', baseline.pageCount === 24, `${baseline.pageCount}`);
check('文件大小接近原文件', Math.abs(fingerprints.rewrittenSize - fingerprints.originalSize) < fingerprints.originalSize * 0.25, `${fingerprints.originalSize} -> ${fingerprints.rewrittenSize}`);
check('第 1 页渲染与原文件逐像素一致', fingerprints.before.hash === fingerprints.after.hash, `${fingerprints.before.hash} vs ${fingerprints.after.hash}`);
check('第 1 页有实际内容', fingerprints.after.ink > 10000, `非白像素=${fingerprints.after.ink}`);
check('第 12 页渲染也一致', fingerprints.laterOriginal.hash === fingerprints.later.hash, `${fingerprints.laterOriginal.hash} vs ${fingerprints.later.hash}`);
check('页面尺寸保留', baseline.pages[0].width > 100 && baseline.pages[0].height > 100, `${baseline.pages[0].width}×${baseline.pages[0].height}`);
check('正文文字保留', baseline.pages[0].text.length > 0, JSON.stringify(baseline.pages[0].text.slice(0, 30)));

console.log('\n=== 2. 删除页面 ===');
{
  const plan = Array.from({ length: 24 }, (_, i) => ({ sourceIndex: i })).filter((_, i) => i !== 0);
  const result = await rewrite(plan);
  check('删掉第 1 页后剩 23 页', result.pageCount === 23, `${result.pageCount}`);
  check('新的第 1 页是原来的第 2 页', result.pages[0].text === baseline.pages[1].text, `${JSON.stringify(result.pages[0].text.slice(0, 24))}`);
}

console.log('\n=== 3. 页面重排 ===');
{
  const order = [...Array.from({ length: 24 }, (_, i) => i)].reverse();
  const result = await rewrite(order.map((i) => ({ sourceIndex: i })));
  check('倒序后页数不变', result.pageCount === 24, `${result.pageCount}`);
  check('第 1 页变成原来的第 24 页', result.pages[0].text === baseline.pages[23].text, JSON.stringify(result.pages[0].text.slice(0, 24)));
  check('最后一页变成原来的第 1 页', result.pages[23].text === baseline.pages[0].text);
}

console.log('\n=== 4. 旋转页面 ===');
{
  const plan = Array.from({ length: 24 }, (_, i) => ({ sourceIndex: i }));
  plan[0] = { sourceIndex: 0, rotate: 90 };
  plan[1] = { sourceIndex: 1, rotate: 180 };
  const result = await rewrite(plan);
  check('第 1 页 /Rotate 为 90', result.pages[0].rotate === 90, `${result.pages[0].rotate}`);
  check('第 2 页 /Rotate 为 180', result.pages[1].rotate === 180, `${result.pages[1].rotate}`);
  check('第 3 页未旋转', result.pages[2].rotate === 0, `${result.pages[2].rotate}`);
  check('旋转后页面尺寸按 90° 交换', result.pages[0].width === baseline.pages[0].height && result.pages[0].height === baseline.pages[0].width, `${result.pages[0].width}×${result.pages[0].height}`);
}

console.log('\n=== 5. 插入空白页 ===');
{
  const plan = Array.from({ length: 24 }, (_, i) => ({ sourceIndex: i }));
  plan.splice(1, 0, { sourceIndex: null, mediaBox: [0, 0, 400, 500] });
  const result = await rewrite(plan);
  check('插入后为 25 页', result.pageCount === 25, `${result.pageCount}`);
  check('插入页尺寸为 400×500', result.pages[1].width === 400 && result.pages[1].height === 500, `${result.pages[1].width}×${result.pages[1].height}`);
  check('插入页没有文字', result.pages[1].text === '', JSON.stringify(result.pages[1].text));
  check('插入位置之后的页顺延', result.pages[2].text === baseline.pages[1].text);
}

console.log('\n=== 6. 插入带内容的页 ===');
{
  const plan = [{ sourceIndex: null, mediaBox: [0, 0, 300, 200], content: 'BT /F1 24 Tf 20 100 Td (Inserted page) Tj ET' }];
  const result = await rewrite(plan);
  check('只含一页', result.pageCount === 1, `${result.pageCount}`);
  check('尺寸正确', result.pages[0].width === 300 && result.pages[0].height === 200, `${result.pages[0].width}×${result.pages[0].height}`);
  // The font is not declared for an inserted page, so pdf.js may warn; the page itself
  // must still open and be the right size.
  check('带内容的新页可以打开', result.pages[0].width === 300);
}

console.log('\n=== 7. 裁剪页面 ===');
{
  const plan = Array.from({ length: 24 }, (_, i) => ({ sourceIndex: i }));
  plan[0] = { sourceIndex: 0, cropBox: [100, 100, 400, 500] };
  const result = await rewrite(plan);
  check('裁剪后可见尺寸变成裁剪框', result.pages[0].width === 300 && result.pages[0].height === 400, `${result.pages[0].width}×${result.pages[0].height}`);
  check('其他页不受影响', result.pages[1].width === baseline.pages[1].width, `${result.pages[1].width}`);
}

console.log('\n=== 8. 同一页复制两次 ===');
{
  const plan = [{ sourceIndex: 0 }, { sourceIndex: 0 }];
  const result = await rewrite(plan);
  check('复制后为两页', result.pageCount === 2, `${result.pageCount}`);
  check('两页内容相同', result.pages[0].text === result.pages[1].text && result.pages[0].text.length > 0);
}

console.log('\n=== 9. 拒绝无效输入 ===');
{
  const empty = await page.evaluate(async () => {
    try {
      await window.__rewritePdf([]);
      return 'no-error';
    } catch (error) {
      return String(error.message ?? error);
    }
  });
  check('空计划被拒绝', empty !== 'no-error' && /至少需要一页/.test(empty), empty);

  const missing = await page.evaluate(async () => {
    try {
      await window.__rewritePdf([{ sourceIndex: 999 }]);
      return 'no-error';
    } catch (error) {
      return String(error.message ?? error);
    }
  });
  check('越界页索引被拒绝', missing !== 'no-error' && /没有第/.test(missing), missing);
}

console.log('\n=== 10. 错误检查 ===');
check('无未捕获页面错误', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));
check('无控制台错误', consoleErrors.length === 0, consoleErrors.slice(0, 2).join(' | '));

await browser.close();
console.log(`\n=== 结果: ${passed} 通过 / ${failed} 失败 ===`);
if (failed > 0) {
  console.log('失败项:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exitCode = 1;
}
