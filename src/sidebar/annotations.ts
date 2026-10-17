/**
 * Annotation side panel.
 *
 * Lists every annotation in the document grouped by page, jumps to one when picked,
 * and deletes individual entries. It is driven entirely by the store, so it stays
 * correct no matter whether an annotation was created by a gesture, loaded from a
 * sidecar, or imported.
 */
import type { Annotation, AnnotationStore, AnnotKind } from '../annotations/model.js';

export interface AnnotationPanelOptions {
  onNavigate(page: number): void;
  onSelect(id: string | null): void;
  onDelete(id: string): void;
  emptyText(): string;
  countText(count: number): string;
  kindLabel(kind: AnnotKind): string;
}

const KIND_MARK: Record<AnnotKind, string> = {
  highlight: '▮',
  underline: '▁',
  strikeout: '▬',
  ink: '✎',
  note: '❐',
  rect: '▢',
  ellipse: '◯',
  arrow: '↗',
  textbox: 'T',
  callout: '❐',
  'measure-distance': '↔',
  'measure-perimeter': '⬡',
  stamp: 'annotStamp',
  'measure-area': '▧',
};

export class AnnotationPanel {
  private readonly host: HTMLElement;
  private store: AnnotationStore;
  private readonly options: AnnotationPanelOptions;
  private selectedId: string | null = null;

  constructor(host: HTMLElement, store: AnnotationStore, options: AnnotationPanelOptions) {
    this.host = host;
    this.store = store;
    this.options = options;
    this.host.addEventListener('click', this.onClick);
    this.render();
  }

  /** Points the panel at another document's annotations. */
  setStore(store: AnnotationStore): void {
    this.store = store;
    this.selectedId = null;
    this.render();
  }

  setSelected(id: string | null): void {
    if (this.selectedId === id) return;
    this.selectedId = id;
    this.render();
  }

  private readonly onClick = (event: MouseEvent): void => {
    const target = event.target as HTMLElement | null;
    const row = target?.closest<HTMLElement>('[data-annot-id]');
    if (!row) return;
    const id = row.dataset['annotId'];
    if (!id) return;
    if (target?.closest('[data-action="delete"]')) {
      this.options.onDelete(id);
      return;
    }
    const item = this.store.byId(id);
    if (!item) return;
    this.selectedId = id;
    this.options.onSelect(id);
    this.options.onNavigate(item.page);
    this.render();
  };

  render(): void {
    const items = this.store.all;
    this.host.replaceChildren();

    const summary = document.createElement('div');
    summary.className = 'annot-summary';
    summary.textContent = this.options.countText(items.length);
    this.host.appendChild(summary);

    if (items.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'annot-empty';
      empty.textContent = this.options.emptyText();
      this.host.appendChild(empty);
      return;
    }

    const byPage = new Map<number, Annotation[]>();
    for (const item of items) {
      const list = byPage.get(item.page);
      if (list) list.push(item);
      else byPage.set(item.page, [item]);
    }

    for (const page of [...byPage.keys()].sort((a, b) => a - b)) {
      const heading = document.createElement('div');
      heading.className = 'annot-page';
      heading.textContent = String(page);
      this.host.appendChild(heading);

      for (const item of byPage.get(page) ?? []) {
        const row = document.createElement('div');
        row.className = `annot-row${item.id === this.selectedId ? ' selected' : ''}`;
        row.dataset['annotId'] = item.id;

        const mark = document.createElement('span');
        mark.className = 'annot-mark';
        mark.textContent = KIND_MARK[item.kind];
        mark.style.color = item.color;
        row.appendChild(mark);

        const body = document.createElement('div');
        body.className = 'annot-body';
        // The author is what makes a comment attributable when several people annotate the
    // same file, so it belongs on the row rather than buried in the detail.
    if (item.author) {
      const author = document.createElement('div');
      author.className = 'annot-author';
      author.textContent = item.author;
      row.appendChild(author);
    }
    const label = document.createElement('div');
        label.className = 'annot-kind';
        label.textContent = this.options.kindLabel(item.kind);
        body.appendChild(label);

        const excerpt = (item.note ?? item.text ?? '').trim();
        if (excerpt.length > 0) {
          const text = document.createElement('div');
          text.className = 'annot-text';
          text.textContent = excerpt.length > 90 ? `${excerpt.slice(0, 90)}…` : excerpt;
          body.appendChild(text);
        }
        row.appendChild(body);

        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'annot-delete';
        del.dataset['action'] = 'delete';
        del.textContent = '✕';
        del.title = this.options.kindLabel(item.kind);
        row.appendChild(del);

        this.host.appendChild(row);
      }
    }
  }
}
