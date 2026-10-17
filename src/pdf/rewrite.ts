/**
 * Whole-document rewrite.
 *
 * The incremental writer can append, which is enough to add annotations but not to
 * delete, reorder or insert pages: those change the page tree, and a page tree cannot be
 * amended by appending to it. This module rebuilds the file instead.
 *
 * The strategy is conservative. Every object from the source is copied through — byte for
 * byte when it is stored uncompressed, re-serialised when it was packed in an object
 * stream — so content streams, fonts and images survive untouched. Only the page
 * dictionaries and the single `/Pages` node are rewritten, and the page tree is flattened
 * to one level, which is why inherited attributes are materialised onto each page first.
 *
 * Pages dropped from the plan leave their objects behind, unreferenced. That is legal
 * PDF and it is the safe choice: a page's content stream may be shared with a page that
 * survived, and deciding what is truly unreachable needs a full reference graph.
 */
import { PdfDocument, type PageRecord } from './document.js';
import {
  array,
  dict,
  name,
  num,
  ref,
  serializeValue,
  type PdfDict,
  type PdfValue,
} from './syntax.js';

/** One page of the output, in output order. */
export interface PagePlan {
  /** 0-based index into the source document, or `null` to insert a new page. */
  sourceIndex: number | null;
  /** Absolute `/Rotate` in degrees, or omitted to keep the source value. */
  rotate?: number;
  /**
   * Degrees to add to the source rotation.
   *
   * The caller usually wants "turn this page a quarter turn", not "make it 90°", and
   * it should not have to read the current rotation to say so.
   */
  rotateBy?: number;
  /**
   * Margins to trim off the media box, in points.
   *
   * Relative like `rotateBy`: a crop is normally expressed as "10 pt off each side",
   * which is independent of where the page sits on the canvas.
   */
  cropMargins?: { top: number; right: number; bottom: number; left: number };
  /** Absolute crop box, or `null` to restore the media box. Omitted keeps the source. */
  cropBox?: [number, number, number, number] | null;
  /** Inserted pages only: the media box. Defaults to US Letter. */
  mediaBox?: [number, number, number, number];
  /** Inserted pages only: PDF content-stream operators to draw. */
  content?: string;
}

export interface RewriteResult {
  bytes: Uint8Array;
  pageCount: number;
}

const DEFAULT_MEDIA_BOX: [number, number, number, number] = [0, 0, 612, 792];
/** PDF header written by a rewrite. 1.7 covers everything this writer emits. */
const HEADER = '%PDF-1.7\n%\xE2\xE3\xCF\xD3\n';

function latin1(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0xff;
  return out;
}


/**
 * Rebuilds a PDF from a page plan.
 *
 * Throws rather than emitting a damaged file: an encrypted source cannot be rewritten
 * without its security handler, and a plan with no pages would produce a document no
 * reader can open.
 */
