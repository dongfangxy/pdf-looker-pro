// Verifies the magnifier and the print flow.
//
//   node tools/e2e-print-loupe.mjs [baseUrl]
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

// A point that is inside both the page and the scroll viewport, so the pointer really
// lands on rendered content rather than on the toolbar or the sidebar.
const probePoint = () =>
  page.evaluate(() => {
    const pg = document.querySelector('.page:not(.unrendered)');
    const scroll = document.querySelector('#scroll-container');
    const r = pg.getBoundingClientRect();
    const s = scroll.getBoundingClientRect();
    const left = Math.max(r.left, s.left);
    const right = Math.min(r.right, s.right);
    const top = Math.max(r.top, s.top);
    const bottom = Math.min(r.bottom, s.bottom);
    return { x: Math.round((left + right) / 2), y: Math.round((top + bottom) / 2) };
  });

const lensState = () =>
  page.evaluate(() => {
    const lens = document.querySelector('.loupe');
    if (!lens) return { exists: false };
    const canvas = lens.querySelector('canvas');
    let ink = 0;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      for (let i = 0; i < data.length; i += 4 * 97) if (data[i] < 250) ink++;
    }
    return {
      exists: true,
      hidden: lens.classList.contains('hidden'),
      width: Math.round(lens.getBoundingClientRect().width),
      ink,
    };
  });

console.log('\n=== 1. 放大镜 ===');
{
  const before = await lensState();
  check('放大镜默认不显示', before.exists === false || before.hidden === true, JSON.stringify(before));

  // The magnifier ships in the overflow menu so the toolbar still fits one row.
  const openLoupe = async () => {
    await page.click('#btn-more');
    await page.waitForTimeout(300);
    await page.click('.more-run[data-command="1220"]');
    await page.waitForTimeout(300);
    if ((await page.locator('#overflow-menu:not(.hidden)').count()) > 0) {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(200);
    }
  };
  await openLoupe();
  check('菜单命令打开放大镜', (await page.evaluate(() => document.querySelector('#scroll-container').parentElement.classList.contains('loupe-on'))) === true);

  const point = await probePoint();
  await page.mouse.move(point.x, point.y);
  await page.waitForTimeout(400);
  const shown = await lensState();
  check('指针移到页面上时镜片出现', shown.exists === true && shown.hidden === false, JSON.stringify({ hidden: shown.hidden }));
  check('镜片尺寸为 180px', shown.width === 180, `${shown.width}`);
  check('镜片确实放大了页面内容（画布非空白）', (shown.ink ?? 0) > 20, `非白采样=${shown.ink}`);

  // Move somewhere with no page under it: the lens must not sit on a stale image.
  await page.mouse.move(8, 8);
  await page.waitForTimeout(400);
  check('指针离开页面后镜片隐藏', (await lensState()).hidden === true);

  await openLoupe();
  check('再次执行关闭放大镜', (await page.evaluate(() => document.querySelector('#scroll-container').parentElement.classList.contains('loupe-on'))) === false);
}

console.log('\n=== 2. 打印对话框 ===');
{
  await page.click('#btn-more');
  await page.waitForTimeout(300);
  check('“更多”菜单里有打印命令', (await page.locator('.more-run[data-command="1221"]').count()) === 1);
  check('“更多”菜单里有放大镜命令', (await page.locator('.more-run[data-command="1220"]').count()) === 1);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
}
{
  // `window.print` would raise the platform dialogue; record the intent instead.
  await page.evaluate(() => {
    window.__printCalls = 0;
    window.print = () => {
      window.__printCalls += 1;
    };
  });

  await page.keyboard.press('Control+p');
  await page.waitForTimeout(500);
  check('Ctrl+P 打开打印对话框', (await page.locator('.modal-print').count()) === 1);
  check('对话框有三组设置', (await page.locator('.modal-print .print-row').count()) === 3);
  check('默认为打印全部页面', (await page.locator('.modal-print input[value="all"]').isChecked()) === true);

  await page.click('.modal-print .modal-cancel');
  await page.waitForTimeout(300);
  check('取消关闭对话框', (await page.locator('.modal-print').count()) === 0);
  check('取消后没有触发打印', (await page.evaluate(() => window.__printCalls)) === 0);
  check('取消后没有留下排版内容', (await page.evaluate(() => document.querySelectorAll('#print-root').length)) === 0);
}

