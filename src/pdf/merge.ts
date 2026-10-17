/**
 * Merging one document into another.
 *
 * Unlike a page operation, this copies objects between two object graphs: every reference
 * inside the incoming document has to be renumbered to its new home, or it would point at
 * whatever the host document happens to keep at that number. That is why the incoming
 * objects are re-serialised rather than copied verbatim -- and why stream *data* is still
 * copied verbatim, since bytes inside a stream are not references.
 *
 * Pages are rebuilt on a flat `/Pages` node for the same reason the rewrite does it:
 * inherited `/MediaBox`, `/Resources` and `/Rotate` from intermediate nodes have to be
 * written onto each page or they are lost when the tree is flattened.
 */
import { PdfDocument, type PageRecord } from './document.js';
import { array, dict, name, num, ref, serializeValue, type PdfDict, type PdfValue } from './syntax.js';

export interface MergeResult {
  bytes: Uint8Array;
  pageCount: number;
  /** Pages that came from the second document. */
  inserted: number;
}

const HEADER = '%PDF-1.7\n%\xE2\xE3\xCF\xD3\n';

function latin1(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0xff;
  return out;
}

function latin1Text(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) out += String.fromCharCode(byte);
  return out;
}

function normaliseRotation(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const wrapped = Math.round(value / 90) * 90;
  return ((wrapped % 360) + 360) % 360;
}

/** Rewrites every object reference through `map`, leaving everything else alone. */
function remap(value: PdfValue, map: ReadonlyMap<number, number>): PdfValue {
  switch (value.kind) {
    case 'ref':
      return ref(map.get(value.num) ?? value.num, value.gen);
    case 'array':
      return array(value.value.map((item) => remap(item, map)));
    case 'dict': {
      const entries = new Map<string, PdfValue>();
      for (const [key, item] of value.value) entries.set(key, remap(item, map));
      return { kind: 'dict', value: entries };
    }
    case 'stream': {
      const dictValue = remap(value.dict, map) as PdfDict;
      // `/Length` follows the bytes, not the other way round.
      dictValue.value.set('Length', num(value.raw.length));
      return { kind: 'stream', dict: dictValue, raw: value.raw };
    }
    default:
      return value;
  }
}

/** The text of one object: a stream keeps its bytes, anything else is serialised. */
function objectText(objectNumber: number, generation: number, value: PdfValue): string {
  const head = `${objectNumber} ${generation} obj\n`;
  if (value.kind === 'stream') {
    return `${head}${serializeValue(value.dict)}\nstream\n${latin1Text(value.raw)}\nendstream\nendobj\n`;
  }
  return `${head}${serializeValue(value)}\nendobj\n`;
}

/**
 * A page dictionary with everything it inherited written onto it.
 *
 * `transform` runs over the finished entries, so an incoming page can have its references
 * renumbered in the same pass that materialises them.
 */
async function pageDict(
  doc: PdfDocument,
  record: PageRecord,
  parentNumber: number,
  transform: (value: PdfValue) => PdfValue,
): Promise<PdfDict> {
  const parsed = (await doc.getObject(record.num)) as PdfDict | null;
  const entries = new Map<string, PdfValue>(parsed && parsed.kind === 'dict' ? parsed.value : []);

  const resources = entries.get('Resources') ?? record.resources ?? dict({});
  const rotation = normaliseRotation(record.rotate);

  const rebuilt = new Map<string, PdfValue>();
  for (const [key, value] of entries) {
    // Everything the page used to inherit is replaced below.
    if (key === 'Parent' || key === 'MediaBox' || key === 'Resources' || key === 'CropBox' || key === 'Rotate') continue;
    rebuilt.set(key, transform(value));
  }
  rebuilt.set('Type', name('Page'));
  rebuilt.set('Parent', ref(parentNumber, 0));
  rebuilt.set('MediaBox', transform(array(record.mediaBox.map((value) => num(value)))));
  rebuilt.set('Resources', transform(resources));
  if (record.cropBox) rebuilt.set('CropBox', transform(array(record.cropBox.map((value) => num(value)))));
  if (rotation !== 0) rebuilt.set('Rotate', num(rotation));
  return { kind: 'dict', value: rebuilt };
}

function buildXref(offsets: ReadonlyMap<number, number>, size: number): string {
  const lines: string[] = [`xref\n0 ${size}\n`, '0000000000 65535 f \n'];
  for (let objectNumber = 1; objectNumber < size; objectNumber++) {
    const at = offsets.get(objectNumber);
    lines.push(at === undefined ? '0000000000 65535 f \n' : `${String(at).padStart(10, '0')} 00000 n \n`);
  }
  return lines.join('');
}

/**
 * Inserts every page of `extra` into `base`, before the page at `at` (1-based).
 *
 * `at` may be one past the last page, which appends; anything outside that range is
 * clamped rather than rejected, because an off-by-one should append, not fail.
 */
