import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';

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

// ------------------------------------------------------- 1. choice dialog
{
  const file = 'src/ui/dialog.ts';
  const text = readFileSync(file, 'utf8');
  if (!text.includes('export function showChoiceDialog')) {
    appendFileSync(
      file,
      J([
        '',
        '/**',
        ' * Picks one value from a short list.',
        ' *',
        ' * The settings dialogue already renders selects, but it is a form that applies on',
        ' * confirm; this is a question with a list of answers, and reads differently.',
        ' */',
        'export function showChoiceDialog(',
        '  i18n: I18n,',
        '  options: {',
        '    title: string;',
        '    label: string;',
        '    value: string;',
        '    choices: Array<{ value: string; label: string }>;',
        '    confirm: string;',
        '    cancel: string;',
        '  },',
        '): Promise<string | null> {',
        '  return new Promise((resolve) => {',
        "    const overlay = document.createElement('div');",
        "    overlay.className = 'modal-overlay';",
        '',
        "    const box = document.createElement('div');",
        "    box.className = 'modal modal-narrow modal-choice';",
        "    box.setAttribute('role', 'dialog');",
        "    box.setAttribute('aria-modal', 'true');",
        '',
        "    const title = document.createElement('div');",
        "    title.className = 'modal-title';",
        '    title.textContent = options.title;',
        '',
        "    const body = document.createElement('div');",
        "    body.className = 'modal-body';",
        "    const label = document.createElement('label');",
        "    label.className = 'print-label';",
        '    label.textContent = options.label;',
        "    const select = document.createElement('select');",
        "    select.className = 'modal-input print-select modal-choice-select';",
        '    for (const choice of options.choices) {',
        "      const node = document.createElement('option');",
        '      node.value = choice.value;',
        '      node.textContent = choice.label;',
        '      select.appendChild(node);',
        '    }',
        '    select.value = options.value;',
        '    body.append(label, select);',
        '',
        "    const footer = document.createElement('div');",
        "    footer.className = 'modal-footer';",
        "    const cancel = document.createElement('button');",
        "    cancel.type = 'button';",
        "    cancel.className = 'btn modal-cancel';",
        '    cancel.textContent = options.cancel;',
        "    const confirm = document.createElement('button');",
        "    confirm.type = 'button';",
        "    confirm.className = 'btn primary modal-confirm';",
        '    confirm.textContent = options.confirm;',
        '    footer.append(cancel, confirm);',
        '',
        '    box.append(title, body, footer);',
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
        '        finish(select.value);',
        '      }',
        '    };',
        '',
        "    confirm.addEventListener('click', () => finish(select.value));",
        "    cancel.addEventListener('click', () => finish(null));",
        "    overlay.addEventListener('click', (event) => {",
        '      if (event.target === overlay) finish(null);',
        '    });',
        "    document.addEventListener('keydown', onKey, true);",
        '',
        '    document.body.appendChild(overlay);',
        '    void i18n;',
        '    select.focus();',
        '  });',
        '}',
        '',
      ]),
    );
    console.log('  ' + file + ' (showChoiceDialog)');
  }
}

// ------------------------------------------------------- 2. command ids
{
  const file = 'src/i18n/commands.ts';
  const text = readFileSync(file, 'utf8');
  const used = new Set();
  for (const m of text.matchAll(/^\s*[A-Za-z][A-Za-z0-9]*:\s*(\d+),/gm)) used.add(Number(m[1]));
  let candidate = 1270;
  const assigned = [];
  for (const name of ['AnnotStamp', 'StampPick']) {
    while (used.has(candidate)) candidate++;
    used.add(candidate);
    assigned.push(`${name}: ${candidate},`);
  }
  const out = text.replace('  FlattenAnnotations:', `${assigned.join('\n  ')}\n  FlattenAnnotations:`);
  if (out === text) throw new Error('commands.ts anchor');
  writeFileSync(file, out);
  console.log('  ' + assigned.join(' '));
}

// ------------------------------------------------------- 3. command strings
patch('src/i18n/packs/zh-CN.ts', [
  [
    '    [CMD.Undo]:',
    J([
      "    [CMD.AnnotStamp]: { title: '图章', tooltip: '在页面上点一下放置图章', status: '放置图章', short: '图章' },",
      "    [CMD.StampPick]: { title: '选择图章样式...', tooltip: '换用另一种标准图章', status: '选择图章', short: '图章样式' },",
      '    [CMD.Undo]:',
    ]),
  ],
]);
patch('src/i18n/packs/en.ts', [
  [
    '    [CMD.Undo]:',
    J([
      "    [CMD.AnnotStamp]: { title: 'Stamp', tooltip: 'Click on the page to place a stamp', status: 'Place a stamp', short: 'Stamp' },",
      "    [CMD.StampPick]: { title: 'Choose stamp...', tooltip: 'Switch to another standard stamp', status: 'Choose stamp', short: 'Stamp style' },",
      '    [CMD.Undo]:',
    ]),
  ],
]);

