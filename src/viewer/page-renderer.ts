/**
 * Page geometry and rendering.
 *
 * Two responsibilities, deliberately kept apart:
 *  - `baseSize` gives the page's unscaled dimensions, used to size placeholders so
 *    the scroll layout is correct *before* anything is painted.
 *  - `renderPage` paints one page into a canvas at the requested scale/rotation.
 */
import type { PDFPageProxy, PageViewport } from 'pdfjs-dist';

export type PdfPage = PDFPageProxy;

export interface Size {
  width: number;
  height: number;
}

/** Unscaled page size at rotation 0. */
export async function baseSize(page: PdfPage): Promise<Size> {
  const vp = page.getViewport({ scale: 1, rotation: 0 });
  return { width: vp.width, height: vp.height };
}

/**
 * Displayed size for a base size at the given scale and rotation.
 * Rotations of 90/270 swap the axes.
 */
export function displaySize(base: Size, scale: number, rotation: number): Size {
  const swapped = ((rotation % 360) + 360) % 360 === 90 || ((rotation % 360) + 360) % 360 === 270;
  const w = swapped ? base.height : base.width;
  const h = swapped ? base.width : base.height;
  return { width: Math.floor(w * scale), height: Math.floor(h * scale) };
}

export interface RenderOptions {
  scale: number;
  rotation: number;
  /** Device pixel ratio used to keep output crisp on HiDPI displays. */
  dpr: number;
}

export interface RenderedPage {
  /**
   * The exact viewport used for the canvas. The text layer must be laid out with
   * this same object, otherwise the selectable runs drift from the painted glyphs.
   */
  viewport: PageViewport;
  /** CSS size that was applied to the canvas. */
  size: Size;
}

/**
 * Paints `page` into `canvas`, resizing the backing store for the device pixel ratio.
 */
export async function renderPage(page: PdfPage, canvas: HTMLCanvasElement, opts: RenderOptions): Promise<RenderedPage> {
  const { scale, rotation, dpr } = opts;
  const viewport = page.getViewport({ scale, rotation });

  const cssW = Math.floor(viewport.width);
  const cssH = Math.floor(viewport.height);

  canvas.width = Math.max(1, Math.floor(viewport.width * dpr));
  canvas.height = Math.max(1, Math.floor(viewport.height * dpr));
  canvas.style.width = `${cssW}px`;
  canvas.style.height = `${cssH}px`;

  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('2D canvas context unavailable');

  // pdf.js v5 takes the canvas itself; `canvasContext` is now a legacy option.
  await page.render({
    canvas,
    viewport,
    transform: [dpr, 0, 0, dpr, 0, 0],
  }).promise;

  return { viewport, size: { width: cssW, height: cssH } };
}

/** Releases a canvas backing store so a re-layout does not accumulate memory. */
export function releaseCanvas(canvas: HTMLCanvasElement): void {
  canvas.width = 0;
  canvas.height = 0;
}
