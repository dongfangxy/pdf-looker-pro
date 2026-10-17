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

// ---------------------------------------------------------------- command ids
{
  const file = 'src/i18n/commands.ts';
  const text = readFileSync(file, 'utf8');
  const used = new Set();
  for (const m of text.matchAll(/^\s*[A-Za-z][A-Za-z0-9]*:\s*(\d+),/gm)) used.add(Number(m[1]));
  let candidate = 1250;
  const assigned = [];
  for (const name of ['NewBlankDocument', 'NewFromImage', 'ReorderPages']) {
    while (used.has(candidate)) candidate++;
    used.add(candidate);
    assigned.push(`${name}: ${candidate},`);
  }
  const out = text.replace('  SaveIntoPdf:', `${assigned.join('\n  ')}\n  SaveIntoPdf:`);
  if (out === text) throw new Error('commands.ts anchor missing');
  writeFileSync(file, out);
  console.log('  命令 id: ' + assigned.join(' '));
}

// ---------------------------------------------------------------- strings
const zhCmd = [
  "    [CMD.NewBlankDocument]: { title: '新建空白文档...', tooltip: '创建一个只有空白页的新文档', status: '新建空白文档', short: '新建' },",
  "    [CMD.NewFromImage]: { title: '从图像创建...', tooltip: '把一张图片变成单页 PDF', status: '从图像创建', short: '从图像' },",
  "    [CMD.ReorderPages]: { title: '页面重排...', tooltip: '按指定顺序重新排列页面', status: '页面重排', short: '重排' },",
].join('\n');
const enCmd = [
  "    [CMD.NewBlankDocument]: { title: 'New blank document...', tooltip: 'Create a document of blank pages', status: 'New blank document', short: 'New' },",
  "    [CMD.NewFromImage]: { title: 'New from image...', tooltip: 'Turn an image into a one-page PDF', status: 'New from image', short: 'From image' },",
  "    [CMD.ReorderPages]: { title: 'Reorder pages...', tooltip: 'Rearrange the pages into a given order', status: 'Reorder pages', short: 'Reorder' },",
].join('\n');
const zhStr = [
  "    newDocPages: '页数',",
  "    untitled: '未命名.pdf',",
  "    newDocDone: '已新建空白文档',",
  "    imagePick: '选择图像文件',",
  "    imageFailed: '无法读取这张图片',",
  "    imageDone: '已从图像创建文档',",
  "    reorderHint: '按想要的顺序填写页码，例如 3,1,2,4-6',",
  "    reorderLabel: '页面顺序',",
  "    reorderDone: '页面已重排',",
].join('\n');
const enStr = [
  "    newDocPages: 'Pages',",
  "    untitled: 'Untitled.pdf',",
  "    newDocDone: 'Blank document created',",
  "    imagePick: 'Choose an image file',",
  "    imageFailed: 'That image could not be read',",
  "    imageDone: 'Document created from the image',",
  "    reorderHint: 'List the pages in the order you want, e.g. 3,1,2,4-6',",
  "    reorderLabel: 'Page order',",
  "    reorderDone: 'Pages reordered',",
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

// ---------------------------------------------------------------- markup
patch('index.html', [
  [
    '          <button id="btn-print" class="btn hidden" title="打印 (Ctrl+P)">打印</button>',
    J([
      '          <button id="btn-print" class="btn hidden" title="打印 (Ctrl+P)">打印</button>',
      '          <button id="btn-new-blank" class="btn hidden" title="新建空白文档">新建</button>',
      '          <button id="btn-new-image" class="btn hidden" title="从图像创建">从图像</button>',
      '          <button id="btn-reorder-pages" class="btn hidden" title="页面重排">重排</button>',
    ]),
  ],
]);

// ---------------------------------------------------------------- main.ts
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

  insertBefore("import { rewritePdf, type PagePlan } from './pdf/rewrite.js';", [
    "import { createBlankPdf, createPdfFromJpeg } from './pdf/create.js';",
  ], 'create import');

  insertAfter("  cropPages: mustFind<HTMLButtonElement>('btn-crop-pages'),", [
    "  newBlank: mustFind<HTMLButtonElement>('btn-new-blank'),",
    "  newImage: mustFind<HTMLButtonElement>('btn-new-image'),",
    "  reorderPages: mustFind<HTMLButtonElement>('btn-reorder-pages'),",
  ], 'ui refs');

  insertBefore(
    '/** Loads `<document>.pdf.arpk` when it exists, without failing the document open. */',
    [
      '/** Creates a document of blank pages and opens it. */',
      'async function newBlankDocument(): Promise<void> {',
      '  const value = await showInputDialog(i18n, {',
      "    title: i18n.resolveCommand(CMD.NewBlankDocument)?.title ?? '新建空白文档',",
      "    label: i18n.t('newDocPages'),",
      "    initial: '1',",
      '    numeric: true,',
      '  });',
      '  if (value === null) return;',
      '  const count = Number.parseInt(value.trim(), 10);',
      '  if (!Number.isFinite(count) || count < 1) {',
      "    setStatus(i18n.t('pageOpsNoPages'), true);",
      '    return;',
      '  }',
      '  const bytes = createBlankPdf(count);',
      "  await openDocument(bytes.buffer as ArrayBuffer, i18n.t('untitled'), null);",
      "  setStatus(`${i18n.t('newDocDone')}：${count} 页`);",
      '}',
      '',
      '/** Asks for an image file, without adding a permanent element to the page. */',
      'function pickImageFile(): Promise<File | null> {',
      '  return new Promise((resolve) => {',
      "    const input = document.createElement('input');",
      "    input.type = 'file';",
      "    input.accept = 'image/*';",
      '    input.style.display = \'none\';',
      '    let settled = false;',
      '    const finish = (file: File | null): void => {',
      '      if (settled) return;',
      '      settled = true;',
      '      input.remove();',
      '      resolve(file);',
      '    };',
      "    input.addEventListener('change', () => finish(input.files?.[0] ?? null));",
      "    input.addEventListener('cancel', () => finish(null));",
      '    document.body.appendChild(input);',
      '    input.click();',
      '  });',
      '}',
      '',
      '/**',
      ' * Builds a one-page PDF from an image file.',
      ' *',
      ' * The image is decoded by the browser and re-encoded as JPEG, so any format the engine',
      ' * understands works and the writer only ever has to embed one filter.',
      ' */',
      'async function newFromImage(): Promise<void> {',
      '  const file = await pickImageFile();',
      '  if (!file) return;',
      '  try {',
      '    const bitmap = await createImageBitmap(file);',
      '    const canvas = document.createElement(\'canvas\');',
      '    canvas.width = bitmap.width;',
      '    canvas.height = bitmap.height;',
      '    const context = canvas.getContext(\'2d\');',
      '    if (!context) throw new Error(\'2D 上下文不可用\');',
      '    context.fillStyle = \'#ffffff\';',
      '    context.fillRect(0, 0, canvas.width, canvas.height);',
      '    context.drawImage(bitmap, 0, 0);',
      "    const dataUrl = canvas.toDataURL('image/jpeg', 0.92);",
      "    const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);",
      '    const binary = atob(base64);',
      '    const jpeg = new Uint8Array(binary.length);',
      '    for (let i = 0; i < binary.length; i++) jpeg[i] = binary.charCodeAt(i);',
      '',
      '    // Scale so the long side fits a printable page; one pixel of the image need not',
      '    // become one point of paper.',
      '    const scale = Math.min(1, 842 / Math.max(bitmap.width, bitmap.height));',
      '    const pdf = createPdfFromJpeg(jpeg, Math.round(bitmap.width * scale), Math.round(bitmap.height * scale));',
      '    bitmap.close();',
      "    const stem = file.name.replace(/\\.[^.]+$/, '') || 'image';",
      '    await openDocument(pdf.buffer as ArrayBuffer, `${stem}.pdf`, null);',
      "    setStatus(i18n.t('imageDone'));",
      '  } catch (error) {',
      "    setStatus(`${i18n.t('imageFailed')}: ${String((error as Error)?.message ?? error)}`, true);",
      '  }',
      '}',
      '',
      '/** Rearranges the pages into the order the reader types. */',
      'async function reorderPages(): Promise<void> {',
      '  const session = activeSession;',
      '  if (!session?.bytes || !viewer.hasDocument) return;',
      '  const value = await showInputDialog(i18n, {',
      "    title: i18n.resolveCommand(CMD.ReorderPages)?.title ?? '页面重排',",
      "    label: `${i18n.t('reorderLabel')}（${i18n.t('reorderHint')}）`,",
      '    initial: Array.from({ length: viewer.pageCount }, (_, index) => index + 1).join(\',\'),',
      '  });',
      '  if (value === null) return;',
      '',
      '  const order = parsePageRange(value, viewer.pageCount);',
      '  if (order.length !== viewer.pageCount) {',
      "    setStatus(`${i18n.t('reorderHint')}（当前 ${viewer.pageCount} 页，填写了 ${order.length} 页）`, true);",
      '    return;',
      '  }',
      '',
      '  setStatus(i18n.t(\'loading\'));',
      '  let result;',
      '  try {',
      '    result = await rewritePdf(new Uint8Array(session.bytes), order.map((page) => ({ sourceIndex: page - 1 })));',
      '  } catch (error) {',
      "    setStatus(`${i18n.t('pageOpsFailed')}: ${String((error as Error)?.message ?? error)}`, true);",
      '    return;',
      '  }',
      '  const sourceToTarget = new Map<number, number>();',
      '  order.forEach((page, index) => {',
      '    if (!sourceToTarget.has(page)) sourceToTarget.set(page, index + 1);',
      '  });',
      '  const dropped = remapAnnotations(sourceToTarget);',
      '  await replaceDocumentBytes(result.bytes);',
      "  setStatus(dropped > 0 ? `${i18n.t('reorderDone')}（${dropped} 条批注随页面删除）` : i18n.t('reorderDone'));",
      '}',
      '',
      '/** Loads `<document>.pdf.arpk` when it exists, without failing the document open. */',
    ],
    'new document functions',
  );

  insertBefore("bindCommand(CMD.CropPages, ui.cropPages, { onClick: () => void runPageOperation('crop') });", [
    'bindCommand(CMD.NewBlankDocument, ui.newBlank, { onClick: () => void newBlankDocument() });',
    'bindCommand(CMD.NewFromImage, ui.newImage, { onClick: () => void newFromImage() });',
    'bindCommand(CMD.ReorderPages, ui.reorderPages, { onClick: () => void reorderPages() });',
  ], 'new document bindings');

  insertBefore("          command(CMD.DeletePages),", [
    '          command(CMD.NewBlankDocument),',
    '          command(CMD.NewFromImage),',
    '          { type: \'separator\' },',
    '          command(CMD.ReorderPages),',
  ], 'file menu');

  writeFileSync(file, lines.join('\n'));
  console.log('  src/main.ts');
}

console.log('B2b 基础完成');
