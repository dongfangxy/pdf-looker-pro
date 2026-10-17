// Verifies form-field highlighting: detection, placement, the toggle, and that it scales.
//
//   node tools/e2e-fields.mjs [baseUrl]
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

const open = async (file) => {
  await page.goto(`${BASE}/?file=./fixtures/${file}&debug=p5`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelectorAll('.page:not(.unrendered)').length > 0, { timeout: 30000 });
  await page.waitForTimeout(1600);
};

const fields = () =>
  page.evaluate(() =>
    [...document.querySelectorAll('.form-field')].map((el) => {
      const box = el.getBoundingClientRect();
      return {
        w: Math.round(box.width),
        h: Math.round(box.height),
        top: Math.round(box.top),
        pointer: getComputedStyle(el).pointerEvents,
      };
    }),
  );

await open('form.pdf');

console.log('\n=== 1. 字段被识别出来 ===');
{
  const detected = await page.evaluate(() => window.__formFields());
  check('读到两个表单字段', detected.length === 2, `${detected.length}`);
  check('字段带名字', detected[0]?.name === 'name' && detected[1]?.name === 'reference', JSON.stringify(detected.map((f) => f.name)));
  check('字段落在第 1 页', detected.every((f) => f.page === 1));
}

console.log('\n=== 2. 字段被画在正确的位置 ===');
{
  const painted = await fields();
  check('画出两个高亮块', painted.length === 2, `${painted.length}`);
  check('两个块大小相同', painted[0]?.w === painted[1]?.w && painted[0]?.h === painted[1]?.h, `${painted[0]?.w}×${painted[0]?.h}`);
  // The fixture's widgets are 160x30 points on a 400x300 page, and the bars stack
  // vertically, so the first must sit above the second.
  check('第一个在第二个上方', (painted[0]?.top ?? 0) < (painted[1]?.top ?? 0), `${painted[0]?.top} < ${painted[1]?.top}`);
  check('宽高比接近字段比例', Math.abs((painted[0]?.w ?? 0) / (painted[0]?.h ?? 1) - 160 / 30) < 0.3, `${((painted[0]?.w ?? 0) / (painted[0]?.h ?? 1)).toFixed(2)}`);
  check('不拦截鼠标事件', painted.every((f) => f.pointer === 'none'), painted[0]?.pointer);
}

console.log('\n=== 3. 随缩放一起变化 ===');
{
  // Doubling the scale must double the painted rectangles too.
  const before = (await fields())[0];
  await page.evaluate(() => {
    // setScale takes an absolute scale, so the current one is read from the zoom label
    // rather than assumed.
    const percent = Number((document.querySelector('#zoom-label')?.textContent ?? '100').replace('%', ''));
    window.__viewer.setScale((percent / 100) * 2);
  });
  await page.waitForTimeout(1600);
  const after = (await fields())[0];
  check('放大后字段也变大', (after?.w ?? 0) > (before?.w ?? 0), `${before?.w} -> ${after?.w}`);
  const ratio = (after?.w ?? 1) / (before?.w ?? 1);
  check('变化比例与缩放一致', Math.abs(ratio - 2) < 0.25, `${ratio.toFixed(2)}`);
}

console.log('\n=== 4. 可以在设置里关掉 ===');
{
  await page.click('#btn-settings');
  await page.waitForSelector('.modal-settings', { timeout: 5000 });
  await page.waitForTimeout(400);

  const found = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.modal-settings .settings-row')];
    const row = rows.find((el) => /高亮表单字段/.test(el.textContent ?? ''));
    return row ? { content: row.textContent, checked: !!row.querySelector('input[type="checkbox"]')?.checked } : null;
  });
  check('设置里有这一项', found !== null, found?.content?.slice(0, 20));
  check('默认是开启的', found?.checked === true, `${found?.checked}`);

  await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.modal-settings .settings-row')];
    const row = rows.find((el) => /高亮表单字段/.test(el.textContent ?? ''));
    row?.querySelector('input[type="checkbox"]')?.click();
  });
  await page.waitForTimeout(300);
  await page.click('.modal .primary');
  await page.waitForTimeout(1200);

  check('关掉后不再画出字段', (await fields()).length === 0, `${(await fields()).length}`);
  const stillDetected = await page.evaluate(() => window.__formFields());
  check('字段仍然被记住，只是没画', stillDetected.length === 2, `${stillDetected.length}`);
}

console.log('\n=== 5. 设置会记住，重新打开仍然关闭 ===');
{
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelectorAll('.page:not(.unrendered)').length > 0, { timeout: 30000 });
  await page.waitForTimeout(1600);
  check('重新打开后仍然是关闭的', (await fields()).length === 0, `${(await fields()).length}`);

  const stored = await page.evaluate(() => JSON.parse(window.localStorage.getItem('pdfreader.settings.v1') ?? '{}'));
  check('设置写进了本地存储', stored.highlightFields === false, JSON.stringify(stored.highlightFields));

  // Turn it back on, since later suites share the profile.
  await page.click('#btn-settings');
  await page.waitForSelector('.modal-settings', { timeout: 5000 });
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.modal-settings .settings-row')];
    const row = rows.find((el) => /高亮表单字段/.test(el.textContent ?? ''));
    row?.querySelector('input[type="checkbox"]')?.click();
  });
  await page.click('.modal .primary');
  await page.waitForTimeout(1200);
  check('重新开启后字段回来了', (await fields()).length === 2, `${(await fields()).length}`);
}

console.log('\n=== 6. 没有字段的文档不受影响 ===');
{
  await open('test.pdf');
  check('普通文档没有高亮块', (await fields()).length === 0, `${(await fields()).length}`);
  const detected = await page.evaluate(() => window.__formFields());
  check('也没有识别到字段', detected.length === 0, `${detected.length}`);
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
