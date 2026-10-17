/**
 * The list of search matches.
 *
 * A separate panel from the find bar on purpose: the bar answers "where is the next one",
 * which is a question about one match; this answers "where are they all", which is a
 * question about the document. Showing only the bar makes a reader press Enter forty times
 * to learn that a term appears on two pages and once in a footnote.
 */
import type { FindHit, FindIndex } from '../tools/find.js';

export interface SearchResultsOptions {
  /** Go to a match, by index into the current match list. */
  onSelect(index: number): void;
  /** Page label, so the panel never formats page numbers itself. */
  pageLabel(page: number): string;
  /** Text shown when a search found nothing. */
  emptyText(): string;
  /** Text shown before a search has been run. */
  idleText(): string;
  /** "3 matches on 2 pages". */
  summaryText(matches: number, pages: number): string;
}

/** Characters of context kept on each side of a match. */
const CONTEXT = 28;

export class SearchResults {
  private readonly host: HTMLElement;
  private readonly options: SearchResultsOptions;
  private find: FindIndex | null = null;
  private query = '';
  private readonly onActivate = (event: MouseEvent): void => {
    const target = event.target as HTMLElement | null;
    const row = target?.closest<HTMLElement>('[data-hit-index]');
    if (!row) return;
    const index = Number(row.dataset['hitIndex']);
    if (Number.isFinite(index)) this.options.onSelect(index);
  };

  constructor(host: HTMLElement, options: SearchResultsOptions) {
    this.host = host;
    this.options = options;
    this.host.addEventListener('click', this.onActivate);
    this.render();
  }

  /** Points the panel at an index and the query that produced it. */
  setSource(find: FindIndex | null, query: string): void {
    this.find = find;
    this.query = query;
    this.render();
  }

  render(): void {
    this.host.replaceChildren();
    if (!this.find || this.query.trim() === '') {
      const idle = document.createElement('div');
      idle.className = 'search-idle';
      idle.textContent = this.options.idleText();
      this.host.appendChild(idle);
      return;
    }

    const matches = this.find.matches;
    if (matches.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'search-idle';
      empty.textContent = this.options.emptyText();
      this.host.appendChild(empty);
      return;
    }

    // Grouped by page, because that is the order a reader works through a document.
    const byPage = new Map<number, Array<{ hit: FindHit; index: number }>>();
    matches.forEach((hit, index) => {
      const list = byPage.get(hit.page);
      if (list) list.push({ hit, index });
      else byPage.set(hit.page, [{ hit, index }]);
    });

    const summary = document.createElement('div');
    summary.className = 'search-summary';
    summary.textContent = this.options.summaryText(matches.length, byPage.size);
    this.host.appendChild(summary);

    for (const page of [...byPage.keys()].sort((a, b) => a - b)) {
      const entries = byPage.get(page) ?? [];
      const heading = document.createElement('div');
      heading.className = 'search-page';
      heading.textContent = this.options.pageLabel(page);
      this.host.appendChild(heading);

      const text = this.find.textFor(page);
      for (const { hit, index } of entries) {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = `search-hit${index === this.find.currentIndex ? ' current' : ''}`;
        row.dataset['hitIndex'] = String(index);

        const before = text.slice(Math.max(0, hit.start - CONTEXT), hit.start);
        const match = text.slice(hit.start, hit.start + hit.length);
        const after = text.slice(hit.start + hit.length, hit.start + hit.length + CONTEXT);

        const lead = document.createElement('span');
        lead.className = 'search-context';
        lead.textContent = `${hit.start > CONTEXT ? '…' : ''}${collapse(before)}`;

        const marked = document.createElement('mark');
        marked.className = 'search-match';
        marked.textContent = match;

        const tail = document.createElement('span');
        tail.className = 'search-context';
        tail.textContent = `${after.replace(/\s+/g, ' ')}${text.length > hit.start + hit.length + CONTEXT ? '…' : ''}`;

        row.append(lead, marked, tail);
        this.host.appendChild(row);
      }
    }
  }
}

/** Collapses whitespace so a snippet stays on one line. */
function collapse(value: string): string {
  return value.replace(/\s+/g, ' ');
}
