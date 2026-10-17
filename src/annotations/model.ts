/**
 * Annotation model.
 *
 * Annotations are stored in **unrotated page space at scale 1**, which is the only
 * frame that stays valid when the view is zoomed or rotated. Screen coordinates are
 * derived on the way out and inverted on the way in, so a highlight survives a zoom
 * or a rotation without being re-drawn.
 */

/**
 * Annotation kinds.
 *
 * The set follows the inventory recovered from the analysed viewer's own command
 * table (highlight / underline / strikeout / note-to-text / pencil / rectangle /
 * ellipse / arrow / text box / callout). Only the *list of things a reader is
 * expected to offer* is taken from that; every kind here is implemented from
 * scratch and shares no code or artwork with it.
 *
 * Geometry reuse keeps the model small: an ellipse is a bounding `rect`, an arrow
 * and a callout leader are `strokes`, and text-bearing kinds put their body in
 * `note`.
 */
export const ANNOT_KINDS = [
  'highlight',
  'underline',
  'strikeout',
  'ink',
  'note',
  'rect',
  'ellipse',
  'arrow',
  'textbox',
  'callout',
  'measure-distance',
  'measure-perimeter',
  'measure-area',
  'stamp',
] as const;
export type AnnotKind = (typeof ANNOT_KINDS)[number];

/**
 * One message in an annotation's thread.
 *
 * `at` is kept so a thread keeps its order after a reload; the store sorts by page and
 * creation time, which says nothing about the order within one conversation.
 */
export interface AnnotReply {
  author: string;
  text: string;
  at: number;
}

/** A rectangle in unrotated page space at scale 1. */
/**
 * The standard stamps.
 *
 * A closed set rather than free text: every other reader recognises these six by name,
 * and a stamp a reader cannot name is only a picture of a stamp.
 */
export type StampId = 'approved' | 'confidential' | 'draft' | 'reviewed' | 'void' | 'final';

export const STAMP_IDS: readonly StampId[] = [
  'approved',
  'confidential',
  'draft',
  'reviewed',
  'void',
  'final',
];

export const DEFAULT_STAMP: StampId = 'approved';

/** Stamp colours, in the ink families these marks conventionally use. */
export const STAMP_COLORS: Record<StampId, string> = {
  approved: '#1f8f4e',
  confidential: '#c0392b',
  draft: '#7f8c8d',
  reviewed: '#2c6fbb',
  void: '#c0392b',
  final: '#1f8f4e',
};

/** The `/Name` written into the PDF, which is how other readers recognise a stamp. */
export const STAMP_PDF_NAMES: Record<StampId, string> = {
  approved: 'Approved',
  confidential: 'Confidential',
  draft: 'Draft',
  reviewed: 'Reviewed',
  void: 'Void',
  final: 'Final',
};

/** i18n key for the word drawn on the stamp. */
export const STAMP_LABEL_KEYS: Record<StampId, string> = {
  approved: 'stampApproved',
  confidential: 'stampConfidential',
  draft: 'stampDraft',
  reviewed: 'stampReviewed',
  void: 'stampVoid',
  final: 'stampFinal',
};

/** Replies read back from storage, dropping anything that is not a complete message. */
function parseReplies(value: unknown): AnnotReply[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: AnnotReply[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const author = typeof (entry as { author?: unknown }).author === 'string' ? (entry as { author: string }).author : '';
    const text = typeof (entry as { text?: unknown }).text === 'string' ? (entry as { text: string }).text : '';
    const at = typeof (entry as { at?: unknown }).at === 'number' ? (entry as { at: number }).at : 0;
    if (text === '') continue;
    out.push({ author, text, at });
  }
  return out.length > 0 ? out : undefined;
}

export function isStampId(value: unknown): value is StampId {
  return typeof value === 'string' && (STAMP_IDS as readonly string[]).includes(value);
}

export interface AnnotRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface AnnotPoint {
  x: number;
  y: number;
}

