/**
 * Writing annotations into the PDF itself.
 *
 * The file is updated *incrementally*: new objects are appended, the page dictionaries
 * that gained annotations are rewritten, and a fresh cross-reference section with a
 * `/Prev` pointer to the previous one is added at the end. The original bytes are never
 * touched, so the operation is reversible by truncating the file, and a reader that does
 * not understand the new section still sees a valid document.
 *
 * Alongside the standard keys — so that other readers show the annotations — each object
 * carries a private `/PLP` entry holding the exact kind, stroke and text size. Standard
 * viewers ignore it; this application uses it to restore its own state without loss.
 */
import type { AnnotKind, AnnotPoint, AnnotRect } from '../annotations/model.js';
import { PdfDocument, type PageRecord } from './document.js';
import {
  array,
  dict,
  formatNumber,
  hexText,
  name,
  num,
  ref,
  serializeValue,
  type PdfDict,
  type PdfValue,
} from './syntax.js';

export interface PdfAnnotationInput {
  kind: AnnotKind;
  /** `#rrggbb`. */
  color: string;
  /** Bounding box in display page space: origin top-left, y down, unrotated. */
  rect?: AnnotRect | undefined;
  /** One entry per text-markup line, for highlights and the like. */
  rects?: AnnotRect[] | undefined;
  strokes?: AnnotPoint[][] | undefined;
  note?: string | undefined;
  fontSize?: number | undefined;
  strokeWidth?: number | undefined;
  strokeDash?: boolean | undefined;
  /** Name written as the annotation's author, into `/T`. */
  author?: string | undefined;
  /** Standard stamp name, written as `/Name`. */
  stampName?: string | undefined;
}

export interface WriteResult {
  bytes: Uint8Array;
  annotationsWritten: number;
  pagesTouched: number;
}

const TEXT_KINDS: ReadonlySet<AnnotKind> = new Set<AnnotKind>(['textbox', 'callout']);

/** Converts `#rrggbb` to the 0..1 triple PDF wants. */
function toRgb(color: string): [number, number, number] {
  const match = /^#?([0-9a-f]{6})$/i.exec(color.trim());
  if (!match) return [0, 0, 0];
  const value = Number.parseInt(match[1]!, 16);
  return [((value >> 16) & 0xff) / 255, ((value >> 8) & 0xff) / 255, (value & 0xff) / 255];
}

/**
 * Maps display page space onto PDF user space.
 *
 * Annotations are stored with the origin at the top-left and y increasing downwards,
 * which is what the overlay needs. PDF user space puts the origin at the bottom-left, so
 * y is mirrored about the media box.
 */
class PageMapper {
  constructor(private readonly box: [number, number, number, number]) {}

  private get x0(): number {
    return this.box[0];
  }

  private get y1(): number {
    return this.box[3];
  }

  point(p: AnnotPoint): [number, number] {
    return [this.x0 + p.x, this.y1 - p.y];
  }

  /** Returns `[x1, y1, x2, y2]` with the corners in ascending order, as the spec requires. */
  rect(r: AnnotRect): [number, number, number, number] {
    const x1 = this.x0 + r.x;
    const x2 = this.x0 + r.x + r.w;
    const y1 = this.y1 - r.y - r.h;
    const y2 = this.y1 - r.y;
    return [Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2)];
  }

  /**
   * A text-markup box as a `/QuadPoints` entry.
   *
   * The order is fixed by the specification: upper-left, upper-right, lower-left,
   * lower-right.
   */
  quad(r: AnnotRect): number[] {
    const [x1, y1, x2, y2] = this.rect(r);
    return [x1, y2, x2, y2, x1, y1, x2, y1];
  }
}

function boundsOf(input: PdfAnnotationInput): AnnotRect {
  if (input.rect) return input.rect;
  if (input.rects && input.rects.length > 0) {
    const xs = input.rects.map((r) => r.x);
    const ys = input.rects.map((r) => r.y);
    const x2 = input.rects.map((r) => r.x + r.w);
    const y2 = input.rects.map((r) => r.y + r.h);
    return {
      x: Math.min(...xs),
      y: Math.min(...ys),
      w: Math.max(...x2) - Math.min(...xs),
      h: Math.max(...y2) - Math.min(...ys),
    };
  }
  const points = (input.strokes ?? []).flat();
  if (points.length > 0) {
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    return {
      x: Math.min(...xs),
      y: Math.min(...ys),
      w: Math.max(...xs) - Math.min(...xs),
      h: Math.max(...ys) - Math.min(...ys),
    };
  }
  return { x: 0, y: 0, w: 1, h: 1 };
}

