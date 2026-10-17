/**
 * Annotation layer.
 *
 * Owns two things: the overlay that paints annotations onto each page, and the
 * pointer gestures that create them. Pointer handling lives here rather than in the
 * tool manager because the gestures differ per kind — text markup consumes a
 * selection, ink and rectangles drag out geometry, and a note is a single click.
 *
 * Overlays are siblings of the text layer inside the page element and are
 * positioned in **displayed page pixels**, converted from the unrotated page space
 * the model stores through `toScreen`.
 */
import {
  DEFAULT_COLORS,
  fromScreen,
  toScreen,
  type AnnotKind,
  type AnnotPoint,
  type AnnotRect,
  type Annotation,
  type AnnotationStore,
  DEFAULT_STAMP,
  STAMP_COLORS,
  type StampId,
} from './model.js';
import { distance, formatArea, formatLength, polygonArea, polylineLength, type MeasureUnit } from '../tools/measure.js';

/** Tools that act on a text selection rather than on dragged geometry. */
export const TEXT_MARKUP_KINDS: readonly AnnotKind[] = ['highlight', 'underline', 'strikeout', 'replace'];

export interface PageGeometry {
  pageNumber: number;
  element: HTMLElement;
  /** Unrotated page size at scale 1. */
  pageWidth: number;
  pageHeight: number;
  scale: number;
  rotation: number;
}

export interface AnnotationLayerOptions {
  /** Element the overlays are appended to is per page; this is the scroll host. */
  scroll: HTMLElement;
  store: AnnotationStore;
  /** Supplies geometry, or null when a page is not laid out yet. */
  geometryFor(pageNumber: number): PageGeometry | null;
  /** Page under a viewport point, or null. */
  pageAtPoint(clientX: number, clientY: number): number | null;
  /** Current tool name; only annotation tools activate gestures. */
  currentTool(): string;
  /** Which standard stamp a click places. */
  currentStamp?: () => StampId;
  /** Called after a replacement mark is made, to collect its substitute text. */
  onReplaceCreated?: (item: Annotation) => void;
  /** The word drawn on a stamp of the given kind. */
  stampLabel?: (stamp: StampId) => string;
  onStatus(text: string, isError?: boolean): void;
  /** Fired when annotations change so the panel and title can update. */
  onChanged(): void;
  /**
   * Fired after an annotation is created. The host returns to the pointer tool so
   * the new annotation can be adjusted straight away.
   */
  onCreated(): void;
  /** Fired when the selected annotation changes, including to null. */
  onSelectionChange(id: string | null): void;
  /** Page-space measurements need the page's own scale and the user's unit. */
  measure: {
    userUnit(page: number): number;
    unit(): MeasureUnit;
  };
  /** Tooltip for the selection bar's delete button. */
  deleteLabel(): string;
  /** Reserved for hosts that still prefer a modal; unused by the built-in tools. */
  promptNote(): Promise<string | null>;
}

const KIND_BY_TOOL: Record<string, AnnotKind> = {
  highlight: 'highlight',
  underline: 'underline',
  strikeout: 'strikeout',
  replace: 'replace',
  ink: 'ink',
  note: 'note',
    stamp: 'stamp',
  rect: 'rect',
  ellipse: 'ellipse',
  arrow: 'arrow',
  textbox: 'textbox',
  callout: 'callout',
  'measure-distance': 'measure-distance',
  'measure-perimeter': 'measure-perimeter',
  'measure-area': 'measure-area',
};

/** Kinds dragged out as a bounding box rather than drawn point by point. */
const BOX_KINDS: ReadonlySet<AnnotKind> = new Set<AnnotKind>(['rect', 'ellipse', 'arrow', 'textbox', 'callout']);

/** Kinds that ask for text once the geometry exists. */
const TEXT_KINDS: ReadonlySet<AnnotKind> = new Set<AnnotKind>(['textbox', 'callout']);

/** Tooltip for the corner grip, set from the language pack by the host. */
let i18nResizeHint = '拖动调整大小';

/** Width and height change for a corner drag, clamped to a usable minimum. */
function biggerThan(rect: AnnotRect, dx: number, dy: number): AnnotRect {
  return { x: rect.x, y: rect.y, w: Math.max(40, rect.w + dx), h: Math.max(20, rect.h + dy) };
}

/** Measurements. Distance is a two-point line; the other two are dragged rectangles. */
const MEASURE_KINDS: ReadonlySet<AnnotKind> = new Set<AnnotKind>(['measure-distance', 'measure-perimeter', 'measure-area']);
const RECT_MEASURE_KINDS: ReadonlySet<AnnotKind> = new Set<AnnotKind>(['measure-perimeter', 'measure-area']);

export function annotationKindForTool(tool: string): AnnotKind | null {
  return KIND_BY_TOOL[tool] ?? null;
}

export function isTextMarkupKind(kind: AnnotKind): boolean {
  return TEXT_MARKUP_KINDS.includes(kind);
}

