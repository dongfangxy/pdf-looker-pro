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

// ---------------------------------------------- 1. one source of truth for zoom modes
patch('src/viewer/progress.ts', [
  [
    "export type ZoomModeName = 'custom' | 'fit-width' | 'fit-page';",
    J([
      'import type { ZoomMode } from \'./viewer.js\';',
      '',
      '/**',
      ' * Persisted zoom mode.',
      ' *',
      ' * Aliased rather than repeated: a second copy of this union drifted out of step the',
      ' * moment a fit mode was added, and the compiler is the right place to notice that.',
      ' */',
      'export type ZoomModeName = ZoomMode;',
    ]),
  ],
]);

// ---------------------------------------------- 2. single-line input dialog
patch('src/ui/dialog.ts', [
  [
    '/**\n * A single-field prompt.',
    J([
      '/**',
      ' * A one-line text or number prompt.',
      ' *',
      ' * `showPromptDialog` is a multi-line editor, which is wrong for a page number or a',
      ' * zoom percentage: Enter should submit, not insert a newline.',
      ' */',
      'export interface InputDialogOptions {',
      '  title: string;',
      '  label: string;',
      '  initial?: string;',
      '  confirm?: string;',
      '  cancel?: string;',
      '  /** Restricts the field to digits and a decimal point, and focuses it for typing. */',
      '  numeric?: boolean;',
      '  suffix?: string;',
      '}',
      '',
      'export function showInputDialog(i18n: I18n, options: InputDialogOptions): Promise<string | null> {',
      '  return new Promise((resolve) => {',
      "    const overlay = document.createElement('div');",
      "    overlay.className = 'modal-overlay';",
      '',
      "    const box = document.createElement('div');",
      "    box.className = 'modal modal-narrow';",
      "    box.setAttribute('role', 'dialog');",
      "    box.setAttribute('aria-modal', 'true');",
      '',
      "    const title = document.createElement('div');",
      "    title.className = 'modal-title';",
      '    title.textContent = options.title;',
      '    box.appendChild(title);',
      '',
      "    const body = document.createElement('div');",
      "    body.className = 'modal-body';",
      "    const label = document.createElement('div');",
      "    label.className = 'modal-line';",
      '    label.textContent = options.label;',
      '    body.appendChild(label);',
      '',
      "    const row = document.createElement('div');",
      "    row.className = 'modal-row';",
      "    const input = document.createElement('input');",
      "    input.type = 'text';",
      "    input.className = 'modal-input';",
      "    input.value = options.initial ?? '';",
      "    if (options.numeric) input.inputMode = 'decimal';",
      '    row.appendChild(input);',
      '    if (options.suffix) {',
      "      const suffix = document.createElement('span');",
      "      suffix.className = 'modal-suffix';",
      '      suffix.textContent = options.suffix;',
      '      row.appendChild(suffix);',
      '    }',
      '    body.appendChild(row);',
      '    box.appendChild(body);',
      '',
      "    const footer = document.createElement('div');",
      "    footer.className = 'modal-footer';",
      "    const cancel = document.createElement('button');",
      "    cancel.type = 'button';",
      "    cancel.className = 'btn modal-cancel';",
      "    cancel.textContent = options.cancel ?? i18n.t('unsavedStay');",
      "    const confirm = document.createElement('button');",
      "    confirm.type = 'button';",
      "    confirm.className = 'btn primary modal-confirm';",
      "    confirm.textContent = options.confirm ?? '确定';",
      '    footer.append(cancel, confirm);',
      '    box.appendChild(footer);',
      '    overlay.appendChild(box);',
      '',
      '    let settled = false;',
      '    const finish = (value: string | null): void => {',
      '      if (settled) return;',
      '      settled = true;',
      "      document.removeEventListener('keydown', onKey, true);",
      '      overlay.remove();',
      '      resolve(value);',
      '    };',
      '    const onKey = (event: KeyboardEvent): void => {',
      "      if (event.key === 'Escape') {",
      '        event.preventDefault();',
      '        finish(null);',
      "      } else if (event.key === 'Enter') {",
      '        event.preventDefault();',
      '        finish(input.value);',
      '      }',
      '    };',
      '',
      '    confirm.addEventListener(\'click\', () => finish(input.value));',
      '    cancel.addEventListener(\'click\', () => finish(null));',
      "    overlay.addEventListener('click', (event) => {",
      '      if (event.target === overlay) finish(null);',
      '    });',
      "    document.addEventListener('keydown', onKey, true);",
      '',
      '    document.body.appendChild(overlay);',
      '    input.focus();',
      '    input.select();',
      '  });',
      '}',
      '',
      '/**',
      ' * A single-field prompt.',
    ]),
  ],
]);

