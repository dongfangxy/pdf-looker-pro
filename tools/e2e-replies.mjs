// Verifies annotation replies: the panel thread, the PDF representation, and the round trip.
//
//   node tools/e2e-replies.mjs [baseUrl]
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

/** Answers the next window.prompt the page raises. */
function answerPrompt(text) {
  page.once('dialog', (dialog) => {
    void dialog.accept(text);
  });
}

const written = () =>
  page.evaluate(async () => {
    const bytes = new Uint8Array(await window.__writePdf());
    let text = '';
    for (let i = 0; i < bytes.length; i++) text += String.fromCharCode(bytes[i]);
    return { irt: (text.match(/\/IRT /g) ?? []).length, length: bytes.length };
  });

console.log('\n=== 1. 一条批注 ===');
{
  await page.evaluate((name) => {
    window.__store().defaultAuthor = name;
    window.__store().add({ page: 1, kind: 'rect', color: '#ff0000', rect: { x: 60, y: 60, w: 90, h: 70 } });
  }, NAME);
  await page.waitForTimeout(500);
  check('批注已建立', (await page.evaluate(() => window.__store().count)) === 1);
  check('没有回复时写入不含 /IRT', (await written()).irt === 0);
}

console.log('\n=== 2. 面板里可以回复 ===');
{
  await page.click('#tab-annotations');
  await page.waitForTimeout(500);
  check('列表里有那一行批注', (await page.locator('.annot-row').count()) === 1);
  check('行上有回复按钮', (await page.locator('.annot-reply-add').count()) === 1);

  answerPrompt('请把这一段再核对一下');
  await page.click('.annot-reply-add');
  await page.waitForTimeout(600);

  const shown = await page.evaluate(() => {
    const nodes = [...document.querySelectorAll('.annot-reply')];
    return nodes.map((node) => ({
      author: node.querySelector('.annot-reply-author')?.textContent ?? '',
      text: node.querySelector('.annot-reply-text')?.textContent ?? '',
    }));
  });
  check('面板里出现一条回复', shown.length === 1, `${shown.length}`);
  check('回复带作者', shown[0]?.author === NAME, shown[0]?.author);
  check('回复内容正确', shown[0]?.text === '请把这一段再核对一下', shown[0]?.text);

  const stored = await page.evaluate(() => window.__store().all[0]?.replies ?? []);
  check('回复进了批注模型', stored.length === 1, `${stored.length}`);
}

console.log('\n=== 3. 多条回复保持顺序 ===');
{
  answerPrompt('第二条');
  await page.click('.annot-reply-add');
  await page.waitForTimeout(600);
  const stored = await page.evaluate(() => (window.__store().all[0]?.replies ?? []).map((r) => r.text));
  check('两条回复按先后排列', JSON.stringify(stored) === JSON.stringify(['请把这一段再核对一下', '第二条']), JSON.stringify(stored));
  check('面板显示两条', (await page.locator('.annot-reply').count()) === 2);
}

console.log('\n=== 4. 写进 PDF 是真正的回复 ===');
{
  const out = await written();
  check('每条回复各是一个带 /IRT 的批注', out.irt === 2, `${out.irt}`);

  const shapes = await page.evaluate(async () => {
    const bytes = new Uint8Array(await window.__writePdf());
    let text = '';
    for (let i = 0; i < bytes.length; i++) text += String.fromCharCode(bytes[i]);
    return {
      textShapes: (text.match(/\/Subtype \/Text/g) ?? []).length,
      hasParentRef: /\/IRT \d+ 0 R/.test(text),
    };
  });
  check('回复是 /Text 子类型', shapes.textShapes === 2, `${shapes.textShapes}`);
  check('/IRT 指向父批注对象', shapes.hasParentRef === true);
}

console.log('\n=== 5. 回复可以从文件读回 ===');
{
  const restored = await page.evaluate(async () => {
    const bytes = new Uint8Array(await window.__writePdf());
    const found = await window.__importFromPdf(bytes);
    return {
      parents: found.length,
      // The debug hook already projects replies down to their text.
      replies: found[0]?.replies ?? [],
    };
  });
  check('读回只有一条父批注', restored.parents === 1, `${restored.parents}`);
  check('两条回复挂回父批注', JSON.stringify(restored.replies) === JSON.stringify(['请把这一段再核对一下', '第二条']), JSON.stringify(restored.replies));
}

console.log('\n=== 6. 回复可以撤销 ===');
{
  const before = await page.evaluate(() => (window.__store().all[0]?.replies ?? []).length);
  check('撤销前有两条', before === 2);
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(600);
  const after = await page.evaluate(() => (window.__store().all[0]?.replies ?? []).length);
  check('撤销后回到一条', after === 1, `${after}`);
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