/** Which PDF annotation subtype, and which additional entries, a kind maps to. */
function subtypeFor(kind: AnnotKind): string {
  switch (kind) {
    case 'highlight': return 'Highlight';
    case 'underline': return 'Underline';
    case 'strikeout': return 'StrikeOut';
    case 'ink': return 'Ink';
    case 'note': return 'Text';
    case 'rect': return 'Square';
    case 'ellipse': return 'Circle';
    case 'arrow': return 'Line';
    case 'textbox':
    case 'callout': return 'FreeText';
    case 'measure-distance': return 'Line';
    case 'measure-perimeter': return 'PolyLine';
    case 'measure-area': return 'Polygon';
    case 'stamp': return 'Stamp';
  }
}

function buildAnnotation(
  input: PdfAnnotationInput,
  mapper: PageMapper,
  pageRef: PdfValue,
  fontRef: PdfValue | null,
): PdfDict {
  const entries: Record<string, PdfValue> = {};
  const rgb = toRgb(input.color);
  const box = boundsOf(input);

  entries['Type'] = name('Annot');
  entries['Subtype'] = name(subtypeFor(input.kind));

  // `/Name` is what makes a stamp a stamp to another reader, rather than a rectangle
  // that happens to have words in it.
  if (input.kind === 'stamp' && input.stampName) {
    entries['Name'] = name(input.stampName);
  }

  // The title is what every reader shows as the annotation's author. Omitted when the
  // reader has not set a name, rather than writing a placeholder nobody chose.
  if (input.author && input.author.trim() !== '') {
    entries['T'] = hexText(input.author.trim());
  }
  entries['Rect'] = array(mapper.rect(box).map((v) => num(v)));
  entries['P'] = pageRef;
  entries['F'] = num(4); // Print
  entries['C'] = array(rgb.map((v) => num(v)));
  entries['M'] = hexText(pdfDate(new Date()));

  const width = input.strokeWidth ?? 1.5;
  entries['Border'] = array([num(0), num(0), num(width)]);
  entries['BS'] = dict({
    W: num(width),
    S: name(input.strokeDash === true ? 'D' : 'S'),
  });

  if (input.note !== undefined && input.note.length > 0) {
    entries['Contents'] = hexText(input.note);
  }

  switch (input.kind) {
    case 'highlight':
    case 'underline':
    case 'strikeout': {
      const rects = input.rects ?? [box];
      entries['QuadPoints'] = array(rects.flatMap((r) => mapper.quad(r).map((v) => num(v))));
      if (input.kind === 'highlight') {
        entries['CA'] = num(0.38);
      }
      break;
    }
    case 'ink': {
      const lists = (input.strokes ?? []).map((stroke) =>
        array(stroke.flatMap((p) => mapper.point(p).map((v) => num(v)))),
      );
      entries['InkList'] = array(lists);
      break;
    }
    case 'note': {
      entries['Name'] = name('Note');
      break;
    }
    case 'arrow': {
      const stroke = input.strokes?.[0] ?? [];
      const from = mapper.point(stroke[0] ?? { x: box.x, y: box.y });
      const to = mapper.point(stroke[1] ?? { x: box.x + box.w, y: box.y + box.h });
      entries['L'] = array([...from, ...to].map((v) => num(v)));
      entries['LE'] = array([name('None'), name('ClosedArrow')]);
      break;
    }
    case 'measure-distance': {
      const stroke = input.strokes?.[0] ?? [];
      const from = mapper.point(stroke[0] ?? { x: box.x, y: box.y });
      const to = mapper.point(stroke[1] ?? { x: box.x + box.w, y: box.y + box.h });
      entries['L'] = array([...from, ...to].map((v) => num(v)));
      entries['IT'] = name('LineDimension');
      entries['Measure'] = measureDict();
      break;
    }
    case 'measure-perimeter':
    case 'measure-area': {
      const stroke = input.strokes?.[0] ?? [];
      entries['Vertices'] = array(stroke.flatMap((p) => mapper.point(p).map((v) => num(v))));
      entries['IT'] = name('PolygonDimension');
      entries['Measure'] = measureDict();
      break;
    }
    case 'textbox':
    case 'callout': {
      const size = input.fontSize ?? 12;
      // `/DA` names the font declared in the AcroForm's default resources.
      entries['DA'] = hexText(`/Helv ${formatNumber(size)} Tf 0 0 0 rg`);
      entries['Q'] = num(0);
      if (input.kind === 'callout') {
        entries['IT'] = name('FreeTextCallout');
        // A short leader from the box towards the lower right, so readers that draw it
        // have something sensible to draw.
        const [x1, y1] = mapper.rect(box);
        entries['CL'] = array([num(x1), num(y1), num(x1 - 18), num(y1 - 18)]);
      }
      if (fontRef) entries['DR'] = fontRef;
      break;
    }
  }

  // The private entry that lets this application restore its own state exactly.
  const privateEntries: Record<string, PdfValue> = {
    V: num(1),
    K: name(input.kind),
  };
  if (input.strokeWidth !== undefined) privateEntries['W'] = num(input.strokeWidth);
  if (input.strokeDash !== undefined) privateEntries['D'] = { kind: 'bool', value: input.strokeDash };
  if (input.fontSize !== undefined) privateEntries['F'] = num(input.fontSize);
  entries['PLP'] = dict(privateEntries);

  return dict(entries);
}

