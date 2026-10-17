// Verifies the replace-text tool: selection, the substitute prompt, painting, the PDF
// representation and the round trip.
//
//   node tools/e2e-replace.mjs [baseUrl]
import { chromium } from 'playwright';

const BASE = process.argv[2] ?? 'http://127.0.0.1:4173';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const REPLACE = 1294;
const SUBSTITUTE = 'a better sentence';

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
await page.waitForTimeout(1200);

console.log('\n=== 1. 工具可选 ===');
{
  await page.click('#btn-more');
  await page.waitForTimeout(350);
  const entries = await page.evaluate(() => document.querySelectorAll('.more-run[data-command="1294"]').length);
  check('“替换文本”在“更多”菜单里', entries === 1, `${entries}`);
  await page.click('.more-run[data-command="1294"]');
  await page.waitForTimeout(500);
  const status = await page.evaluate(() => document.querySelector('#status-text')?.textContent ?? '');
  check('选中后状态栏说明怎么用', /替换/.test(status), status);
}

console.log('\n=== 2. 划选文字会建立替换标记 ===');
{
  // A real mouse drag over the text layer, so the selection is the browser's own.
  const box = await page.evaluate(() => {
    const span = document.querySelector('.page .textLayer span, .page .text-layer span, .page .textLayer > span');
    const target = span ?? document.querySelector('.page .textLayer');
    const rect = target?.getBoundingClientRect();
    return rect ? { x: rect.x, y: rect.y, w: rect.width, h: rect.height } : null;
  });
  check('页面上有可选的文字', box !== null, box ? `${Math.round(box.w)}×${Math.round(box.h)}` : '无');

  if (box) {
    await page.mouse.move(box.x + 2, box.y + box.h / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.w - 2, box.y + box.h / 2, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(900);
  }

  const modal = await page.locator('.modal').count();
  check('弹出替代文字对话框', modal >= 1, `${modal}`);

  if (modal >= 1) {
    await page.fill('.modal input', SUBSTITUTE);
    await page.click('.modal .primary');
    await page.waitForTimeout(800);
  }

  const stored = await page.evaluate(() => {
    const items = window.__store().all;
    const item = items.find((a) => a.kind === 'replace');
    return item ? { kind: item.kind, note: item.note, rects: (item.rects ?? []).length, text: item.text } : null;
  });
  check('建立了一个 replace 批注', stored !== null, JSON.stringify(stored?.kind));
  check('记下了替代文字', stored?.note === SUBSTITUTE, JSON.stringify(stored?.note));
  check('记下了被替换的文字', typeof stored?.text === 'string' && stored.text.length > 0, JSON.stringify(stored?.text?.slice(0, 20)));
}

console.log('\n=== 3. 显示为一条虚线删除线 ===');
{
  const painted = await page.evaluate(() => {
    const node = document.querySelector('.annot-replace .annot-part');
    if (!node) return null;
    const style = getComputedStyle(node);
    return { top: style.borderTopStyle, width: style.borderTopWidth, background: style.backgroundColor };
  });
  check('画出来了', painted !== null);
  check('是虚线（与普通删除线区分）', painted?.top === 'dashed', painted?.top);
  check('有可见的线宽', Number.parseFloat(painted?.width ?? '0') > 0, painted?.width);
  check('带一层淡色底', (painted?.background ?? 'none') !== 'rgba(0, 0, 0, 0)', painted?.background);
}

console.log('\n=== 4. PDF 里是标准的删除线 ===');
{
  const written = await page.evaluate(async () => {
    const bytes = new Uint8Array(await window.__writePdf());
    let text = '';
    for (let i = 0; i < bytes.length; i++) text += String.fromCharCode(bytes[i]);
    return {
      strikeout: (text.match(/\/Subtype \/StrikeOut/g) ?? []).length,
      privateKind: /\/PLP <<[^>]*\/K \/replace/.test(text),
      // Text is written as a hex string, so the ASCII form is what to look for.
      substitute: text.includes('61206265747465722073656e74656e6365'),
    };
  });
  check('写成了 /StrikeOut（其他阅读器能看到划线）', written.strikeout === 1, `${written.strikeout}`);
  check('私有标记记下了 kind=replace', written.privateKind === true);
  check('替代文字进了文件', written.substitute === true);
}

console.log('\n=== 5. 读回来仍然是替换文本 ===');
{
  const restored = await page.evaluate(async () => {
    const bytes = new Uint8Array(await window.__writePdf());
    const found = await window.__importFromPdf(bytes);
    const item = found.find((a) => a.kind === 'replace') ?? null;
    return found.length === 0 ? { none: true } : { kind: item?.kind ?? null, note: item?.note ?? null, kinds: found.map((a) => a.kind) };
  });
  check('读回时还原为 replace', restored.kind === 'replace', JSON.stringify(restored.kinds ?? restored));
  check('替代文字也读回来', restored.note === SUBSTITUTE, JSON.stringify(restored.note));
}

console.log('\n=== 6. 批注面板里有它 ===');
{
  await page.click('#tab-annotations');
  await page.waitForTimeout(600);
  const row = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.annot-row')];
    const found = rows.find((el) => /替换/.test(el.textContent ?? ''));
    return found ? found.textContent : null;
  });
  check('面板里有一行叫“替换文本”', row !== null, row?.replace(/\s+/g, ' ').slice(0, 30));
}

console.log('\n=== 7. 可以撤销 ===');
{
  const before = await page.evaluate(() => {
    const item = window.__store().all.find((a) => a.kind === 'replace');
    return item ? { note: item.note ?? null, count: window.__store().count } : null;
  });
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(700);
  const after = await page.evaluate(() => {
    const item = window.__store().all.find((a) => a.kind === 'replace');
    return { note: item?.note ?? null, count: window.__store().count };
  });
  // Undo takes back the substitution first: the mark and its text were two steps.
  check('撤销退掉替代文字或整个批注', (after.note ?? '') !== (before?.note ?? '') || after.count < (before?.count ?? 0), `${JSON.stringify(before)} -> ${JSON.stringify(after)}`);
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
