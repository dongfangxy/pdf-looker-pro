// 保存改为覆盖原文件、加软盘图标、撤销/重做、侧栏开关并入设置。
import { readFileSync, writeFileSync } from 'node:fs';

const J = (l) => l.join('\n');
function patch(file, edits) {
  let t = readFileSync(file, 'utf8');
  for (const [from, to] of edits) {
    if (!t.includes(from)) throw new Error(`${file}: anchor ${JSON.stringify(from.slice(0, 70))}`);
    t = t.replace(from, to);
  }
  writeFileSync(file, t);
  console.log('  ' + file);
}

// ------------------------------------------------------------ 1. 软盘图标
patch('tools/pack-resources.mjs', [
  [
    "  // Magnifier.",
    J([
      '  // A floppy disk: the shape everyone still reads as "save".',
      "  save: `",
      '    <path ${STROKE} d="M4 5.5A1.5 1.5 0 0 1 5.5 4h9.8L20 8.6v9.9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5z"/>',
      '    <path ${STROKE} d="M8 4v5.5h6.5V4"/>',
      '    <path ${STROKE} d="M7.5 13.5h9v6.5h-9z"/>`',
      '',
      '  // Magnifier.',
    ]),
  ],
]);

// ------------------------------------------------------------ 2. 命令 id
patch('src/i18n/commands.ts', [
  ['  SaveAnnotations: 1130,', J(['  SaveAnnotations: 1130,', '  Undo: 1150,', '  Redo: 1151,'])],
]);

// ------------------------------------------------------------ 3. 文案
const zhCmd = [
  "    [CMD.SaveIntoPdf]: { title: '保存', tooltip: '把批注保存进 PDF 文件（Ctrl+S）', status: '已保存', short: '保存' },",
  "    [CMD.Undo]: { title: '撤销', tooltip: '撤销上一步批注操作 (Ctrl+Z)', status: '已撤销', short: '撤销' },",
  "    [CMD.Redo]: { title: '重做', tooltip: '重做被撤销的操作 (Ctrl+Shift+Z)', status: '已重做', short: '重做' },",
].join('\n');
const enCmd = [
  "    [CMD.SaveIntoPdf]: { title: 'Save', tooltip: 'Save the annotations into the PDF (Ctrl+S)', status: 'Saved', short: 'Save' },",
  "    [CMD.Undo]: { title: 'Undo', tooltip: 'Undo the last annotation change (Ctrl+Z)', status: 'Undone', short: 'Undo' },",
  "    [CMD.Redo]: { title: 'Redo', tooltip: 'Redo the undone change (Ctrl+Shift+Z)', status: 'Redone', short: 'Redo' },",
].join('\n');
const zhStr = [
  "    savedTo: '已保存到',",
  "    saveReadOnly: '文件不可写入，另存为',",
  "    undoEmpty: '没有可撤销的操作',",
  "    redoEmpty: '没有可重做的操作',",
  "    showSidebar: '显示侧栏',",
  "    showSidebarHint: '打开时显示缩略图、大纲与批注面板',",
].join('\n');
const enStr = [
  "    savedTo: 'Saved to',",
  "    saveReadOnly: 'The file is not writable; save a copy instead',",
  "    undoEmpty: 'Nothing to undo',",
  "    redoEmpty: 'Nothing to redo',",
  "    showSidebar: 'Show the sidebar',",
  "    showSidebarHint: 'Show thumbnails, outline and annotations when a document opens',",
].join('\n');

for (const [file, cmd, str] of [
  ['src/i18n/packs/zh-CN.ts', zhCmd, zhStr],
  ['src/i18n/packs/en.ts', enCmd, enStr],
]) {
  patch(file, [
    ['    [CMD.SaveIntoPdf]:', cmd.replace(/^ {4}\[CMD\.SaveIntoPdf\][^\n]*\n/, '')],
    ["    langSwitchFail: '", `${str}\n\n    langSwitchFail: '`],
  ]);
}

// ------------------------------------------------------------ 4. HTML
patch('index.html', [
  [
    '          <button id="btn-save-pdf" class="btn hidden" title="把批注写入 PDF 文件本身">写入</button>',
    '          <button id="btn-save-pdf" class="btn" title="保存批注到 PDF（Ctrl+S）">保存</button>',
  ],
  [
    '          <button id="btn-sidebar" class="btn" title="显示/隐藏侧栏">☰</button>\n',
    '',
  ],
]);

// ------------------------------------------------------------ 5. main.ts
patch('src/main.ts', [
  [
    "import { readAnnotations } from './pdf/import.js';",
    J([
      "import { readAnnotations } from './pdf/import.js';",
      "import { History } from './annotations/history.js';",
    ]),
  ],
  // 设置项
  [
    '  showStatusBar: boolean;',
    J(['  showStatusBar: boolean;', '  showSidebar: boolean;']),
  ],
  [
    "  showStatusBar: true,",
    J(["  showStatusBar: true,", "  showSidebar: true,"]),
  ],
  [
    '  ui.statusBar.classList.toggle(\'hidden\', !appSettings.showStatusBar);',
    J([
      "  ui.statusBar.classList.toggle('hidden', !appSettings.showStatusBar);",
      "  ui.sidebar.classList.toggle('hidden', !appSettings.showSidebar);",
    ]),
  ],
  [
    "      key: 'showStatusBar',",
    J([
      "      {",
      "        key: 'showSidebar',",
      "        kind: 'toggle',",
      "        label: i18n.t('showSidebar'),",
      "        hint: i18n.t('showSidebarHint'),",
      "        value: appSettings.showSidebar,",
      '      },',
      "      key: 'showStatusBar',",
    ]),
  ],
  [
    "  appSettings.showStatusBar = result['showStatusBar'] === true;",
    J([
      "  appSettings.showStatusBar = result['showStatusBar'] === true;",
      "  appSettings.showSidebar = result['showSidebar'] === true;",
    ]),
  ],
  [
    '  await persistSettings({ theme, pageGap: gap, showStatusBar: appSettings.showStatusBar, defaultViewMode: view, defaultZoomMode: zoom });',
    '  await persistSettings({ theme, pageGap: gap, showStatusBar: appSettings.showStatusBar, showSidebar: appSettings.showSidebar, defaultViewMode: view, defaultZoomMode: zoom });',
  ],
  // 侧栏按钮从工具栏移除，快捷键保留
  [
    "bindCommand(CMD.Sidebar, ui.btnSidebar, { onClick: () => ui.sidebar.classList.toggle('hidden') });",
    J([
      '// The toolbar toggle is gone: sidebar visibility lives in Settings. The shortcut',
      '// and the View menu entry stay, because a reader who knows Ctrl+B still wants it.',
      'registerCommand(CMD.Sidebar, () => {',
      '  appSettings.showSidebar = ui.sidebar.classList.contains(\'hidden\');',
      '  applyReadingSettings();',
      '  void persistSettings({ showSidebar: appSettings.showSidebar });',
      '});',
    ]),
  ],
  ['  btnSidebar: mustFind<HTMLButtonElement>(\'btn-sidebar\'),\n', ''],
  ['    \'btn-sidebar\': ui.btnSidebar,\n', ''],
]);

console.log('第一批改动已应用');
