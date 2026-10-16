/**
 * Document search and match highlighting.
 *
 * Search indexes each page's extracted text once. Highlighting does **not** compute
 * its own geometry: it rewrites the text-layer spans, so a painted match is aligned
 * with the painted glyphs by construction. The span-splitting approach follows the
 * algorithm pdf.js uses in its text highlighter (whose class is not exported).
 *
 * Safety guard: before painting, the page's live span strings are compared with the
 * strings the index was built from. If a page's text layer disagrees with the index
 * (different item structure), that page is skipped rather than mis-highlighted.
 */
import type { PdfDocument } from '../viewer/pdf-document.js';
import type { PageTextArrays } from '../viewer/viewer.js';

export interface FindOptions {
  query: string;
  caseSensitive: boolean;
  entireWord: boolean;
}

export interface FindHit {
  page: number;
  /** Character offset into the page's concatenated item strings. */
  start: number;
  length: number;
}

interface PageIndex {
  items: string[];
  haystack: string;
  folded: string;
}

interface Span {
  divIdx: number;
  offset: number;
}

interface Segment {
  from: number;
  to: number;
  className: string | null;
}

function fold(value: string): string {
  // Case folding only. Diacritic-insensitive matching is deliberately not claimed.
  return value.toLowerCase();
}

function isWordChar(ch: string | undefined): boolean {
  return ch !== undefined && /[\p{L}\p{N}_]/u.test(ch);
}

/** Maps a character offset onto the span that contains it. */
function locate(items: readonly string[], offset: number): Span {
  let acc = 0;
  for (let i = 0; i < items.length; i++) {
    const len = items[i]?.length ?? 0;
    if (offset < acc + len) return { divIdx: i, offset: offset - acc };
    acc += len;
  }
  const last = items.length - 1;
  return { divIdx: Math.max(0, last), offset: items[last]?.length ?? 0 };
}

export class FindIndex {
  private pages: PageIndex[] = [];
  private hits: FindHit[] = [];
  private cursor = -1;
  private built = false;

  get isBuilt(): boolean {
    return this.built;
  }

  get matches(): readonly FindHit[] {
    return this.hits;
  }

  get currentIndex(): number {
    return this.cursor;
  }

  get currentHit(): FindHit | null {
    return this.hits[this.cursor] ?? null;
  }

  /** Extracts and caches every page's text. Safe to call repeatedly. */
  async build(doc: PdfDocument, onProgress?: (done: number, total: number) => void): Promise<void> {
    if (this.built) return;
    const total = doc.numPages;
    const pages: PageIndex[] = [];
    for (let i = 1; i <= total; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      const items: string[] = [];
      for (const raw of content.items) {
        const str = (raw as { str?: unknown }).str;
        if (typeof str === 'string' && str.length > 0) items.push(str);
      }
      const haystack = items.join('');
      pages.push({ items, haystack, folded: fold(haystack) });
      onProgress?.(i, total);
    }
    this.pages = pages;
    this.built = true;
  }

  clear(): void {
    this.hits = [];
    this.cursor = -1;
  }

  /** Runs the query and returns every hit in document order. */
  search(options: FindOptions): FindHit[] {
    this.clear();
    const query = options.query;
    if (query.length === 0 || !this.built) return [];

    const needle = options.caseSensitive ? query : fold(query);
    const hits: FindHit[] = [];

    for (let p = 0; p < this.pages.length; p++) {
      const page = this.pages[p];
      if (!page) continue;
      const hay = options.caseSensitive ? page.haystack : page.folded;
      let from = 0;
      for (;;) {
        const at = hay.indexOf(needle, from);
        if (at < 0) break;
        from = at + Math.max(1, needle.length);
        if (options.entireWord) {
          const before = hay[at - 1];
          const after = hay[at + needle.length];
          if (isWordChar(before) || isWordChar(after)) continue;
        }
        hits.push({ page: p + 1, start: at, length: needle.length });
      }
    }

    this.hits = hits;
    this.cursor = hits.length > 0 ? 0 : -1;
    return hits;
  }

