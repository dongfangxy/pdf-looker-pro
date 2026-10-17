/**
 * Viewer controller: page layout, lazy canvas + text rendering, zoom, rotation,
 * navigation, outline resolution and persisted state.
 *
 * Rendering is demand-driven: every page gets a correctly sized placeholder up
 * front (so the scrollbar and layout are stable), and a page's canvas and text
 * layer are only produced once it comes near the viewport. That keeps memory
 * bounded on long documents.
 */
import type { PdfDocument, PdfPage } from './pdf-document.js';
import { baseSize, displaySize, releaseCanvas, renderPage, type Size } from './page-renderer.js';
import { PageTextLayer } from './text-layer.js';

export type ZoomMode =
  | 'custom'
  | 'fit-width'
  | 'fit-page'
  /** One PDF point per CSS pixel: 100%, with no fitting. */
  | 'actual'
  /**
   * Fits the page's *content* to the window rather than its paper edge.
   *
   * A scan or a form usually carries white margins; fit-width leaves those margins
   * as wasted screen, and fit-visible removes them. The content box is measured by
   * rendering the page small once and scanning for non-white pixels, so this costs
   * one cheap render per page and is cached thereafter.
   */
  | 'fit-visible';

export type ViewMode =
  /** Every page stacked, scrolling continuously. */
  | 'continuous'
  /** Only the current page. */
  | 'single'
  /** Only the current pair of facing pages. */
  | 'spread'
  /** Every pair of facing pages, scrolling continuously. */
  | 'spread-continuous';

const MIN_SCALE = 0.1;
const MAX_SCALE = 8;
/** Horizontal padding kept around a page in fit modes. */
const FIT_PADDING = 24;
/** Preload margin around the viewport, as a fraction of viewport height. */
const PRELOAD_MARGIN = '150% 0px';
const MAX_CONCURRENT_RENDERS = 2;

interface PageSlot {
  pageNumber: number;
  element: HTMLDivElement;
  canvas: HTMLCanvasElement;
  textContainer: HTMLDivElement;
  text: PageTextLayer;
  base: Size;
  rendered: boolean;
  rendering: boolean;
  renderedScale: number;
  renderedRotation: number;
}

export interface ViewerState {
  page: number;
  scale: number;
  zoomMode: ZoomMode;
  rotation: number;
}

export interface OutlineEntry {
  title: string;
  /** 1-based page number, or null when the destination could not be resolved. */
  page: number | null;
  bold: boolean;
  italic: boolean;
  children: OutlineEntry[];
}

export interface ViewerCallbacks {
  onPageChange?(page: number, total: number): void;
  onZoomChange?(percent: number, mode: ZoomMode): void;
  onStatus?(text: string, isError: boolean): void;
  onStateChange?(state: ViewerState): void;
  /** Fired after a page's canvas and text layer finish (re)rendering. */
  onPageRendered?(pageNumber: number): void;
}

/** The text-layer DOM a page exposes, used to map search hits onto spans. */
export interface PageTextArrays {
  divs: HTMLElement[];
  items: string[];
}

/** Shape of one node returned by `PDFDocumentProxy.getOutline()`. */
interface RawOutlineNode {
  title?: unknown;
  bold?: unknown;
  italic?: unknown;
  dest?: unknown;
  items?: unknown;
}

/** Padding kept inside the window when fitting content, so text never touches the edge. */
const FIT_VISIBLE_PAD = 12;

/** A page's non-white bounding box, in unrotated page units. */
export interface ContentBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** One entry of the back/forward view history. */
interface ViewSnapshot {
  page: number;
  scale: number;
  zoomMode: ZoomMode;
  rotation: number;
  scrollTop: number;
}
function normaliseRotation(value: number): number {
  const wrapped = Math.round(value / 90) * 90;
  return ((wrapped % 360) + 360) % 360;
}