/** Formats a colour with an alpha channel for overlay painting. */
function withAlpha(color: string, alpha: number): string {
  const hex = color.replace('#', '');
  if (hex.length !== 6) return color;
  const r = Number.parseInt(hex.slice(0, 2), 16);
  const g = Number.parseInt(hex.slice(2, 4), 16);
  const b = Number.parseInt(hex.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export class AnnotationLayer {
  private store: AnnotationStore;
  private readonly options: AnnotationLayerOptions;
  private readonly overlays = new Map<number, HTMLDivElement>();
  /** Form-field rectangles by page, from the document that was opened. */
  private formFields = new Map<number, AnnotRect[]>();
  /** Whether those rectangles are painted. */
  private fieldsVisible = false;
  private selectedId: string | null = null;

  private gesture: { kind: AnnotKind; page: number; start: AnnotPoint; points: AnnotPoint[] } | null = null;
  private preview: HTMLDivElement | null = null;
  private selectionBar: HTMLDivElement | null = null;
  /** Stroke applied to newly created shapes; mirrored from the toolbar. */
  private activeStrokeWidth = 1.5;
  private activeStrokeDash = false;
  /** Page-space text size applied to new text and mirrored onto a selection. */
  private activeFontSize = 12;
  /** Live corner-resize of a text box. */
  private resize: { id: string; page: number; startX: number; startY: number; rect: AnnotRect } | null = null;
  /** Active move gesture: the geometry captured when the drag began. */
  private drag: {
    id: string;
    page: number;
    start: AnnotPoint;
    moved: boolean;
    rect?: AnnotRect;
    rects?: AnnotRect[];
    strokes?: AnnotPoint[][];
  } | null = null;
  private activeColor: string | null = null;

  constructor(options: AnnotationLayerOptions) {
    this.options = options;
    this.store = options.store;
    options.scroll.addEventListener('pointerdown', this.onPointerDown, true);
    options.scroll.addEventListener('pointermove', this.onPointerMove, true);
    options.scroll.addEventListener('pointerup', this.onPointerUp, true);
    options.scroll.addEventListener('pointercancel', this.onPointerUp, true);
    options.scroll.addEventListener('dblclick', this.onDoubleClick, true);
  }

  get selected(): string | null {
    return this.selectedId;
  }

  /** Points the layer at another document's annotations, as a tab switch requires. */
  setStore(store: AnnotationStore): void {
    this.reset();
    this.store = store;
    this.refreshAll();
  }

  setFontSize(size: number): void {
    this.activeFontSize = size;
  }

  /** Applies a text size, re-fitting any box that follows its content. */
  applyFontSizeToSelection(size: number): boolean {
    const id = this.selectedId;
    if (!id) return false;
    const item = this.store.byId(id);
    if (!item || !TEXT_KINDS.has(item.kind)) return false;
    if (!this.store.update(id, { fontSize: size })) return false;
    const updated = this.store.byId(id);
    if (updated) this.refitIfAuto(updated);
    this.afterChange();
    return true;
  }

  setStroke(width: number, dash: boolean): void {
    this.activeStrokeWidth = width;
    this.activeStrokeDash = dash;
  }

  /** Updates the selected annotation, or the defaults when nothing is selected. */
  applyColorToSelection(color: string): boolean {
    const id = this.selectedId;
    if (!id) return false;
    const changed = this.store.update(id, { color });
    if (changed) this.afterChange();
    return changed;
  }

  applyStrokeToSelection(width: number, dash: boolean): boolean {
    const id = this.selectedId;
    if (!id) return false;
    const changed = this.store.update(id, { strokeWidth: width, strokeDash: dash });
    if (changed) this.afterChange();
    return changed;
  }

  setActiveColor(color: string | null): void {
    this.activeColor = color;
  }

  get color(): string | null {
    return this.activeColor;
  }

  select(id: string | null): void {
    if (this.selectedId === id) return;
    this.selectedId = id;
    this.refreshAll();
    this.options.onSelectionChange(id);
  }

  /** Deletes whatever is selected; used by the Delete key and the menu. */
  removeSelected(): boolean {
    const id = this.selectedId;
    if (!id) return false;
    const removed = this.store.remove(id);
    if (removed) {
      this.selectedId = null;
      this.options.onSelectionChange(null);
    }
    return removed;
  }

  // -------------------------------------------------------------- overlays

  private overlayFor(page: number, element: HTMLElement): HTMLDivElement {
    const existing = this.overlays.get(page);
    if (existing && existing.parentElement === element) return existing;
    existing?.remove();
    const overlay = document.createElement('div');
    overlay.className = 'annot-overlay';
    overlay.dataset['page'] = String(page);
    element.appendChild(overlay);
    this.overlays.set(page, overlay);
    return overlay;
  }

  /** Repaints one page. Cheap when the page has no annotations and no selection. */
  renderPage(page: number): void {
    const geometry = this.options.geometryFor(page);
    if (!geometry) return;
    const overlay = this.overlayFor(page, geometry.element);
    const items = this.store.byPage(page);
    const pageWidth = geometry.element.clientWidth || geometry.pageWidth * geometry.scale;

    const fieldCount = this.fieldsVisible ? (this.formFields.get(page)?.length ?? 0) : 0;
    if (items.length === 0 && overlay.childElementCount === 0 && fieldCount === 0) {
      overlay.style.width = `${pageWidth}px`;
      return;
    }

    overlay.replaceChildren();
    overlay.style.width = `${pageWidth}px`;
    overlay.style.height = `${geometry.element.clientHeight}px`;

    for (const item of items) this.paintAnnotation(overlay, item, geometry);

    // Drawn after the annotations so a field is never hidden by a highlight sitting on
    // top of it. The node takes no pointer events, so it cannot swallow a gesture.
    if (this.fieldsVisible) this.paintFormFields(overlay, page, geometry);
  }

  /** Paints the form-field rectangles for one page. */
  private paintFormFields(overlay: HTMLDivElement, page: number, geometry: PageGeometry): void {
    const rects = this.formFields.get(page);
    if (!rects) return;
    const { rotation, pageWidth, pageHeight, scale } = geometry;
    for (const rect of rects) {
      const s = toScreen(rect, rotation, pageWidth, pageHeight, scale);
      const node = document.createElement('div');
      node.className = 'form-field';
      node.style.left = `${s.left}px`;
      node.style.top = `${s.top}px`;
      node.style.width = `${s.width}px`;
      node.style.height = `${s.height}px`;
      node.dataset['field'] = 'true';
      overlay.appendChild(node);
    }
  }

  /**
   * Replaces the form-field rectangles and repaints.
   *
   * Painting them here rather than in a layer of their own is deliberate: this overlay
   * already handles rotation, zoom and virtualisation, and a second one would have to
   * re-derive all three.
   */
  setFormFields(fields: ReadonlyArray<{ page: number; rect: AnnotRect }>, visible: boolean): void {
    this.formFields = new Map();
    for (const field of fields) {
      const list = this.formFields.get(field.page);
      if (list) list.push(field.rect);
      else this.formFields.set(field.page, [field.rect]);
    }
    this.fieldsVisible = visible;
    this.refreshAll();
  }

  /** Turns the field highlighting on or off without re-reading the document. */
  setFormFieldsVisible(visible: boolean): void {
    if (this.fieldsVisible === visible) return;
    this.fieldsVisible = visible;
    this.refreshAll();
  }

  /** Repaints every page that currently has an overlay. */
  refreshAll(): void {
    this.selectionBar?.remove();
    this.selectionBar = null;
    for (const page of [...this.overlays.keys()]) this.renderPage(page);
    for (const page of new Set(this.store.all.map((a) => a.page))) this.renderPage(page);
    // Pages that only carry form fields have no annotations to bring them in, so they
    // are named here or their overlay is never created.
    for (const page of this.fieldsVisible ? this.formFields.keys() : []) this.renderPage(page);
    const selected = this.selectedId ? this.store.byId(this.selectedId) : null;
    if (selected) {
      const overlay = this.overlays.get(selected.page);
      const geometry = this.options.geometryFor(selected.page);
      if (overlay && geometry) this.paintSelectionFrame(overlay, selected, geometry);
    }
    this.paintSelectionBar();
  }

  /** Drops overlays for pages that no longer exist (a new document was opened). */
  reset(): void {
    for (const overlay of this.overlays.values()) overlay.remove();
    this.overlays.clear();
    this.selectedId = null;
    this.cancelGesture();
  }

  private paintAnnotation(overlay: HTMLDivElement, item: Annotation, geometry: PageGeometry): void {
    const { rotation, pageWidth, pageHeight, scale } = geometry;
    const selected = item.id === this.selectedId;
    const node = document.createElement('div');
    node.className = `annot annot-${item.kind}${selected ? ' selected' : ''}`;
    node.dataset['annotId'] = item.id;
    node.title = item.kind;

    // Border width is a page-space quantity, so it thickens with the zoom.
    const strokePx = (item.strokeWidth ?? 1.5) * scale;

    const place = (rect: AnnotRect): void => {
      const s = toScreen(rect, rotation, pageWidth, pageHeight, scale);
      const part = document.createElement('div');
      part.className = 'annot-part';
      part.style.left = `${s.left}px`;
      part.style.top = `${s.top}px`;
      part.style.width = `${s.width}px`;
      part.style.height = `${s.height}px`;
      if (item.kind === 'highlight') {
        part.style.background = withAlpha(item.color, 0.38);
        part.style.mixBlendMode = 'multiply';
      } else if (item.kind === 'underline') {
        part.style.borderBottom = `${strokePx}px ${item.strokeDash ? 'dashed' : 'solid'} ${item.color}`;
      } else if (item.kind === 'strikeout') {
        part.style.borderTop = `${strokePx}px ${item.strokeDash ? 'dashed' : 'solid'} ${item.color}`;
      } else if (item.kind === 'replace') {
        // Dashed, so a replacement reads differently from a plain strikeout at a glance.
        part.style.borderTop = `${strokePx}px dashed ${item.color}`;
        part.style.background = withAlpha(item.color, 0.1);
      } else if (item.kind === 'rect' || item.kind === 'ellipse') {
        part.style.border = `${strokePx}px ${item.strokeDash ? 'dashed' : 'solid'} ${item.color}`;
        part.style.borderRadius = item.kind === 'ellipse' ? '50%' : '0';
        part.style.background = withAlpha(item.color, 0.08);
      } else if (item.kind === 'textbox' || item.kind === 'callout') {
        part.style.border = `${strokePx}px ${item.strokeDash ? 'dashed' : 'solid'} ${item.color}`;
        part.style.background = 'rgba(255,255,255,0.92)';
        part.style.color = '#1f2937';
        part.style.padding = `${2 * scale}px ${4 * scale}px`;
        part.style.overflow = 'visible';
        part.style.whiteSpace = 'pre-wrap';
        part.style.lineHeight = '1.25';
        part.style.fontSize = `${(item.fontSize ?? 12) * scale}px`;
        if (item.note) part.textContent = item.note;
      } else if (item.kind === 'note') {
        part.style.background = item.color;
        part.style.borderRadius = '3px';
        part.style.boxShadow = '0 1px 3px rgba(0,0,0,0.4)';
      } else if (item.kind === 'stamp') {
        // Two rules and centred lettering: the shape readers recognise as a stamp.
        part.style.border = `${Math.max(1, strokePx)}px solid ${item.color}`;
        part.style.outline = `${Math.max(1, strokePx * 0.6)}px solid ${item.color}`;
        part.style.outlineOffset = `${Math.max(1, strokePx * 1.4)}px`;
        part.style.borderRadius = '4px';
        part.style.background = withAlpha(item.color, 0.08);
        part.style.color = item.color;
        part.style.display = 'flex';
        part.style.alignItems = 'center';
        part.style.justifyContent = 'center';
        part.style.textAlign = 'center';
        part.style.fontWeight = '700';
        part.style.letterSpacing = `${0.5 * scale}px`;
        part.style.textTransform = 'uppercase';
        part.style.fontSize = `${Math.max(7, (item.fontSize ?? 15) * scale)}px`;
        part.style.overflow = 'hidden';
        part.textContent = item.note ?? '';
      }
      node.appendChild(part);
    };

    if (item.rect) place(item.rect);
    for (const rect of item.rects ?? []) place(rect);

    if (MEASURE_KINDS.has(item.kind)) {
      this.paintMeasurement(node, item, geometry);
    } else if (item.strokes && item.strokes.length > 0) {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('class', 'annot-ink');
      svg.setAttribute('width', '100%');
      svg.setAttribute('height', '100%');
      for (const stroke of item.strokes) {
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        const points = stroke.map((p) => {
          const s = toScreen({ x: p.x, y: p.y, w: 0, h: 0 }, rotation, pageWidth, pageHeight, scale);
          return `${s.left.toFixed(1)},${s.top.toFixed(1)}`;
        });
        path.setAttribute('d', `M ${points.join(' L ')}`);
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke', item.color);
        path.setAttribute('stroke-width', '2');
        path.setAttribute('stroke-linecap', 'round');
        path.setAttribute('stroke-linejoin', 'round');
        svg.appendChild(path);
      }
      node.appendChild(svg);
    }

    overlay.appendChild(node);
  }

  /** Text for a measurement, in the unit the reader chose. */
  private measureLabel(item: Annotation, page: number): string {
    const points = item.strokes?.[0] ?? [];
    if (points.length < 2) return '';
    const userUnit = this.options.measure.userUnit(page);
    const unit: MeasureUnit = this.options.measure.unit();
    if (item.kind === 'measure-distance') {
      const [a, b] = points;
      return a && b ? formatLength(distance(a, b), userUnit, unit) : '';
    }
    if (item.kind === 'measure-perimeter') {
      const first = points[0];
      const last = points[points.length - 1];
      const total = polylineLength(points) + (first && last ? distance(last, first) : 0);
      return formatLength(total, userUnit, unit);
    }
    return formatArea(polygonArea(points), userUnit, unit);
  }

  /** Draws a measurement: its outline plus the value next to it. */
  private paintMeasurement(node: HTMLDivElement, item: Annotation, geometry: PageGeometry): void {
    const { rotation, pageWidth, pageHeight, scale } = geometry;
    const points = item.strokes?.[0] ?? [];
    if (points.length < 2) return;
    const screen = points.map((p) =>
      toScreen({ x: p.x, y: p.y, w: 0, h: 0 }, rotation, pageWidth, pageHeight, scale),
    );

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'annot-ink');
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', '100%');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    const d = screen.map((s, i) => `${i === 0 ? 'M' : 'L'} ${s.left.toFixed(1)},${s.top.toFixed(1)}`).join(' ');
    const closed = item.kind !== 'measure-distance';
    path.setAttribute('d', closed ? `${d} Z` : d);
    path.setAttribute('fill', item.kind === 'measure-area' ? withAlpha(item.color, 0.18) : 'none');
    path.setAttribute('stroke', item.color);
    path.setAttribute('stroke-width', String((item.strokeWidth ?? 2) * scale));
    path.setAttribute('stroke-linejoin', 'round');
    if (item.strokeDash === true) path.setAttribute('stroke-dasharray', `${4 * scale} ${3 * scale}`);
    svg.appendChild(path);
    node.appendChild(svg);

    // Anchor the value at the shape's centre so it reads as belonging to it.
    const xs = screen.map((s) => s.left + s.width / 2);
    const ys = screen.map((s) => s.top + s.height / 2);
    const cx = xs.reduce((a, b) => a + b, 0) / xs.length;
    const cy = ys.reduce((a, b) => a + b, 0) / ys.length;
    const label = document.createElement('div');
    label.className = 'annot-measure-label';
    label.dataset['annotId'] = item.id;
    label.textContent = this.measureLabel(item, item.page);
    label.style.left = `${cx}px`;
    label.style.top = `${cy}px`;
    label.style.borderColor = item.color;
    node.appendChild(label);
  }

  /**
   * Measures text the way the browser will lay it out.
   *
   * The probe is a real element inside the page, so it inherits the page's font and
   * the box's own size; estimating from character widths is wrong for CJK text,
   * where a glyph is about twice as wide as the Latin average.
   *
   * Returns page-space width and height.
   */
  private measureText(text: string, fontSize: number, maxWidth: number): { w: number; h: number } {
    const host = this.overlays.values().next().value as HTMLDivElement | undefined;
    const lineHeight = fontSize * 1.35;
    if (!host) return { w: maxWidth, h: lineHeight };
    const probe = document.createElement('div');
    probe.className = 'annot-probe';
    probe.style.fontSize = `${fontSize}px`;
    probe.textContent = text;
    host.appendChild(probe);
    // `pre` honours the reader's newlines without wrapping, giving the natural size.
    probe.style.whiteSpace = 'pre';
    probe.style.width = 'auto';
    const naturalWidth = probe.offsetWidth;
    const naturalHeight = probe.offsetHeight;
    if (naturalWidth <= maxWidth) {
      probe.remove();
      return { w: naturalWidth, h: naturalHeight };
    }
    // Too wide: wrap it and keep the widest allowed column.
    probe.style.whiteSpace = 'pre-wrap';
    probe.style.width = `${maxWidth}px`;
    const wrappedHeight = probe.offsetHeight;
    probe.remove();
    return { w: maxWidth, h: wrappedHeight };
  }

  /**
   * Shrinks or grows a box to the envelope of its text.
   *
   * Only boxes that follow their content are touched, so a size the reader dragged
   * out is never overwritten.
   */
  private refitIfAuto(item: Annotation): void {
    if (item.autoFit !== true) return;
    const rect = item.rect;
    const geometry = this.options.geometryFor(item.page);
    if (!rect || !geometry) return;
    const text = item.note ?? '';
    const fontSize = item.fontSize ?? 12;
    const margin = 8;
    const padding = 10;
    const maxWidth = Math.max(60, geometry.pageWidth - margin * 2 - padding * 2);
    if (text.trim().length === 0) return;
    // The probe is measured at the on-screen size, so the result has to be divided
    // back down before it is stored. Measuring at the page-space size and then
    // dividing by the scale made every box about half as wide as its text.
    const scale = geometry.scale;
    const size = this.measureText(text, fontSize * scale, maxWidth * scale);
    const w = size.w / scale + padding * 2;
    const h = size.h / scale + padding;
    const x = Math.max(margin, Math.min(rect.x, geometry.pageWidth - margin - w));
    const y = Math.max(margin, Math.min(rect.y, geometry.pageHeight - margin - h));
    this.store.setGeometry(item.id, { rect: { x, y, w, h } });
  }




  /** Page-space width/height change for a corner drag. */

  /** Converts a viewport point into unrotated page space. */
  private toPageSpace(page: number, clientX: number, clientY: number): AnnotPoint | null {
    const geometry = this.options.geometryFor(page);
    if (!geometry) return null;
    const rect = geometry.element.getBoundingClientRect();
    const displayed = { x: clientX - rect.left, y: clientY - rect.top, w: 0, h: 0 };
    const local = fromScreen(displayed, geometry.rotation, geometry.pageWidth, geometry.pageHeight, geometry.scale);
    return { x: local.x, y: local.y };
  }

  /** Reads the live selection into unrotated page-space rectangles. */
  private selectionRects(page: number, text: string): AnnotRect[] | null {
    const geometry = this.options.geometryFor(page);
    if (!geometry) return null;
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;

    const pageRect = geometry.element.getBoundingClientRect();
    const rects: AnnotRect[] = [];
    for (let i = 0; i < selection.rangeCount; i++) {
      const range = selection.getRangeAt(i);
      if (!geometry.element.contains(range.commonAncestorContainer)) continue;
      for (const client of range.getClientRects()) {
        if (client.width < 1 || client.height < 1) continue;
        const converted = fromScreen(
          { x: client.left - pageRect.left, y: client.top - pageRect.top, w: client.width, h: client.height },
          geometry.rotation,
          geometry.pageWidth,
          geometry.pageHeight,
          geometry.scale,
        );
        rects.push(converted);
      }
    }
    void text;
    return rects.length > 0 ? rects : null;
  }

  // ------------------------------------------------------------- gestures

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) return;

    // Re-sizing takes priority over selection and creation.
    const grip = (event.target as HTMLElement | null)?.closest?.('.annot-resize');
    if (grip instanceof HTMLElement) {
      const id = grip.dataset['annotId'];
      const target = id ? this.store.byId(id) : null;
      if (target?.rect) {
        this.resize = { id: target.id, page: target.page, startX: event.clientX, startY: event.clientY, rect: { ...target.rect } };
        this.options.scroll.setPointerCapture(event.pointerId);
        event.preventDefault();
        event.stopPropagation();
        return;
      }
    }

    const tool = this.options.currentTool();
    const page = this.options.pageAtPoint(event.clientX, event.clientY);

    // Clicking empty space, or outside any page, clears the selection in pointer mode.
    if (page === null) {
      if (tool === 'pointer') this.select(null);
      return;
    }
    const point = this.toPageSpace(page, event.clientX, event.clientY);
    if (!point) return;

    // An existing annotation is selectable under **any** tool. Making the user switch
    // back to the pointer first to touch something already on screen is a wasted step.
    const hit = this.store.hitTest(page, point);
    if (hit) {
      this.select(hit.id);
      // A text tool pressed on an existing text box edits that box. Stacking a second
      // empty one on top is what makes a reader believe the annotation cannot be
      // selected: the click selects it, then immediately covers it with a blank box.
      const activeKind = annotationKindForTool(tool);
      if (activeKind && TEXT_KINDS.has(activeKind) && TEXT_KINDS.has(hit.kind)) {
        void this.editTextInPlace(hit, page);
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      // A click selects the annotation under any tool, but the *gesture* belongs to
      // whichever tool is active. Swallowing pointerdown here is what broke the
      // snapshot and hand drags whenever they started on top of an annotation.
      if (tool !== 'pointer' && !annotationKindForTool(tool)) return;
      if (tool === 'pointer') this.beginDrag(hit, page, point, event);
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    if (tool === 'pointer') {
      this.select(null);
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    const kind = annotationKindForTool(this.options.currentTool());
    if (!kind) return;
    // Text markup is driven by the selection the drag creates, not by this handler.
    if (isTextMarkupKind(kind)) return;

    if (kind === 'note') {
      event.preventDefault();
      event.stopPropagation();
      void this.addNote(page, point);
      return;
    }

    if (kind === 'stamp') {
      event.preventDefault();
      event.stopPropagation();
      this.addStamp(page, point);
      return;
    }

    this.gesture = { kind, page, start: point, points: [point] };
    this.options.scroll.setPointerCapture(event.pointerId);
    event.preventDefault();
    event.stopPropagation();
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (this.resize) {
      const geometry = this.options.geometryFor(this.resize.page);
      if (geometry) {
        const dx = (event.clientX - this.resize.startX) / geometry.scale;
        const dy = (event.clientY - this.resize.startY) / geometry.scale;
        this.store.setGeometry(this.resize.id, { rect: biggerThan(this.resize.rect, dx, dy) });
        // The reader chose a size, so the box stops following its text.
        this.store.update(this.resize.id, { autoFit: false });
        this.refreshAll();
      }
      event.preventDefault();
      return;
    }
    if (this.drag) {
      this.updateDrag(event);
      return;
    }
    if (!this.gesture) return;
    const point = this.toPageSpace(this.gesture.page, event.clientX, event.clientY);
    if (!point) return;
    this.gesture.points.push(point);
    this.drawPreview();
    event.preventDefault();
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    if (this.resize) {
      this.resize = null;
      try {
        this.options.scroll.releasePointerCapture(event.pointerId);
      } catch {
        // Already released; nothing to undo.
      }
      this.afterChange();
      return;
    }
    if (this.drag) {
      const moved = this.drag.moved;
      this.drag = null;
      try {
        this.options.scroll.releasePointerCapture(event.pointerId);
      } catch {
        // The pointer may already be released; nothing to undo.
      }
      if (moved) this.afterChange();
      else this.refreshAll();
      return;
    }

    const kind = annotationKindForTool(this.options.currentTool());

    if (this.gesture) {
      const gesture = this.gesture;
      this.cancelGesture();
      this.commitGesture(gesture, event.clientX, event.clientY);
      return;
    }

    // Text markup: the drag produced a selection, so consume it on release.
    if (kind && isTextMarkupKind(kind)) {
      const page = this.options.pageAtPoint(event.clientX, event.clientY);
      if (page === null) return;
      const selection = window.getSelection();
      const text = selection?.toString() ?? '';
      if (text.trim().length === 0) return;
      const rects = this.selectionRects(page, text);
      if (!rects) return;
      const created = this.store.add({
        page,
        kind,
        color: this.activeColor ?? DEFAULT_COLORS[kind],
        rects,
        text: text.slice(0, 2000),
      });
      selection?.removeAllRanges();
      this.afterChange();
      // A replacement is not finished until it has something to say; the caller asks.
      if (kind === 'replace') this.options.onReplaceCreated?.(created);
      this.options.onCreated();
    }
  };

  /** Prompts for the note body, then places it. The prompt is asynchronous. */
  private async addNote(page: number, point: AnnotPoint): Promise<void> {
    const geometry = this.options.geometryFor(page);
    if (!geometry) return;
    const size = 22 / geometry.scale;
    const item = this.store.add({
      page,
      kind: 'note',
      color: this.activeColor ?? DEFAULT_COLORS.note,
      rect: { x: point.x - size / 2, y: point.y - size / 2, w: size, h: size },
      note: '',
      fontSize: this.activeFontSize,
      autoFit: true,
    });
    this.afterChange();
    this.options.onCreated();
    await this.editTextInPlace(item, page, { removeIfEmpty: true, wide: true });
  }

  /**
   * Places a stamp centred on the click.
   *
   * A fixed size in page units rather than a drag: a stamp is a mark of a standard size,
   * and dragging one out would produce a stamp the wrong shape for its word.
   */
  private addStamp(page: number, point: AnnotPoint): void {
    const stamp = this.options.currentStamp?.() ?? DEFAULT_STAMP;
    const width = 158;
    const height = 54;
    const item = this.store.add({
      page,
      kind: 'stamp',
      color: STAMP_COLORS[stamp],
      rect: { x: point.x - width / 2, y: point.y - height / 2, w: width, h: height },
      fontSize: 15,
      strokeWidth: 1.6,
      stampId: stamp,
      note: this.options.stampLabel?.(stamp) ?? stamp,
    });
    this.select(item.id);
  }
/**
       * A click-sized text box.
       *
       * Its width stops before the page edge and it never exceeds the default, so
       * clicking near the right margin still leaves room for the text to wrap.
       */
      private defaultTextBox(page: number, at: AnnotPoint): AnnotRect {
        const geometry = this.options.geometryFor(page);
        const fallback = { x: at.x, y: at.y, w: 200, h: 44 };
        if (!geometry) return fallback;
        const margin = 8;
        const desired = 200;
        // Never wider than the paper, and never narrower than a usable column.
        const w = Math.min(desired, Math.max(60, geometry.pageWidth - margin * 2));
        // Clicking near the right margin slides the box left rather than letting it
        // hang off the page; the text then wraps inside the paper as expected.
        const x = Math.max(margin, Math.min(at.x, geometry.pageWidth - margin - w));
        return { x, y: at.y, w, h: 44 };
      }

      /**
       * Places an empty text annotation and puts the caret in it immediately.
       *
       * There is no prompt dialog: the box is already on the page, so the text is
       * typed where it will live. Committing nothing removes it again, so an
       * accidental drag does not leave an empty box behind.
       */
      private async addTextAnnotation(page: number, kind: AnnotKind, color: string, rect: AnnotRect, autoFit: boolean): Promise<void> {
        const item = this.store.add({
          page,
          kind,
          color,
          rect,
          note: '',
          fontSize: this.activeFontSize,
          strokeWidth: this.activeStrokeWidth,
          strokeDash: this.activeStrokeDash,
          autoFit,
        });
        this.afterChange();
        this.options.onCreated();
        await this.editTextInPlace(item, page, { removeIfEmpty: true });
      }

  /**
   * Repaints the selection affordance: an outline on the annotation plus a small
   * floating bar carrying a delete button, positioned over the annotation itself.
   */
  /** Outlines the selected annotation with a visible frame and handles. */
  private paintSelectionFrame(overlay: HTMLDivElement, item: Annotation, geometry: PageGeometry): void {
    const anchor = item.rect ?? item.rects?.[0] ?? this.boundsOfStrokes(item);
    if (!anchor) return;
    const s = toScreen(anchor, geometry.rotation, geometry.pageWidth, geometry.pageHeight, geometry.scale);
    const frame = document.createElement('div');
    frame.className = 'annot-frame';
    frame.style.left = `${s.left - 3}px`;
    frame.style.top = `${s.top - 3}px`;
    frame.style.width = `${s.width + 6}px`;
    frame.style.height = `${s.height + 6}px`;
    if (TEXT_KINDS.has(item.kind)) {
      // The grip doubles as the frame's corner marker; a decorative handle on top
      // would swallow the pointer events the drag needs.
      const grip = document.createElement('div');
      grip.className = 'annot-resize';
      grip.dataset['annotId'] = item.id;
      grip.title = i18nResizeHint;
      frame.appendChild(grip);
    } else {
      const handle = document.createElement('span');
      handle.className = 'annot-handle';
      frame.appendChild(handle);
    }
    overlay.appendChild(frame);
  }

  private paintSelectionBar(): void {
    this.selectionBar?.remove();
    this.selectionBar = null;
    const id = this.selectedId;
    if (!id) return;
    const item = this.store.byId(id);
    if (!item) return;
    const geometry = this.options.geometryFor(item.page);
    if (!geometry) return;

    const anchor = item.rect ?? item.rects?.[0] ?? this.boundsOfStrokes(item);
    if (!anchor) return;
    const s = toScreen(anchor, geometry.rotation, geometry.pageWidth, geometry.pageHeight, geometry.scale);

    const bar = document.createElement('div');
    bar.className = 'annot-selbar';
    bar.dataset['annotId'] = id;
    bar.style.left = `${s.left + s.width - 24}px`;
    bar.style.top = `${Math.max(0, s.top - 26)}px`;

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'annot-selbar-btn';
    del.dataset['action'] = 'delete';
    del.textContent = '✕';
    del.title = this.options.deleteLabel();
    del.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.store.remove(id);
      this.selectedId = null;
      this.options.onSelectionChange(null);
      this.afterChange();
    });
    bar.appendChild(del);

    const overlay = this.overlays.get(item.page);
    if (!overlay) return;
    overlay.appendChild(bar);
    this.selectionBar = bar;
  }

  /** Bounding box of an ink or arrow annotation, used to anchor its selection bar. */
  private boundsOfStrokes(item: Annotation): AnnotRect | null {
    const points = (item.strokes ?? []).flat();
    if (points.length === 0) return null;
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    return { x: minX, y: minY, w: Math.max(...xs) - minX, h: Math.max(...ys) - minY };
  }

  /** Captures the annotation geometry so a drag can be applied, then committed. */
  private beginDrag(item: Annotation, page: number, point: AnnotPoint, event: PointerEvent): void {
    this.drag = {
      id: item.id,
      page,
      start: point,
      moved: false,
      ...(item.rect ? { rect: { ...item.rect } } : {}),
      ...(item.rects ? { rects: item.rects.map((r) => ({ ...r })) } : {}),
      ...(item.strokes ? { strokes: item.strokes.map((s) => s.map((p) => ({ ...p }))) } : {}),
    };
    try {
      this.options.scroll.setPointerCapture(event.pointerId);
    } catch {
      // Capture is an optimisation; the drag still works without it.
    }
  }

  /** Translates the dragged annotation by the pointer delta, in page space. */
  private updateDrag(event: PointerEvent): void {
    const drag = this.drag;
    if (!drag) return;
    const point = this.toPageSpace(drag.page, event.clientX, event.clientY);
    if (!point) return;
    const dx = point.x - drag.start.x;
    const dy = point.y - drag.start.y;
    if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) drag.moved = true;

    this.store.setGeometry(drag.id, {
      ...(drag.rect ? { rect: { ...drag.rect, x: drag.rect.x + dx, y: drag.rect.y + dy } } : {}),
      ...(drag.rects ? { rects: drag.rects.map((r) => ({ ...r, x: r.x + dx, y: r.y + dy })) } : {}),
      ...(drag.strokes
        ? { strokes: drag.strokes.map((s) => s.map((p) => ({ x: p.x + dx, y: p.y + dy }))) }
        : {}),
    });
    this.renderPage(drag.page);
    const item = this.store.byId(drag.id);
    const overlay = this.overlays.get(drag.page);
    const geometry = this.options.geometryFor(drag.page);
    if (item && overlay && geometry) this.paintSelectionFrame(overlay, item, geometry);
    event.preventDefault();
  }

  /** Double-clicking a text-bearing annotation edits it on the page. */
  private readonly onDoubleClick = (event: MouseEvent): void => {
    if (this.options.currentTool() !== 'pointer') return;
    const page = this.options.pageAtPoint(event.clientX, event.clientY);
    if (page === null) return;
    const point = this.toPageSpace(page, event.clientX, event.clientY);
    if (!point) return;
    const hit = this.store.hitTest(page, point);
    if (!hit) return;
    if (!TEXT_KINDS.has(hit.kind) && hit.kind !== 'note') return;
    event.preventDefault();
    event.stopPropagation();
    void this.editTextInPlace(hit, page);
  };

  /**
   * Places a textarea over the annotation so the text is edited where it lives,
   * sized and scaled like the annotation itself.
   */
  private async editTextInPlace(item: Annotation, page: number, options: { removeIfEmpty?: boolean; wide?: boolean } = {}): Promise<string | null> {
    const geometry = this.options.geometryFor(page);
    if (!geometry) return null;
    const anchor = item.rect ?? item.rects?.[0];
    if (!anchor) return null;
    const overlay = this.overlays.get(page);
    if (!overlay) return null;
    const s = toScreen(anchor, geometry.rotation, geometry.pageWidth, geometry.pageHeight, geometry.scale);

    const editor = document.createElement('textarea');
    editor.className = 'annot-editor';
    editor.dataset['annotId'] = item.id;
    editor.value = item.note ?? '';
    editor.style.left = `${s.left}px`;
    editor.style.top = `${s.top}px`;
    editor.style.width = `${options.wide === true ? Math.max(200, s.width) : Math.max(140, s.width)}px`;
    editor.style.height = `${Math.max(52, s.height)}px`;
    editor.style.fontSize = `${Math.max(12, (item.fontSize ?? 12) * geometry.scale)}px`;
    overlay.appendChild(editor);
    editor.focus();
    editor.select();

    return await new Promise<string | null>((resolve) => {
      let done = false;
      const finish = (commit: boolean): void => {
        if (done) return;
        done = true;
        editor.removeEventListener('blur', onBlur);
        editor.removeEventListener('keydown', onKey);
        const text = editor.value;
        editor.remove();
        if (commit && text.trim().length > 0) {
          this.store.setText(item.id, text);
          this.refitIfAuto(this.store.byId(item.id) ?? item);
          this.afterChange();
          resolve(text);
          return;
        }
        // Nothing typed: an empty box is clutter, so it goes away again on cancel
        // as well as on commit.
        if (text.trim().length === 0 && options.removeIfEmpty === true) {
          this.store.remove(item.id);
        }
        this.refreshAll();
        resolve(null);
      };
      const onBlur = (): void => finish(true);
      const onKey = (ke: KeyboardEvent): void => {
        ke.stopPropagation();
        if (ke.key === 'Escape') {
          ke.preventDefault();
          finish(false);
        } else if (ke.key === 'Enter' && (ke.ctrlKey || ke.metaKey)) {
          ke.preventDefault();
          finish(true);
        }
      };
      editor.addEventListener('blur', onBlur);
      editor.addEventListener('keydown', onKey);
    });
  }

  private commitGesture(gesture: { kind: AnnotKind; page: number; start: AnnotPoint; points: AnnotPoint[] }, clientX: number, clientY: number): void {
    const end = this.toPageSpace(gesture.page, clientX, clientY) ?? gesture.points[gesture.points.length - 1];
    if (!end) return;
    const color = this.activeColor ?? DEFAULT_COLORS[gesture.kind];

    if (gesture.kind === 'ink') {
      const points = gesture.points.length > 1 ? gesture.points : [gesture.start, end];
      const span = Math.hypot(end.x - gesture.start.x, end.y - gesture.start.y);
      if (points.length < 2 || span < 2) return;
      this.store.add({ page: gesture.page, kind: 'ink', color, strokes: [points] });
      this.afterChange();
      this.options.onCreated();
      return;
    }

    if (gesture.kind === 'measure-distance') {
      if (distance(gesture.start, end) < 3) return;
      this.store.add({ page: gesture.page, kind: gesture.kind, color, strokes: [[gesture.start, end]] });
      this.afterChange();
      this.options.onCreated();
      return;
    }

    if (RECT_MEASURE_KINDS.has(gesture.kind)) {
      const rect: AnnotRect = {
        x: Math.min(gesture.start.x, end.x),
        y: Math.min(gesture.start.y, end.y),
        w: Math.abs(end.x - gesture.start.x),
        h: Math.abs(end.y - gesture.start.y),
      };
      if (rect.w < 3 || rect.h < 3) return;
      const corners = [
        { x: rect.x, y: rect.y },
        { x: rect.x + rect.w, y: rect.y },
        { x: rect.x + rect.w, y: rect.y + rect.h },
        { x: rect.x, y: rect.y + rect.h },
      ];
      this.store.add({ page: gesture.page, kind: gesture.kind, color, rect, strokes: [corners] });
      this.afterChange();
      this.options.onCreated();
      return;
    }

    if (BOX_KINDS.has(gesture.kind)) {
      const rect: AnnotRect = {
        x: Math.min(gesture.start.x, end.x),
        y: Math.min(gesture.start.y, end.y),
        w: Math.abs(end.x - gesture.start.x),
        h: Math.abs(end.y - gesture.start.y),
      };
      if (TEXT_KINDS.has(gesture.kind)) {
        // A click places a default box that stops short of the page edge, so the text
        // has somewhere to wrap instead of running off the paper.
        const dragged = rect.w >= 3 && rect.h >= 3;
        const box = dragged ? rect : this.defaultTextBox(gesture.page, gesture.start);
        if (box.w < 3 || box.h < 3) return;
        // A dragged box keeps the size the reader drew; a clicked one follows its text.
        void this.addTextAnnotation(gesture.page, gesture.kind, color, box, !dragged);
        return;
      }
      if (rect.w < 3 || rect.h < 3) return;
      // An arrow keeps its direction, so both corners are stored in order.
      const geometry = gesture.kind === 'arrow' ? { strokes: [[gesture.start, end]] } : { rect };
      this.store.add({ page: gesture.page, kind: gesture.kind, color, ...geometry });
      this.afterChange();
      this.options.onCreated();
      return;
    }

    if (gesture.kind === 'rect') {
      const rect: AnnotRect = {
        x: Math.min(gesture.start.x, end.x),
        y: Math.min(gesture.start.y, end.y),
        w: Math.abs(end.x - gesture.start.x),
        h: Math.abs(end.y - gesture.start.y),
      };
      if (rect.w < 3 || rect.h < 3) return;
      this.store.add({ page: gesture.page, kind: 'rect', color, rect });
      this.afterChange();
    }
  }

  private drawPreview(): void {
    if (!this.gesture) return;
    const geometry = this.options.geometryFor(this.gesture.page);
    if (!geometry) return;
    const overlay = this.overlayFor(this.gesture.page, geometry.element);
    this.preview?.remove();
    const preview = document.createElement('div');
    preview.className = `annot annot-preview annot-${this.gesture.kind}`;

    if (this.gesture.kind === 'ink' || this.gesture.kind === 'measure-distance') {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('class', 'annot-ink');
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      const d = this.gesture.points
        .map((p) => {
          const s = toScreen({ x: p.x, y: p.y, w: 0, h: 0 }, geometry.rotation, geometry.pageWidth, geometry.pageHeight, geometry.scale);
          return `${s.left.toFixed(1)},${s.top.toFixed(1)}`;
        })
        .join(' L ');
      path.setAttribute('d', `M ${d}`);
      path.setAttribute('stroke', this.activeColor ?? DEFAULT_COLORS.ink);
      path.setAttribute('stroke-width', '2');
      path.setAttribute('fill', 'none');
      svg.appendChild(path);
      preview.appendChild(svg);
    } else {
      const last = this.gesture.points[this.gesture.points.length - 1] ?? this.gesture.start;
      const rect: AnnotRect = {
        x: Math.min(this.gesture.start.x, last.x),
        y: Math.min(this.gesture.start.y, last.y),
        w: Math.abs(last.x - this.gesture.start.x),
        h: Math.abs(last.y - this.gesture.start.y),
      };
      const s = toScreen(rect, geometry.rotation, geometry.pageWidth, geometry.pageHeight, geometry.scale);
      const box = document.createElement('div');
      box.className = 'annot-part';
      box.style.left = `${s.left}px`;
      box.style.top = `${s.top}px`;
      box.style.width = `${s.width}px`;
      box.style.height = `${s.height}px`;
      box.style.border = `2px dashed ${this.activeColor ?? DEFAULT_COLORS.rect}`;
      preview.appendChild(box);
    }
    overlay.appendChild(preview);
    this.preview = preview;
  }

  private cancelGesture(): void {
    this.gesture = null;
    this.preview?.remove();
    this.preview = null;
  }

  private afterChange(): void {
    this.refreshAll();
    this.options.onChanged();
  }
}