console.log('\n=== 3. 生成打印内容 ===');
{
  await page.keyboard.press('Control+p');
  await page.waitForTimeout(400);
  // Current page only, so the run stays quick and the count is known.
  await page.locator('.modal-print input[value="current"]').check();
  await page.click('.modal-print .modal-confirm');
  // The container is display:none on screen by design, so wait for attachment.
  await page.waitForSelector('#print-root .print-page', { state: 'attached', timeout: 30000 });
  await page.waitForTimeout(600);

  const sheets = await page.evaluate(() => {
    const root = document.querySelector('#print-root');
    if (!root) return null;
    return {
      pages: root.querySelectorAll('.print-page').length,
      images: [...root.querySelectorAll('img')].map((img) => ({
        complete: img.complete,
        width: img.naturalWidth,
        data: img.src.startsWith('data:image/jpeg'),
      })),
      pageNumbers: [...root.querySelectorAll('.print-page')].map((el) => el.dataset.page),
    };
  });
  check('生成了打印容器', sheets !== null);
  check('当前页只排一张', sheets?.pages === 1, `${sheets?.pages}`);
  check('排的是当前页', sheets?.pageNumbers?.[0] === '1', sheets?.pageNumbers?.join(','));
  check('内容是一张已解码的 JPEG', sheets?.images?.[0]?.complete === true && sheets.images[0].data === true, JSON.stringify(sheets?.images?.[0]?.width));
  check('图像有实际像素', (sheets?.images?.[0]?.width ?? 0) > 500, `${sheets?.images?.[0]?.width}px`);
  check('浏览器环境调用了 window.print', (await page.evaluate(() => window.__printCalls)) === 1);
}

console.log('\n=== 4. 打印样式只露出内容 ===');
{
  await page.emulateMedia({ media: 'print' });
  await page.waitForTimeout(200);
  const visibility = await page.evaluate(() => {
    // `display` is not inherited, so a hidden ancestor leaves a child reporting its own
    // display value. What matters is whether the element actually lays out.
    const rendered = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      return el.getClientRects().length > 0;
    };
    return {
      printRoot: rendered('#print-root .print-page'),
      shell: rendered('#scroll-container'),
      toolbar: rendered('.toolbar'),
      sidebar: rendered('#sidebar'),
      statusBar: rendered('#status-bar'),
      bodyChildren: [...document.body.children].map((el) => el.id || el.className.toString().slice(0, 20)),
    };
  });
  check('打印媒体下打印容器可见', visibility.printRoot === true, JSON.stringify({ pages: visibility.printRoot }));
  check('打印媒体下阅读区不渲染', visibility.shell === false);
  check('打印媒体下工具栏不渲染', visibility.toolbar === false);
  check('打印媒体下侧栏隐藏', visibility.sidebar === false);
  check('打印媒体下状态栏隐藏', visibility.statusBar === false);

  await page.emulateMedia({ media: 'screen' });
  await page.waitForTimeout(200);
  check('回到屏幕媒体后打印容器隐藏', (await page.evaluate(() => getComputedStyle(document.querySelector('#print-root')).display)) === 'none');
}

console.log('\n=== 5. 页面范围解析 ===');
{
  await page.keyboard.press('Control+p');
  await page.waitForTimeout(400);
  await page.locator('.modal-print input[value="custom"]').check();
  await page.fill('.modal-print .print-range-input', '2-4, 9');
  await page.click('.modal-print .modal-confirm');
  await page.waitForFunction(() => document.querySelectorAll('#print-root .print-page').length === 4, { timeout: 60000 });
  await page.waitForTimeout(400);

  const ranged = await page.evaluate(() =>
    [...document.querySelectorAll('#print-root .print-page')].map((el) => Number(el.dataset.page)),
  );
  check('自定义范围 2-4,9 排出 4 页', ranged.length === 4, ranged.join(','));
  check('范围解析正确', JSON.stringify(ranged) === JSON.stringify([2, 3, 4, 9]), ranged.join(','));
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