// ---------------------------------------------- 3. command ids (find free ones)
{
  const file = 'src/i18n/commands.ts';
  const text = readFileSync(file, 'utf8');
  const used = new Set();
  for (const m of text.matchAll(/^\s*[A-Za-z][A-Za-z0-9]*:\s*(\d+),/gm)) used.add(Number(m[1]));
  const wanted = [
    'ZoomActual',
    'FitVisible',
    'ZoomTo',
    'ViewSpreadContinuous',
    'PrevView',
    'NextView',
    'GoToPage',
  ];
  let candidate = 1200;
  const assigned = [];
  for (const name of wanted) {
    while (used.has(candidate)) candidate++;
    used.add(candidate);
    assigned.push(`${name}: ${candidate},`);
  }
  let out = text.replace('  SaveIntoPdf:', `${assigned.join('\n  ')}\n  SaveIntoPdf:`);
  if (out === text) throw new Error('commands.ts anchor missing');
  writeFileSync(file, out);
  console.log('  命令 id: ' + assigned.join(' '));
}

// ---------------------------------------------- 4. strings
const zhCmd = [
  "    [CMD.ZoomActual]: { title: '实际大小', tooltip: '按 100% 显示 (Ctrl+0)', status: '实际大小', short: '实际' },",
  "    [CMD.FitVisible]: { title: '符合可见区域', tooltip: '把页面内容（不含白边）充满窗口', status: '符合可见区域', short: '可见' },",
  "    [CMD.ZoomTo]: { title: '缩放至...', tooltip: '输入缩放百分比', status: '缩放至', short: '缩放' },",
  "    [CMD.ViewSpreadContinuous]: { title: '连续 - 对开', tooltip: '所有页面按对开连续滚动', status: '连续 - 对开', short: '连续对开' },",
  "    [CMD.PrevView]: { title: '上一视图', tooltip: '回到上一个视图', status: '上一视图', short: '上一视图' },",
  "    [CMD.NextView]: { title: '下一视图', tooltip: '前进到下一个视图', status: '下一视图', short: '下一视图' },",
  "    [CMD.GoToPage]: { title: '转到页面', tooltip: '输入页码并跳转', status: '转到页面', short: '转到' },",
].join('\n');
const enCmd = [
  "    [CMD.ZoomActual]: { title: 'Actual size', tooltip: 'Show at 100% (Ctrl+0)', status: 'Actual size', short: 'Actual' },",
  "    [CMD.FitVisible]: { title: 'Fit visible', tooltip: 'Fill the window with the page content, without its margins', status: 'Fit visible', short: 'Visible' },",
  "    [CMD.ZoomTo]: { title: 'Zoom to...', tooltip: 'Enter a zoom percentage', status: 'Zoom to', short: 'Zoom' },",
  "    [CMD.ViewSpreadContinuous]: { title: 'Continuous - Facing', tooltip: 'Every page in facing pairs, scrolling continuously', status: 'Continuous facing', short: 'Cont. facing' },",
  "    [CMD.PrevView]: { title: 'Previous view', tooltip: 'Return to the previous view', status: 'Previous view', short: 'Back' },",
  "    [CMD.NextView]: { title: 'Next view', tooltip: 'Go forward to the next view', status: 'Next view', short: 'Forward' },",
  "    [CMD.GoToPage]: { title: 'Go to page', tooltip: 'Jump to a page number', status: 'Go to page', short: 'Go to' },",
].join('\n');
const zhStr = [
  "    zoomPercent: '缩放比例',",
  "    pageNumber: '页码',",
  "    zoomInvalid: '请输入有效的缩放比例',",
  "    pageInvalid: '页码超出文档范围',",
  "    noPrevView: '没有更早的视图',",
  "    noNextView: '没有更晚的视图',",
].join('\n');
const enStr = [
  "    zoomPercent: 'Zoom level',",
  "    pageNumber: 'Page number',",
  "    zoomInvalid: 'Enter a valid zoom percentage',",
  "    pageInvalid: 'That page number is outside the document',",
  "    noPrevView: 'No earlier view',",
  "    noNextView: 'No later view',",
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

// ---------------------------------------------- 5. toolbar markup
patch('index.html', [
  [
    '        <button id="btn-fit-page" class="btn" title="适应页面">页面</button>',
    J([
      '        <button id="btn-fit-page" class="btn" title="适应页面">页面</button>',
      '        <button id="btn-fit-visible" class="btn" title="符合可见区域：页面内容充满窗口">可见</button>',
      '        <button id="btn-zoom-actual" class="btn" title="实际大小 100%">实际</button>',
    ]),
  ],
  [
    '        <button id="view-fullscreen" class="btn hidden" title="全屏">全屏</button>',
    J([
      '        <button id="view-spread-cont" class="btn hidden" title="连续 - 对开">连续对开</button>',
      '        <button id="view-fullscreen" class="btn hidden" title="全屏">全屏</button>',
    ]),
  ],
]);

// ---------------------------------------------- 6. layout CSS for four view modes
patch('src/styles/main.css', [
  [
    J([
      '.pages.mode-single,',
      '.pages.mode-spread { align-items: center; }',
      '',
      '/* Single-page mode shows only the current page; facing mode pairs pages in a row. */',
      '.pages.mode-single .page { display: none; }',
      '.pages.mode-single .page.current { display: block; }',
      '.pages.mode-spread {',
      '  flex-direction: row;',
      '  flex-wrap: wrap;',
      '  justify-content: center;',
      '  align-content: flex-start;',
      '  gap: 10px;',
      '}',
      '.pages.mode-spread .page { margin: 0; }',
    ]),
    J([
      '.pages.mode-single,',
      '.pages.mode-spread { align-items: center; }',
      '',
      '/* Single-page mode shows only the current page. */',
      '.pages.mode-single .page { display: none; }',
      '.pages.mode-single .page.current { display: block; }',
      '',
      '/* Facing mode shows exactly the current pair and nothing else. The pair starts on',
      '   an odd page, so two pages are always side by side rather than one and a gap. */',
      '.pages.mode-spread {',
      '  flex-direction: row;',
      '  flex-wrap: nowrap;',
      '  justify-content: center;',
      '  align-content: center;',
      '  gap: 10px;',
      '}',
      '.pages.mode-spread .page { display: none; margin: 0; }',
      '.pages.mode-spread .page.in-pair { display: block; }',
      '',
      '/* Continuous facing: every pair, wrapping two per row and scrolling. */',
      '.pages.mode-spread-continuous {',
      '  flex-direction: row;',
      '  flex-wrap: wrap;',
      '  justify-content: center;',
      '  align-content: flex-start;',
      '  gap: 10px;',
      '}',
      '.pages.mode-spread-continuous .page { margin: 0; }',
    ]),
  ],
]);

console.log('A 档第一批（除 main.ts 接线）已应用');