export interface Annotation {
  id: string;
  page: number;
  kind: AnnotKind;
  color: string;
  createdAt: number;
  updatedAt: number;
  author: string;
  /** Text markup: one rectangle per selected line. */
  rects?: AnnotRect[];
  /** The text the markup covers, kept so the panel can show it. */
  text?: string;
  /** Freehand: polylines in page space. */
  strokes?: AnnotPoint[][];
  /** Rectangle markup and note anchor. */
  rect?: AnnotRect;
  /** Sticky-note body. */
  note?: string;
  /** Which standard stamp this is, for `stamp` annotations. */
  stampId?: StampId | undefined;
  /** Replies in the annotation's thread, oldest first. */
  replies?: AnnotReply[] | undefined;
  /**
   * Text size in **page-space units**, so a text box keeps its proportions when
   * the view is zoomed instead of drifting out of its own frame.
   */
  fontSize?: number;
  /** Border width in page-space units, so it scales with the view like the text. */
  strokeWidth?: number;
  /** Dashed rather than solid border. */
  strokeDash?: boolean;
  /**
   * Follow the text rather than a size the reader chose.
   *
   * True for a box made by clicking; a box the reader dragged out, or resized by
   * hand, sets it false so their size is never overwritten.
   */
  autoFit?: boolean;
}

export const DEFAULT_COLORS: Record<AnnotKind, string> = {
  highlight: '#ffd400',
  underline: '#2f6bd8',
  strikeout: '#e0342f',
  ink: '#e0342f',
  note: '#f0b429',
  rect: '#2f6bd8',
  ellipse: '#2f6bd8',
  arrow: '#e0342f',
  textbox: '#2f6bd8',
  callout: '#f0b429',
  'measure-distance': '#e0342f',
  'measure-perimeter': '#2f6bd8',
  stamp: 'annotStamp',
  'measure-area': '#1f9d55',
};

/** Palette offered in the annotation toolbar. */
/**
 * Preset colours offered in the annotation toolbar.
 *
 * Ordered the way a reader reaches for them: the neutrals and the four common
 * markup colours first, then the wider set.
 */
export const PALETTE = [
  '#000000',
  '#e0342f',
  '#f2711c',
  '#f0b429',
  '#ffd400',
  '#1f9d55',
  '#7bd88f',
  '#2f6bd8',
  '#7cc4ff',
  '#7c4dff',
  '#ff9db1',
  '#ffffff',
];

// ------------------------------------------------------------------ geometry

export interface ScreenRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Maps an unrotated page-space rectangle onto the displayed page.
 *
 * `pageWidth`/`pageHeight` are the **unrotated** page dimensions at scale 1; the
 * caller multiplies by the current scale through `scale`.
 */
export function toScreen(rect: AnnotRect, rotation: number, pageWidth: number, pageHeight: number, scale: number): ScreenRect {
  const r = ((Math.round(rotation / 90) % 4) + 4) % 4;
  let x = rect.x;
  let y = rect.y;
  let w = rect.w;
  let h = rect.h;
  if (r === 1) {
    x = pageHeight - rect.y - rect.h;
    y = rect.x;
    w = rect.h;
    h = rect.w;
  } else if (r === 2) {
    x = pageWidth - rect.x - rect.w;
    y = pageHeight - rect.y - rect.h;
  } else if (r === 3) {
    x = rect.y;
    y = pageWidth - rect.x - rect.w;
    w = rect.h;
    h = rect.w;
  }
  return { left: x * scale, top: y * scale, width: w * scale, height: h * scale };
}

/** Inverse of {@link toScreen}: displayed page space back to unrotated page space. */
export function fromScreen(rect: AnnotRect, rotation: number, pageWidth: number, pageHeight: number, scale: number): AnnotRect {
  const r = ((Math.round(rotation / 90) % 4) + 4) % 4;
  const sx = rect.x / scale;
  const sy = rect.y / scale;
  const sw = rect.w / scale;
  const sh = rect.h / scale;
  if (r === 1) {
    // displayed (sx, sy, sw, sh) where sw = h and sh = w
    return { x: sy, y: pageHeight - sx - sw, w: sh, h: sw };
  }
  if (r === 2) {
    return { x: pageWidth - sx - sw, y: pageHeight - sy - sh, w: sw, h: sh };
  }
  if (r === 3) {
    // displayed sw = h, sh = w
    return { x: pageWidth - sy - sh, y: sx, w: sh, h: sw };
  }
  return { x: sx, y: sy, w: sw, h: sh };
}

