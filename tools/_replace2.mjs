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

// ------------------------------------------------------------ command id
{
  const file = 'src/i18n/commands.ts';
  const text = readFileSync(file, 'utf8');
  const used = new Set();
  for (const m of text.matchAll(/^\s*[A-Za-z][A-Za-z0-9]*:\s*(\d+),/gm)) used.add(Number(m[1]));
  let candidate = 1294;
  while (used.has(candidate)) candidate++;
  const out = text.replace('  MergeDocument:', `  AnnotReplace: ${candidate},\n  MergeDocument:`);
  if (out === text) throw new Error('commands anchor');
  writeFileSync(file, out);
  console.log(`  AnnotReplace: ${candidate}`);
}

// ------------------------------------------------------------ strings
patch('src/i18n/packs/zh-CN.ts', [
  [
    '    [CMD.AnnotStrikeout]:',
    J([
      "    [CMD.AnnotReplace]: { title: '替换文本', tooltip: '划掉选中文字并写下替代内容', status: '替换文本工具：选中要替换的文字', short: '替换' },",
      '    [CMD.AnnotStrikeout]:',
    ]),
  ],
  [
    '    annotReply:',
    J([
      "    replacePrompt: '把这段文字替换为',",
      "    replaceHint: '划掉的就是被替换的内容，替代文字会作为批注附在它上面',",
      '    annotReply:',
    ]),
  ],
]);
patch('src/i18n/packs/en.ts', [
  [
    '    [CMD.AnnotStrikeout]:',
    J([
      "    [CMD.AnnotReplace]: { title: 'Replace text', tooltip: 'Strike out the selection and write what should stand in its place', status: 'Replace text: select the text to replace', short: 'Replace' },",
      '    [CMD.AnnotStrikeout]:',
    ]),
  ],
  [
    '    annotReply:',
    J([
      "    replacePrompt: 'Replace that text with',",
      "    replaceHint: 'The struck text is what goes; the substitute is attached to it as a comment',",
      '    annotReply:',
    ]),
  ],
]);

// ------------------------------------------------------------ markup
patch('index.html', [
  [
    '          <button id="annot-strikeout" class="btn hidden" title="删除线">删除线</button>',
    J([
      '          <button id="annot-strikeout" class="btn hidden" title="删除线">删除线</button>',
      '          <button id="annot-replace" class="btn hidden" title="替换文本">替换</button>',
    ]),
  ],
]);

// ------------------------------------------------------------ main
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

  insertAfter("  strikeout: mustFind<HTMLButtonElement>('annot-strikeout'),", [
    "  replace: mustFind<HTMLButtonElement>('annot-replace'),",
  ], 'replace button ref');

  insertAfter("    case 'strikeout':\n      return CMD.AnnotStrikeout;".split('\n')[0], [
    "    case 'replace':",
    '      return CMD.AnnotReplace;',
  ], 'kind mapping');

  insertBefore("bindCommand(CMD.AnnotStrikeout, ui.strikeout, {", [
    'bindCommand(CMD.AnnotReplace, ui.replace, {',
    "  onClick: () => tools.select('replace' as never),",
    "  status: 'replaceHint',",
    '});',
    '',
  ], 'replace binding');

  insertBefore("  currentStamp: () => currentStamp,", [
    '  // A replacement is not finished until it has a substitute; asking here keeps the',
    '  // gesture and the text in one flow instead of leaving a mark that says nothing.',
    '  onReplaceCreated: (item) => {',
    '    void (async () => {',
    '      const text = await showInputDialog(i18n, {',
    "        title: i18n.resolveCommand(CMD.AnnotReplace)?.title ?? '替换文本',",
    "        label: i18n.t('replacePrompt'),",
    "        initial: '',",
    "        confirm: i18n.t('pageOpsConfirm'),",
    "        cancel: i18n.t('printCancel'),",
    '      });',
    "      if (text === null || text.trim() === '') return;",
    '      annotations.update(item.id, { note: text.trim() });',
    '      history.record(snapshotAnnotations());',
    '    })();',
    '  },',
  ], 'replace prompt hook');

  insertBefore('          command(CMD.AnnotStrikeout),', [
    '          command(CMD.AnnotReplace),',
  ], 'annotate menu');

  writeFileSync(file, lines.join('\n'));
  console.log('  src/main.ts');
}

console.log('替换文本接线完成');