/** A minimal but structurally valid `/Measure` for a linear dimension. */
function measureDict(): PdfDict {
  return dict({
    Type: name('Measure'),
    Subtype: name('RL'),
    // One unit of default user space is one point; the ratio states that in millimetres.
    R: hexText('1 mm'),
    X: array([
      dict({
        Type: name('NumberFormat'),
        F: hexText('D'),
        C: num(0.3527778),
      }),
    ]),
  });
}

/** `D:YYYYMMDDHHmmSSOHH'mm'`, the date format PDF annotation dictionaries use. */
function pdfDate(date: Date): string {
  const pad = (value: number, width = 2): string => String(value).padStart(width, '0');
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  const abs = Math.abs(offset);
  return (
    `D:${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}` +
    `${sign}${pad(Math.floor(abs / 60))}'${pad(abs % 60)}'`
  );
}

// ------------------------------------------------------------------ dictionary text

/** Finds a top-level dictionary key, ignoring occurrences inside strings. */
function findDictKey(body: string, key: string): number {
  const needle = `/${key}`;
  let depth = 0;
  let index = 0;
  while (index < body.length) {
    const ch = body[index]!;
    if (ch === '(') {
      // Skip a literal string, honouring escapes.
      let nesting = 1;
      index++;
      while (index < body.length && nesting > 0) {
        if (body[index] === '\\') index += 2;
        else if (body[index] === '(') { nesting++; index++; }
        else if (body[index] === ')') { nesting--; index++; }
        else index++;
      }
      continue;
    }
    if (ch === '<' && body[index + 1] === '<') { depth++; index += 2; continue; }
    if (ch === '>' && body[index + 1] === '>') { depth--; index += 2; continue; }
    if (ch === '/' && depth === 1 && body.startsWith(needle, index)) {
      const after = body[index + needle.length];
      if (after === undefined || /[\s/<>[\]()]/.test(after)) return index;
    }
    index++;
  }
  return -1;
}

