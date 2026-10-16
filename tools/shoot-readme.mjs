// Produces the screenshot used by the README.
//
// The scene is built from the synthetic test fixture rather than a real paper, so the
// image can be redistributed with the repository without carrying someone else's
// document. What it shows is the application: toolbar, sidebar, page, and annotations.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const OUT = resolve('docs/screenshots');
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: EDGE, headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1.25 });

await page.goto('http://127.0.0.1:4173/?file=./fixtures/test.pdf&debug=p5', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('.page:not(.unrendered)').length > 0, { timeout: 30000 });
await page.waitForTimeout(1200);
await page.click('#btn-fit-page');
await page.waitForTimeout(700);
await page.evaluate(() => {
  document.querySelector('#scroll-container').scrollTop = 0;
});
await page.waitForTimeout(500);

const pick = async (id) => {
  await page.click('#btn-more');
  await page.waitForTimeout(260);
  await page.click(`#overflow-menu .more-run[data-command="${id}"]`);
  await page.waitForTimeout(320);
};

const geometry = await page.evaluate(() => {
  const r = document.querySelector('.page:not(.unrendered)').getBoundingClientRect();
  return { left: r.left, top: Math.max(r.top, 90), width: r.width, height: r.height };
});
const at = (fx, fy) => ({
  x: Math.round(geometry.left + geometry.width * fx),
  y: Math.round(geometry.top + geometry.height * fy),
});

// A rectangle over a paragraph, drawn in a warm colour.
await pick(1105);
await page.click('#btn-color');
await page.waitForTimeout(260);
await page.locator('#color-popup .swatch').nth(3).click();
await page.waitForTimeout(220);
const r1 = at(0.12, 0.16);
const r2 = at(0.62, 0.26);
await page.mouse.move(r1.x, r1.y);
await page.mouse.down();
await page.mouse.move(r2.x, r2.y, { steps: 10 });
await page.mouse.up();
await page.waitForTimeout(500);

// A text box, typed in place.
await pick(1111);
await page.click('#btn-color');
await page.waitForTimeout(260);
await page.locator('#color-popup .swatch').nth(7).click();
await page.waitForTimeout(220);
const t1 = at(0.14, 0.36);
await page.mouse.move(t1.x, t1.y);
await page.mouse.down();
await page.waitForTimeout(60);
await page.mouse.up();
await page.waitForTimeout(500);
await page.fill('.annot-editor', 'Typed directly on the page — no dialog.');
await page.keyboard.press('Control+Enter');
await page.waitForTimeout(700);

// A distance measurement.
await pick(1115);
const m1 = at(0.14, 0.58);
const m2 = at(0.66, 0.58);
await page.mouse.move(m1.x, m1.y);
await page.mouse.down();
await page.mouse.move(m2.x, m2.y, { steps: 10 });
await page.mouse.up();
await page.waitForTimeout(600);

// Select the rectangle so the selection frame and its grip are visible.
await page.click('#tool-pointer');
await page.waitForTimeout(250);
await page.mouse.click(Math.round((r1.x + r2.x) / 2), Math.round((r1.y + r2.y) / 2));
await page.waitForTimeout(600);

// Show the annotation panel next to the page.
const panelTab = page.locator('.sidebar-tab', { hasText: '批注' });
if (await panelTab.count()) {
  await panelTab.first().click();
  await page.waitForTimeout(500);
}

await page.screenshot({ path: `${OUT}/main.png` });
console.log('已输出 docs/screenshots/main.png');

// Second shot: the toolbar customisation list.
await page.click('#btn-more');
await page.waitForTimeout(450);
await page.screenshot({ path: `${OUT}/toolbar.png` });
console.log('已输出 docs/screenshots/toolbar.png');

await browser.close();
