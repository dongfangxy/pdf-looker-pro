/**
 * Reading-position persistence.
 *
 * Documents are keyed by a hash of pdf.js's content-derived fingerprints rather
 * than by file name or title, so nothing identifying is written to storage and the
 * same file reopened from a different path still resumes.
 */
import type { ZoomMode } from './viewer.js';

/**
 * Persisted zoom mode.
 *
 * Aliased rather than repeated: a second copy of this union drifted out of step the
 * moment a fit mode was added, and the compiler is the right place to notice that.
 */
export type ZoomModeName = ZoomMode;

export interface PersistedState {
  page: number;
  scale: number;
  zoomMode: ZoomModeName;
  rotation: number;
}

const STORAGE_KEY = 'pdfreader.progress.v1';
/** Keeps the store bounded; oldest entries are dropped first. */
const MAX_ENTRIES = 50;

type Store = Record<string, PersistedState>;

/** FNV-1a, 32-bit. Enough to separate documents in a local store. */
function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function documentKey(
  fingerprints: readonly (string | null)[] | undefined,
  pageCount: number,
): string {
  const parts = (fingerprints ?? []).filter((value): value is string => typeof value === 'string' && value.length > 0);
  const basis = parts.length > 0 ? parts.join('|') : `pages:${pageCount}`;
  return fnv1a(basis);
}

function readStore(): Store {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as Store;
  } catch {
    // Corrupt or unavailable storage must not break opening a document.
    return {};
  }
}

function writeStore(store: Store): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // Quota or privacy mode: persistence is best-effort.
  }
}

/**
 * Every zoom mode, as a lookup table.
 *
 * Typed as `Record<ZoomMode, true>` rather than as a hand-written list: adding a mode
 * to the union without adding it here is a compile error, which is the only way to
 * stop the runtime validator drifting away from the type. A stored mode the
 * validator rejects discards the whole saved position.
 */
const ZOOM_MODES: Record<ZoomMode, true> = {
  custom: true,
  'fit-width': true,
  'fit-page': true,
  actual: true,
  'fit-visible': true,
};

function isZoomMode(value: unknown): value is ZoomMode {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(ZOOM_MODES, value);
}

function isState(value: unknown): value is PersistedState {
  if (value === null || typeof value !== 'object') return false;
  const s = value as Partial<PersistedState>;
  return (
    typeof s.page === 'number' &&
    Number.isFinite(s.page) &&
    typeof s.scale === 'number' &&
    Number.isFinite(s.scale) &&
    isZoomMode(s.zoomMode) &&
    typeof s.rotation === 'number' &&
    Number.isFinite(s.rotation)
  );
}

export function loadProgress(key: string): PersistedState | null {
  const value = readStore()[key];
  return isState(value) ? value : null;
}

export function saveProgress(key: string, state: PersistedState): void {
  const store = readStore();
  // Re-insert so the touched entry moves to the end (most recently used).
  delete store[key];
  store[key] = state;

  const keys = Object.keys(store);
  for (const stale of keys.slice(0, Math.max(0, keys.length - MAX_ENTRIES))) {
    delete store[stale];
  }
  writeStore(store);
}

export function clearProgress(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
