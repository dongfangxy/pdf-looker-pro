import { readFileSync, writeFileSync } from 'node:fs';

const J = (l) => l.join('\n');
function patch(file, edits) {
  let t = readFileSync(file, 'utf8');
  for (const [from, to] of edits) {
    if (!t.includes(from)) throw new Error(`${file}: anchor ${JSON.stringify(from.slice(0, 80))}`);
    t = t.replace(from, to);
  }
  writeFileSync(file, t);
  console.log('  ' + file);
}

// ---------------------------------------------------------------- 1. command ids
{
  const file = 'src/i18n/commands.ts';
  const text = readFileSync(file, 'utf8');
  const used = new Set();
  for (const m of text.matchAll(/^\s*[A-Za-z][A-Za-z0-9]*:\s*(\d+),/gm)) used.add(Number(m[1]));
  let candidate = 1220;
  const assigned = [];
  for (const name of ['Loupe', 'Print']) {
    while (used.has(candidate)) candidate++;
    used.add(candidate);
    assigned.push(`${name}: ${candidate},`);
  }
  const out = text.replace('  SaveIntoPdf:', `${assigned.join('\n  ')}\n  SaveIntoPdf:`);
  if (out === text) throw new Error('commands.ts anchor missing');
  writeFileSync(file, out);
  console.log('  命令 id: ' + assigned.join(' '));
}

// ---------------------------------------------------------------- 2. strings
const zhCmd = [
  "    [CMD.Loupe]: { title: '放大镜', tooltip: '放大镜工具：跟随指针放大页面局部', status: '放大镜', short: '放大镜' },",
  "    [CMD.Print]: { title: '打印...', tooltip: '打印页面 (Ctrl+P)', status: '打印', short: '打印' },",
].join('\n');
const enCmd = [
  "    [CMD.Loupe]: { title: 'Magnifier', tooltip: 'Magnifier: enlarge the page under the pointer', status: 'Magnifier', short: 'Magnifier' },",
  "    [CMD.Print]: { title: 'Print...', tooltip: 'Print pages (Ctrl+P)', status: 'Print', short: 'Print' },",
].join('\n');
const zhStr = [
  "    printTitle: '打印',",
  "    printRange: '页面范围',",
  "    printRangeAll: '全部',",
  "    printRangeCurrent: '当前页',",
  "    printRangeCustom: '自定义',",
  "    printRangeHint: '例如 1-5, 8, 11-',",
  "    printScale: '缩放',",
  "    printScaleFit: '适合页面',",
  "    printScaleActual: '实际大小',",
  "    printScalePercent: '百分比',",
  "    printOrientation: '方向',",
  "    printOrientationAuto: '自动',",
  "    printOrientationPortrait: '纵向',",
  "    printOrientationLandscape: '横向',",
  "    printPageCount: '文档共 {n} 页',",
  "    printConfirm: '打印',",
  "    printCancel: '取消',",
  "    printPreparing: '正在准备打印…',",
  "    printNoPages: '没有可打印的页面',",
  "    printFailed: '打印失败',",
  "    printRendering: '正在排版第 {a}/{b} 页…',",
  "    printRenderFailed: '第 {a} 页无法渲染：{b}',",
  "    loupeOn: '放大镜已开启',",
  "    loupeOff: '放大镜已关闭',",
].join('\n');
const enStr = [
  "    printTitle: 'Print',",
  "    printRange: 'Page range',",
  "    printRangeAll: 'All',",
  "    printRangeCurrent: 'Current page',",
  "    printRangeCustom: 'Custom',",
  "    printRangeHint: 'e.g. 1-5, 8, 11-',",
  "    printScale: 'Scale',",
  "    printScaleFit: 'Fit to page',",
  "    printScaleActual: 'Actual size',",
  "    printScalePercent: 'Percentage',",
  "    printOrientation: 'Orientation',",
  "    printOrientationAuto: 'Automatic',",
  "    printOrientationPortrait: 'Portrait',",
  "    printOrientationLandscape: 'Landscape',",
  "    printPageCount: 'The document has {n} pages',",
  "    printConfirm: 'Print',",
  "    printCancel: 'Cancel',",
  "    printPreparing: 'Preparing to print…',",
  "    printNoPages: 'There are no pages to print',",
  "    printFailed: 'Printing failed',",
  "    printRendering: 'Laying out page {a} of {b}…',",
  "    printRenderFailed: 'Page {a} could not be rendered: {b}',",
  "    loupeOn: 'Magnifier on',",
  "    loupeOff: 'Magnifier off',",
].join('\n');

