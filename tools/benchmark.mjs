// Measures the timings the paper reports: open to first painted page, full-text index
// build, incremental annotation save, whole-document rewrite, and a two-document merge.
//
// Each measurement is repeated; the paper reports the median. Nothing is estimated: a
// timing this script cannot take is reported as null rather than as a guess.
//
//   node tools/benchmark.mjs [baseUrl]
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';

const BASE = process.argv[2] ?? 'http://127.0.0.1:4173';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const REPEATS = 5;

const browser = await chromium.launch({ executablePath: EDGE, headless: true });

const newPage = async () => {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  page.on('pageerror', () => undefined);
  return page;
};

/** Median of the samples that survived. */
function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

async function timeOpen(file) {
  const samples = [];
  for (let i = 0; i < REPEATS; i++) {
    const page = await newPage();
    const started = Date.now();
    await page.goto(`${BASE}/?file=./fixtures/${file}&debug=p5`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.querySelectorAll('.page:not(.unrendered) canvas').length > 0, {
      timeout: 60000,
    });
    samples.push(Date.now() - started);
    await page.close();
  }
  return { samples, median: median(samples) };
}

const openAndWait = async (file) => {
  const page = await newPage();
  await page.goto(`${BASE}/?file=./fixtures/${file}&debug=p5`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelectorAll('.page:not(.unrendered) canvas').length > 0, {
    timeout: 60000,
  });
  await page.waitForTimeout(1200);
  return page;
};

const results = { measuredAt: new Date().toISOString(), repeats: REPEATS, fixture: {}, operations: {} };

console.log('open to first painted page');
for (const file of ['test.pdf', 'large.pdf']) {
  const { samples, median: mid } = await timeOpen(file);
  results.fixture[file] = { samplesMs: samples, medianMs: mid };
  console.log(`  ${file.padEnd(12)} median ${mid} ms  (${samples.join(', ')})`);
}

// Full-text index: every page's text extracted and searchable.
{
  const page = await openAndWait('test.pdf');
  const samples = await page.evaluate(async () => {
    const out = [];
    for (let i = 0; i < 5; i++) out.push(await window.__indexAll());
    return out;
  });
  results.operations['index-24p'] = { samplesMs: samples, medianMs: median(samples) };
  console.log(`  index 24p    median ${median(samples)} ms  (${samples.join(', ')})`);
  await page.close();
}

{
  const page = await openAndWait('large.pdf');
  const samples = await page.evaluate(async () => {
    const out = [];
    for (let i = 0; i < 3; i++) out.push(await window.__indexAll());
    return out;
  });
  results.operations['index-200p'] = { samplesMs: samples, medianMs: median(samples) };
  console.log(`  index 200p   median ${median(samples)} ms  (${samples.join(', ')})`);
  await page.close();
}

// Incremental annotation save: append one annotation and write the update.
{
  const page = await openAndWait('test.pdf');
  const samples = await page.evaluate(async () => {
    const out = [];
    for (let i = 0; i < 5; i++) {
      window.__store().add({
        page: 1,
        kind: 'rect',
        color: '#c0392b',
        rect: { x: 60 + i, y: 60 + i, w: 80, h: 40 },
      });
      const started = performance.now();
      const bytes = await window.__writePdf();
      out.push({ ms: performance.now() - started, bytes: bytes.byteLength });
    }
    return out;
  });
  const times = samples.map((s) => s.ms);
  results.operations['incremental-save-24p'] = {
    samplesMs: times,
    medianMs: median(times),
    outputBytes: samples.map((s) => s.bytes),
  };
  console.log(`  save 24p     median ${median(times).toFixed(0)} ms  (${times.map((t) => t.toFixed(0)).join(', ')})`);
  await page.close();
}

// Whole-document rewrite: rebuild the page tree for every page.
{
  const page = await openAndWait('test.pdf');
  const samples = await page.evaluate(async () => {
    const out = [];
    for (let i = 0; i < 5; i++) {
      // Every page is carried through, so the measurement includes the whole page tree
      // and not an empty rebuild.
      const plan = Array.from({ length: window.__viewer.pageCount }, (_, i) => ({ sourceIndex: i }));
      const started = performance.now();
      await window.__rewritePdf(plan);
      out.push(performance.now() - started);
    }
    return out;
  });
  results.operations['rewrite-24p'] = { samplesMs: samples, medianMs: median(samples) };
  console.log(`  rewrite 24p  median ${median(samples).toFixed(0)} ms  (${samples.map((t) => t.toFixed(0)).join(', ')})`);
  await page.close();
}

// Merge: 24-page document inserted into itself, so both object graphs are renumbered.
{
  const page = await openAndWait('test.pdf');
  const samples = await page.evaluate(async () => {
    const extra = new Uint8Array(await (await fetch('./fixtures/test.pdf')).arrayBuffer());
    const out = [];
    for (let i = 0; i < 5; i++) {
      const started = performance.now();
      await window.__mergePdf(extra, 1);
      out.push(performance.now() - started);
    }
    return out;
  });
  results.operations['merge-24plus24'] = { samplesMs: samples, medianMs: median(samples) };
  console.log(`  merge 48p    median ${median(samples).toFixed(0)} ms  (${samples.map((t) => t.toFixed(0)).join(', ')})`);
  await page.close();
}

// Memory footprint after opening the 200-page document, as the renderer reports it.
{
  const page = await openAndWait('large.pdf');
  const mem = await page.evaluate(() => (performance.memory ? {
    usedMiB: Math.round(performance.memory.usedJSHeapSize / 1048576),
    totalMiB: Math.round(performance.memory.totalJSHeapSize / 1048576),
  } : null));
  results.operations['memory-200p'] = mem;
  console.log(`  heap 200p    ${mem ? `${mem.usedMiB} MiB used / ${mem.totalMiB} MiB reserved` : 'unavailable'}`);
  await page.close();
}

mkdirSync('paper/metrics', { recursive: true });
writeFileSync('paper/metrics/benchmark.json', `${JSON.stringify(results, null, 2)}\n`);
console.log('\n  paper/metrics/benchmark.json');

await browser.close();
