/**
 * Thumbnail strip.
 *
 * Thumbnails are produced on demand: every page gets a placeholder at the right
 * aspect ratio, and the small canvas is only painted once the tile scrolls into
 * the sidebar viewport. Without that, a long document would rasterise hundreds of
 * pages at open time.
 */
import type { PdfDocument, PdfPage } from '../viewer/pdf-document.js';
import { baseSize, displaySize, renderPage, releaseCanvas } from '../viewer/page-renderer.js';

/** Target thumbnail width in CSS pixels. */
const THUMB_WIDTH = 132;
const MAX_CONCURRENT = 2;

interface Tile {
  pageNumber: number;
  element: HTMLDivElement;
  canvas: HTMLCanvasElement;
  aspect: number;
  rendered: boolean;
  rendering: boolean;
}

export interface ThumbnailHandlers {
  onNavigate(page: number): void;
}

export class ThumbnailStrip {
  private readonly container: HTMLElement;
  private readonly handlers: ThumbnailHandlers;
  private readonly observer: IntersectionObserver;
  private readonly tiles: Tile[] = [];
  private readonly queue: Tile[] = [];
  private readonly pageCache = new Map<number, PdfPage>();
  private doc: PdfDocument | null = null;
  private active = 0;
  private currentPage = 0;

  constructor(container: HTMLElement, handlers: ThumbnailHandlers) {
    this.container = container;
    this.handlers = handlers;
    this.observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const tile = this.tiles.find((t) => t.element === entry.target);
          if (tile) this.enqueue(tile);
        }
      },
      { root: this.container, rootMargin: '200px 0px', threshold: 0 },
    );
  }

  get hasDocument(): boolean {
    return this.doc !== null;
  }

  async load(doc: PdfDocument): Promise<void> {
    this.clear();
    this.doc = doc;

    const total = doc.numPages;
    const fragment = document.createDocumentFragment();

    for (let i = 1; i <= total; i++) {
      const element = document.createElement('div');
      element.className = 'thumb';
      element.dataset['page'] = String(i);

      const canvas = document.createElement('canvas');
      element.appendChild(canvas);

      const caption = document.createElement('div');
      caption.className = 'thumb-caption';
      caption.textContent = String(i);
      element.appendChild(caption);

      element.addEventListener('click', () => this.handlers.onNavigate(i));
      fragment.appendChild(element);

      this.tiles.push({ pageNumber: i, element, canvas, aspect: 1 / 1.414, rendered: false, rendering: false });
    }

    this.container.appendChild(fragment);

    // Resolve real aspect ratios, then size every placeholder so the strip does
    // not reflow as thumbnails come in.
    for (const tile of this.tiles) {
      try {
        const base = await baseSize(await this.getPage(tile.pageNumber));
        tile.aspect = base.width / base.height;
      } catch {
        // Keep the A4 default ratio.
      }
      const width = THUMB_WIDTH;
      const height = Math.round(width / tile.aspect);
      tile.element.style.width = `${width}px`;
      tile.canvas.style.width = `${width}px`;
      tile.canvas.style.height = `${height}px`;
      this.observer.observe(tile.element);
    }
  }

  clear(): void {
    this.observer.disconnect();
    for (const tile of this.tiles) releaseCanvas(tile.canvas);
    this.tiles.length = 0;
    this.queue.length = 0;
    this.pageCache.clear();
    this.container.replaceChildren();
    this.doc = null;
    this.currentPage = 0;
  }

  /** Highlights the tile for a page and scrolls it into view. */
  setCurrentPage(page: number): void {
    if (page === this.currentPage) return;
    const previous = this.tiles[this.currentPage - 1];
    if (previous) previous.element.classList.remove('current');
    this.currentPage = page;
    const tile = this.tiles[page - 1];
    if (!tile) return;
    tile.element.classList.add('current');
    if (!this.isVisible(tile.element)) {
      tile.element.scrollIntoView({ block: 'nearest' });
    }
  }

  private isVisible(element: HTMLElement): boolean {
    const c = this.container.getBoundingClientRect();
    const e = element.getBoundingClientRect();
    return e.top >= c.top && e.bottom <= c.bottom;
  }

  private async getPage(pageNumber: number): Promise<PdfPage> {
    const cached = this.pageCache.get(pageNumber);
    if (cached) return cached;
    if (!this.doc) throw new Error('no document');
    const page = await this.doc.getPage(pageNumber);
    this.pageCache.set(pageNumber, page);
    return page;
  }

  private enqueue(tile: Tile): void {
    if (tile.rendered || tile.rendering) return;
    if (this.queue.includes(tile)) return;
    this.queue.push(tile);
    this.pump();
  }

  private pump(): void {
    while (this.active < MAX_CONCURRENT && this.queue.length > 0) {
      const tile = this.queue.shift();
      if (!tile) break;
      if (tile.rendered || tile.rendering) continue;
      void this.renderTile(tile);
    }
  }

  private async renderTile(tile: Tile): Promise<void> {
    if (!this.doc) return;
    tile.rendering = true;
    this.active++;
    try {
      const page = await this.getPage(tile.pageNumber);
      const base = await baseSize(page);
      const scale = THUMB_WIDTH / base.width;
      const size = displaySize(base, scale, 0);
      tile.canvas.style.width = `${size.width}px`;
      tile.canvas.style.height = `${size.height}px`;
      await renderPage(page, tile.canvas, { scale, rotation: 0, dpr: window.devicePixelRatio || 1 });
      tile.rendered = true;
      tile.element.classList.add('rendered');
    } catch {
      // A thumbnail failing to render must not break the strip.
    } finally {
      tile.rendering = false;
      this.active--;
      this.pump();
    }
  }
}