/** Advances past one PDF value, so a dictionary entry can be replaced wholesale. */
function skipValue(body: string, start: number): number {
  let index = start;
  const skipWs = (): void => {
    while (index < body.length && /\s/.test(body[index]!)) index++;
  };
  skipWs();
  if (index >= body.length) return index;

  const ch = body[index]!;
  if (ch === '<' && body[index + 1] === '<') {
    let depth = 0;
    while (index < body.length) {
      if (body[index] === '<' && body[index + 1] === '<') { depth++; index += 2; continue; }
      if (body[index] === '>' && body[index + 1] === '>') {
        depth--;
        index += 2;
        if (depth === 0) return index;
        continue;
      }
      if (body[index] === '(') {
        let nesting = 1;
        index++;
        while (index < body.length && nesting > 0) {
          if (body[index] === '\\') index += 2;
          else if (body[index] === '(') { nesting++; index++; }
          else if (body[index] === ')') { nesting--; index++; }
          else index++;
        }
        continue;
      }
      index++;
    }
    return index;
  }
  if (ch === '[') {
    let depth = 1;
    index++;
    while (index < body.length && depth > 0) {
      if (body[index] === '[') depth++;
      else if (body[index] === ']') depth--;
      index++;
    }
    return index;
  }
  if (ch === '(') {
    let nesting = 1;
    index++;
    while (index < body.length && nesting > 0) {
      if (body[index] === '\\') index += 2;
      else if (body[index] === '(') { nesting++; index++; }
      else if (body[index] === ')') { nesting--; index++; }
      else index++;
    }
    return index;
  }
  if (ch === '/') {
    index++;
    while (index < body.length && !/[\s/<>[\]()]/.test(body[index]!)) index++;
    return index;
  }
  // A number, or a `N G R` reference: consume up to three tokens.
  const before = index;
  const tokens: string[] = [];
  while (tokens.length < 3) {
    skipWs();
    const tokenStart = index;
    while (index < body.length && !/[\s/<>[\]()]/.test(body[index]!)) index++;
    if (index === tokenStart) break;
    tokens.push(body.slice(tokenStart, index));
  }
  if (tokens.length >= 3 && tokens[2] === 'R') return index;
  // Not a reference: stop after the first token.
  index = before;
  skipWs();
  while (index < body.length && !/[\s/<>[\]()]/.test(body[index]!)) index++;
  return index;
}

/** Replaces or inserts a dictionary entry in an object body, preserving everything else. */
export function setDictEntry(body: string, key: string, valueText: string): string {
  const index = findDictKey(body, key);
  if (index >= 0) {
    let valueStart = index + key.length + 1;
    while (valueStart < body.length && /\s/.test(body[valueStart]!)) valueStart++;
    const valueEnd = skipValue(body, valueStart);
    return `${body.slice(0, valueStart)}${valueText} ${body.slice(valueEnd)}`;
  }
  const close = body.lastIndexOf('>>');
  if (close < 0) return body;
  return `${body.slice(0, close)}/Annots ${valueText} ${body.slice(close)}`;
}

// ------------------------------------------------------------------ the update

export interface PageAnnotationUpdate {
  /** Zero-based index into the document's pages. */
  pageIndex: number;
  annotations: PdfAnnotationInput[];
}

/**
 * Appends annotations to a PDF and returns the new bytes.
 *
 * Throws rather than producing a damaged file: an encrypted document cannot be written
 * without implementing the security handler, and a document with no resolvable page tree
 * has nowhere to attach annotations.
 */
