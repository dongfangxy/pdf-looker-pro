/**
 * Saved searches.
 *
 * A search is worth keeping when the reader is going to run it again: a term they check
 * every time a new revision arrives, or one they expect to find in the wrong place. What
 * is stored is the question, not its answer -- the hits go stale the moment the document
 * changes, and re-running is the whole point.
 */

export interface SavedSearch {
  id: string;
  name: string;
  query: string;
  caseSensitive: boolean;
  entireWord: boolean;
  /** Where it was run: the open document, or a folder. */
  scope: 'document' | 'folder';
  /** Folder path, when `scope` is `folder`. */
  folder?: string;
}

const STORAGE_KEY = 'pdfreader.searches.v1';
/** More than a reader can keep track of, and enough to survive a lot of experiments. */
const MAX_SAVED = 50;

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Reads the list. Anything malformed is dropped rather than repaired. */
export function loadSavedSearches(): SavedSearch[] {
  const store = storage();
  if (!store) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(store.getItem(STORAGE_KEY) ?? '[]');
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];

  const out: SavedSearch[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const item = entry as Record<string, unknown>;
    const name = typeof item['name'] === 'string' ? item['name'].trim() : '';
    const query = typeof item['query'] === 'string' ? item['query'] : '';
    // A saved search with no name or no question is not a saved search.
    if (name === '' || query === '') continue;
    const scope = item['scope'] === 'folder' ? 'folder' : 'document';
    const folder = typeof item['folder'] === 'string' ? item['folder'] : undefined;
    out.push({
      id: typeof item['id'] === 'string' && item['id'] !== '' ? item['id'] : `${name}-${out.length}`,
      name,
      query,
      caseSensitive: item['caseSensitive'] === true,
      entireWord: item['entireWord'] === true,
      scope,
      ...(folder !== undefined ? { folder } : {}),
    });
  }
  return out.slice(0, MAX_SAVED);
}

export function saveSavedSearches(items: readonly SavedSearch[]): void {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(STORAGE_KEY, JSON.stringify(items.slice(0, MAX_SAVED)));
  } catch {
    // Storage full or denied: the search still works this session, it just will not
    // outlive it. Losing a convenience is not worth an error in the status bar.
  }
}

/** Adds one, replacing a saved search with the same name so re-saving updates it. */
export function addSavedSearch(items: readonly SavedSearch[], entry: SavedSearch): SavedSearch[] {
  const name = entry.name.trim();
  if (name === '') return [...items];
  const rest = items.filter((item) => item.name !== name);
  return [{ ...entry, name }, ...rest].slice(0, MAX_SAVED);
}

export function removeSavedSearch(items: readonly SavedSearch[], id: string): SavedSearch[] {
  return items.filter((item) => item.id !== id);
}
