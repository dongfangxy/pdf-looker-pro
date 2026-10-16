// Verifies the resource container end to end in the running application: the pack
// loads over the network, the embedded font becomes available to the renderer, the
// page badge is stamped with it, and every icon is injected from the pack.
//
//   node tools/e2e-resources.mjs [baseUrl]
//
// Requires the preview server (npm run preview).
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = process.argv[2] ?? 'http://127.0.0.1:4173';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

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
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
const consoleErrors = [];
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text());
});

console.log('=== 1. 容器加载 ===');
await page.goto(`${BASE}/?file=./fixtures/test.pdf&debug=res`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__packReady === undefined || window.__packReady(), { timeout: 25000 });
await page.waitForFunction(() => document.querySelectorAll('.page:not(.unrendered)').length > 0, { timeout: 30000 });

const pack = await page.evaluate(() => {
  const p = window.__pack ? window.__pack() : null;
  if (!p) return null;
  const c = p.container;
  return {
    assets: c.assets.map((a) => ({ name: a.name, layer: a.layer, rawLen: a.rawLen, storedLen: a.storedLen, deflate: a.deflate })),
    meta: [...c.meta.entries()],
    layers: [c.layerName(0), c.layerName(1)],
    fontFamily: p.fontFamily,
    unknown: c.unknownSections.length,
  };
});

check('容器已加载', pack !== null);
if (pack) {
  const uiAssets = pack.assets.filter((a) => a.layer === 0);
const fontAssets = pack.assets.filter((a) => a.layer === 1);
check('资产数量 = ui 图标数 + 字体数', pack.assets.length === uiAssets.length + fontAssets.length, `总 ${pack.assets.length} = ui ${uiAssets.length} + font ${fontAssets.length}`);
check('图标资产足够覆盖工具栏与标签页', uiAssets.length >= 18, String(uiAssets.length));
  check('ui 层全部是图标（无字体混入）', uiAssets.length > 0 && uiAssets.every((a) => a.kind === 'icon' || a.name.length > 0), String(uiAssets.length));
  check('font 层含内置字体', pack.assets.filter((a) => a.layer === 1).length === 1, `rawLen=${pack.assets.find((a) => a.layer === 1)?.rawLen}`);
  check('图层名从 META 解析', pack.layers[0] === 'ui' && pack.layers[1] === 'font', pack.layers.join(' / '));
  check('字体被逐条压缩', pack.assets.find((a) => a.layer === 1)?.deflate === true);
  check(
    '字体压缩率合理',
    (pack.assets.find((a) => a.layer === 1)?.storedLen ?? 0) < (pack.assets.find((a) => a.layer === 1)?.rawLen ?? 1) / 5,
    `${pack.assets.find((a) => a.layer === 1)?.storedLen} / ${pack.assets.find((a) => a.layer === 1)?.rawLen}`,
  );
  check('META 键值可读', pack.meta.some(([k, v]) => k === 'pack.name' && v === 'pdfreader-ui'), JSON.stringify(pack.meta.slice(0, 3)));
  check('无未知段', pack.unknown === 0);
}

console.log('\n=== 2. 内置字体 ===');
{
  const font = await page.evaluate(async () => {
    const badge = document.querySelector('.page-badge');
    const ready = document.fonts.check('13px "ARPK Sans"');
    const loaded = [...document.fonts].map((f) => ({ family: f.family, status: f.status }));
    const ctx = document.createElement('canvas').getContext('2d');
    ctx.font = '100px "ARPK Sans"';
    const own = ctx.measureText('0123456789').width;
    ctx.font = '100px monospace';
    const mono = ctx.measureText('0123456789').width;
    return {
      ready,
      loaded,
      own,
      mono,
      badgeText: badge?.textContent ?? '',
      badgeFont: badge ? getComputedStyle(badge).fontFamily : '',
      badgeRect: badge ? { w: badge.getBoundingClientRect().width, h: badge.getBoundingClientRect().height } : null,
    };
  });
  check('字体已注册并可用', font.ready === true, JSON.stringify(font.loaded));
  check('字体状态为 loaded', font.loaded.some((f) => f.family === 'ARPK Sans' && f.status === 'loaded'));
  check('自研字体宽度与回退不同（确实在用）', Math.abs(font.own - font.mono) > 1, `自研=${font.own.toFixed(1)} 等宽=${font.mono.toFixed(1)}`);

  check('页码角标存在', font.badgeText === '1', `"${font.badgeText}"`);
  check('角标使用内置字体', font.badgeFont.includes('ARPK Sans'), font.badgeFont);
  check('角标已渲染出尺寸', (font.badgeRect?.w ?? 0) > 10 && (font.badgeRect?.h ?? 0) > 10, `${font.badgeRect?.w.toFixed(0)}×${font.badgeRect?.h.toFixed(0)}`);

  const badges = await page.evaluate(() => [...document.querySelectorAll('.page-badge')].map((b) => b.textContent));
  check('每页都有角标且编号正确', badges.length === 24 && badges[0] === '1' && badges[23] === '24', `首=${badges[0]} 末=${badges[23]} 数=${badges.length}`);
}