export function rectsIntersect(a: AnnotRect, b: AnnotRect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

// -------------------------------------------------------------------- store

export type StoreListener = () => void;

let sequence = 0;
function newId(): string {
  sequence += 1;
  return `a${Date.now().toString(36)}${sequence.toString(36)}`;
}

export class AnnotationStore {
  /**
   * Who new annotations are attributed to.
   *
   * A field on the store rather than a parameter on every call: the reader sets it once
   * in the settings, and every tool that creates an annotation would otherwise have to
   * thread it through.
   */
  defaultAuthor = 'local';
  private items: Annotation[] = [];
  private listeners = new Set<StoreListener>();
  private dirtyFlag = false;

  get all(): readonly Annotation[] {
    return this.items;
  }

  get count(): number {
    return this.items.length;
  }

  get dirty(): boolean {
    return this.dirtyFlag;
  }

  onChange(listener: StoreListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }

  /** Replaces the contents, e.g. after loading a sidecar. */
  load(items: Annotation[], markClean = true): void {
    this.items = items.slice().sort((a, b) => a.page - b.page || a.createdAt - b.createdAt);
    this.dirtyFlag = !markClean;
    this.emit();
  }

  markSaved(): void {
    this.dirtyFlag = false;
    this.emit();
  }

  add(annotation: Omit<Annotation, 'id' | 'createdAt' | 'updatedAt' | 'author'> & Partial<Pick<Annotation, 'id' | 'author'>>): Annotation {
    const now = Date.now();
    const full: Annotation = {
      id: annotation.id ?? newId(),
      page: annotation.page,
      kind: annotation.kind,
      color: annotation.color,
      createdAt: now,
      updatedAt: now,
      author: annotation.author || this.defaultAuthor,
      ...(annotation.rects ? { rects: annotation.rects } : {}),
      ...(annotation.text !== undefined ? { text: annotation.text } : {}),
      ...(annotation.strokes ? { strokes: annotation.strokes } : {}),
      ...(annotation.rect ? { rect: annotation.rect } : {}),
      ...(annotation.note !== undefined ? { note: annotation.note } : {}),
        // These were being dropped here, so a size or line style chosen before
        // creating an annotation never reached it.
        ...(annotation.fontSize !== undefined ? { fontSize: annotation.fontSize } : {}),
        ...(annotation.strokeWidth !== undefined ? { strokeWidth: annotation.strokeWidth } : {}),
        ...(annotation.strokeDash !== undefined ? { strokeDash: annotation.strokeDash } : {}),
        ...(annotation.autoFit !== undefined ? { autoFit: annotation.autoFit } : {}),
        ...(annotation.stampId !== undefined ? { stampId: annotation.stampId } : {}),
        ...(annotation.replies && annotation.replies.length > 0 ? { replies: annotation.replies } : {}),
    };
    this.items.push(full);
    this.items.sort((a, b) => a.page - b.page || a.createdAt - b.createdAt);
    this.dirtyFlag = true;
    this.emit();
    return full;
  }

  update(
    id: string,
    patch: Partial<
      Pick<
        Annotation,
        'color' | 'note' | 'strokeWidth' | 'strokeDash' | 'fontSize' | 'autoFit' | 'replies'
      >
    >,
  ): boolean {
    const item = this.items.find((a) => a.id === id);
    if (!item) return false;
    if (patch.color !== undefined) item.color = patch.color;
    if (patch.note !== undefined) item.note = patch.note;
    if (patch.strokeWidth !== undefined) item.strokeWidth = patch.strokeWidth;
    if (patch.strokeDash !== undefined) item.strokeDash = patch.strokeDash;
    if (patch.fontSize !== undefined) item.fontSize = patch.fontSize;
    if (patch.autoFit !== undefined) item.autoFit = patch.autoFit;
    if (patch.replies !== undefined) item.replies = patch.replies;
    item.updatedAt = Date.now();
    this.dirtyFlag = true;
    this.emit();
    return true;
  }

  remove(id: string): boolean {
    const before = this.items.length;
    this.items = this.items.filter((a) => a.id !== id);
    if (this.items.length === before) return false;
    this.dirtyFlag = true;
    this.emit();
    return true;
  }

  /** Removes every annotation on a page; returns how many were removed. */
  clearPage(page: number): number {
    const before = this.items.length;
    this.items = this.items.filter((a) => a.page !== page);
    const removed = before - this.items.length;
    if (removed > 0) {
      this.dirtyFlag = true;
      this.emit();
    }
    return removed;
  }

  clear(): void {
    if (this.items.length === 0) return;
    this.items = [];
    this.dirtyFlag = true;
    this.emit();
  }

  byPage(page: number): Annotation[] {
    return this.items.filter((a) => a.page === page);
  }

  byId(id: string): Annotation | null {
    return this.items.find((a) => a.id === id) ?? null;
  }

  /** Replaces one annotation's geometry, used while dragging a selection. */
  setGeometry(id: string, geometry: { rect?: AnnotRect; rects?: AnnotRect[]; strokes?: AnnotPoint[][] }): boolean {
    const item = this.items.find((a) => a.id === id);
    if (!item) return false;
    if (geometry.rect) item.rect = geometry.rect;
    if (geometry.rects) item.rects = geometry.rects;
    if (geometry.strokes) item.strokes = geometry.strokes;
    item.updatedAt = Date.now();
    this.dirtyFlag = true;
    return true;
  }

  /** Updates the free-text body and optional size of a text annotation. */
  setText(id: string, note: string, fontSize?: number): boolean {
    const item = this.items.find((a) => a.id === id);
    if (!item) return false;
    item.note = note;
    if (fontSize !== undefined) item.fontSize = fontSize;
    item.updatedAt = Date.now();
    this.dirtyFlag = true;
    this.emit();
    return true;
  }

  /** Innermost annotation containing a page-space point, for hit testing. */
  hitTest(page: number, point: AnnotPoint): Annotation | null {
    const candidates = this.byPage(page);
    for (let i = candidates.length - 1; i >= 0; i--) {
      const item = candidates[i];
      if (!item) continue;
      if (item.rect && point.x >= item.rect.x && point.x <= item.rect.x + item.rect.w && point.y >= item.rect.y && point.y <= item.rect.y + item.rect.h) {
        return item;
      }
      for (const rect of item.rects ?? []) {
        if (point.x >= rect.x && point.x <= rect.x + rect.w && point.y >= rect.y && point.y <= rect.y + rect.h) return item;
      }
      for (const stroke of item.strokes ?? []) {
        for (const p of stroke) {
          if (Math.abs(p.x - point.x) < 6 && Math.abs(p.y - point.y) < 6) return item;
        }
      }
    }
    return null;
  }

  toJSON(): { version: number; annotations: Annotation[] } {
    return { version: 1, annotations: this.items.map((a) => ({ ...a })) };
  }

  /** Counts per kind, for the panel summary. */
  summary(): Record<AnnotKind, number> {
    const out = Object.fromEntries(ANNOT_KINDS.map((kind) => [kind, 0])) as Record<AnnotKind, number>;
    for (const item of this.items) out[item.kind] += 1;
    return out;
  }
}

// --------------------------------------------------------------- validation

export interface ValidationOutcome {
  items: Annotation[];
  issues: string[];
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function readRect(value: unknown): AnnotRect | null {
  if (!value || typeof value !== 'object') return null;
  const r = value as Record<string, unknown>;
  if (!isFiniteNumber(r['x']) || !isFiniteNumber(r['y']) || !isFiniteNumber(r['w']) || !isFiniteNumber(r['h'])) return null;
  return { x: r['x'], y: r['y'], w: r['w'], h: r['h'] };
}

/**
 * Validates untrusted annotation data (a sidecar or an imported JSON file).
 * Unknown kinds and malformed geometry are reported rather than silently dropped.
 */
export function parseAnnotations(input: unknown, pageCount?: number): ValidationOutcome {
  const issues: string[] = [];
  const items: Annotation[] = [];
  const raw = Array.isArray(input) ? input : (input as { annotations?: unknown })?.annotations;
  if (!Array.isArray(raw)) return { items, issues: ['根节点不是数组，也没有 annotations 数组'] };

  raw.forEach((entry, index) => {
    const path = `[${index}]`;
    if (!entry || typeof entry !== 'object') {
      issues.push(`${path} 不是对象`);
      return;
    }
    const a = entry as Record<string, unknown>;
    const kind = a['kind'];
    if (typeof kind !== 'string' || !(ANNOT_KINDS as readonly string[]).includes(kind)) {
      issues.push(`${path}.kind 不是已知类型: ${String(kind)}`);
      return;
    }
    if (!isFiniteNumber(a['page']) || a['page'] < 1) {
      issues.push(`${path}.page 非法`);
      return;
    }
    if (pageCount !== undefined && a['page'] > pageCount) {
      issues.push(`${path}.page=${a['page']} 超出文档页数 ${pageCount}`);
      return;
    }
    const rects = Array.isArray(a['rects']) ? a['rects'].map(readRect).filter((r): r is AnnotRect => r !== null) : undefined;
    const rect = readRect(a['rect']) ?? undefined;
    const strokes = Array.isArray(a['strokes'])
      ? (a['strokes'] as unknown[])
          .map((s) =>
            Array.isArray(s)
              ? (s as unknown[])
                  .map((p) => {
                    if (!p || typeof p !== 'object') return null;
                    const q = p as Record<string, unknown>;
                    return isFiniteNumber(q['x']) && isFiniteNumber(q['y']) ? { x: q['x'], y: q['y'] } : null;
                  })
                  .filter((p): p is AnnotPoint => p !== null)
              : [],
          )
          .filter((s) => s.length > 0)
      : undefined;

    const hasGeometry = (rects && rects.length > 0) || rect || (strokes && strokes.length > 0);
    if (!hasGeometry) {
      issues.push(`${path} 没有任何几何数据`);
      return;
    }

    const id = typeof a['id'] === 'string' && a['id'].length > 0 ? a['id'] : newId();
    const now = Date.now();
    items.push({
      id,
      page: a['page'],
      kind: kind as AnnotKind,
      color: typeof a['color'] === 'string' ? a['color'] : DEFAULT_COLORS[kind as AnnotKind],
      createdAt: isFiniteNumber(a['createdAt']) ? a['createdAt'] : now,
      updatedAt: isFiniteNumber(a['updatedAt']) ? a['updatedAt'] : now,
      author: typeof a['author'] === 'string' ? a['author'] : 'unknown',
    stampId: isStampId(a['stampId']) ? a['stampId'] : undefined,
    replies: parseReplies(a['replies']),
      ...(rects ? { rects } : {}),
      ...(typeof a['text'] === 'string' ? { text: a['text'] } : {}),
      ...(strokes ? { strokes } : {}),
      ...(rect ? { rect } : {}),
      ...(typeof a['note'] === 'string' ? { note: a['note'] } : {}),
      ...(isFiniteNumber(a['fontSize']) && a['fontSize'] > 0 ? { fontSize: a['fontSize'] } : {}),
      ...(isFiniteNumber(a['strokeWidth']) && a['strokeWidth'] > 0 ? { strokeWidth: a['strokeWidth'] } : {}),
      ...(a['strokeDash'] === true ? { strokeDash: true } : {}),
      ...(a['autoFit'] === false ? { autoFit: false } : {}),
    });
  });

  return { items, issues };
}