export async function mergePdf(base: Uint8Array, extra: Uint8Array, at: number): Promise<MergeResult> {
  const baseDoc = await PdfDocument.parse(base);
  const extraDoc = await PdfDocument.parse(extra);
  if (baseDoc.encrypted || extraDoc.encrypted) throw new Error('加密的 PDF 无法合并');

  const basePages = await baseDoc.pages();
  const extraPages = await extraDoc.pages();
  if (basePages.length === 0) throw new Error('目标文档没有页面');
  if (extraPages.length === 0) throw new Error('要合并的文档没有页面');

  const baseRoot = await baseDoc.dict(baseDoc.rootRef);
  if (!baseRoot) throw new Error('文件没有 /Root');
  const pagesEntry = baseRoot.value.get('Pages');
  if (!pagesEntry || pagesEntry.kind !== 'ref') throw new Error('/Root 没有 /Pages 引用');
  const pagesNumber = pagesEntry.num;

  // ---- renumber the incoming graph above the host's highest number ----
  const map = new Map<number, number>();
  let next = baseDoc.size;
  for (const objectNumber of extraDoc.objectNumbers()) map.set(objectNumber, next++);

  const appended: Array<{ num: number; text: string }> = [];
  /** The incoming page objects, which are replaced rather than transplanted. */
  const incomingPages = new Set(extraPages.map((page) => page.num));

  for (const objectNumber of extraDoc.objectNumbers()) {
    if (incomingPages.has(objectNumber)) continue;
    // A single `/Pages` node of the incoming document is not needed: its pages are being
    // rebuilt onto the host's tree, and keeping the node would leave a second tree.
    const value = await extraDoc.getObject(objectNumber);
    if (value === null) continue;
    const target = map.get(objectNumber);
    if (target === undefined) continue;
    if (value.kind === 'dict') {
      const type = value.value.get('Type');
      if (type?.kind === 'name' && type.value === 'Pages') continue;
      if (type?.kind === 'name' && type.value === 'Catalog') continue;
    }
    appended.push({ num: target, text: objectText(target, 0, remap(value, map)) });
  }

  // ---- rebuild the page sequence ----
  const total = basePages.length;
  const position = Math.max(1, Math.min(total + 1, Math.round(at) || 1));
  const kids: PdfValue[] = [];
  const overrides = new Map<number, string>();

  const pushBasePage = async (index: number): Promise<void> => {
    const record = basePages[index];
    if (!record) return;
    const built = await pageDict(baseDoc, record, pagesNumber, (value) => value);
    overrides.set(record.num, serializeValue(built));
    kids.push(ref(record.num, 0));
  };

  for (let index = 0; index < position - 1; index++) await pushBasePage(index);

  for (const record of extraPages) {
    const objectNumber = next++;
    const built = await pageDict(extraDoc, record, pagesNumber, (value) => remap(value, map));
    appended.push({ num: objectNumber, text: `${objectNumber} 0 obj\n${serializeValue(built)}\nendobj\n` });
    kids.push(ref(objectNumber, 0));
  }

  for (let index = position - 1; index < total; index++) await pushBasePage(index);

  overrides.set(
    pagesNumber,
    serializeValue(dict({ Type: name('Pages'), Kids: array(kids), Count: num(kids.length) })),
  );

  // ---- emit ----
  const chunks: string[] = [HEADER];
  let offset = HEADER.length;
  const offsets = new Map<number, number>();
  let maxNumber = 0;
  const emit = (objectNumber: number, text: string): void => {
    offsets.set(objectNumber, offset);
    if (objectNumber > maxNumber) maxNumber = objectNumber;
    chunks.push(text);
    offset += text.length;
  };

  for (const objectNumber of baseDoc.objectNumbers()) {
    const generation = baseDoc.generationOf(objectNumber);
    const replacement = overrides.get(objectNumber);
    if (replacement !== undefined) {
      emit(objectNumber, `${objectNumber} ${generation} obj\n${replacement}\nendobj\n`);
      continue;
    }
    const raw = baseDoc.rawObjectText(objectNumber);
    if (raw !== null) {
      emit(objectNumber, `${raw}\n`);
      continue;
    }
    const value = await baseDoc.getObject(objectNumber);
    if (value === null) continue;
    emit(objectNumber, objectText(objectNumber, generation, value));
  }
  for (const object of appended) emit(object.num, object.text);

  const xrefOffset = offset;
  const xrefText = buildXref(offsets, maxNumber + 1);
  chunks.push(xrefText);

  const trailer: Record<string, PdfValue> = { Size: num(maxNumber + 1), Root: baseDoc.rootRef ?? ref(1, 0) };
  const info = baseDoc.trailer.get('Info');
  if (info) trailer['Info'] = info;
  const id = baseDoc.trailer.get('ID');
  if (id) trailer['ID'] = id;
  chunks.push(`trailer\n${serializeValue(dict(trailer))}\nstartxref\n${xrefOffset}\n%%EOF\n`);

  return {
    bytes: latin1(chunks.join('')),
    pageCount: kids.length,
    inserted: extraPages.length,
  };
}
