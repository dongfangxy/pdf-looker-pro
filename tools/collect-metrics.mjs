// Collects the per-suite assertion counts into paper/metrics/results.json.
//
// The paper reports these numbers, so they are measured on the machine rather than
// copied from memory: each suite is run and its own summary line is parsed. A suite that
// fails is recorded as such instead of being dropped.
//
//   node tools/collect-metrics.mjs
import { execFile } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { promisify } from 'node:util';

const run = promisify(execFile);

const SUITES = [
  'test-container',
  'test-font',
  'e2e',
  'e2e-i18n',
  'e2e-resources',
  'e2e-p5',
  'e2e-settings',
  'e2e-ux',
  'e2e-tabs',
  'e2e-styles',
  'e2e-viewmodes',
  'e2e-print-loupe',
  'e2e-pdfwrite',
  'e2e-pdfroundtrip',
  'e2e-rewrite',
  'e2e-pageops',
  'e2e-newdoc',
  'e2e-merge',
  'e2e-fields',
  'e2e-replace',
  'e2e-flatten',
  'e2e-author',
  'e2e-stamp',
  'e2e-replies',
  'e2e-summary',
  'e2e-search',
  'e2e-savedsearch',
  'e2e-save-reopen',
];

const DESKTOP = ['e2e-electron', 'e2e-desktop', 'e2e-save'];

mkdirSync('paper/metrics', { recursive: true });

const results = [];
for (const suite of [...SUITES, ...DESKTOP]) {
  const started = Date.now();
  let output = '';
  try {
    const { stdout, stderr } = await run(process.execPath, [`tools/${suite}.mjs`], {
      timeout: 600_000,
      maxBuffer: 32 * 1024 * 1024,
    });
    output = `${stdout}\n${stderr}`;
  } catch (error) {
    output = `${error.stdout ?? ''}\n${error.stderr ?? ''}`;
  }
  const match = /=== 结果: (\d+) 通过 \/ (\d+) 失败 ===/.exec(output);
  const entry = {
    suite,
    passed: match ? Number(match[1]) : 0,
    failed: match ? Number(match[2]) : null,
    seconds: Number(((Date.now() - started) / 1000).toFixed(1)),
    kind: DESKTOP.includes(suite) ? 'packaged' : 'browser',
  };
  results.push(entry);
  console.log(
    `  ${suite.padEnd(20)} ${String(entry.passed).padStart(3)} passed  ${entry.failed ?? '?'} failed  ${entry.seconds}s`,
  );
}

const browser = results.filter((r) => r.kind === 'browser');
const packaged = results.filter((r) => r.kind === 'packaged');
const summary = {
  measuredAt: new Date().toISOString(),
  node: process.version,
  suites: results.length,
  browserSuites: browser.length,
  browserAssertions: browser.reduce((sum, r) => sum + r.passed, 0),
  packagedSuites: packaged.length,
  packagedAssertions: packaged.reduce((sum, r) => sum + r.passed, 0),
  failures: results.reduce((sum, r) => sum + (r.failed ?? 0), 0),
  detail: results,
};

writeFileSync('paper/metrics/results.json', `${JSON.stringify(summary, null, 2)}\n`);
console.log(
  `\n  total: ${summary.suites} suites, ${summary.browserAssertions + summary.packagedAssertions} assertions, ${summary.failures} failures`,
);

// A note in the console if package.json's chain and this list disagree, so the paper's
// "all suites" claim cannot quietly become false.
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const inChain = new Set(
  [...(pkg.scripts.test ?? '').matchAll(/node tools\/([a-z0-9-]+)\.mjs/g)].map((m) => m[1]),
);
const missing = [...inChain].filter((s) => !SUITES.includes(s));
if (missing.length > 0) console.log(`  note: in npm test but not collected: ${missing.join(', ')}`);