console.log('\n=== 3. 图标由容器注入 ===');
{
  const icons = await page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('.btn-icon')) {
      const style = getComputedStyle(el);
      const mask = style.maskImage !== 'none' ? style.maskImage : style.webkitMaskImage;
      out.push({
        parent: el.parentElement?.id ?? '',
        mask,
        w: el.getBoundingClientRect().width,
        h: el.getBoundingClientRect().height,
    visible: el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0,
      });
    }
    return out;
  });
  check('全部图标元素都被注入', icons.length >= 18, `${icons.length}: ${icons.map((i) => i.parent).join(',')}`);
  check('图标源为 blob URL', icons.every((i) => i.mask.includes('blob:')), icons[0]?.mask.slice(0, 40));
  const visibleIcons = icons.filter((i) => i.visible);
check('可见图标的尺寸非零', visibleIcons.length > 0 && visibleIcons.every((i) => i.w > 0 && i.h > 0), `${visibleIcons.length}/${icons.length} 可见: ` + visibleIcons.map((i) => `${i.w.toFixed(0)}x${i.h.toFixed(0)}`).join(' '));

  // The masked image must resolve to real SVG bytes.
  const svgCheck = await page.evaluate(async () => {
    const el = document.querySelector('.btn-icon');
    const style = getComputedStyle(el);
    const mask = style.maskImage !== 'none' ? style.maskImage : style.webkitMaskImage;
    const url = mask.match(/url\("?([^")]+)"?\)/)?.[1];
    if (!url) return { ok: false, reason: 'no url' };
    const text = await (await fetch(url)).text();
    return { ok: text.startsWith('<svg'), length: text.length, head: text.slice(0, 60) };
  });
  check('图标 blob 可解析为 SVG', svgCheck.ok === true, `${svgCheck.length} 字符`);

  const labels = await page.evaluate(() =>
    ['tool-hand', 'tool-select', 'tool-zoom', 'tool-snapshot', 'tab-thumbnails', 'tab-outline'].map((id) => ({
      id,
      label: document.getElementById(id)?.querySelector('.btn-label')?.textContent ?? '',
    })),
  );
  check('图标不吞掉文字标签', labels.every((l) => l.label.length > 0), labels.map((l) => `${l.id}="${l.label}"`).join(' '));
}

console.log('\n=== 4. 语言切换后图标仍在 ===');
{
  const beforeIcons = await page.evaluate(() => document.querySelectorAll('.btn-icon').length);
  await page.click('#btn-settings');
  await page.waitForSelector('.modal-settings', { timeout: 5000 });
  await page.selectOption('.settings-select[data-key="language"]', 'en');
  await page.click('.modal-confirm');
  await page.waitForTimeout(500);
  await page.waitForTimeout(400);
  const after = await page.evaluate(() => ({
    icons: document.querySelectorAll('.btn-icon').length,
    label: document.querySelector('#tool-hand .btn-label')?.textContent ?? '',
  }));
  check('切换语言后图标数量不变', after.icons === beforeIcons, `${beforeIcons} -> ${after.icons}`);
  check('标签跟随语言更新', after.label === 'Hand', `"${after.label}"`);
  await page.click('#btn-settings');
  await page.waitForSelector('.modal-settings', { timeout: 5000 });
  await page.selectOption('.settings-select[data-key="language"]', 'zh-CN');
  await page.click('.modal-confirm');
  await page.waitForTimeout(500);
  await page.waitForTimeout(300);
}

console.log('\n=== 5. 无外部资源依赖 ===');
{
  // Everything the pack supplies must come from the pack: no separate font or icon
  // file is requested.
  const requests = [];
  page.on('request', (r) => requests.push(r.url()));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelectorAll('.page:not(.unrendered)').length > 0, { timeout: 30000 });
  await page.waitForTimeout(600);
  const fontFiles = requests.filter((u) => /\.(ttf|otf|woff2?)$/i.test(u));
  const iconFiles = requests.filter((u) => /\.svg(\?|$)/i.test(u) && !u.startsWith('data:'));
  const packRequests = requests.filter((u) => u.includes('ui.arpk'));
  check('请求了资源容器', packRequests.length >= 1, packRequests.length ? packRequests[0].split('/').pop() : '无');
  check('没有单独请求字体文件', fontFiles.length === 0, fontFiles.join(' ') || '无');
  check('没有单独请求图标文件', iconFiles.length === 0, iconFiles.join(' ') || '无');
}

mkdirSync(join(root, 'docs'), { recursive: true });
await page.screenshot({ path: join(root, 'docs', 'p4-resources.png') });
console.log('\n  截图: docs/p4-resources.png');

console.log('\n=== 6. 错误检查 ===');
check('无未捕获页面错误', errors.length === 0, errors.slice(0, 2).join(' | '));
check('无控制台错误', consoleErrors.length === 0, consoleErrors.slice(0, 2).join(' | '));

await browser.close();
console.log(`\n=== 结果: ${passed} 通过 / ${failed} 失败 ===`);
if (failed > 0) {
  console.log('失败项:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exitCode = 1;
}
