/**
 * Reading annotations back out of a PDF.
 *
 * Once annotations live in the file, opening that file has to show them — otherwise a
 * successful save looks like a failed one. This reads them with the project's own parser
 * rather than asking pdf.js, because the private `/PLP` entry that preserves exact state
 * is not part of pdf.js's normalised annotation output.
 *
 * Anything this application does not understand — links, form widgets, popups — is left
 * alone.
 */
import type { AnnotKind, AnnotPoint, AnnotRect } from '../annotations/model.js';
import { PdfDocument, type PageRecord } from './document.js';
import type { PdfDict, PdfName, PdfValue } from './syntax.js';
import { decodeText } from './syntax.js';

export interface ImportedAnnotation {
  kind: AnnotKind;
  color: string;
  page: number;
  rect?: AnnotRect;
  rects?: AnnotRect[];
  strokes?: AnnotPoint[][];
  note?: string;
  fontSize?: number;
  strokeWidth?: number;
  strokeDash?: boolean;
  /** Author, reconstructed from `/T`. */
  author?: string;
  /** Standard stamp name, from `/Name`. */
  stampName?: string;
}

/** Subtypes this application knows how to reconstruct. */
const KNOWN_SUBTYPES = new Set([
  'Stamp',
  'Highlight',
  'Underline',
  'StrikeOut',
  'Ink',
  'Text',
  'Square',
  'Circle',
  'Line',
  'FreeText',
  'PolyLine',
  'Polygon',
]);

/**
 * Maps PDF user space back onto the display space the overlay uses.
 *
 * This is the inverse of what the writer does: y is mirrored about the media box, and the
 * box origin is subtracted.
 */
class InverseMapper {
  constructor(private readonly box: [number, number, number, number]) {}

  private get x0(): number {
    return this.box[0];
  }

  private get y1(): number {
    return this.box[3];
  }

  point(x: number, y: number): AnnotPoint {
    return { x: x - this.x0, y: this.y1 - y };
  }

  rect(x1: number, y1: number, x2: number, y2: number): AnnotRect {
    const left = Math.min(x1, x2);
    const right = Math.max(x1, x2);
    const bottom = Math.min(y1, y2);
    const top = Math.max(y1, y2);
    return { x: left - this.x0, y: this.y1 - top, w: right - left, h: top - bottom };
  }
}

function nameOf(value: PdfValue | undefined): string | null {
  return value?.kind === 'name' ? value.value : null;
}

function numberOf(value: PdfValue | undefined): number | null {
  return value?.kind === 'number' ? value.value : null;
}

function numbersOf(value: PdfValue | undefined): number[] {
  if (value?.kind !== 'array') return [];
  return value.value.map((v) => (v.kind === 'number' ? v.value : 0));
}

function textOf(value: PdfValue | undefined): string | null {
  return value?.kind === 'string' ? decodeText(value.bytes) : null;
}

/** `#rrggbb` from a `/C` triple, falling back to black when the entry is absent. */
function colorOf(value: PdfValue | undefined): string {
  const parts = numbersOf(value);
  if (parts.length < 3) return '#000000';
  const channel = (v: number): number => Math.max(0, Math.min(255, Math.round(v * 255)));
  return `#${[channel(parts[0]!), channel(parts[1]!), channel(parts[2]!)]
    .map((v) => v.toString(16).padStart(2, '0'))
    .join('')}`;
}

/** Reads every annotation this application can reconstruct, in page order. */
export async function readAnnotations(bytes: Uint8Array): Promise<ImportedAnnotation[]> {
  const doc = await PdfDocument.parse(bytes);
  if (doc.encrypted) return [];
  const pages = await doc.pages();
  const out: ImportedAnnotation[] = [];

  for (let index = 0; index < pages.length; index++) {
    const page = pages[index]!;
    const found = await readPageAnnotations(doc, page, index + 1);
    out.push(...found);
  }
  return out;
}

async function readPageAnnotations(
  doc: PdfDocument,
  page: PageRecord,
  pageNumber: number,
): Promise<ImportedAnnotation[]> {
  const list = await doc.array(page.annots);
  if (!list) return [];
  const mapper = new InverseMapper(page.mediaBox);
  const out: ImportedAnnotation[] = [];

  for (const entry of list.value) {
    const annotation = await doc.dict(entry);
    if (!annotation) continue;
    const subtype = nameOf(annotation.value.get('Subtype'));
    if (!subtype || !KNOWN_SUBTYPES.has(subtype)) continue;
    const item = convert(annotation, subtype, mapper, pageNumber);
    if (item) out.push(item);
  }
  return out;
}