for (const [file, cmd, str] of [
  ['src/i18n/packs/zh-CN.ts', zhCmd, zhStr],
  ['src/i18n/packs/en.ts', enCmd, enStr],
]) {
  patch(file, [
    ['    [CMD.Undo]:', `${cmd}\n    [CMD.Undo]:`],
    ["    langSwitchFail: '", `${str}\n\n    langSwitchFail: '`],
  ]);
}

// ---------------------------------------------------------------- 3. markup
patch('index.html', [
  [
    '        <button id="btn-save-pdf" class="btn" title="保存批注到 PDF（Ctrl+S）">保存</button>',
    J([
      '        <button id="btn-save-pdf" class="btn" title="保存批注到 PDF（Ctrl+S）">保存</button>',
      '        <button id="btn-print" class="btn" title="打印 (Ctrl+P)">打印</button>',
    ]),
  ],
  [
    '        <button id="tool-snapshot"',
    J([
      '        <button id="tool-loupe" class="btn" title="放大镜">放大镜</button>',
      '        <button id="tool-snapshot"',
    ]),
  ],
]);

// ---------------------------------------------------------------- 4. CSS
{
  const file = 'src/styles/main.css';
  const text = readFileSync(file, 'utf8');
  const addition = J([
    '',
    '/* ---------- magnifier ---------- */',
    '/* The lens is positioned against the viewport, so it must not be clipped by an',
    '   ancestor with its own stacking or overflow. */',
    '.loupe {',
    '  position: fixed;',
    '  z-index: 60;',
    '  width: 180px;',
    '  height: 180px;',
    '  border-radius: 50%;',
    '  overflow: hidden;',
    '  pointer-events: none;',
    '  border: 2px solid var(--border-strong, var(--border));',
    '  box-shadow: 0 6px 22px var(--shadow);',
    '  background: #fff;',
    '}',
    '.loupe-canvas { display: block; }',
    '.loupe-badge {',
    '  position: absolute;',
    '  right: 8px;',
    '  bottom: 6px;',
    '  padding: 1px 6px;',
    '  border-radius: 9px;',
    '  background: rgba(0, 0, 0, 0.62);',
    '  color: #fff;',
    '  font-size: 11px;',
    '  letter-spacing: 0.02em;',
    '}',
    '/* A crosshair marks the exact point the lens is centred on. */',
    '.loupe::after {',
    '  content: "";',
    '  position: absolute;',
    '  left: 50%;',
    '  top: 50%;',
    '  width: 9px;',
    '  height: 9px;',
    '  margin: -5px 0 0 -5px;',
    '  border: 1px solid rgba(224, 52, 47, 0.9);',
    '  border-radius: 50%;',
    '  pointer-events: none;',
    '}',
    '.loupe-on .page { cursor: zoom-in; }',
    '',
    '/* ---------- print settings ---------- */',
    '.modal-print { width: min(460px, 92vw); }',
    '.print-row { display: flex; align-items: flex-start; gap: 10px; margin-bottom: 10px; }',
    '.print-label { flex: 0 0 68px; padding-top: 5px; color: var(--fg-muted); font-size: 12px; }',
    '.print-controls { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; flex: 1; }',
    '.print-radio { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; cursor: pointer; }',
    '.print-select { width: auto; min-width: 110px; }',
    '.print-range-input { width: 130px; }',
    '.print-percent-input { width: 62px; }',
    '.print-summary { margin-top: 6px; font-size: 12px; color: var(--fg-muted); }',
    '',
    '/* ---------- printing ---------- */',
    '/* Only the generated sheets reach paper: the whole application shell is hidden. */',
    '#print-root { display: none; }',
    '@media print {',
    '  body > *:not(#print-root) { display: none !important; }',
    '  #print-root { display: block !important; }',
    '  #print-root .print-page {',
    '    break-after: page;',
    '    page-break-after: always;',
    '    margin: 0;',
    '    padding: 0;',
    '    text-align: center;',
    '  }',
    '  #print-root .print-page:last-child {',
    '    break-after: auto;',
    '    page-break-after: auto;',
    '  }',
    '  #print-root img { display: block; margin: 0 auto; max-width: 100%; height: auto; }',
    '  html, body { background: #fff !important; }',
    '}',
    '',
  ].join('\n'));
  writeFileSync(file, text + addition);
  console.log('  src/styles/main.css');
}

// ---------------------------------------------------------------- 5. desktop bridge
patch('src/platform/desktop.ts', [
  [
    '  confirmClose(): void;',
    J([
      '  confirmClose(): void;',
      '  /** Opens the platform print dialogue for the current window. */',
      '  print(options?: { printBackground?: boolean }): Promise<{ ok: boolean; reason?: string }>;',
    ]),
  ],
]);

console.log('放大镜与打印的基础接线完成');
