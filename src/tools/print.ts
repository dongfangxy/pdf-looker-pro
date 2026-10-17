/**
 * Printing.
 *
 * Pages are rasterised to images at a print resolution and laid out in a container that
 * only exists on paper: `@media print` hides the reader's chrome and shows the container.
 * Both the packaged window and a browser tab print the same document, because
 * `webContents.print()` and `window.print()` both honour that stylesheet.
 *
 * Rasterising rather than printing the live canvases keeps output stable: the on-screen
 * canvases are at the reader's zoom level and only exist for pages near the viewport.
 */
import type { Viewer } from '../viewer/viewer.js';

export type PrintScale = 'fit' | 'actual' | 'percent';

export interface PrintOptions {
  /** 1-based page numbers, in printing order. */
  pages: number[];
  scale: PrintScale;
  /** Only read when `scale` is `percent`. */
  percent: number;
  orientation: 'auto' | 'portrait' | 'landscape';
}

export interface PrintMessages {
  rendering(page: number, total: number): string;
  failed(page: number, reason: string): string;
  cancelled(): string;
}

/** 72 units per inch is PDF's own unit, so 2x is 144 DPI: enough for a legible sheet. */
const PRINT_DPI_SCALE = 2;

const CONTAINER_ID = 'print-root';
const STYLE_ID = 'print-page-style';

/** Removes any previous print document and its page-size rule. */
function clearPrintDocument(): void {
  document.getElementById(CONTAINER_ID)?.remove();
  document.getElementById(STYLE_ID)?.remove();
}

/** Chooses the paper size rule from the orientation the reader picked. */
function pageRule(orientation: PrintOptions['orientation']): string {
  if (orientation === 'portrait') return '@page { size: portrait; margin: 0; }';
  if (orientation === 'landscape') return '@page { size: landscape; margin: 0; }';
  return '@page { margin: 0; }';
}

/**
 * Builds the printable document and returns the container, or null when every page
 * failed to render.
 */
export async function buildPrintDocument(
  viewer: Viewer,
  options: PrintOptions,
  messages: PrintMessages,
  onProgress: (text: string) => void,
  isCancelled: () => boolean = () => false,
): Promise<HTMLElement | null> {
  clearPrintDocument();

  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = pageRule(options.orientation);
  document.head.appendChild(style);

  const container = document.createElement('div');
  container.id = CONTAINER_ID;

  for (let index = 0; index < options.pages.length; index++) {
    const pageNumber = options.pages[index];
    if (pageNumber === undefined) continue;
    if (isCancelled()) {
      clearPrintDocument();
      throw new Error(messages.cancelled());
    }
    onProgress(messages.rendering(index + 1, options.pages.length));

    let image: string;
    try {
      const canvas = await viewer.renderPageBitmap(pageNumber, PRINT_DPI_SCALE);
      // JPEG at high quality: a photographic scan compresses far better than PNG, and
      // the difference is invisible at 144 DPI.
      image = canvas.toDataURL('image/jpeg', 0.92);
      canvas.width = 0;
      canvas.height = 0;
    } catch (error) {
      onProgress(messages.failed(pageNumber, String((error as Error)?.message ?? error)));
      continue;
    }

    const sheet = document.createElement('div');
    sheet.className = 'print-page';
    sheet.dataset['page'] = String(pageNumber);

    const img = document.createElement('img');
    img.src = image;
    img.alt = '';
    // A percent or actual-size request pins the width; otherwise the sheet decides.
    if (options.scale === 'percent') {
      img.style.width = `${options.percent}%`;
    } else if (options.scale === 'actual') {
      img.style.width = `${595}px`;
    }
    sheet.appendChild(img);
    container.appendChild(sheet);
  }

  if (!container.childElementCount) {
    clearPrintDocument();
    return null;
  }

  document.body.appendChild(container);

  // Printing can start before the images decode, which yields blank sheets.
  const images = [...container.querySelectorAll('img')];
  await Promise.all(
    images.map(
      (img) =>
        new Promise<void>((resolve) => {
          if (img.complete) {
            resolve();
            return;
          }
          img.addEventListener('load', () => resolve(), { once: true });
          img.addEventListener('error', () => resolve(), { once: true });
        }),
    ),
  );

  return container;
}

/** Removes the print document; safe to call when none exists. */
export function disposePrintDocument(): void {
  clearPrintDocument();
}

/** Turns a page-range expression such as `1-3, 7, 10-` into page numbers. */
export function parsePageRange(input: string, pageCount: number): number[] {
  const text = input.trim();
  if (text === '') return [];
  const out: number[] = [];
  const seen = new Set<number>();
  for (const part of text.split(/[,，;；\s]+/)) {
    if (part === '') continue;
    const range = /^(\d*)\s*[-–—]\s*(\d*)$/.exec(part);
    if (range) {
      const start = range[1] === '' ? 1 : Number(range[1]);
      const end = range[2] === '' ? pageCount : Number(range[2]);
      if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
      const from = Math.max(1, Math.min(start, end));
      const to = Math.min(pageCount, Math.max(start, end));
      for (let page = from; page <= to; page++) {
        if (!seen.has(page)) {
          seen.add(page);
          out.push(page);
        }
      }
      continue;
    }
    const single = Number(part);
    if (Number.isFinite(single) && single >= 1 && single <= pageCount && !seen.has(single)) {
      seen.add(single);
      out.push(single);
    }
  }
  return out;
}