export class Viewer {
  private readonly pagesEl: HTMLElement;
  private readonly scrollEl: HTMLElement;
  private readonly cb: ViewerCallbacks;

  private doc: PdfDocument | null = null;
  private slots: PageSlot[] = [];
  private readonly pageCache = new Map<number, PdfPage>();

  private scale = 1;
  private rotation = 0;
  private zoomMode: ZoomMode = 'fit-width';
  private viewMode: ViewMode = 'continuous';
  private currentPage = 0;
  private textSelection = true;
  /** Measured content boxes, in unrotated page units; null means "no content". */
  private readonly boundsCache = new Map<number, ContentBox | null>();
  /** Visited views, oldest first, for the back/forward navigation. */
  private readonly viewHistory: ViewSnapshot[] = [];
  private viewHistoryIndex = -1;
  /** Set while a history entry is being restored, so it is not recorded again. */
  private restoringView = false;

  private readonly observer: IntersectionObserver;
  private readonly resizeObserver: ResizeObserver;
  private readonly queue: PageSlot[] = [];
  private activeRenders = 0;
  private scrollRaf = 0;
  private destroyed = false;

  constructor(pagesEl: HTMLElement, scrollEl: HTMLElement, cb: ViewerCallbacks = {}) {
    this.pagesEl = pagesEl;
    this.scrollEl = scrollEl;
    this.cb = cb;

    this.observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const slot = this.slots.find((s) => s.element === entry.target);
          if (slot) this.enqueue(slot);
        }
      },
      { root: this.scrollEl, rootMargin: PRELOAD_MARGIN, threshold: 0 },
    );

    this.scrollEl.addEventListener('scroll', this.onScroll, { passive: true });

    // Observing the scroll container (rather than the window) also catches the
    // scrollbar appearing after the first layout, which changes clientWidth and
    // would otherwise leave fit-width slightly too wide.
    this.resizeObserver = new ResizeObserver(() => {
      if (this.zoomMode !== 'custom') this.applyZoomMode();
    });
    this.resizeObserver.observe(this.scrollEl);
  }

  // ---------------------------------------------------------------- lifecycle

  get hasDocument(): boolean {
    return this.doc !== null;
  }

  get pageCount(): number {
    return this.slots.length;
  }

  get page(): number {
    return this.currentPage || 1;
  }

  /** Reserves page slots and applies an optional restored state. */
  async load(doc: PdfDocument, restore?: Partial<ViewerState> | null): Promise<void> {
    this.clear();
    this.doc = doc;

    const total = doc.numPages;
    const fragment = document.createDocumentFragment();
    const bases: Size[] = [];
    for (let i = 1; i <= total; i++) {
      bases.push(await this.geometry(i));
    }

    for (let i = 1; i <= total; i++) {
      const base = bases[i - 1];
      if (!base) continue;

      const element = document.createElement('div');
      element.className = 'page unrendered';
      element.dataset['page'] = String(i);

      const canvas = document.createElement('canvas');
      element.appendChild(canvas);

      const textContainer = document.createElement('div');
      textContainer.className = 'textLayer';
      element.appendChild(textContainer);

      // Page badge. It is stamped with the application's own embedded font (loaded
      // from the ARPK resource container), so the badge also demonstrates that the
      // built-in font is available without any system font present.
      const badge = document.createElement('div');
      badge.className = 'page-badge';
      badge.textContent = String(i);
      badge.setAttribute('aria-hidden', 'true');
      element.appendChild(badge);

      fragment.appendChild(element);

      this.slots.push({
        pageNumber: i,
        element,
        canvas,
        textContainer,
        text: new PageTextLayer(textContainer),
        base,
        rendered: false,
        rendering: false,
        renderedScale: 0,
        renderedRotation: -1,
      });
    }

    this.pagesEl.appendChild(fragment);
    for (const slot of this.slots) this.observer.observe(slot.element);

    if (restore) {
      if (typeof restore.rotation === 'number') this.rotation = normaliseRotation(restore.rotation);
      if (restore.zoomMode === 'custom' && typeof restore.scale === 'number') {
        this.zoomMode = 'custom';
        this.scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, restore.scale));
        this.relayout();
      } else {
        if (restore.zoomMode) this.zoomMode = restore.zoomMode;
        this.applyZoomMode(true);
      }
    } else {
      this.applyZoomMode(true);
    }

    this.setTextSelection(this.textSelection);
    this.gotoPage(typeof restore?.page === 'number' ? restore.page : 1);
    // Seed the history with the opening view so the first 上一视图 has a target.
    this.viewHistory.length = 0;
    this.viewHistoryIndex = -1;
    this.recordView();
  }

  destroy(): void {
    this.destroyed = true;
    this.resizeObserver.disconnect();
    this.scrollEl.removeEventListener('scroll', this.onScroll);
    this.observer.disconnect();
    if (this.scrollRaf) cancelAnimationFrame(this.scrollRaf);
    this.clear();
  }

  private clear(): void {
    this.observer.disconnect();
    for (const slot of this.slots) {
      slot.text.clear();
      releaseCanvas(slot.canvas);
    }
    this.slots = [];
    this.queue.length = 0;
    this.pageCache.clear();
    this.boundsCache.clear();
    this.viewHistory.length = 0;
    this.viewHistoryIndex = -1;
    this.pagesEl.replaceChildren();
    this.doc = null;
    this.currentPage = 0;
  }

  // ---------------------------------------------------------------- geometry

  private async geometry(pageNumber: number): Promise<Size> {
    return baseSize(await this.getPage(pageNumber));
  }

  private async getPage(pageNumber: number): Promise<PdfPage> {
    const cached = this.pageCache.get(pageNumber);
    if (cached) return cached;
    if (!this.doc) throw new Error('no document');
    const page = await this.doc.getPage(pageNumber);
    this.pageCache.set(pageNumber, page);
    return page;
  }

  // ---------------------------------------------------------------- zoom

  /**
   * Releases the current document. Used when the last tab is closed, so the view
   * cannot keep reporting the previous document's page count.
   */
  unload(): void {
    this.doc = null;
    this.clear();
    this.emitZoom();
  }

  setZoomMode(mode: ZoomMode): void {
    this.zoomMode = mode;
    this.applyZoomMode(true);
    this.recordView();
  }

  setScale(scale: number): void {
    const clamped = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
    if (Math.abs(clamped - this.scale) < 1e-4 && this.zoomMode === 'custom') return;
    this.scale = clamped;
    this.zoomMode = 'custom';
    this.relayout();
    this.recordView();
  }

  zoomIn(): void {
    this.setScale(this.scale * 1.25);
  }

  zoomOut(): void {
    this.setScale(this.scale / 1.25);
  }

  rotate(): void {
    this.rotation = (this.rotation + 90) % 360;
    if (this.zoomMode !== 'custom') {
      this.applyZoomMode(true);
    } else {
      this.relayout();
    }
    this.emitState();
    this.recordView();
  }

  private applyZoomMode(force = false): void {
    if (!this.slots.length) {
      this.emitZoom();
      return;
    }
    const reference = this.slots[Math.min(this.currentPage || 1, this.slots.length) - 1];
    if (!reference) return;

    const availW = this.scrollEl.clientWidth - FIT_PADDING;
    const availH = this.scrollEl.clientHeight - FIT_PADDING;
    const rotated = displaySize(reference.base, 1, this.rotation);

    // Facing pages share the width, so the fit is computed against half of it.
    const columns = this.viewMode === 'spread' || this.viewMode === 'spread-continuous' ? 2 : 1;

    if (this.zoomMode === 'actual') {
      // 100% is a fixed scale, not a fit: nothing to measure.
      this.scale = 1;
      this.relayout();
      return;
    }

    if (this.zoomMode === 'fit-visible') {
      this.applyFitVisible(force, columns, availW);
      return;
    }

    let next = this.scale;
    if (this.zoomMode === 'fit-width') {
      next = availW / columns / rotated.width;
    } else if (this.zoomMode === 'fit-page') {
      next = Math.min(availW / columns / rotated.width, availH / rotated.height);
    }
    next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, next));

    // An automatic resize that leaves the fit scale essentially unchanged must not
    // trigger a relayout, otherwise the scrollbar toggling feeds back into itself.
    if (!force && Math.abs(next - this.scale) / Math.max(this.scale, 1e-6) < 0.005) {
      this.emitZoom();
      return;
    }
    this.scale = next;
    this.relayout();
  }

  /**
   * Fits the current page's content, measured on demand.
   *
   * Measurement renders the page at a low scale and scans the pixels, so it is
   * asynchronous. The result is only applied if the reader has not moved on in the
   * meantime, which keeps a fast page-flip from snapping the zoom to a stale page.
   */
  private applyFitVisible(force: boolean, columns: number, availW: number): void {
    const pageNumber = this.currentPage || 1;
    void this.contentBounds(pageNumber).then((box) => {
      if (this.destroyed) return;
      if (this.zoomMode !== 'fit-visible') return;
      if ((this.currentPage || 1) !== pageNumber) return;

      const slot = this.slots[pageNumber - 1];
      if (!slot) return;
      // A page with no content has nothing to fit; fall back to the paper width.
      const contentWidth = box ? box.width : 0;
      const paper = displaySize(slot.base, 1, this.rotation);
      const sideways = this.rotation === 90 || this.rotation === 270;
      const width = box
        ? (sideways ? box.height : box.width)
        : paper.width;
      const usable = Math.max(40, availW - FIT_VISIBLE_PAD);
      const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, usable / columns / Math.max(width, 1)));
      void contentWidth;

      if (!force && Math.abs(next - this.scale) / Math.max(this.scale, 1e-6) < 0.005) {
        this.emitZoom();
        return;
      }
      this.scale = next;
      this.relayout();
    });
  }

  /** The measured content box of a page, for callers that need to reason about it. */
  async contentBox(pageNumber: number): Promise<ContentBox | null> {
    return this.contentBounds(pageNumber);
  }

  /** Measures the non-white bounding box of a page, in unrotated page units. */
  private async contentBounds(pageNumber: number): Promise<ContentBox | null> {
    if (this.boundsCache.has(pageNumber)) return this.boundsCache.get(pageNumber) ?? null;
    let result: ContentBox | null = null;
    try {
      const page = await this.getPage(pageNumber);
      // 0.5 is enough to find margins and cheap enough to do on demand.
      const probe = 0.5;
      const viewport = page.getViewport({ scale: probe });
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.ceil(viewport.width));
      canvas.height = Math.max(1, Math.ceil(viewport.height));
      const ctx = canvas.getContext('2d', { alpha: false });
      if (ctx) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvas, viewport, transform: [1, 0, 0, 1, 0, 0] }).promise;
        const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        let minX = canvas.width;
        let minY = canvas.height;
        let maxX = -1;
        let maxY = -1;
        for (let y = 0; y < canvas.height; y++) {
          const row = y * canvas.width;
          for (let x = 0; x < canvas.width; x++) {
            const i = (row + x) * 4;
            // 250 rather than 255: anti-aliased glyph edges are not pure white.
            if (data[i]! < 250 || data[i + 1]! < 250 || data[i + 2]! < 250) {
              if (x < minX) minX = x;
              if (x > maxX) maxX = x;
              if (y < minY) minY = y;
              if (y > maxY) maxY = y;
            }
          }
        }
        if (maxX >= minX && maxY >= minY) {
          result = {
            x: minX / probe,
            y: minY / probe,
            width: (maxX - minX + 1) / probe,
            height: (maxY - minY + 1) / probe,
          };
        }
        releaseCanvas(canvas);
      }
    } catch {
      result = null;
    }
    this.boundsCache.set(pageNumber, result);
    return result;
  }

  // ---------------------------------------------------------------- layout

  /** Resizes every placeholder to the current scale/rotation and discards painted pages. */
  private relayout(): void {
    for (const slot of this.slots) {
      const size = displaySize(slot.base, this.scale, this.rotation);
      slot.element.style.width = `${size.width}px`;
      slot.element.style.height = `${size.height}px`;
      slot.element.classList.add('unrendered');
      releaseCanvas(slot.canvas);
      slot.canvas.style.width = `${size.width}px`;
      slot.canvas.style.height = `${size.height}px`;
      slot.text.clear();
      slot.rendered = false;
      slot.rendering = false;
      slot.renderedScale = 0;
      slot.renderedRotation = -1;
    }
    this.queue.length = 0;
    this.emitZoom();
    this.reobserve();
  }

  /** Re-arms the observer so pages already on screen are queued again. */
  private reobserve(): void {
    for (const slot of this.slots) {
      this.observer.unobserve(slot.element);
      this.observer.observe(slot.element);
    }
  }

  // ---------------------------------------------------------------- rendering

  private enqueue(slot: PageSlot): void {
    if (slot.rendered || slot.rendering) return;
    if (this.queue.includes(slot)) return;
    this.queue.push(slot);
    this.pump();
  }

  private pump(): void {
    while (this.activeRenders < MAX_CONCURRENT_RENDERS && this.queue.length > 0) {
      const slot = this.queue.shift();
      if (!slot) break;
      if (slot.rendered || slot.rendering) continue;
      void this.renderSlot(slot);
    }
  }

  private async renderSlot(slot: PageSlot): Promise<void> {
    if (this.destroyed || !this.doc) return;
    slot.rendering = true;
    this.activeRenders++;
    try {
      const page = await this.getPage(slot.pageNumber);
      const scale = this.scale;
      const rotation = this.rotation;
      const dpr = window.devicePixelRatio || 1;

      // `setLayerDimensions` sizes the text layer from `--scale-factor`, but does not
      // set it; the property has to live on an ancestor of the layer.
      slot.element.style.setProperty('--scale-factor', String(scale));

      const { viewport } = await renderPage(page, slot.canvas, { scale, rotation, dpr });
      slot.rendered = true;
      slot.renderedScale = scale;
      slot.renderedRotation = rotation;
      slot.element.classList.remove('unrendered');

      // Text layer uses the same viewport object as the canvas so the runs line up.
      await slot.text.render(page, viewport);
      slot.text.setInteractive(this.textSelection);
      this.cb.onPageRendered?.(slot.pageNumber);
    } catch (err) {
      this.cb.onStatus?.(`第 ${slot.pageNumber} 页渲染失败: ${String(err)}`, true);
    } finally {
      slot.rendering = false;
      this.activeRenders--;
      if (slot.rendered && (slot.renderedScale !== this.scale || slot.renderedRotation !== this.rotation)) {
        this.enqueue(slot);
      }
      this.pump();
    }
  }

  // ---------------------------------------------------------------- selection

  setTextSelection(enabled: boolean): void {
    this.textSelection = enabled;
    for (const slot of this.slots) slot.text.setInteractive(enabled);
  }

  get selectingText(): boolean {
    return this.textSelection;
  }

  /** Currently selected text, or an empty string when the selection is collapsed. */
  getSelectedText(): string {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) return '';
    return selection.toString().replace(/\s+/g, ' ').trim();
  }

  // ---------------------------------------------------------------- outline

  /** Resolves the document outline, mapping each destination to a page number. */
  async outline(): Promise<OutlineEntry[]> {
    if (!this.doc) return [];
    let raw: unknown;
    try {
      raw = await this.doc.getOutline();
    } catch {
      return [];
    }
    if (!Array.isArray(raw)) return [];
    return this.mapOutline(raw as RawOutlineNode[]);
  }

  private async mapOutline(nodes: RawOutlineNode[]): Promise<OutlineEntry[]> {
    const out: OutlineEntry[] = [];
    for (const node of nodes) {
      const title = typeof node.title === 'string' ? node.title.trim() : '';
      const children = Array.isArray(node.items) ? await this.mapOutline(node.items as RawOutlineNode[]) : [];
      const page = await this.resolveDestination(node.dest);
      if (!title && children.length === 0) continue;
      out.push({
        title: title || '(未命名)',
        page,
        bold: node.bold === true,
        italic: node.italic === true,
        children,
      });
    }
    return out;
  }

  private async resolveDestination(dest: unknown): Promise<number | null> {
    if (!this.doc || dest === null || dest === undefined) return null;
    let explicit: unknown = dest;
    if (typeof dest === 'string') {
      try {
        explicit = await this.doc.getDestination(dest);
      } catch {
        return null;
      }
    }
    if (!Array.isArray(explicit) || explicit.length === 0) return null;
    const ref = explicit[0];
    if (ref === null || typeof ref !== 'object') return null;
    try {
      const index = await this.doc.getPageIndex(ref as Parameters<PdfDocument['getPageIndex']>[0]);
      return index + 1;
    } catch {
      return null;
    }
  }

  // ---------------------------------------------------------------- navigation

  gotoPage(pageNumber: number): void {
    if (!this.slots.length) return;
    const clamped = Math.min(this.slots.length, Math.max(1, Math.floor(pageNumber)));
    const slot = this.slots[clamped - 1];
    if (!slot) return;
    // Update the current page first: fit modes size against the current page, so
    // the page number must be settled before the zoom mode is re-applied.
    this.setCurrentPage(clamped);
    if (this.zoomMode !== 'custom') this.applyZoomMode(true);
    this.scrollEl.scrollTop = slot.element.offsetTop - (this.scrollEl.clientHeight - slot.element.clientHeight) / 2;
    this.emitState();
    this.recordView();
  }

  nextPage(): void {
    this.gotoPage(this.page + 1);
  }

  prevPage(): void {
    this.gotoPage(this.page - 1);
  }

  private setCurrentPage(pageNumber: number): void {
    if (pageNumber === this.currentPage) return;
    this.currentPage = pageNumber;
    this.cb.onPageChange?.(pageNumber, this.slots.length);
  }

  private readonly onScroll = (): void => {
    if (this.scrollRaf) return;
    this.scrollRaf = requestAnimationFrame(() => {
      this.scrollRaf = 0;
      this.updateCurrentPageFromScroll();
    });
  };

  private updateCurrentPageFromScroll(): void {
    if (!this.slots.length) return;
    const probe = this.scrollEl.scrollTop + this.scrollEl.clientHeight * 0.35;
    let candidate = 1;
    for (const slot of this.slots) {
      if (slot.element.offsetTop <= probe) candidate = slot.pageNumber;
      else break;
    }
    const changed = candidate !== this.currentPage;
    this.setCurrentPage(candidate);
    if (changed) this.emitState();
  }

  // ---------------------------------------------------------------- view history

  /**
   * Records the current view, so 上一视图 / 下一视图 can return to it.
   *
   * Consecutive identical views collapse: scrolling inside a page must not fill the
   * history with entries the reader cannot tell apart.
   */
  private recordView(): void {
    if (this.restoringView || !this.slots.length) return;
    const snapshot = this.captureView();
    const current = this.viewHistory[this.viewHistoryIndex];
    if (current && current.page === snapshot.page && current.scale === snapshot.scale &&
        current.zoomMode === snapshot.zoomMode && current.rotation === snapshot.rotation &&
        Math.abs(current.scrollTop - snapshot.scrollTop) < 40) {
      // Same view, only a small scroll: keep the entry, update its offset.
      current.scrollTop = snapshot.scrollTop;
      return;
    }
    // Dropping forward entries is what makes this a branch, not a ring.
    this.viewHistory.length = this.viewHistoryIndex + 1;
    this.viewHistory.push(snapshot);
    if (this.viewHistory.length > 60) this.viewHistory.shift();
    this.viewHistoryIndex = this.viewHistory.length - 1;
  }

  private captureView(): ViewSnapshot {
    return {
      page: this.currentPage || 1,
      scale: this.scale,
      zoomMode: this.zoomMode,
      rotation: this.rotation,
      scrollTop: this.scrollEl.scrollTop,
    };
  }

  private restoreView(snapshot: ViewSnapshot): void {
    this.restoringView = true;
    try {
      this.zoomMode = snapshot.zoomMode;
      this.scale = snapshot.scale;
      this.rotation = snapshot.rotation;
      this.setCurrentPage(snapshot.page);
      this.relayout();
      const slot = this.slots[snapshot.page - 1];
      if (slot) this.scrollEl.scrollTop = slot.element.offsetTop - (this.scrollEl.clientHeight - slot.element.clientHeight) / 2;
      this.emitState();
    } finally {
      this.restoringView = false;
    }
  }

  get canGoBack(): boolean {
    return this.viewHistoryIndex > 0;
  }

  get canGoForward(): boolean {
    return this.viewHistoryIndex >= 0 && this.viewHistoryIndex < this.viewHistory.length - 1;
  }

  /** Steps back through visited views. Returns false when there is nowhere to go. */
  previousView(): boolean {
    if (!this.canGoBack) return false;
    this.viewHistoryIndex--;
    const snapshot = this.viewHistory[this.viewHistoryIndex];
    if (!snapshot) return false;
    this.restoreView(snapshot);
    return true;
  }

  /** Steps forward again after `previousView`. */
  nextView(): boolean {
    if (!this.canGoForward) return false;
    this.viewHistoryIndex++;
    const snapshot = this.viewHistory[this.viewHistoryIndex];
    if (!snapshot) return false;
    this.restoreView(snapshot);
    return true;
  }

  // ---------------------------------------------------------------- state

  getState(): ViewerState {
    return {
      page: this.page,
      scale: this.scale,
      zoomMode: this.zoomMode,
      rotation: this.rotation,
    };
  }

  private emitZoom(): void {
    this.cb.onZoomChange?.(Math.round(this.scale * 100), this.zoomMode);
    this.emitState();
  }

  private emitState(): void {
    this.cb.onStateChange?.(this.getState());
  }

  get mode(): ZoomMode {
    return this.zoomMode;
  }

  // ---------------------------------------------------------------- P2 support

  /** The DOM element for a page, or null when the page index is out of range. */
  pageElement(pageNumber: number): HTMLElement | null {
    return this.slots[pageNumber - 1]?.element ?? null;
  }

  /**
   * Switches the page layout. `continuous` stacks every page, `single` shows only
   * the current one, and `spread` pairs pages side by side. The container classes
   * drive the layout; the fit calculation accounts for the extra column.
   */
  setViewMode(mode: ViewMode, options: { refit?: boolean } = {}): void {
    if (mode === this.viewMode) return;
    this.viewMode = mode;
    this.pagesEl.classList.toggle('mode-single', mode === 'single');
    this.pagesEl.classList.toggle('mode-spread', mode === 'spread');
    this.pagesEl.classList.toggle('mode-spread-continuous', mode === 'spread-continuous');
    this.pagesEl.dataset['mode'] = mode;
    if (mode !== 'continuous' && this.zoomMode === 'fit-width') this.zoomMode = 'fit-page';
    // The visible pair changes with the mode, so it has to be recomputed.
    this.markCurrentPage(this.currentPage || 1);
    this.applyZoomMode(options.refit === true);
  }

  get layoutMode(): ViewMode {
    return this.viewMode;
  }

  /** Marks the page the reader is on, which single-page mode uses to pick a page. */
  markCurrentPage(pageNumber: number): void {
    // In facing mode a "view" is a pair, and the pair starts on an odd page so that
    // two pages are always on screen together.
    const pairStart = pageNumber - ((pageNumber - 1) % 2);
    for (const slot of this.slots) {
      slot.element.classList.toggle('current', slot.pageNumber === pageNumber);
      slot.element.classList.toggle('in-pair', slot.pageNumber === pairStart || slot.pageNumber === pairStart + 1);
    }
  }

  /**
   * Layout facts an overlay needs: the page element plus the **unrotated** page size,
   * current scale and rotation. Annotations are stored in unrotated page space, so
   * this is the frame they are converted from.
   */
  pageGeometry(pageNumber: number): {
    pageNumber: number;
    element: HTMLElement;
    pageWidth: number;
    pageHeight: number;
    scale: number;
    rotation: number;
  } | null {
    const slot = this.slots[pageNumber - 1];
    if (!slot || !slot.base) return null;
    return {
      pageNumber,
      element: slot.element,
      pageWidth: slot.base.width,
      pageHeight: slot.base.height,
      scale: this.scale,
      rotation: this.rotation,
    };
  }

  /**
   * Text-layer span nodes and their source strings for a page, or null when that
   * page's text layer has not been produced. Offsets into `items.join('')` map
   * directly onto `divs`, which is what keeps highlights aligned with the glyphs.
   */
  textLayerArrays(pageNumber: number): PageTextArrays | null {
    const slot = this.slots[pageNumber - 1];
    if (!slot || !slot.rendered) return null;
    const divs = slot.text.textDivs;
    const items = slot.text.items;
    if (!divs || !items || divs.length === 0 || divs.length !== items.length) return null;
    return { divs, items };
  }

  /** Replaces a page's text-layer content, clearing any highlight markup. */
  resetTextLayer(pageNumber: number): void {
    this.slots[pageNumber - 1]?.text.resetContent();
  }

  /**
   * Renders a page into a detached canvas at an arbitrary scale, for exports.
   * The caller owns the returned canvas.
   */
  async renderPageBitmap(pageNumber: number, scale: number): Promise<HTMLCanvasElement> {
    const page = await this.getPage(pageNumber);
    const viewport = page.getViewport({ scale, rotation: this.rotation });
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(viewport.width));
    canvas.height = Math.max(1, Math.round(viewport.height));
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('2D canvas context unavailable');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvas, viewport, transform: [1, 0, 0, 1, 0, 0] }).promise;
    return canvas;
  }

  /** Scales around a viewport point, keeping that point visually fixed. */
  zoomAt(clientX: number, clientY: number, factor: number): void {
    const rect = this.scrollEl.getBoundingClientRect();
    const anchorX = clientX - rect.left;
    const anchorY = clientY - rect.top;
    const contentX = anchorX + this.scrollEl.scrollLeft;
    const contentY = anchorY + this.scrollEl.scrollTop;

    const before = this.scale;
    this.setScale(before * factor);
    if (this.scale === before) return;

    const k = this.scale / before;
    this.scrollEl.scrollLeft = contentX * k - anchorX;
    this.scrollEl.scrollTop = contentY * k - anchorY;
  }

  /** 1-based page number under a viewport point, or null when outside all pages. */
  pageAtPoint(clientX: number, clientY: number): number | null {
    for (const slot of this.slots) {
      const rect = slot.element.getBoundingClientRect();
      if (clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom) {
        return slot.pageNumber;
      }
    }
    return null;
  }

  /** Enables or disables the drag-to-pan affordance (the viewer itself only sets state). */
  setPanningHint(enabled: boolean): void {
    this.scrollEl.classList.toggle('panning-enabled', enabled);
  }
}
