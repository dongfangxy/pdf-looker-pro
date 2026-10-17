// Verifies the annotation author: the name set in the settings must be attributed to new
// annotations and written into the PDF as `/T`, which is what other readers show.
//
//   node tools/e2e-author.mjs [baseUrl]
import { chromium } from 'playwright';

const BASE = process.argv[2] ?? 'http://127.0.0.1:4173';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const NAME = 'Chengxi Zhang';

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

console.log('\n=== 1. 设置里可以填写作者 ===');
{
  await page.click('#btn-settings');
  await page.waitForTimeout(600);
  check('设置对话框打开', (await page.locator('.modal').count()) === 1);
  check('有作者文本框', (await page.locator('.settings-text').count()) === 1);

  const label = await page.locator('.settings-text').evaluate((el) => el.closest('.settings-row')?.textContent ?? '');
  check('字段标注为“注释作者”', /注释作者/.test(label), JSON.stringify(label.slice(0, 20)));

  await page.fill('.settings-text', NAME);
  await page.click('.modal-footer .primary');
  await page.waitForTimeout(900);
  check('设置已保存并关闭', (await page.locator('.modal').count()) === 0);
}

console.log('\n=== 2. 新批注归属到作者 ===');
{
  await page.evaluate(() => {
    window.__store().add({ page: 1, kind: 'rect', color: '#ff0000', rect: { x: 50, y: 50, w: 80, h: 60 } });
  });
  await page.waitForTimeout(500);
  const author = await page.evaluate(() => window.__store().all[0]?.author ?? null);
  check('批注带上了设置里的名字', author === NAME, `${author}`);
}

console.log('\n=== 3. 作者被写进 PDF 的 /T ===');
{
  const outcome = await page.evaluate(async (name) => {
    const bytes = new Uint8Array(await window.__writePdf());
    let text = '';
    for (let i = 0; i < bytes.length; i++) text += String.fromCharCode(bytes[i]);
    // The writer stores text strings as hex, so the name appears as its own bytes.
    const hex = [...new TextEncoder().encode(name)].map((b) => b.toString(16).padStart(2, '0')).join('');
    const at = text.lastIndexOf('/T ');
    return {
      length: bytes.length,
      hasT: at >= 0,
      carriesName: text.includes(hex),
      context: at >= 0 ? text.slice(at, at + 48) : '',
    };
  }, NAME);

  check('批注带 /T 条目', outcome.hasT, outcome.context);
  check('字节里带着作者名', outcome.carriesName, `文件 ${outcome.length} 字节`);
  check('/T 紧挨着批注的几何条目', /\/T <[0-9a-f]+> \/Rect/.test(outcome.context), outcome.context);
}

console.log('\n=== 3b. 作者可以从文件读回 ===');
{
  const restored = await page.evaluate(async (name) => {
    const bytes = new Uint8Array(await window.__writePdf());
    const found = await window.__importFromPdf(bytes);
    void name;
    return found[0]?.author ?? null;
  }, NAME);
  check('重新读出的批注带着同一个作者', restored === NAME, `${restored}`);
}

console.log('\n=== 4. 空名字不写占位符 ===');
{
  await page.evaluate(() => {
    window.__store().load([], false);
    window.__store().defaultAuthor = '';
    window.__store().add({ page: 1, kind: 'rect', color: '#00aa00', rect: { x: 60, y: 60, w: 40, h: 40 } });
  });
  await page.waitForTimeout(400);
  const outcome = await page.evaluate(async () => {
    const bytes = new Uint8Array(await window.__writePdf());
    let text = '';
    for (let i = 0; i < bytes.length; i++) text += String.fromCharCode(bytes[i]);
    return { hasT: /\/T </.test(text) };
  });
  check('没有名字时不写 /T', outcome.hasT === false);
}

console.log('\n=== 5. 面板在行上显示作者 ===');
{
  await page.evaluate((name) => {
    window.__store().load([], false);
    window.__store().defaultAuthor = name;
    window.__store().add({ page: 1, kind: 'note', color: '#f0b429', rect: { x: 80, y: 80, w: 24, h: 24 }, note: '看看这里' });
  }, NAME);
  await page.waitForTimeout(500);
  await page.click('#tab-annotations');
  await page.waitForTimeout(500);

  const shown = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.annot-author')];
    return rows.map((el) => el.textContent);
  });
  check('面板里出现作者行', shown.includes(NAME), JSON.stringify(shown));
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