export async function writeAnnotations(
  original: Uint8Array,
  updates: readonly PageAnnotationUpdate[],
): Promise<WriteResult> {
  const doc = await PdfDocument.parse(original);
  if (doc.encrypted) {
    throw new Error('这个 PDF 是加密的，无法写入批注');
  }
  const pages = await doc.pages();
  if (pages.length === 0) throw new Error('没有找到可写入的页面');

  const total = updates.reduce((sum, update) => sum + update.annotations.length, 0);
  if (total === 0) return { bytes: original, annotationsWritten: 0, pagesTouched: 0 };

  let nextObjectNumber = doc.size;
  const allocate = (): number => nextObjectNumber++;

  // A font is only needed when text is actually written.
  const needsFont = updates.some((update) => update.annotations.some((a) => TEXT_KINDS.has(a.kind)));
  const fontNumber = needsFont ? allocate() : null;
  const fontRef = fontNumber === null ? null : ref(fontNumber, 0);

  const appended: Array<{ num: number; text: string }> = [];
  const touched: Array<{ num: number; gen: number; text: string }> = [];
  let annotationsWritten = 0;

  for (const update of updates) {
    const page = pages[update.pageIndex];
    if (!page || update.annotations.length === 0) continue;
    const mapper = new PageMapper(page.mediaBox);
    const pageRef = ref(page.num, page.gen);

    const annotNumbers: number[] = [];
    for (const input of update.annotations) {
      const objectNumber = allocate();
      const built = buildAnnotation(input, mapper, pageRef, fontRef);
      appended.push({ num: objectNumber, text: serializeValue(built) });
      annotNumbers.push(objectNumber);
    }

    // Keep whatever was already on the page, then add ours.
    const existing = await collectAnnotRefs(doc, page);
    const annotsArray = array([...existing, ...annotNumbers.map((n) => ref(n, 0))]);
    const annotsNumber = allocate();
    appended.push({ num: annotsNumber, text: serializeValue(annotsArray) });

    const body = await pageBodyText(doc, page);
    if (body === null) continue;
    touched.push({ num: page.num, gen: page.gen, text: setDictEntry(body, 'Annots', `${annotsNumber} 0 R`) });
    annotationsWritten += update.annotations.length;
  }

  if (annotationsWritten === 0) return { bytes: original, annotationsWritten: 0, pagesTouched: 0 };

  if (fontNumber !== null) {
    appended.push({
      num: fontNumber,
      text: serializeValue(
        dict({
          Type: name('Font'),
          Subtype: name('Type1'),
          BaseFont: name('Helvetica'),
          Encoding: name('WinAnsiEncoding'),
        }),
      ),
    });
  }

  // ---- serialise the appended section ----
  const chunks: string[] = [];
  let offset = original.length;

  // The original file may not end with a newline; start the addition on its own line.
  const needsBreak = original.length > 0 && original[original.length - 1] !== 0x0a;
  if (needsBreak) {
    chunks.push('\n');
    offset += 1;
  }

  const xrefEntries = new Map<number, number>();

  for (const object of appended) {
    xrefEntries.set(object.num, offset);
    const text = `${object.num} 0 obj\n${object.text}\nendobj\n`;
    chunks.push(text);
    offset += byteLength(text);
  }
  for (const object of touched) {
    xrefEntries.set(object.num, offset);
    const text = `${object.num} ${object.gen} obj\n${object.text}\nendobj\n`;
    chunks.push(text);
    offset += byteLength(text);
  }

  const xrefOffset = offset;
  const xrefText = buildXrefTable(xrefEntries);
  chunks.push(xrefText);
  offset += byteLength(xrefText);

  const trailer: Record<string, PdfValue> = {
    Size: num(Math.max(doc.size, nextObjectNumber)),
    Root: doc.rootRef ?? ref(1, 0),
    Prev: num(doc.startxref),
  };
  const id = doc.trailer.get('ID');
  if (id) trailer['ID'] = id;
  const info = doc.trailer.get('Info');
  if (info) trailer['Info'] = info;
  if (fontNumber !== null) {
    // Default resources make `/DA`'s `/Helv` resolvable for the text annotations.
    trailer['PLPFont'] = ref(fontNumber, 0);
  }

  const trailerText = `trailer\n${serializeValue(dict(trailer))}\nstartxref\n${xrefOffset}\n%%EOF\n`;
  chunks.push(trailerText);

  const bytes = concat([original, latin1(chunks.join(''))]);
  return { bytes, annotationsWritten, pagesTouched: touched.length };
}

/** Existing `/Annots` references, so an update does not drop annotations already there. */
async function collectAnnotRefs(doc: PdfDocument, page: PageRecord): Promise<PdfValue[]> {
  if (!page.annots) return [];
  if (page.annots.kind === 'ref') return [page.annots];
  const resolved = await doc.array(page.annots);
  const out: PdfValue[] = [];
  for (const entry of resolved?.value ?? []) {
    if (entry.kind === 'ref') out.push(entry);
  }
  return out;
}

/** The text of a page dictionary, taken verbatim when the object is not compressed. */
async function pageBodyText(doc: PdfDocument, page: PageRecord): Promise<string | null> {
  const raw = doc.rawBodyOf(page.num);
  if (raw !== null) return raw;
  const value = await doc.getObject(page.num);
  if (!value || value.kind !== 'dict') return null;
  return serializeValue(value);
}

/** A classic cross-reference table, one subsection per contiguous run. */
function buildXrefTable(entries: Map<number, number>): string {
  const numbers = [...entries.keys()].sort((a, b) => a - b);
  const lines: string[] = ['xref\n', '0 1\n', '0000000000 65535 f \n'];
  let index = 0;
  while (index < numbers.length) {
    const start = numbers[index]!;
    let end = index;
    while (end + 1 < numbers.length && numbers[end + 1] === numbers[end]! + 1) end++;
    const count = end - index + 1;
    lines.push(`${start} ${count}\n`);
    for (let i = index; i <= end; i++) {
      lines.push(`${String(entries.get(numbers[i]!)).padStart(10, '0')} 00000 n \n`);
    }
    index = end + 1;
  }
  return lines.join('');
}

function byteLength(text: string): number {
  return text.length;
}

function latin1(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0xff;
  return out;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