// ------------------------------------------------------- 4. main.ts
{
  const file = 'src/main.ts';
  let lines = readFileSync(file, 'utf8').split('\n');
  const find = (s, from = 0) => lines.findIndex((l, i) => i >= from && l.includes(s));
  const insertBefore = (match, newLines, label) => {
    const i = find(match);
    if (i < 0) throw new Error(`未找到: ${label ?? match}`);
    lines.splice(i, 0, ...newLines);
    console.log(`  + ${newLines.length} @ ${label ?? match}`);
  };
  const insertAfter = (match, newLines, label) => {
    const i = find(match);
    if (i < 0) throw new Error(`未找到: ${label ?? match}`);
    lines.splice(i + 1, 0, ...newLines);
    console.log(`  + ${newLines.length} @ ${label ?? match}`);
  };

  insertBefore("import { showConfirmDialog,", [
    "import { showChoiceDialog, showConfirmDialog, showInputDialog, showPackDialog, showPromptDialog } from './ui/dialog.js';",
  ], 'choice dialog import');
  // remove the now-duplicated original import line
  {
    const dup = lines.findIndex((l) => l === "import { showConfirmDialog, showInputDialog, showPackDialog, showPromptDialog } from './ui/dialog.js';");
    if (dup >= 0) lines.splice(dup, 1);
  }

  insertBefore("import { AnnotationStore, DEFAULT_COLORS, PALETTE, parseAnnotations, type AnnotKind } from './annotations/model.js';", [
    "import {",
    '  DEFAULT_STAMP,',
    '  STAMP_COLORS,',
    '  STAMP_IDS,',
    '  STAMP_LABEL_KEYS,',
    '  STAMP_PDF_NAMES,',
    '  isStampId,',
    '  type StampId,',
    "} from './annotations/model.js';",
  ], 'stamp model imports');

  insertAfter("  flatten: mustFind<HTMLButtonElement>('btn-flatten'),", [
    "  annotStamp: mustFind<HTMLButtonElement>('annot-stamp'),",
  ], 'stamp ui ref');

  // state + picker, placed next to the flatten handler
  insertBefore('registerCommand(CMD.SaveIntoPdf', [
    '/** Which standard stamp the tool places. */',
    "let currentStamp: StampId = DEFAULT_STAMP;",
    '',
    '/** Asks which stamp to place, and remembers the answer. */',
    'async function pickStamp(): Promise<void> {',
    '  const chosen = await showChoiceDialog(i18n, {',
    "    title: i18n.t('stampPickTitle'),",
    "    label: i18n.t('stampNow'),",
    '    value: currentStamp,',
    '    choices: STAMP_IDS.map((id) => ({ value: id, label: i18n.t(STAMP_LABEL_KEYS[id]) })),',
    "    confirm: i18n.t('pageOpsConfirm'),",
    "    cancel: i18n.t('printCancel'),",
    '  });',
    '  if (chosen === null || !isStampId(chosen)) return;',
    '  currentStamp = chosen;',
    "  setStatus(`${i18n.t('stampNow')}：${i18n.t(STAMP_LABEL_KEYS[currentStamp])}`);",
    '}',
    '',
    'registerCommand(CMD.SaveIntoPdf',
  ], 'stamp state and picker');
  // drop the duplicated anchor line the template re-added
  {
    const dup = find('registerCommand(CMD.SaveIntoPdf', find("let currentStamp: StampId = DEFAULT_STAMP;"));
    if (dup >= 0) lines.splice(dup, 1);
  }

  insertBefore("bindCommand(CMD.AnnotNote, ui.annotNote, { onClick: () => tools.setTool('note') });", [
    "bindCommand(CMD.AnnotStamp, ui.annotStamp, { onClick: () => tools.setTool('stamp') });",
    "registerCommand(CMD.StampPick, () => void pickStamp());",
  ], 'stamp bindings');

  insertBefore('          command(CMD.AnnotNote),', [
    '          command(CMD.AnnotStamp),',
    '          command(CMD.StampPick),',
  ], 'menu stamps');

  // layer options
  insertBefore('    onStatus: (text, isError) => setStatus(text, isError ?? false),', [
    '    currentStamp: () => currentStamp,',
    '    stampLabel: (stamp) => i18n.t(STAMP_LABEL_KEYS[stamp]),',
  ], 'layer stamp options');

  // PDF write: /Name and the word
  insertBefore('        author: item.author,', [
    '        stampName: item.stampId ? STAMP_PDF_NAMES[item.stampId] : undefined,',
  ], 'pdf write stamp name');

  // flatten: the word
  insertBefore('        strokeDash: item.strokeDash,', [
    '        stampLabel: item.note,',
  ], 'flatten stamp label');

  writeFileSync(file, lines.join('\n'));
  console.log('  src/main.ts');
}

console.log('戳记主程序接线完成');
