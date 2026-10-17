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

// -------------------------------------------------- 1. optional stampId
patch('src/annotations/model.ts', [
  ['  stampId?: StampId;', '  stampId?: StampId | undefined;'],
  [
    "  'measure-area': ",
    J([
      "  stamp: 'annotStamp',",
      "  'measure-area': ",
    ]),
  ],
]);

// -------------------------------------------------- 2. layer: options + addStamp
{
  const file = 'src/annotations/layer.ts';
  let t = readFileSync(file, 'utf8');

  const anchor = '  /** How the layer asks which colour a new annotation should take. */';
  if (!t.includes(anchor)) throw new Error('options anchor');
  t = t.replace(
    anchor,
    J([
      '  /** Which standard stamp a click places. */',
      '  currentStamp?: () => StampId;',
      '  /** The word drawn on a stamp of the given kind. */',
      '  stampLabel?: (stamp: StampId) => string;',
      '',
      anchor,
    ]),
  );

  // addStamp, placed next to addNote
  const noteFn = /  private async addNote\([\s\S]*?\n  \}\n/;
  const found = noteFn.exec(t);
  if (!found) throw new Error('addNote not found');
  const addStamp = J([
    '',
    '  /**',
    '   * Places a stamp centred on the click.',
    '   *',
    '   * A fixed size in page units rather than a drag: a stamp is a mark of a standard size,',
    '   * and dragging one out would produce a stamp that is the wrong shape for its word.',
    '   */',
    '  private addStamp(page: number, point: AnnotPoint): void {',
    '    const stamp = this.options.currentStamp?.() ?? DEFAULT_STAMP;',
    '    const width = 158;',
    '    const height = 54;',
    '    const item = this.store.add({',
    '      page,',
    "      kind: 'stamp',",
    '      color: STAMP_COLORS[stamp],',
    '      rect: { x: point.x - width / 2, y: point.y - height / 2, w: width, h: height },',
    '      fontSize: 15,',
    '      strokeWidth: 1.6,',
    '      stampId: stamp,',
    '      note: this.options.stampLabel?.(stamp) ?? stamp,',
    '    });',
    '    this.select(item.id);',
    '  }',
    '',
  ]);
  t = t.replace(found[0], found[0] + addStamp);
  writeFileSync(file, t);
  console.log('  ' + file);
}

// -------------------------------------------------- 3. imports for the new symbols
{
  const file = 'src/annotations/layer.ts';
  let t = readFileSync(file, 'utf8');
  const m = /import \{([^}]*)\} from '\.\/model\.js';/.exec(t);
  if (!m) throw new Error('model import');
  if (!m[1].includes('STAMP_COLORS')) {
    t = t.replace(
      m[0],
      m[0].replace(
        'from \'./model.js\'',
        '',
      ).replace(/\)$/, '') + '',
    );
  }
  // simpler: append names
  const names = m[1].trim().replace(/,$/, '');
  t = t.replace(m[0], `import {${names}, DEFAULT_STAMP, STAMP_COLORS, type StampId } from './model.js';`);
  writeFileSync(file, t);
  console.log('  ' + file + ' (imports)');
}

// -------------------------------------------------- 4. sidebar label map
patch('src/sidebar/annotations.ts', [
  ["  'measure-area': ", "  stamp: 'annotStamp',\n  'measure-area': "],
]);

// -------------------------------------------------- 5. strings
patch('src/i18n/packs/zh-CN.ts', [
  [
    '    annotAuthor:',
    J([
      "    annotStamp: '图章',",
      "    stampApproved: '已批准',",
      "    stampConfidential: '机密',",
      "    stampDraft: '草稿',",
      "    stampReviewed: '已审阅',",
      "    stampVoid: '作废',",
      "    stampFinal: '最终版',",
      "    stampPick: '选择图章',",
      "    stampPickTitle: '插入哪种图章？',",
      "    stampNow: '当前图章',",
      '    annotAuthor:',
    ]),
  ],
]);
patch('src/i18n/packs/en.ts', [
  [
    '    annotAuthor:',
    J([
      "    annotStamp: 'Stamp',",
      "    stampApproved: 'Approved',",
      "    stampConfidential: 'Confidential',",
      "    stampDraft: 'Draft',",
      "    stampReviewed: 'Reviewed',",
      "    stampVoid: 'Void',",
      "    stampFinal: 'Final',",
      "    stampPick: 'Choose stamp',",
      "    stampPickTitle: 'Which stamp?',",
      "    stampNow: 'Current stamp',",
      '    annotAuthor:',
    ]),
  ],
]);

// -------------------------------------------------- 6. toolbar button
patch('index.html', [
  [
    '        <button id="annot-note" class="btn" title="便签">便签</button>',
    J([
      '        <button id="annot-note" class="btn" title="便签">便签</button>',
      '        <button id="annot-stamp" class="btn hidden" title="图章">图章</button>',
    ]),
  ],
]);

console.log('戳记：类型/图层/文案/按钮 完成');
