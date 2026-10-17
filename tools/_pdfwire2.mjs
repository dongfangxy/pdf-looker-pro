// Wires the PDF writer into the application: a real save command, plus hooks that let the
// verification suites round-trip a written file through pdf.js.
import { readFileSync, writeFileSync } from 'node:fs';

function patch(file, edits) {
  let t = readFileSync(file, 'utf8');
  for (const [from, to] of edits) {
    if (!t.includes(from)) throw new Error(`${file}: anchor not found: ${from.slice(0, 90)}`);
    t = t.replace(from, to);
  }
  writeFileSync(file, t);
  console.log(`${file} 已更新`);
}
const J = (l) => l.join('\n');

patch('src/i18n/commands.ts', [['  SaveAnnotations: 1130,', J(['  SaveAnnotations: 1130,', '  SaveIntoPdf: 1131,'])]]);

const zhCmd = "    [CMD.SaveIntoPdf]: { title: '保存到 PDF', tooltip: '把批注写入 PDF 文件本身', status: '正在写入 PDF', short: '写入' },";
const enCmd = "    [CMD.SaveIntoPdf]: { title: 'Save into PDF', tooltip: 'Write the annotations into the PDF file itself', status: 'Writing into the PDF', short: 'Write' },";
const zhStr = [
  "    pdfSaved: '批注已写入 PDF',",
  "    pdfSaveFailed: '写入 PDF 失败',",
  "    savingPdf: '正在写入 PDF…',",
  "    pdfNoBytes: '当前文档没有可写入的原始数据',",
].join('\n');
const enStr = [
  "    pdfSaved: 'Annotations written into the PDF',",
  "    pdfSaveFailed: 'Could not write into the PDF',",
  "    savingPdf: 'Writing into the PDF…',",
  "    pdfNoBytes: 'The open document has no original bytes to update',",
].join('\n');

for (const [file, cmd, str] of [
  ['src/i18n/packs/zh-CN.ts', zhCmd, zhStr],
  ['src/i18n/packs/en.ts', enCmd, enStr],
]) {
  patch(file, [
    ['    [CMD.SaveAnnotations]:', `${cmd}\n    [CMD.SaveAnnotations]:`],
    ["    langSwitchFail: '", `${str}\n\n    langSwitchFail: '`],
  ]);
}

patch('index.html', [
  [
    '          <button id="btn-close-doc" class="btn hidden" title="关闭文档">关闭</button>',
    J([
      '          <button id="btn-close-doc" class="btn hidden" title="关闭文档">关闭</button>',
      '          <button id="btn-save-pdf" class="btn hidden" title="把批注写入 PDF 文件本身">写入</button>',
    ]),
  ],
]);