export async function rewritePdf(
  original: Uint8Array,
  plan: readonly PagePlan[],
): Promise<RewriteResult> {
  const doc = await PdfDocument.parse(original);
  if (doc.encrypted) throw new Error('这个 PDF 是加密的，无法重写');
  if (plan.length === 0) throw new Error('输出至少需要一页');

  const sourcePages = await doc.pages();
  if (sourcePages.length === 0) throw new Error('源文件没有页面');

  const root = await doc.dict(doc.rootRef);
  if (!root) throw new Error('文件没有 /Root');
  const pagesEntry = root.value.get('Pages');
  if (!pagesEntry || pagesEntry.kind !== 'ref') throw new Error('/Root 没有 /Pages 引用');
  const pagesObjectNumber = pagesEntry.num;

  /** Replacement text per object number, applied while emitting. */
  const overrides = new Map<number, string>();
  /** Objects created by this rewrite, numbered above the source's highest. */
  const appended: Array<{ num: number; text: string }> = [];
  let nextNumber = doc.size;
  const allocate = (): number => nextNumber++;

  const childRefs: PdfValue[] = [];
  /** A source page may appear more than once; only the first keeps its object number. */
  const pageOwner = new Map<number, number>();

  for (const entry of plan) {
    if (entry.sourceIndex === null) {
      // ---- inserted page ----
      const mediaBox = entry.mediaBox ?? DEFAULT_MEDIA_BOX;
      const pageNumber = allocate();
      let contents: PdfValue | undefined;
      if (entry.content !== undefined && entry.content !== '') {
        const contentNumber = allocate();
        const body = entry.content;
        appended.push({
          num: contentNumber,
          text: `${contentNumber} 0 obj\n<< /Length ${byteLength(body)} >>\nstream\n${body}\nendstream\nendobj\n`,
        });
        contents = ref(contentNumber, 0);
      }
      const entries: Record<string, PdfValue> = {
        Type: name('Page'),
        Parent: ref(pagesObjectNumber, 0),
        MediaBox: array(mediaBox.map((value) => num(value))),
        Resources: dict({}),
      };
      if (entry.rotate) entries['Rotate'] = num(normaliseRotation(entry.rotate));
      if (entry.cropBox) entries['CropBox'] = array(entry.cropBox.map((value) => num(value)));
      if (contents) entries['Contents'] = contents;
      appended.push({ num: pageNumber, text: `${pageNumber} 0 obj\n${serializeValue(dict(entries))}\nendobj\n` });
      childRefs.push(ref(pageNumber, 0));
      continue;
    }

    const source = sourcePages[entry.sourceIndex];
    if (!source) throw new Error(`没有第 ${entry.sourceIndex + 1} 页`);

    const reused = pageOwner.has(source.num);
    const pageNumber = reused ? allocate() : source.num;
    if (!reused) pageOwner.set(source.num, pageNumber);

    const text = await pageObjectText(doc, source, entry, pagesObjectNumber);
    if (reused) {
      appended.push({ num: pageNumber, text: `${pageNumber} 0 obj\n${text}\nendobj\n` });
    } else {
      overrides.set(source.num, text);
    }
    childRefs.push(ref(pageNumber, 0));
  }

  // ---- the flattened page tree ----
  const pagesText = serializeValue(
    dict({
      Type: name('Pages'),
      Kids: array(childRefs),
      Count: num(childRefs.length),
    }),
  );
  overrides.set(pagesObjectNumber, pagesText);

  // ---- emit ----
  const chunks: string[] = [HEADER];
  let offset = byteLength(HEADER);
  const xref = new Map<number, number>();
  let maxNumber = 0;

  const emit = (objectNumber: number, text: string): void => {
    xref.set(objectNumber, offset);
    if (objectNumber > maxNumber) maxNumber = objectNumber;
    chunks.push(text);
    offset += byteLength(text);
  };

  for (const objectNumber of doc.objectNumbers()) {
    const generation = doc.generationOf(objectNumber);
    const replacement = overrides.get(objectNumber);
    if (replacement !== undefined) {
      emit(objectNumber, `${objectNumber} ${generation} obj\n${replacement}\nendobj\n`);
      continue;
    }
    const raw = doc.rawObjectText(objectNumber);
    if (raw !== null) {
      // Verbatim: re-serialising a stream would change bytes that must not change.
      emit(objectNumber, `${raw}\n`);
      continue;
    }
    const value = await doc.getObject(objectNumber);
    if (value === null) continue;
    emit(objectNumber, `${objectNumber} ${generation} obj\n${serializeValue(value)}\nendobj\n`);
  }

  for (const object of appended) {
    emit(object.num, object.text);
  }

  // ---- cross-reference and trailer ----
  const xrefOffset = offset;
  const xrefText = buildXrefTable(xref, maxNumber + 1);
  chunks.push(xrefText);
  offset += byteLength(xrefText);

  const trailerEntries: Record<string, PdfValue> = {
    Size: num(maxNumber + 1),
    Root: doc.rootRef ?? ref(1, 0),
  };
  const info = doc.trailer.get('Info');
  if (info) trailerEntries['Info'] = info;

  const id = doc.trailer.get('ID');
  if (id) {
    trailerEntries['ID'] = id;
  } else {
    // A fresh identifier set, derived from the content so the same input yields the
    // same output.
    const stamp = `${doc.size}-${plan.length}-${original.length}`;
    const digest = simpleHash(stamp);
    trailerEntries['ID'] = array([hexBytes(digest), hexBytes(digest)]);
  }

  const trailerText = `trailer\n${serializeValue(dict(trailerEntries))}\nstartxref\n${xrefOffset}\n%%EOF\n`;
  chunks.push(trailerText);

  return {
    bytes: latin1(chunks.join('')),
    pageCount: childRefs.length,
  };
}

