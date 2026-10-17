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

// ============================================================ writer
patch('src/pdf/annotate.ts', [
  [
    '  stampName?: string | undefined;',
    J([
      '  stampName?: string | undefined;',
      '  /** Replies in the annotation\'s thread, written as `/IRT` text annotations. */',
      '  replies?: Array<{ author: string; text: string }> | undefined;',
    ]),
  ],
  [
    J([
      '    for (const input of update.annotations) {',
      '      const objectNumber = allocate();',
      '      const built = buildAnnotation(input, mapper, pageRef, fontRef);',
      '      appended.push({ num: objectNumber, text: serializeValue(built) });',
      '      annotNumbers.push(objectNumber);',
      '    }',
    ]),
    J([
      '    for (const input of update.annotations) {',
      '      const objectNumber = allocate();',
      '      const built = buildAnnotation(input, mapper, pageRef, fontRef);',
      '      appended.push({ num: objectNumber, text: serializeValue(built) });',
      '      annotNumbers.push(objectNumber);',
      '',
      '      // A reply is its own annotation pointing back at its parent through `/IRT`,',
      '      // which is how every reader shows a thread. Writing the thread into the',
      '      // parent\'s `/Contents` would look like a reply and read like a monologue.',
      '      for (const reply of input.replies ?? []) {',
      '        if (reply.text.trim() === \'\') continue;',
      '        const replyNumber = allocate();',
      '        appended.push({',
      '          num: replyNumber,',
      '          text: serializeValue(buildReply(reply, input, mapper, pageRef, objectNumber)),',
      '        });',
      '        annotNumbers.push(replyNumber);',
      '      }',
      '    }',
    ]),
  ],
  [
    'function buildAnnotation(',
    J([
      '/**',
      ' * A reply, as a `/Text` annotation tied to its parent.',
      ' *',
      ' * Positioned on the parent\'s top-left corner: the geometry of a reply is not what',
      ' * anyone reads, but a reader that draws the icon needs somewhere to put it.',
      ' */',
      'function buildReply(',
      '  reply: { author: string; text: string },',
      '  parent: PdfAnnotationInput,',
      '  mapper: PageMapper,',
      '  pageRef: PdfValue,',
      '  parentNumber: number,',
      '): PdfDict {',
      '  const base = boundsOf(parent);',
      '  const [x1, y1] = mapper.rect({ x: base.x, y: base.y, w: 0, h: 0 });',
      '  const entries: Record<string, PdfValue> = {',
      "    Type: name('Annot'),",
      "    Subtype: name('Text'),",
      '    Rect: array([num(x1), num(y1 - 20), num(x1 + 20), num(y1)]),',
      '    Contents: hexText(reply.text),',
      '    IRT: ref(parentNumber, 0),',
      '    P: pageRef,',
      '    F: num(4),',
      '  };',
      "  if (reply.author.trim() !== '') entries['T'] = hexText(reply.author.trim());",
      '  return dict(entries);',
      '}',
      '',
      'function buildAnnotation(',
    ]),
  ],
]);

// ============================================================ reader
patch('src/pdf/import.ts', [
  [
    '  stampName?: string;',
    J([
      '  stampName?: string;',
      '  /** Replies reconstructed from annotations whose `/IRT` points here. */',
      '  replies?: AnnotReply[];',
    ]),
  ],
  [
    J([
      '  for (const entry of list.value) {',
      '    const annotation = await doc.dict(entry);',
      '    if (!annotation) continue;',
      "    const subtype = nameOf(annotation.value.get('Subtype'));",
      '    if (!subtype || !KNOWN_SUBTYPES.has(subtype)) continue;',
      '    const item = convert(annotation, subtype, mapper, pageNumber);',
      '    if (item) out.push(item);',
      '  }',
      '  return out;',
    ]),
    J([
      '  /** Object number to annotation, so `/IRT` can be resolved after the pass. */',
      '  const byNumber = new Map<number, ImportedAnnotation>();',
      '  const pending: Array<{ item: ImportedAnnotation; irt: number }> = [];',
      '',
      '  for (const entry of list.value) {',
      '    const annotation = await doc.dict(entry);',
      '    if (!annotation) continue;',
      "    const subtype = nameOf(annotation.value.get('Subtype'));",
      '    if (!subtype || !KNOWN_SUBTYPES.has(subtype)) continue;',
      '    const item = convert(annotation, subtype, mapper, pageNumber);',
      '    if (!item) continue;',
      '',
      '    const irt = annotation.value.get(\'IRT\');',
      "    if (irt?.kind === 'ref') {",
      '      pending.push({ item, irt: irt.num });',
      '      continue;',
      '    }',
      "    if (entry.kind === 'ref') byNumber.set(entry.num, item);",
      '    out.push(item);',
      '  }',
      '',
      '  // Replies are attached after every annotation is known, because `/IRT` may point at',
      '  // a parent that appears later in the list.',
      '  for (const { item, irt } of pending) {',
      '    const parent = byNumber.get(irt);',
      '    if (!parent) {',
      '      // A reply whose parent is outside this page is still worth showing.',
      '      out.push(item);',
      '      continue;',
      '    }',
      '    const list = parent.replies ?? (parent.replies = []);',
      "    list.push({ author: item.author ?? '', text: item.note ?? '', at: 0 });",
      '  }',
      '  return out;',
    ]),
  ],
]);

// AnnotReply must be importable by the reader
{
  const file = 'src/pdf/import.ts';
  let t = readFileSync(file, 'utf8');
  if (!t.includes('type AnnotReply')) {
    const m = /import \{([^}]*)\} from '\.\/\.\.\/annotations\/model\.js';/.exec(t);
    if (!m) throw new Error('model import in import.ts');
    const names = m[1].trim().replace(/,$/, '');
    t = t.replace(m[0], `import {${names}, type AnnotReply } from '../annotations/model.js';`);
    writeFileSync(file, t);
    console.log('  import.ts (AnnotReply)');
  }
}

// ============================================================ main: pass replies both ways
{
  const file = 'src/main.ts';
  let t = readFileSync(file, 'utf8');
  const a = '        stampName: item.stampId ? STAMP_PDF_NAMES[item.stampId] : undefined,';
  if (!t.includes(a)) throw new Error('stampName anchor');
  t = t.replace(
    a,
    J([
      a,
      '        replies: (item.replies ?? []).map((reply) => ({ author: reply.author, text: reply.text })),',
    ]),
  );
  const b = '        stampLabel: item.note,';
  if (t.includes(b)) {
    // flatten keeps only the parent's marks; a reply has no visual of its own
  }
  writeFileSync(file, t);
  console.log('  ' + file);
}

console.log('回复：PDF 写入与读回 完成');
