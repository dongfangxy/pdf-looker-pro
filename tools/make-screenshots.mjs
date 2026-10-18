// Regenerates the README screenshots from the running build.
//
// The images in docs/screenshots are what a visitor sees first, so they should show the
// application as it is, not as it was two releases ago. Captured with the debug hooks so
// the annotations can be placed deterministically; `?debug=p5` installs hooks only and
// changes nothing visible.
//
//   node tools/make-screenshots.mjs [baseUrl]
import { chromium } from 'playwright';

const BASE = process.argv[2] ?? 'http://127.0.0.1:4173';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

const browser = await chromium.launch({ executablePath: EDGE, headless: true });
const page = await browser.newPage({
  viewport: { width: 1600, height: 1000 },
  deviceScaleFactor: 1.25,
});

await page.goto(`${BASE}/?file=./fixtures/test.pdf&debug=p5`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('.page:not(.unrendered)').length > 0, { timeout: 30000 });
await page.waitForTimeout(1500);

// A page with one of each thing the reader is meant to show off: a text box, a standard
// stamp and a text highlight.
await page.evaluate(() => {
  const store = window.__store();
  store.defaultAuthor = 'Chengxi Zhang';
  store.add({
    page: 1,
    kind: 'textbox',
    color: '#c0392b',
    rect: { x: 70, y: 210, w: 300, h: 74 },
    note: 'Type directly on the page — no dialog in the way.',
    fontSize: 13,
  });
  store.add({
    page: 1,
    kind: 'highlight',
    color: '#ffd24a',
    rects: [{ x: 64, y: 300, w: 372, h: 26 }],
  });
  store.add({
    page: 1,
    kind: 'stamp',
    color: '#1f8f4e',
    rect: { x: 372, y: 396, w: 158, h: 54 },
    stampId: 'approved',
    note: '已批准',
  });
  store.add({
    page: 1,
    kind: 'measure-distance',
    color: '#2c6fbb',
    strokes: [
      [
        { x: 70, y: 470 },
        { x: 470, y: 470 },
      ],
    ],
  });
});
await page.waitForTimeout(900);

// Whole page in view, at the top: a screenshot of a cropped 208% page says nothing about
// how the reader is laid out.
await page.evaluate(() => window.__viewer.setZoomMode('fit-page'));
await page.waitForTimeout(900);
await page.evaluate(() => {
  document.querySelector('#scroll-container').scrollTop = 0;
});
await page.waitForTimeout(500);

// Showcase the panel that lists them.
await page.click('#tab-annotations');
await page.waitForTimeout(700);

await page.screenshot({ path: 'docs/screenshots/main.png' });
console.log('  docs/screenshots/main.png');

// The toolbar on its own, from the same deterministic layout.
await page.click('#tab-thumbnails');
await page.waitForTimeout(400);
const bar = await page.evaluate(() => {
  const el = document.querySelector('.toolbar') ?? document.querySelector('header');
  const box = el.getBoundingClientRect();
  return { x: box.x, y: box.y, width: box.width, height: box.height };
});
await page.screenshot({ path: 'docs/screenshots/toolbar.png', clip: bar });
console.log('  docs/screenshots/toolbar.png');

await browser.close();
