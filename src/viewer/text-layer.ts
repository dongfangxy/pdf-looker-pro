/**
 * Text layer: render a page's text runs into an absolutely positioned overlay so
 * the content becomes selectable and copyable on top of the canvas.
 *
 * The accompanying CSS (see `styles/main.css`, `.textLayer`) replicates the
 * positioning contract pdf.js expects: spans are placed in percentages by the
 * library, while font size is driven by the `--scale-factor` / `--total-scale-factor`
 * custom properties that `setLayerDimensions` maintains.
 */
import { TextLayer, setLayerDimensions, type PDFPageProxy, type PageViewport } from 'pdfjs-dist';

export class PageTextLayer {
  private readonly container: HTMLDivElement;
  private current: TextLayer | null = null;
  private generation = 0;

  constructor(container: HTMLDivElement) {
    this.container = container;
  }

  /** Renders the page's text runs. A previous render for this page is cancelled first. */
  async render(page: PDFPageProxy, viewport: PageViewport): Promise<void> {
    this.cancel();
    const token = ++this.generation;
    this.container.replaceChildren();
    setLayerDimensions(this.container, viewport);

    const layer = new TextLayer({
      textContentSource: page.streamTextContent(),
      container: this.container,
      viewport,
    });
    this.current = layer;
    await layer.render();

    // A newer render started while this one was in flight; drop these spans.
    if (token !== this.generation) {
      this.container.replaceChildren();
      return;
    }
  }

  cancel(): void {
    this.generation++;
    try {
      this.current?.cancel();
    } catch {
      // Cancelling an already-finished layer is not an error.
    }
    this.current = null;
  }

  clear(): void {
    this.cancel();
    this.container.replaceChildren();
  }

  /** Enables or disables pointer interaction, leaving the spans in place. */
  setInteractive(interactive: boolean): void {
    this.container.style.pointerEvents = interactive ? 'auto' : 'none';
    this.container.style.userSelect = interactive ? 'text' : 'none';
  }

  /** Span nodes for the current layer, indexed to match `items`. */
  get textDivs(): HTMLElement[] | null {
    return this.current?.textDivs ?? null;
  }

  /** Source strings for the current layer. `items.join('')` is the search haystack. */
  get items(): string[] | null {
    return this.current?.textContentItemsStr ?? null;
  }

  /**
   * Restores every span to its original text and drops highlight markup, so a new
   * search can be painted without accumulating wrappers.
   */
  resetContent(): void {
    const divs = this.textDivs;
    const items = this.items;
    if (!divs || !items) return;
    const n = Math.min(divs.length, items.length);
    for (let i = 0; i < n; i++) {
      const div = divs[i];
      if (!div) continue;
      if (div.textContent !== items[i]) div.textContent = items[i] ?? '';
      if (div.className) div.className = '';
    }
  }
}