  next(): FindHit | null {
    if (this.hits.length === 0) return null;
    this.cursor = (this.cursor + 1) % this.hits.length;
    return this.currentHit;
  }

  prev(): FindHit | null {
    if (this.hits.length === 0) return null;
    this.cursor = (this.cursor - 1 + this.hits.length) % this.hits.length;
    return this.currentHit;
  }

  selectAt(index: number): FindHit | null {
    if (index < 0 || index >= this.hits.length) return null;
    this.cursor = index;
    return this.currentHit;
  }

  hitsForPage(page: number): FindHit[] {
    return this.hits.filter((hit) => hit.page === page);
  }

  /**
   * True when the page's live spans still correspond to the indexed text.
   *
   * Only the concatenated string has to match: offsets are mapped onto spans with
   * `locate(arrays.items, …)` at paint time, so per-item structure may legitimately
   * differ between the index and the text layer (the layer keeps empty items, the
   * index drops them).
   */
  private agreesWithIndex(page: number, arrays: PageTextArrays): boolean {
    const index = this.pages[page - 1];
    if (!index) return false;
    return arrays.items.join('') === index.haystack;
  }

  /**
   * Paints every hit for one page into its text layer, marking the current hit.
   * Returns the number of hits painted, or 0 when the page was skipped.
   */
  paint(page: number, arrays: PageTextArrays): number {
    const pageHits = this.hitsForPage(page);
    this.resetPage(arrays);
    if (pageHits.length === 0) return 0;
    if (!this.agreesWithIndex(page, arrays)) return 0;

    // Collect the segments each touched span must be rebuilt from, so that several
    // hits inside one span do not overwrite one another.
    const byDiv = new Map<number, Segment[]>();
    const push = (divIdx: number, seg: Segment): void => {
      const list = byDiv.get(divIdx);
      if (list) list.push(seg);
      else byDiv.set(divIdx, [seg]);
    };

    for (const hit of pageHits) {
      // The `appended` class is required: `.textLayer :is(span, br)` forces
      // `position: absolute` on every span, and only `.appended` resets it to
      // `initial` so the run stays in flow and later text keeps its place.
      const cls = hit === this.currentHit ? 'highlight selected appended' : 'highlight appended';
      const begin = locate(arrays.items, hit.start);
      const end = locate(arrays.items, hit.start + hit.length);
      if (begin.divIdx === end.divIdx) {
        push(begin.divIdx, { from: begin.offset, to: end.offset, className: cls });
      } else {
        push(begin.divIdx, { from: begin.offset, to: arrays.items[begin.divIdx]?.length ?? 0, className: cls });
        for (let n = begin.divIdx + 1; n < end.divIdx; n++) {
          push(n, { from: 0, to: arrays.items[n]?.length ?? 0, className: cls });
        }
        push(end.divIdx, { from: 0, to: end.offset, className: cls });
      }
    }

    for (const [divIdx, segments] of byDiv) {
      const div = arrays.divs[divIdx];
      const source = arrays.items[divIdx];
      if (!div || source === undefined) continue;
      div.textContent = '';
      let at = 0;
      for (const seg of segments.sort((a, b) => a.from - b.from)) {
        if (seg.from > at) div.append(document.createTextNode(source.slice(at, seg.from)));
        const text = source.slice(Math.max(at, seg.from), seg.to);
        if (text.length > 0) {
          const span = document.createElement('span');
          span.className = seg.className ?? '';
          span.textContent = text;
          div.append(span);
        }
        at = Math.max(at, seg.to);
      }
      if (at < source.length) div.append(document.createTextNode(source.slice(at)));
    }

    return pageHits.length;
  }

  /** Restores the page's spans to plain text. */
  resetPage(arrays: PageTextArrays): void {
    const { divs, items } = arrays;
    const n = Math.min(divs.length, items.length);
    for (let i = 0; i < n; i++) {
      const div = divs[i];
      if (!div) continue;
      if (div.childNodes.length === 1 && div.firstChild?.nodeType === Node.TEXT_NODE) {
        if (div.textContent === items[i] && !div.className) continue;
      }
      div.textContent = items[i] ?? '';
      div.className = '';
    }
  }
}