function convert(
  annotation: PdfDict,
  subtype: string,
  mapper: InverseMapper,
  page: number,
): ImportedAnnotation | null {
  const privateEntry = annotation.value.get('PLP');
  const priv = privateEntry?.kind === 'dict' ? privateEntry.value : null;
  const declaredKind = nameOf(priv?.get('K')) as AnnotKind | null;

  const box = numbersOf(annotation.value.get('Rect'));
  if (box.length < 4) return null;
  const rect = mapper.rect(box[0]!, box[1]!, box[2]!, box[3]!);
  const base = colorsAndStroke(annotation, rect);
  const note = textOf(annotation.value.get('Contents')) ?? undefined;

  const kind = declaredKind ?? inferKind(annotation, subtype);
  if (!kind) return null;

  const item: ImportedAnnotation = { kind, page, ...base };
  if (note !== undefined && note.length > 0) item.note = note;

  // `/T` is the title other writers use for the author. Reading it back keeps the name
  // attached to the annotation across a save and reload instead of dropping it.
  const author = textOf(annotation.value.get('T'));
  if (subtype === 'Stamp') {
    const stampName = nameOf(annotation.value.get('Name'));
    if (stampName) item.stampName = stampName;
  }
  if (author !== null && author.length > 0) item.author = author;

  // The private entry restores what the standard keys cannot express exactly.
  if (priv) {
    const size = numberOf(priv.get('F'));
    if (size !== null) item.fontSize = size;
    const width = numberOf(priv.get('W'));
    if (width !== null) item.strokeWidth = width;
    const dash = priv.get('D');
    if (dash?.kind === 'bool') item.strokeDash = dash.value;
  }

  switch (subtype) {
    case 'Highlight':
    case 'Underline':
    case 'StrikeOut': {
      const quads = numbersOf(annotation.value.get('QuadPoints'));
      const rects: AnnotRect[] = [];
      for (let i = 0; i + 7 < quads.length; i += 8) {
        // Upper-left, upper-right, lower-left, lower-right.
        const xs = [quads[i]!, quads[i + 2]!, quads[i + 4]!, quads[i + 6]!];
        const ys = [quads[i + 1]!, quads[i + 3]!, quads[i + 5]!, quads[i + 7]!];
        rects.push(mapper.rect(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)));
      }
      item.rects = rects.length > 0 ? rects : [rect];
      delete item.rect;
      break;
    }
    case 'Ink': {
      const strokes = inkStrokes(annotation, mapper);
      if (strokes.length === 0) return null;
      item.strokes = strokes;
      delete item.rect;
      break;
    }
    case 'Line': {
      const line = numbersOf(annotation.value.get('L'));
      if (line.length < 4) return null;
      item.strokes = [[mapper.point(line[0]!, line[1]!), mapper.point(line[2]!, line[3]!)]];
      delete item.rect;
      break;
    }
    case 'PolyLine':
    case 'Polygon': {
      const vertices = numbersOf(annotation.value.get('Vertices'));
      const points: AnnotPoint[] = [];
      for (let i = 0; i + 1 < vertices.length; i += 2) {
        points.push(mapper.point(vertices[i]!, vertices[i + 1]!));
      }
      if (points.length < 2) return null;
      item.strokes = [points];
      if (subtype === 'Polygon') {
        delete item.rect;
      } else {
        delete item.rect;
      }
      break;
    }
    default:
      break;
  }

  return item;
}

function colorsAndStroke(
  annotation: PdfDict,
  rect: AnnotRect,
): Pick<ImportedAnnotation, 'color' | 'rect' | 'strokeWidth' | 'strokeDash'> {
  const out: Pick<ImportedAnnotation, 'color' | 'rect' | 'strokeWidth' | 'strokeDash'> = {
    color: colorOf(annotation.value.get('C')),
    rect,
  };
  const bs = annotation.value.get('BS');
  if (bs?.kind === 'dict') {
    const width = numberOf(bs.value.get('W'));
    if (width !== null) out.strokeWidth = width;
    const style = nameOf(bs.value.get('S'));
    if (style === 'D') out.strokeDash = true;
  }
  return out;
}

function inkStrokes(annotation: PdfDict, mapper: InverseMapper): AnnotPoint[][] {
  const list = annotation.value.get('InkList');
  if (list?.kind !== 'array') return [];
  const out: AnnotPoint[][] = [];
  for (const entry of list.value) {
    const numbers = numbersOf(entry);
    const points: AnnotPoint[] = [];
    for (let i = 0; i + 1 < numbers.length; i += 2) {
      points.push(mapper.point(numbers[i]!, numbers[i + 1]!));
    }
    if (points.length > 0) out.push(points);
  }
  return out;
}

/** Falls back to the subtype when the private entry is missing (a PDF from elsewhere). */
function inferKind(annotation: PdfDict, subtype: string): AnnotKind | null {
  const intent = nameOf(annotation.value.get('IT'));
  switch (subtype) {
    case 'Highlight': return 'highlight';
    case 'Underline': return 'underline';
    case 'StrikeOut': return 'strikeout';
    case 'Ink': return 'ink';
    case 'Text': return 'note';
    case 'Square': return 'rect';
    case 'Circle': return 'ellipse';
    case 'FreeText': return intent === 'FreeTextCallout' ? 'callout' : 'textbox';
    case 'Line': return intent === 'LineDimension' ? 'measure-distance' : 'arrow';
    case 'Polygon': return 'measure-area';
    case 'PolyLine': return 'measure-perimeter';
    default: return null;
  }
}

export type { PdfName };
