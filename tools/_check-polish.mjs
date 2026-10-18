// Compares the existing homepage against the polished override: same content, two
// stylesheets, screenshots of each.
//
//   node tools/_check-polish.mjs [url] [outDir]
import { chromium } from 'playwright';

const URL_ = process.argv[2] ?? 'http://127.0.0.1:4180/style-demo/';
const OUT = process.argv[3] ?? 'D:/CodeX/REA/pages/_shots-polish';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

const browser = await chromium.launch({ executablePath: EDGE, headless: true });
const errors = [];

async function shot(name, width, height) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => errors.push(`${name}: ${e}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`${name} console: ${m.text()}`);
  });
  await page.goto(URL_, { waitUntil: 'load' });
  await page.waitForTimeout(700);

  const measure = await page.evaluate(() => {
    const para = [...document.querySelectorAll('.container p')].find((p) => p.textContent.trim().length > 120);
    const services = document.querySelector('#academic-services + ul');
    const li = services?.querySelector('li');
    const card = document.querySelector('.container');
    return {
      width: card ? Math.round(card.getBoundingClientRect().width) : 0,
      paraWidth: para ? Math.round(para.getBoundingClientRect().width) : 0,
      paraChars: para ? para.textContent.trim().length : 0,
      servicesLineHeight: services ? getComputedStyle(services).lineHeight : null,
      servicesLiMargin: li ? getComputedStyle(li).marginTop : null,
      headingBar: (() => {
        const h3 = document.querySelector('.container h3');
        return h3 ? getComputedStyle(h3, '::before').display : null;
      })(),
      overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      height: document.documentElement.scrollHeight,
    };
  });

  // "Polished" is the default; switch it off to capture the baseline.
  const polished = await page.evaluate(() => !document.getElementById('polish')?.disabled);
  await page.screenshot({ path: `${OUT}/${name}-${polished ? 'after' : 'before'}.png`, fullPage: true });
  await page.screenshot({ path: `${OUT}/${name}-${polished ? 'after' : 'before'}-top.png` });
  await page.close();
  return measure;
}

const after = await shot('desktop', 1280, 1000);
console.log(`  [after]  card ${after.width}px   prose line ${after.paraWidth}px / ${after.paraChars} chars`);
console.log(`           services line-height ${after.servicesLineHeight}   li margin ${after.servicesLiMargin}`);
console.log(`           h3::before ${after.headingBar}   overflowX ${after.overflowX}   height ${after.height}px`);

// Baseline: same page with the override switched off.
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 }, deviceScaleFactor: 1 });
await page.goto(URL_, { waitUntil: 'load' });
await page.click('#toggle-polish');
await page.waitForTimeout(400);
const before = await page.evaluate(() => {
  const para = [...document.querySelectorAll('.container p')].find((p) => p.textContent.trim().length > 120);
  const services = document.querySelector('#academic-services + ul');
  const li = services?.querySelector('li');
  const card = document.querySelector('.container');
  const h3 = document.querySelector('.container h3');
  return {
    width: card ? Math.round(card.getBoundingClientRect().width) : 0,
    paraWidth: para ? Math.round(para.getBoundingClientRect().width) : 0,
    servicesLineHeight: services ? getComputedStyle(services).lineHeight : null,
    servicesLiMargin: li ? getComputedStyle(li).marginTop : null,
    headingBar: h3 ? getComputedStyle(h3, '::before').display : null,
    height: document.documentElement.scrollHeight,
  };
});
console.log(`  [before] card ${before.width}px   prose line ${before.paraWidth}px`);
console.log(`           services line-height ${before.servicesLineHeight}   li margin ${before.servicesLiMargin}`);
console.log(`           h3::before ${before.headingBar}   height ${before.height}px`);
await page.screenshot({ path: `${OUT}/desktop-before.png`, fullPage: true });
await page.screenshot({ path: `${OUT}/desktop-before-top.png` });
await page.close();

const mobAfter = await shot('mobile', 390, 844);
console.log(`  [mobile after] overflowX ${mobAfter.overflowX}   card ${mobAfter.width}px`);

console.log(`  errors: ${errors.length ? errors.join(' | ') : 'none'}`);
await browser.close();