patch('src/main.ts', [
  [
    "import { AnnotationLayer, annotationKindForTool } from './annotations/layer.js';",
    J([
      "import { AnnotationLayer, annotationKindForTool } from './annotations/layer.js';",
      "import { writeAnnotations, type PdfAnnotationInput } from './pdf/annotate.js';",
      "import { openFromArrayBuffer } from './viewer/pdf-document.js';",
    ]),
  ],
  [
    "  btnCloseDoc: mustFind<HTMLButtonElement>('btn-close-doc'),",
    J([
      "  btnCloseDoc: mustFind<HTMLButtonElement>('btn-close-doc'),",
      "  savePdf: mustFind<HTMLButtonElement>('btn-save-pdf'),",
    ]),
  ],
  [
    "  hooks['__saveAnnotations'] = () => saveAnnotations();",
    J([
      "  hooks['__saveAnnotations'] = () => saveAnnotations();",
      '',
      '  // ---- writing annotations into the PDF ----',
      "  hooks['__writePdf'] = (pages?: number[]) => buildAnnotatedPdf(pages);",
      "  hooks['__loadPdfAnnotations'] = async (bytes: ArrayBuffer | Uint8Array) => {",
      '    const buffer =',
      '      bytes instanceof Uint8Array',
      '        ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)',
      '        : bytes;',
      "    const opened = await openFromArrayBuffer(buffer as ArrayBuffer, 'roundtrip.pdf');",
      '    try {',
      '      const out: Array<Record<string, unknown>> = [];',
      '      for (let index = 1; index <= opened.pageCount; index++) {',
      '        const pdfPage = await opened.doc.getPage(index);',
      '        const list = await pdfPage.getAnnotations();',
      '        for (const entry of list) {',
      '          const record = entry as unknown as Record<string, unknown>;',
      '          const privateEntry = record[\'plp\'] as { K?: string } | undefined;',
      '          out.push({',
      '            page: index,',
      '            subtype: record[\'subtype\'],',
      '            rect: record[\'rect\'],',
      '            contents: (record[\'contentsObj\'] as { str?: string } | undefined)?.str ?? null,',
      '            color: record[\'color\'] ?? null,',
      '            kind: privateEntry?.K ?? null,',
      '            quadPoints: record[\'quadPoints\'] ?? null,',
      '            inkLists: record[\'inkLists\'] ?? null,',
      '            line: record[\'lineCoordinates\'] ?? null,',
      '            vertices: record[\'vertices\'] ?? null,',
      '          });',
      '        }',
      '      }',
      '      return out;',
      '    } finally {',
      '      await opened.doc.destroy();',
      '    }',
      '  };',
    ]),
  ],
  [
    '/** Loads `<document>.pdf.arpk` when it exists, without failing the document open. */',
    J([
      '  /**',
      '   * Builds a copy of the open PDF with the annotations written into it.',
      '   *',
      '   * Annotations are grouped by page and handed to the incremental writer, which',
      '   * appends objects to the original bytes rather than re-serialising the document.',
      '   */',
      '  async function buildAnnotatedPdf(onlyPages?: number[]): Promise<Uint8Array> {',
      '    const source = activeSession?.bytes;',
      "    if (!source) throw new Error(i18n.t('pdfNoBytes'));",
      '    const allowed = onlyPages ? new Set(onlyPages) : null;',
      '    const byPage = new Map<number, PdfAnnotationInput[]>();',
      '    for (const item of annotations.all) {',
      '      if (allowed && !allowed.has(item.page)) continue;',
      '      const list = byPage.get(item.page - 1);',
      '      const input: PdfAnnotationInput = {',
      '        kind: item.kind,',
      '        color: item.color,',
      '        rect: item.rect,',
      '        rects: item.rects,',
      '        strokes: item.strokes,',
      '        note: item.note,',
      '        fontSize: item.fontSize,',
      '        strokeWidth: item.strokeWidth,',
      '        strokeDash: item.strokeDash,',
      '      };',
      '      if (list) list.push(input);',
      '      else byPage.set(item.page - 1, [input]);',
      '    }',
      '    const updates = [...byPage.entries()].map(([pageIndex, list]) => ({ pageIndex, annotations: list }));',
      '    const result = await writeAnnotations(new Uint8Array(source), updates);',
      '    return result.bytes;',
      '  }',
      '',
      '  /** Writes the annotations into the PDF and saves the result as a new file. */',
      '  async function saveIntoPdf(): Promise<void> {',
      '    const session = activeSession;',
      "    if (!session?.bytes) { setStatus(i18n.t('pdfNoBytes'), true); return; }",
      "    if (annotations.count === 0) { setStatus(i18n.t('annotEmpty'), true); return; }",
      "    setStatus(i18n.t('savingPdf'));",
      '    let bytes: Uint8Array;',
      '    try {',
      '      bytes = await buildAnnotatedPdf();',
      '    } catch (error) {',
      '      const message = String((error as Error)?.message ?? error);',
      "      setStatus(`${i18n.t('pdfSaveFailed')}: ${message}`, true);",
      '      return;',
      '    }',
      '',
      "    const stem = (session.name || 'document').replace(/\\.pdf$/i, '');",
      '    const suggested = session.path ? session.path.replace(/\\.pdf$/i, \'\') + \'-annotated.pdf\' : `${stem}-annotated.pdf`;',
      '    const bridge = desktop;',
      '    if (bridge) {',
      '      const target = await bridge.saveFileDialog({',
      "        title: i18n.resolveCommand(CMD.SaveIntoPdf)?.title ?? 'Save into PDF',",
      '        defaultPath: suggested,',
      "        filters: [{ name: 'PDF', extensions: ['pdf'] }],",
      '      });',
      '      if (!target) return;',
      '      const result = await bridge.writeFile(target, bytes);',
      '      if (!result.ok) {',
      "        setStatus(`${i18n.t('pdfSaveFailed')}: ${result.error ?? target}`, true);",
      '        return;',
      '      }',
      '      // Re-open the updated file, so the reader now shows what was written.',
      '      await openPath(target, target.split(/[\\\\/]/).pop() ?? session.name);',
      "      setStatus(`${i18n.t('pdfSaved')} → ${target.split(/[\\\\/]/).pop()}`);",
      '      return;',
      '    }',
      '    downloadBlob(new Blob([bytes as BlobPart], { type: \'application/pdf\' }), `${stem}-annotated.pdf`);',
      "    setStatus(`${i18n.t('pdfSaved')}: ${stem}-annotated.pdf`);",
      '  }',
      '',
      '/** Loads `<document>.pdf.arpk` when it exists, without failing the document open. */',
    ]),
  ],
  [
    '  registerCommand(CMD.SaveAnnotations, () => void saveAnnotations());',
    J([
      '  registerCommand(CMD.SaveAnnotations, () => void saveAnnotations());',
      '  registerCommand(CMD.SaveIntoPdf, () => void saveIntoPdf());',
    ]),
  ],
  [
    "bindCommand(CMD.CloseFile, ui.btnCloseDoc, { onClick: () => closeDocument() });",
    J([
      "bindCommand(CMD.CloseFile, ui.btnCloseDoc, { onClick: () => closeDocument() });",
      "bindCommand(CMD.SaveIntoPdf, ui.savePdf, { onClick: () => void saveIntoPdf() });",
    ]),
  ],
  [
    "command(CMD.SaveAnnotations, 'CmdOrCtrl+S'),",
    J([
      "command(CMD.SaveIntoPdf, 'CmdOrCtrl+Shift+S'),",
      "command(CMD.SaveAnnotations, 'CmdOrCtrl+Alt+S'),",
    ]),
  ],
  // The session has to remember the bytes it was opened from.
  [
    '  session.opened = opened;\n  session.path = path;',
    J([
      '  session.opened = opened;',
      '  session.bytes = data;',
      '  session.path = path;',
    ]),
  ],
]);
