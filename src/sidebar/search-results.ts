/**
 * The list of search matches.
 *
 * A separate panel from the find bar on purpose: the bar answers "where is the next one",
 * which is a question about one match; this answers "where are they all", which is a
 * question about the document. Showing only the bar makes a reader press Enter forty times
 * to learn that a term appears on two pages and once in a footnote.
 */
import type { FindHit, FindIndex } from '../tools/find.js';

export interface ExternalHit {
  path: string;
  name: string;
  page: number;
  before: string;
  match: string;
  after: string;
}

export interface SavedSearchView {
  id: string;
  name: string;
  query: string;
}

export interface SearchResultsOptions {
  /** Go to a match, by index into the current match list. */
  onSelect(index: number): void;
  /** Page label, so the panel never formats page numbers itself. */
  pageLabel(page: number): string;
  /** Text shown when a search found nothing. */
  emptyText(): string;
  /** Text shown before a search has been run. */
  idleText(): string;
  /** Heading above the saved-search list. */
  savedLabel?(): string;

  /** Run a saved search again. */
  onApplySaved?(id: string): void;
  /** Forget a saved search. */
  onDeleteSaved?(id: string): void;

  /** Open a match found outside the current document. */
  onOpenExternal?(path: string, page: number): void;

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
  /** Hits from a folder search, which replace the in-document list while shown. */
  private external: ExternalHit[] | null = null;
  private externalNote = '';
  private saved: SavedSearchView[] = [];
  private readonly onActivate = (event: MouseEvent): void => {
    const target = event.target as HTMLElement | null;
    const saved = target?.closest<HTMLElement>('[data-saved-id]');
    if (saved) {
      const id = saved.dataset['savedId'];
      if (id) {
        if (target?.closest('[data-action="forget"]')) this.options.onDeleteSaved?.(id);
        else this.options.onApplySaved?.(id);
      }
      return;
    }
    const external = target?.closest<HTMLElement>('[data-file-path]');
    if (external) {
      const path = external.dataset['filePath'];
      const page = Number(external.dataset['filePage'] ?? '1');
      if (path && Number.isFinite(page)) this.options.onOpenExternal?.(path, page);
      return;
    }
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
    this.external = null;
    this.render();
  }

  /** Replaces the saved-search list shown above the results. */
  setSaved(items: readonly SavedSearchView[]): void {
    this.saved = [...items];
    this.render();
  }

  /** Shows hits gathered from a folder, grouped by file and page. */
  setExternal(query: string, hits: ExternalHit[], note = ''): void {
    this.external = hits;
    this.externalNote = note;
    this.query = query;
    this.render();
  }

  render(): void {
    this.host.replaceChildren();
    this.renderSaved();
    if (this.external !== null) {
      this.renderExternal();
      return;
    }
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
  /** The saved-search list, shown above whatever the current search produced. */
  private renderSaved(): void {
    if (this.saved.length === 0) return;

    const heading = document.createElement('div');
    heading.className = 'search-summary';
    heading.textContent = this.options.savedLabel?.() ?? '';
    this.host.appendChild(heading);

    for (const item of this.saved) {
      const row = document.createElement('div');
      row.className = 'search-saved';
      row.dataset['savedId'] = item.id;

      const name = document.createElement('button');
      name.type = 'button';
      name.className = 'search-saved-name';
      name.textContent = item.name;
      name.title = item.query;

      const query = document.createElement('span');
      query.className = 'search-saved-query';
      query.textContent = item.query;

      const forget = document.createElement('button');
      forget.type = 'button';
      forget.className = 'search-saved-forget';
      forget.dataset['action'] = 'forget';
      forget.textContent = '✕';

      row.append(name, query, forget);
      this.host.appendChild(row);
    }
  }

/** Renders the folder-search list, grouped by file and then by page. */
  private renderExternal(): void {
    const hits = this.external ?? [];
    const heading = document.createElement('div');
    heading.className = 'search-summary';
    heading.textContent = this.externalNote;
    this.host.appendChild(heading);

    if (hits.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'search-idle';
      empty.textContent = this.options.emptyText();
      this.host.appendChild(empty);
      return;
    }

    // Grouped by file, then page: a reader picks the document first, then the place in it.
    const byFile = new Map<string, ExternalHit[]>();
    for (const hit of hits) {
      const list = byFile.get(hit.path);
      if (list) list.push(hit);
      else byFile.set(hit.path, [hit]);
    }

    for (const [path, fileHits] of byFile) {
      const file = document.createElement('div');
      file.className = 'search-file';
      file.textContent = `${fileHits[0]?.name ?? path} · ${fileHits.length}`;
      this.host.appendChild(file);

      for (const hit of fileHits) {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'search-hit search-hit-file';
        row.dataset['filePath'] = hit.path;
        row.dataset['filePage'] = String(hit.page);

        const page = document.createElement('span');
        page.className = 'search-file-page';
        page.textContent = String(hit.page);

        const lead = document.createElement('span');
        lead.className = 'search-context';
        lead.textContent = `…${collapse(hit.before)}`;

        const marked = document.createElement('mark');
        marked.className = 'search-match';
        marked.textContent = hit.match;

        const tail = document.createElement('span');
        tail.className = 'search-context';
        tail.textContent = `${collapse(hit.after)}…`;

        row.append(page, lead, marked, tail);
        this.host.appendChild(row);
      }
    }
  }

}

/** Collapses whitespace so a snippet stays on one line. */
function collapse(value: string): string {
  return value.replace(/\s+/g, ' ');
}