/** Serialises a page dictionary with every inherited attribute materialised. */
async function pageObjectText(
  doc: PdfDocument,
  source: PageRecord,
  plan: PagePlan,
  parentNumber: number,
): Promise<string> {
  // Start from the parsed dictionary so keys this writer does not model survive.
  const parsed = (await doc.getObject(source.num)) as PdfDict | null;
  const entries = new Map<string, PdfValue>(parsed && parsed.kind === 'dict' ? parsed.value : []);

  entries.set('Type', name('Page'));
  entries.set('Parent', ref(parentNumber, 0));
  entries.set('MediaBox', array(source.mediaBox.map((value) => num(value))));

  // Resources were inherited in the source; write them down or the page loses its fonts.
  if (!entries.has('Resources') && source.resources) entries.set('Resources', source.resources);
  if (!entries.has('Resources')) entries.set('Resources', dict({}));

  // Crop box: an explicit override wins, `null` removes it, otherwise keep the source's.
  if (plan.cropBox === null) {
    entries.delete('CropBox');
  } else if (plan.cropBox) {
    entries.set('CropBox', array(plan.cropBox.map((value) => num(value))));
  } else if (!entries.has('CropBox') && source.cropBox) {
    entries.set('CropBox', array(source.cropBox.map((value) => num(value))));
  }

  const rotation =
    plan.rotateBy !== undefined
      ? normaliseRotation(source.rotate + plan.rotateBy)
      : plan.rotate === undefined
        ? source.rotate
        : normaliseRotation(plan.rotate);
  if (rotation === 0) entries.delete('Rotate');
  else entries.set('Rotate', num(rotation));

  // A margin crop is expressed against the page box the reader can see, which is the
  // crop box when there is one, so it does not silently trim twice.
  if (plan.cropMargins && !plan.cropBox) {
    const base = source.cropBox ?? source.mediaBox;
    const { top, right, bottom, left } = plan.cropMargins;
    const x1 = base[0] + left;
    const y1 = base[1] + bottom;
    const x2 = base[2] - right;
    const y2 = base[3] - top;
    if (x2 - x1 > 8 && y2 - y1 > 8) {
      entries.set('CropBox', array([num(x1), num(y1), num(x2), num(y2)]));
    }
  }

  return serializeValue({ kind: 'dict', value: entries });
}

function normaliseRotation(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const wrapped = Math.round(value / 90) * 90;
  return ((wrapped % 360) + 360) % 360;
}

function byteLength(text: string): number {
  return text.length;
}

/** A classic cross-reference table covering every number in `[0, size)`. */
function buildXrefTable(offsets: Map<number, number>, size: number): string {
  const lines: string[] = [`xref\n0 ${size}\n`];
  // Object zero is the head of the free list.
  lines.push('0000000000 65535 f \n');
  for (let objectNumber = 1; objectNumber < size; objectNumber++) {
    const offset = offsets.get(objectNumber);
    if (offset === undefined) {
      // A gap: mark it free, chained to the next free slot.
      lines.push('0000000000 65535 f \n');
    } else {
      lines.push(`${String(offset).padStart(10, '0')} 00000 n \n`);
    }
  }
  return lines.join('');
}

function simpleHash(text: string): Uint8Array {
  // FNV-1a, 32-bit, expanded to sixteen bytes by mixing two seeds. Only used to make a
  // deterministic /ID; it is not a security value.
  const out = new Uint8Array(16);
  for (let seed = 0; seed < 2; seed++) {
    let hash = 0x811c9dc5 ^ (seed * 0x9e3779b9);
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
    for (let byte = 0; byte < 8; byte++) {
      out[seed * 8 + byte] = (hash >>> ((7 - byte) * 4)) & 0xff;
    }
  }
  return out;
}

function hexBytes(bytes: Uint8Array): PdfValue {
  return { kind: 'string', bytes };
}
