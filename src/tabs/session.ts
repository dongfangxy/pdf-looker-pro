/**
 * One open document.
 *
 * Everything that used to be a module-level singleton in the bootstrap — the loaded
 * document, its path, its annotations, its find index and its saved view position —
 * lives here, so several documents can be open at once without sharing state.
 */
import { AnnotationStore } from '../annotations/model.js';
import { FindIndex } from '../tools/find.js';
import type { OpenedDocument } from '../viewer/pdf-document.js';
import type { ViewerState } from '../viewer/viewer.js';
import { PRODUCT_NAME } from '../product.js';

let counter = 0;

export class DocumentSession {
  readonly id: string;
  readonly annotations = new AnnotationStore();
  readonly findIndex = new FindIndex();

  /** The opened document; `.doc` on it is the pdf.js proxy. */
  opened: OpenedDocument | null = null;
  /** Filesystem path, when the document came from disk rather than a URL. */
  path: string | null = null;
  /** Display name, without the `*` dirty marker. */
  name = '';
  /** Stable identity used for the saved reading position. */
  key: string | null = null;
  /** Annotations hidden for this document only. */
  annotationsHidden = false;
  /** View position captured when the user switched away from this tab. */
  snapshot: Partial<ViewerState> | null = null;

  constructor(name = '') {
    counter += 1;
    this.id = `s${counter}`;
    this.name = name;
  }

  get pageCount(): number {
    return this.opened?.pageCount ?? 0;
  }

  get title(): string {
    return this.name.length > 0 ? this.name : PRODUCT_NAME;
  }

  get hasDocument(): boolean {
    return this.opened !== null;
  }
}
