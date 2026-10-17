/**
 * Application bootstrap.
 *
 * Every control is addressed by a numeric **command id**, and all visible text comes
 * from the loaded language pack:
 *
 *   short    -> the control's own label
 *   tooltip  -> the control's hover title
 *   status   -> the status-bar description shown while hovered
 *   title    -> the full label, used where there is room
 *
 * The same command table drives the native menu when running inside Electron, so a
 * language switch relabels the menu bar as well as the toolbar.
 */
import './styles/main.css';
import { openFromArrayBuffer, type OpenedDocument } from './viewer/pdf-document.js';
import { Viewer, type ViewMode, type ViewerState } from './viewer/viewer.js';
import { ThumbnailStrip } from './sidebar/thumbnails.js';
import { renderOutline } from './sidebar/outline.js';
import { AnnotationPanel } from './sidebar/annotations.js';
import { ToolManager, type ToolName } from './tools/tool-manager.js';
import { FindIndex } from './tools/find.js';
import { documentKey, loadProgress, saveProgress } from './viewer/progress.js';
import { showPackDialog, showPromptDialog } from './ui/dialog.js';
import { showSettingsDialog, type SettingsField } from './ui/settings-dialog.js';
import { showAboutDialog } from './ui/about-dialog.js';
import { ENGINE_LICENCE, ENGINE_NAME, LICENCE_NOTE, PRODUCT_AUTHOR, PRODUCT_DESCRIPTION, PRODUCT_EMAIL, PRODUCT_NAME, PRODUCT_TAGLINE, PRODUCT_VERSION } from './product.js';
import { loadResourcePack, type ResourcePack } from './assets/registry.js';
import { AnnotationLayer, annotationKindForTool } from './annotations/layer.js';
import { writeAnnotations, type PdfAnnotationInput } from './pdf/annotate.js';
import { readAnnotations } from './pdf/import.js';
import { PdfDocument } from './pdf/document.js';
import type { PdfValue } from './pdf/syntax.js';
import { builtinStyles, StyleStore, type AnnotationStyle } from './annotations/styles.js';
import type { MeasureUnit } from './tools/measure.js';
import { readUserUnit } from './tools/measure.js';
import type { Annotation } from './annotations/model.js';
import { AnnotationStore, DEFAULT_COLORS, PALETTE, parseAnnotations, type AnnotKind } from './annotations/model.js';
import { packAnnotations, sidecarPathFor, unpackAnnotations } from './annotations/sidecar.js';
import { applyMenu, desktop, isDesktop, setWindowTitle, type MenuDescriptor, type MenuItem } from './platform/desktop.js';
import { DocumentSession } from './tabs/session.js';
import { TabBar } from './tabs/tab-bar.js';
import { CMD, DIALOG, PROPS_ITEM, i18n, validateLanguagePack } from './i18n/index.js';

function mustFind<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing element #${id}`);
  return el as T;
}

const ui = {
  sidebar: mustFind<HTMLElement>('sidebar'),
  btnSidebar: mustFind<HTMLButtonElement>('btn-sidebar'),
  tabThumbnails: mustFind<HTMLButtonElement>('tab-thumbnails'),
  tabOutline: mustFind<HTMLButtonElement>('tab-outline'),
  tabAnnotations: mustFind<HTMLButtonElement>('tab-annotations'),
  paneThumbnails: mustFind<HTMLElement>('pane-thumbnails'),
  paneOutline: mustFind<HTMLElement>('pane-outline'),
  paneAnnotations: mustFind<HTMLElement>('pane-annotations'),
  thumbnails: mustFind<HTMLElement>('thumbnails'),
  outline: mustFind<HTMLElement>('outline'),
  annotations: mustFind<HTMLElement>('annotations'),

  open: mustFind<HTMLButtonElement>('btn-open'),
  fileInput: mustFind<HTMLInputElement>('file-input'),
  prev: mustFind<HTMLButtonElement>('btn-prev'),
  next: mustFind<HTMLButtonElement>('btn-next'),
  pageInput: mustFind<HTMLInputElement>('page-input'),
  pageTotal: mustFind<HTMLSpanElement>('page-total'),
  zoomOut: mustFind<HTMLButtonElement>('btn-zoom-out'),
  zoomIn: mustFind<HTMLButtonElement>('btn-zoom-in'),
  zoomLabel: mustFind<HTMLSpanElement>('zoom-label'),
  fitWidth: mustFind<HTMLButtonElement>('btn-fit-width'),
  fitPage: mustFind<HTMLButtonElement>('btn-fit-page'),
  rotate: mustFind<HTMLButtonElement>('btn-rotate'),
  findOpen: mustFind<HTMLButtonElement>('btn-find'),
  props: mustFind<HTMLButtonElement>('btn-props'),
  about: mustFind<HTMLButtonElement>('btn-about'),
  title: mustFind<HTMLDivElement>('doc-title'),
  pages: mustFind<HTMLDivElement>('pages'),
  content: mustFind<HTMLDivElement>('scroll-container').parentElement as HTMLDivElement,
  tabBar: mustFind<HTMLElement>('tab-bar'),
  toolbar: document.querySelector<HTMLElement>('.toolbar') as HTMLElement,
  moreList: mustFind<HTMLElement>('more-list'),
  moreReset: mustFind<HTMLButtonElement>('more-reset'),
  btnFirst: mustFind<HTMLButtonElement>('btn-first'),
  btnLast: mustFind<HTMLButtonElement>('btn-last'),
  btnCloseDoc: mustFind<HTMLButtonElement>('btn-close-doc'),
  savePdf: mustFind<HTMLButtonElement>('btn-save-pdf'),
  scroll: mustFind<HTMLDivElement>('scroll-container'),
  dropHint: mustFind<HTMLDivElement>('drop-hint'),
  dropTitle: mustFind<HTMLDivElement>('drop-title'),
  dropSub: mustFind<HTMLDivElement>('drop-sub'),
  statusBar: mustFind<HTMLDivElement>('status-bar'),
  statusText: mustFind<HTMLSpanElement>('status-text'),

  toolHand: mustFind<HTMLButtonElement>('tool-hand'),
  toolSelect: mustFind<HTMLButtonElement>('tool-select'),
  toolZoom: mustFind<HTMLButtonElement>('tool-zoom'),
  toolSnapshot: mustFind<HTMLButtonElement>('tool-snapshot'),

  annotHighlight: mustFind<HTMLButtonElement>('annot-highlight'),
  annotUnderline: mustFind<HTMLButtonElement>('annot-underline'),
  annotStrikeout: mustFind<HTMLButtonElement>('annot-strikeout'),
  annotInk: mustFind<HTMLButtonElement>('annot-ink'),
  annotNote: mustFind<HTMLButtonElement>('annot-note'),
  annotRect: mustFind<HTMLButtonElement>('annot-rect'),
  annotEllipse: mustFind<HTMLButtonElement>('annot-ellipse'),
  annotArrow: mustFind<HTMLButtonElement>('annot-arrow'),
  annotTextbox: mustFind<HTMLButtonElement>('annot-textbox'),
  annotCallout: mustFind<HTMLButtonElement>('annot-callout'),
  measureDistance: mustFind<HTMLButtonElement>('measure-distance'),
  measurePerimeter: mustFind<HTMLButtonElement>('measure-perimeter'),
  measureArea: mustFind<HTMLButtonElement>('measure-area'),
  toolPointer: mustFind<HTMLButtonElement>('tool-pointer'),
  annotToggle: mustFind<HTMLButtonElement>('annot-toggle'),
  styleList: mustFind<HTMLElement>('style-list'),
  styleSave: mustFind<HTMLButtonElement>('style-save'),
  exportPage: mustFind<HTMLButtonElement>('btn-export-page'),
  annotColor: mustFind<HTMLInputElement>('annot-color'),
  annotSwatches: mustFind<HTMLElement>('annot-swatches'),
  settings: mustFind<HTMLButtonElement>('btn-settings'),
  btnMore: mustFind<HTMLButtonElement>('btn-more'),
  btnColor: mustFind<HTMLButtonElement>('btn-color'),
  overflowMenu: mustFind<HTMLElement>('overflow-menu'),
  colorPopup: mustFind<HTMLElement>('color-popup'),
  strokeSolid: mustFind<HTMLButtonElement>('stroke-solid'),
  strokeDash: mustFind<HTMLButtonElement>('stroke-dash'),
  fontSize: mustFind<HTMLInputElement>('font-size'),
  fontSizeValue: mustFind<HTMLElement>('font-size-value'),
  fontSizeLabel: mustFind<HTMLElement>('font-size-label'),
  strokeWidth: mustFind<HTMLInputElement>('stroke-width'),
  strokeWidthValue: mustFind<HTMLElement>('stroke-width-value'),
  strokeStyleLabel: mustFind<HTMLElement>('stroke-style-label'),
  strokeWidthLabel: mustFind<HTMLElement>('stroke-width-label'),

  viewContinuous: mustFind<HTMLButtonElement>('view-continuous'),
  viewSingle: mustFind<HTMLButtonElement>('view-single'),
  viewSpread: mustFind<HTMLButtonElement>('view-spread'),
  viewFullscreen: mustFind<HTMLButtonElement>('view-fullscreen'),

  findBar: mustFind<HTMLDivElement>('find-bar'),
  findInput: mustFind<HTMLInputElement>('find-input'),
  findCount: mustFind<HTMLSpanElement>('find-count'),
  findPrev: mustFind<HTMLButtonElement>('find-prev'),
  findNext: mustFind<HTMLButtonElement>('find-next'),
  findCase: mustFind<HTMLInputElement>('find-case'),
  findWord: mustFind<HTMLInputElement>('find-word'),
  findClose: mustFind<HTMLButtonElement>('find-close'),
  findCaseLabel: mustFind<HTMLLabelElement>('find-case-label'),
  findWordLabel: mustFind<HTMLLabelElement>('find-word-label'),
};

if (new URLSearchParams(location.search).get('debug') === 'text') {
  document.body.classList.add('debug-text');
}

// Test seams, opt-in by query parameter.
const debugFlag = new URLSearchParams(location.search).get('debug');
if (debugFlag === 'i18n') {
  const hooks = window as unknown as Record<string, unknown>;
  hooks['__i18n'] = i18n;
  hooks['__validatePack'] = validateLanguagePack;
  hooks['__cmd'] = CMD;
}
if (debugFlag === 'res') {
  const hooks = window as unknown as Record<string, unknown>;
  hooks['__packReady'] = () => packReady;
  hooks['__pack'] = () => pack;
}
if (debugFlag === 'p5') {
  const hooks = window as unknown as Record<string, unknown>;
  hooks['__store'] = () => annotations;
  hooks['__addRect'] = (page: number, x: number, y: number, w: number, h: number, kind: AnnotKind = 'rect') => {
    annotations.add({ page, kind, color: DEFAULT_COLORS[kind], rect: { x, y, w, h } });
  };
  hooks['__saveAnnotations'] = () => saveAnnotations();

  // ---- writing annotations into the PDF ----
  hooks['__writePdf'] = (pages?: number[]) => buildAnnotatedPdf(pages);
  // Reads the private entries back with this project's own parser.
  hooks['__importFromPdf'] = async (bytes: Uint8Array) => {
    const found = await readAnnotations(bytes);
    return found.map((item) => ({
      page: item.page,
      kind: item.kind,
      color: item.color,
      rect: item.rect ?? null,
      rects: item.rects ?? null,
      strokes: item.strokes ?? null,
      note: item.note ?? null,
      fontSize: item.fontSize ?? null,
      strokeWidth: item.strokeWidth ?? null,
      strokeDash: item.strokeDash ?? null,
    }));
  };

  hooks['__readPdfPrivate'] = async (bytes: Uint8Array) => {
    const doc = await PdfDocument.parse(bytes);
    const pages = await doc.pages();
    const out: Array<Record<string, unknown>> = [];
    for (let index = 0; index < pages.length; index++) {
      const page = pages[index]!;
      const list = await doc.array(page.annots);
      for (const entry of list?.value ?? []) {
        const obj = await doc.dict(entry);
        if (!obj) continue;
        const priv = await doc.dict(obj.value.get('PLP'));
        if (!priv) continue;
        const read = (key: string): PdfValue | undefined => priv.value.get(key);
        const k = read('K');
        const w = read('W');
        const fs_ = read('F');
        const d = read('D');
        out.push({
          page: index + 1,
          kind: k?.kind === 'name' ? k.value : null,
          strokeWidth: w?.kind === 'number' ? w.value : undefined,
          fontSize: fs_?.kind === 'number' ? fs_.value : undefined,
          strokeDash: d?.kind === 'bool' ? d.value : undefined,
        });
      }
    }
    return out;
  };

  hooks['__roundTripRender'] = async (bytes: Uint8Array) => {
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const opened = await openFromArrayBuffer(buffer as ArrayBuffer, 'roundtrip.pdf');
    try {
      const pdfPage = await opened.doc.getPage(1);
      const list = await pdfPage.getAnnotations();
      const viewport = pdfPage.getViewport({ scale: 1 });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const context = canvas.getContext('2d');
      if (context) await pdfPage.render({ canvasContext: context, viewport, canvas } as never).promise;
      return { pages: opened.pageCount, annots: list.length, rendered: context ? 1 : 0 };
    } finally {
      await opened.doc.destroy();
    }
  };

  hooks['__pdfDebug'] = async () => {
    const source = activeSession?.bytes;
    if (!source) return { error: 'no bytes' };
    const doc = await PdfDocument.parse(new Uint8Array(source));
    let pages: Array<{ num: number; box: number[]; rotate: number }> = [];
    let pageError: string | null = null;
    try {
      pages = (await doc.pages()).map((p) => ({ num: p.num, box: p.mediaBox, rotate: p.rotate }));
    } catch (error) {
      pageError = String((error as Error)?.message ?? error);
    }
    return {
      pageError,
      startxref: doc.startxref,
      size: doc.size,
      encrypted: doc.encrypted,
      trailerKeys: [...doc.trailer.keys()],
      rootRef: doc.rootRef ? JSON.stringify(doc.rootRef) : null,
      pages,
    };
  };
  hooks['__loadPdfAnnotations'] = async (bytes: ArrayBuffer | Uint8Array) => {
    const buffer =
      bytes instanceof Uint8Array
        ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
        : bytes;
    const opened = await openFromArrayBuffer(buffer as ArrayBuffer, 'roundtrip.pdf');
    try {
      const out: Array<Record<string, unknown>> = [];
      for (let index = 1; index <= opened.pageCount; index++) {
        const pdfPage = await opened.doc.getPage(index);
        const list = await pdfPage.getAnnotations();
        for (const entry of list) {
          const record = entry as unknown as Record<string, unknown>;
          const priv = record['plp'] as { K?: string } | undefined;
          out.push({
            page: index,
            subtype: record['subtype'],
            rect: record['rect'],
            contents: (record['contentsObj'] as { str?: string } | undefined)?.str ?? null,
            color: record['color'] ?? null,
            kind: priv?.K ?? null,
            quadPoints: record['quadPoints'] ?? null,
            inkLists: record['inkLists'] ?? null,
            line: record['lineCoordinates'] ?? null,
            vertices: record['vertices'] ?? null,
          });
        }
      }
      return out;
    } finally {
      await opened.doc.destroy();
    }
  };
  hooks['__exportJson'] = () => exportAnnotationsJson();
}

/** Controls whose glyph comes from the resource pack, keyed by asset name. */
const ICON_ELEMENTS: Record<string, HTMLElement> = {
  'tool-hand': ui.toolHand,
  'tool-select': ui.toolSelect,
  'tool-zoom': ui.toolZoom,
  'tool-snapshot': ui.toolSnapshot,
  'tab-thumbnails': ui.tabThumbnails,
  'tab-outline': ui.tabOutline,
  'tab-annotations': ui.tabAnnotations,
  settings: ui.settings,
  'tool-pointer': ui.toolPointer,
  'annot-highlight': ui.annotHighlight,
  'annot-underline': ui.annotUnderline,
  'annot-strikeout': ui.annotStrikeout,
  'annot-ink': ui.annotInk,
  'annot-note': ui.annotNote,
  'annot-rect': ui.annotRect,
  'annot-ellipse': ui.annotEllipse,
  'annot-arrow': ui.annotArrow,
  'annot-textbox': ui.annotTextbox,
  'annot-callout': ui.annotCallout,
};

let packReady = false;
let pack: ResourcePack | null = null;

// --------------------------------------------------------- command dispatch

interface CommandBinding {
  id: number;
  element: HTMLElement;
  labelSlot: 'title' | 'short';
}

const bindings: CommandBinding[] = [];
const handlers = new Map<number, (data?: string) => void>();

/** Registers a handler for a command; the native menu dispatches through this too. */
function registerCommand(id: number, handler: (data?: string) => void): void {
  handlers.set(id, handler);
}

function dispatchCommand(id: number, data?: string): void {
  const handler = handlers.get(id);
  if (handler) handler(data);
}

function bindCommand(
  id: number,
  element: HTMLElement,
  options: { labelSlot?: 'title' | 'short'; onClick?: (data?: string) => void } = {},
): void {
  bindings.push({ id, element, labelSlot: options.labelSlot ?? 'short' });
  if (options.onClick) {
    registerCommand(id, options.onClick);
    element.addEventListener('click', () => options.onClick?.());
  }
  const announce = (): void => {
    const status = i18n.resolveCommand(id)?.status ?? '';
    if (status !== '') setStatus(status);
  };
  element.addEventListener('mouseenter', announce);
  element.addEventListener('focus', announce);
}

/** Writes a command label into the element, or into its label span when one exists. */
function setElementLabel(element: HTMLElement, label: string): void {
  if (label.length === 0) return;
  const span = element.querySelector<HTMLElement>(':scope > .btn-label');
  if (span) span.textContent = label;
  else element.textContent = label;
}

function applyCommandLabels(): void {
  for (const binding of bindings) {
    const resolved = i18n.resolveCommand(binding.id);
    if (!resolved) continue;
    const label = binding.labelSlot === 'title' ? resolved.title : resolved.short;
    setElementLabel(binding.element, label);
    binding.element.title = resolved.tooltip;
    binding.element.dataset['command'] = String(binding.id);
    binding.element.dataset['commandSource'] = resolved.sources.title;
  }
}

function setLabelText(label: HTMLLabelElement, text: string): void {
  for (const node of Array.from(label.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) node.remove();
  }
  label.append(text);
}

function applyStrings(): void {
  ui.dropTitle.textContent = i18n.t('dropTitle');
  ui.dropSub.textContent = i18n.t('dropSub');
  const findTitle = i18n.resolveCommand(CMD.Find)?.title ?? ui.findInput.placeholder;
  ui.findInput.placeholder = `${findTitle}…`;
  ui.findInput.setAttribute('aria-label', findTitle);
  setLabelText(ui.findCaseLabel, i18n.t('findCase'));
  setLabelText(ui.findWordLabel, i18n.t('findWord'));
  ui.annotColor.title = i18n.t('annotColor');
  ui.strokeStyleLabel.textContent = i18n.t('strokeStyle');
  ui.strokeSolid.textContent = i18n.t('strokeSolid');
  ui.strokeDash.textContent = i18n.t('strokeDash');
  ui.strokeWidthLabel.textContent = i18n.t('strokeWidth');
  ui.fontSizeLabel.textContent = i18n.t('fontSize');
  if (findIndex.matches.length === 0 && ui.findInput.value.length === 0) ui.findCount.textContent = '–';
  document.documentElement.lang = i18n.languageId;
  annotPanel.render();
}

function setStatus(text: string, isError = false): void {
  ui.statusText.textContent = text;
  ui.statusBar.classList.toggle('error', isError);
}

function toolCommandId(tool: ToolName): number {
  switch (tool) {
    case 'hand':
      return CMD.ToolHand;
    case 'zoom':
      return CMD.ToolZoom;
    case 'snapshot':
      return CMD.ToolSnapshot;
    case 'pointer':
      return CMD.ToolPointer;
    case 'ellipse':
      return CMD.AnnotEllipse;
    case 'arrow':
      return CMD.AnnotArrow;
    case 'textbox':
      return CMD.AnnotTextbox;
    case 'callout':
      return CMD.AnnotCallout;
    case 'measure-distance':
      return CMD.AnnotMeasureDistance;
    case 'measure-perimeter':
      return CMD.AnnotMeasurePerimeter;
    case 'measure-area':
      return CMD.AnnotMeasureArea;
    case 'highlight':
      return CMD.AnnotHighlight;
    case 'underline':
      return CMD.AnnotUnderline;
    case 'strikeout':
      return CMD.AnnotStrikeout;
    case 'ink':
      return CMD.AnnotInk;
    case 'note':
      return CMD.AnnotNote;
    case 'rect':
      return CMD.AnnotRect;
    default:
      return CMD.ToolSelect;
  }
}

function hintFor(tool: ToolName): string {
  return i18n.resolveCommand(toolCommandId(tool))?.status ?? '';
}

// ---------------------------------------------------------------- documents

interface RecentEntry {
  path: string;
  name: string;
  at: number;
}

// Mirrors of the active session. `bindSession` is the only writer, so every helper
// below keeps addressing "the current document" without knowing about tabs.
let currentDoc: OpenedDocument | null = null;
let currentPath: string | null = null;
let currentName = '';
let saveTimer = 0;
let recentFiles: RecentEntry[] = [];

function scheduleSave(state: ViewerState): void {
  const key = activeSession?.key ?? null;
  if (!key) return;
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => saveProgress(key, state), 400);
}

let annotations = new AnnotationStore();

const annotationLayer = new AnnotationLayer({
  scroll: ui.scroll,
  store: annotations,
  geometryFor: (page) => viewer.pageGeometry(page),
  pageAtPoint: (x, y) => viewer.pageAtPoint(x, y),
  currentTool: () => tools.tool,
  onStatus: (text, isError) => setStatus(text, isError ?? false),
  onChanged: () => {
    annotPanel.render();
    thumbnails.setCurrentPage(viewer.page);
    void refreshTitle();
  },
  // Creating something returns to the pointer so it can be moved or edited at once,
  // instead of leaving the user in a mode where the next click makes another one.
  onCreated: () => {
    if (tools.tool !== 'pointer') tools.setTool('pointer');
  },
  onSelectionChange: (id) => {
    ui.statusBar.classList.toggle('has-selection', id !== null);
  },
  deleteLabel: () => i18n.resolveCommand(CMD.AnnotDelete)?.tooltip ?? 'Delete',
  measure: {
    userUnit: (page) => userUnitFor(page),
    unit: () => measureUnit,
  },
  promptNote: () => showPromptDialog(i18n, { title: i18n.resolveCommand(CMD.AnnotNote)?.title ?? 'Note', label: i18n.t('annotNotePrompt') }),
});

const viewer = new Viewer(ui.pages, ui.scroll, {
  onPageChange: (page, total) => {
    ui.pageInput.value = String(page);
    ui.pageTotal.textContent = `/ ${total}`;
    ui.prev.disabled = page <= 1;
    ui.next.disabled = page >= total;
    thumbnails.setCurrentPage(page);
    viewer.markCurrentPage(page);
  },
  onZoomChange: (percent, mode) => {
    ui.zoomLabel.textContent = `${percent}%`;
    ui.fitWidth.classList.toggle('primary', mode === 'fit-width');
    ui.fitPage.classList.toggle('primary', mode === 'fit-page');
    annotationLayer.refreshAll();
  },
  onStatus: (text, isError) => setStatus(text, isError),
  onStateChange: (state) => scheduleSave(state),
  onPageRendered: (pageNumber) => {
    const arrays = viewer.textLayerArrays(pageNumber);
    if (arrays) findIndex.paint(pageNumber, arrays);
    annotationLayer.renderPage(pageNumber);
  },
});

const thumbnails = new ThumbnailStrip(ui.thumbnails, {
  onNavigate: (page) => viewer.gotoPage(page),
});

let findIndex = new FindIndex();

const annotPanel = new AnnotationPanel(ui.annotations, annotations, {
  onNavigate: (page) => viewer.gotoPage(page),
  onSelect: (id) => annotationLayer.select(id),
  onDelete: (id) => annotations.remove(id),
  emptyText: () => i18n.t('annotEmpty'),
  countText: (count) => `${count} ${i18n.t('annotCount')}`,
  kindLabel: (kind) => i18n.resolveCommand(kindCommandId(kind))?.title ?? kind,
});

/**
 * Creates a session with its change subscription already attached.
 *
 * The subscription has to be per session: `annotations` is a mirror of the active
 * session, so a single module-level listener would stay bound to whichever store
 * existed first and every later tab would lose its repaints.
 */
function createSession(name = ''): DocumentSession {
  const session = new DocumentSession(name);
  session.annotations.onChange(() => {
    // A background tab only needs its dirty marker refreshed.
    if (session !== activeSession) {
      renderTabs();
      return;
    }
    annotationLayer.refreshAll();
    annotPanel.render();
    void refreshTitle();
    renderTabs();
  });
  return session;
}

const styles = new StyleStore();
/** Which preset was applied last, so the menu can mark it. */
let activeStyleId: string | null = null;

/** Every preset: generated built-ins first, then the reader's own. */
function allStyles(): AnnotationStyle[] {
  return [...builtinStyles((kind) => i18n.resolveCommand(kindCommandId(kind))?.title ?? kind), ...styles.all];
}

function renderStyles(): void {
  ui.styleList.replaceChildren();
  for (const style of allStyles()) {
    const row = document.createElement('div');
    row.className = `style-row${style.id === activeStyleId ? ' active' : ''}`;
    row.dataset['styleId'] = style.id;
    row.title = style.builtin ? i18n.t('styleBuiltin') : style.name;

    const dot = document.createElement('span');
    dot.className = 'style-dot';
    dot.style.background = style.color;
    row.appendChild(dot);

    const name = document.createElement('span');
    name.className = 'style-name';
    name.textContent = style.name;
    row.appendChild(name);

    if (!style.builtin) {
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'style-del';
      del.dataset['action'] = 'delete';
      del.textContent = '✕';
      del.title = i18n.t('styleDelete');
      row.appendChild(del);
    }
    ui.styleList.appendChild(row);
  }
}

/** Applies a preset: its tool and its colour. */
function applyStyle(style: AnnotationStyle): void {
  activeStyleId = style.id;
  ui.annotColor.value = style.color;
  annotationLayer.setActiveColor(style.color);
  tools.setTool(style.kind as unknown as ToolName);
  renderStyles();
  closePopups();
  setStatus(`${style.name} · ${style.color}`);
}

async function persistStyles(): Promise<void> {
  const payload = styles.toJSON();
  const bridge = desktop;
  if (bridge) {
    await bridge.settings.patch({ styles: payload } as never);
    return;
  }
  try {
    const raw = JSON.parse(localStorage.getItem(settingsStorageKey()) ?? '{}') as Record<string, unknown>;
    raw['styles'] = payload;
    localStorage.setItem(settingsStorageKey(), JSON.stringify(raw));
  } catch {
    // Losing the presets only costs the next launch its custom styles.
  }
}

/** Saves the active tool and colour as a new named preset. */
async function saveCurrentStyle(): Promise<void> {
  const kind = annotationKindForTool(tools.tool);
  if (!kind) {
    setStatus(i18n.t('styleNeedsTool'), true);
    return;
  }
  const name = await showPromptDialog(i18n, {
    title: i18n.t('styleSave'),
    label: i18n.t('styleName'),
    initial: '',
  });
  if (name === null || name.trim().length === 0) return;
  const style = styles.add(name, kind, ui.annotColor.value, 12);
  activeStyleId = style.id;
  await persistStyles();
  renderStyles();
  setStatus(`${i18n.t('styleSaved')}: ${style.name}`);
}

function kindCommandId(kind: AnnotKind): number {
  switch (kind) {
    case 'highlight':
      return CMD.AnnotHighlight;
    case 'underline':
      return CMD.AnnotUnderline;
    case 'strikeout':
      return CMD.AnnotStrikeout;
    case 'ink':
      return CMD.AnnotInk;
    case 'note':
      return CMD.AnnotNote;
    default:
      return CMD.AnnotRect;
  }
}

const tools = new ToolManager({
  overlayHost: ui.content,
  scroll: ui.scroll,
  viewer,
  onStatus: (text, isError) => setStatus(text, isError ?? false),
  messages: {
    snapshotExported: (width, height) => `${i18n.t('snapshotDone')}：${width}×${height}`,
    snapshotFailed: (reason) => `${i18n.t('snapshotFail')}：${reason}`,
    reasonNotOnPage: i18n.t('snapshotNotOnPage'),
    reasonNoElement: i18n.t('snapshotNoElement'),
    reasonOutOfPage: i18n.t('snapshotOutOfPage'),
  },
  onSnapshot: (blob, name) => {
    downloadBlob(blob, name);
    setStatus(`${i18n.t('snapshotDone')}: ${name}`);
  },
  onToolChange: (tool) => {
    updateToolButtons(tool);
    annotationLayer.setActiveColor(ui.annotColor.value);
    setStatus(hintFor(tool));
  },
});

function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function updateToolButtons(active: ToolName): void {
  const map: Record<string, HTMLButtonElement> = {
    hand: ui.toolHand,
    select: ui.toolSelect,
    zoom: ui.toolZoom,
    snapshot: ui.toolSnapshot,
    highlight: ui.annotHighlight,
    underline: ui.annotUnderline,
    strikeout: ui.annotStrikeout,
    ink: ui.annotInk,
    note: ui.annotNote,
    rect: ui.annotRect,
    ellipse: ui.annotEllipse,
    arrow: ui.annotArrow,
    textbox: ui.annotTextbox,
    callout: ui.annotCallout,
    pointer: ui.toolPointer,
    'measure-distance': ui.measureDistance,
    'measure-perimeter': ui.measurePerimeter,
    'measure-area': ui.measureArea,
  };
  for (const [name, button] of Object.entries(map)) {
    button.classList.toggle('active', name === active);
  }
}

// --------------------------------------------------------------- settings

type ThemeName = 'dark' | 'light' | 'sepia' | 'contrast';
type PageGap = 'compact' | 'normal' | 'roomy';
type DefaultZoom = 'fit-width' | 'fit-page' | 'actual';

const THEME_LABELS: Record<ThemeName, string> = {
  dark: 'themeDark',
  light: 'themeLight',
  sepia: 'themeSepia',
  contrast: 'themeContrast',
};

const PAGE_GAPS: Record<PageGap, string> = { compact: '4px', normal: '12px', roomy: '24px' };

interface AppSettings {
  theme: ThemeName;
  showStatusBar: boolean;
  pageGap: PageGap;
  defaultViewMode: ViewMode;
  defaultZoomMode: DefaultZoom;
}

const DEFAULT_APP_SETTINGS: AppSettings = {
  theme: 'dark',
  showStatusBar: true,
  pageGap: 'normal',
  defaultViewMode: 'continuous',
  defaultZoomMode: 'fit-width',
};

let appSettings: AppSettings = { ...DEFAULT_APP_SETTINGS };

function settingsStorageKey(): string {
  return 'pdfreader.settings.v1';
}

/** Applies a theme by attribute so every custom property switches at once. */
function applyTheme(name: ThemeName): void {
  appSettings.theme = name;
  document.documentElement.dataset['theme'] = name;
}

function applyReadingSettings(): void {
  document.documentElement.style.setProperty('--page-gap', PAGE_GAPS[appSettings.pageGap]);
  ui.statusBar.classList.toggle('hidden', !appSettings.showStatusBar);
}

/** Persists settings through the desktop shell, or localStorage in a browser. */
async function persistSettings(patch: Partial<AppSettings>): Promise<void> {
  appSettings = { ...appSettings, ...patch };
  const bridge = desktop;
  if (bridge) {
    await bridge.settings.patch(patch as Record<string, unknown>);
    return;
  }
  try {
    localStorage.setItem(settingsStorageKey(), JSON.stringify(appSettings));
  } catch {
    // Losing the preference only costs the next launch its defaults.
  }
}

async function loadAppSettings(): Promise<void> {
  const bridge = desktop;
  if (bridge) {
    const stored = (await bridge.settings.read()) as unknown as Partial<AppSettings>;
    appSettings = { ...DEFAULT_APP_SETTINGS, ...stored };
  } else {
    try {
      appSettings = { ...DEFAULT_APP_SETTINGS, ...(JSON.parse(localStorage.getItem(settingsStorageKey()) ?? '{}') as Partial<AppSettings>) };
    } catch {
      appSettings = { ...DEFAULT_APP_SETTINGS };
    }
  }
  applyTheme(appSettings.theme);
  applyReadingSettings();
  if (bridge) {
    const stored = (await bridge.settings.read()) as unknown as { styles?: unknown };
    styles.load(stored.styles);
  } else {
    try {
      const raw = JSON.parse(localStorage.getItem(settingsStorageKey()) ?? '{}') as { styles?: unknown };
      styles.load(raw.styles);
    } catch {
      // No stored presets is the normal first-run case.
    }
  }
  if (bridge) {
    const stored = (await bridge.settings.read()) as unknown as { hiddenCommands?: unknown };
    applyStoredHiddenCommands(stored.hiddenCommands);
  } else {
    try {
      const raw = JSON.parse(localStorage.getItem(settingsStorageKey()) ?? '{}') as { hiddenCommands?: unknown };
      applyStoredHiddenCommands(raw.hiddenCommands);
    } catch {
      // First run: the markup already carries the default arrangement.
    }
  }
  renderStyles();
}

/** Applies a persisted toolbar arrangement, ignoring anything no longer defined. */
function applyStoredHiddenCommands(raw: unknown): void {
  if (!Array.isArray(raw)) return;
  const known = new Set(barEntries.map((e) => e.command));
  hiddenCommands.clear();
  for (const value of raw) {
    const command = Number(value);
    if (Number.isFinite(command) && known.has(command)) hiddenCommands.add(command);
  }
  applyToolbarVisibility();
  renderMoreMenu();
}

function buildSettingsFields(): SettingsField[] {
  const languageOptions = i18n.languages.map((l) => ({ value: l.id, label: l.nativeName }));
  return [
    {
      key: 'theme',
      kind: 'select',
      label: i18n.t('theme'),
      hint: i18n.t('themeHint'),
      value: appSettings.theme,
      options: (Object.keys(THEME_LABELS) as ThemeName[]).map((name) => ({ value: name, label: i18n.t(THEME_LABELS[name]) })),
    },
    {
      key: 'language',
      kind: 'select',
      label: i18n.t('uiLanguage'),
      value: i18n.languageId,
      options: languageOptions,
    },
    {
      key: 'defaultViewMode',
      kind: 'select',
      label: i18n.t('defaultViewMode'),
      value: appSettings.defaultViewMode,
      options: [
        { value: 'continuous', label: i18n.resolveCommand(CMD.ViewContinuous)?.title ?? 'continuous' },
        { value: 'single', label: i18n.resolveCommand(CMD.ViewSingle)?.title ?? 'single' },
        { value: 'spread', label: i18n.resolveCommand(CMD.ViewSpread)?.title ?? 'spread' },
      ],
    },
    {
      key: 'defaultZoomMode',
      kind: 'select',
      label: i18n.t('defaultZoomMode'),
      value: appSettings.defaultZoomMode,
      options: [
        { value: 'fit-width', label: i18n.t('zoomFitWidth') },
        { value: 'fit-page', label: i18n.t('zoomFitPage') },
        { value: 'actual', label: i18n.t('zoomActual') },
      ],
    },
    {
      key: 'pageGap',
      kind: 'select',
      label: i18n.t('pageGap'),
      value: appSettings.pageGap,
      options: [
        { value: 'compact', label: i18n.t('pageGapCompact') },
        { value: 'normal', label: i18n.t('pageGapNormal') },
        { value: 'roomy', label: i18n.t('pageGapRoomy') },
      ],
    },
    {
      key: 'showStatusBar',
      kind: 'toggle',
      label: i18n.t('showStatusBar'),
      hint: i18n.t('showStatusBarHint'),
      value: appSettings.showStatusBar,
    },
  ];
}

async function openSettings(): Promise<void> {
  const result = await showSettingsDialog(i18n, buildSettingsFields(), {
    title: i18n.t('settingsTitle'),
    confirm: i18n.t('ok'),
    cancel: i18n.t('unsavedStay'),
    reset: i18n.t('settingsReset'),
    onReset: () => {
      appSettings = { ...DEFAULT_APP_SETTINGS };
      applyTheme(appSettings.theme);
      applyReadingSettings();
      return buildSettingsFields();
    },
  });
  if (!result) return;

  const theme = String(result['theme'] ?? appSettings.theme) as ThemeName;
  applyTheme(theme);
  const gap = String(result['pageGap'] ?? appSettings.pageGap) as PageGap;
  appSettings.pageGap = gap;
  appSettings.showStatusBar = result['showStatusBar'] === true;
  const view = String(result['defaultViewMode'] ?? appSettings.defaultViewMode) as ViewMode;
  const zoom = String(result['defaultZoomMode'] ?? appSettings.defaultZoomMode) as DefaultZoom;
  applyReadingSettings();

  const language = String(result['language'] ?? i18n.languageId);
  if (language !== i18n.languageId) i18n.setLanguage(language);

  await persistSettings({ theme, pageGap: gap, showStatusBar: appSettings.showStatusBar, defaultViewMode: view, defaultZoomMode: zoom });
  if (language !== i18n.languageId) await persistSettings({ language } as Partial<AppSettings>);

  if (viewer.hasDocument) {
    setViewMode(view);
    viewer.setZoomMode(zoom === 'actual' ? 'custom' : zoom);
    if (zoom === 'actual') viewer.setScale(1);
  }
  setStatus(i18n.t('settingsSaved'));
}

// ------------------------------------------------------- toolbar layout

interface BarEntry {
  element: HTMLButtonElement;
  command: number;
  section: string;
  /** Locked entries are always present and cannot be unticked. */
  locked: boolean;
  hiddenByDefault: boolean;
}

let barEntries: BarEntry[] = [];
/** Commands the reader has removed from the toolbar. */
const hiddenCommands = new Set<number>();
const defaultHiddenCommands = new Set<number>();

/**
 * Reads the toolbar out of the DOM.
 *
 * The markup stays the single definition of which commands exist; this only records
 * which of them a reader may toggle and how they were arranged originally.
 */
function collectBarEntries(): void {
  const firstCollection = barEntries.length === 0;
  barEntries = [];
  for (const group of ui.toolbar.querySelectorAll<HTMLElement>(':scope > .group')) {
    const section = group.dataset['section'] ?? 'sectionTools';
    const locked = group.dataset['locked'] === 'true';
    for (const button of group.querySelectorAll<HTMLButtonElement>(':scope > .btn')) {
      const command = Number(button.dataset['command']);
      if (!Number.isFinite(command) || button.id.length === 0) continue;
      const hiddenByDefault = button.classList.contains('hidden');
      barEntries.push({ element: button, command, section, locked, hiddenByDefault });
      if (!locked && hiddenByDefault && firstCollection) defaultHiddenCommands.add(command);
    }
  }

  // The markup's initial arrangement *is* the default. Without seeding the set here
  // an empty `hiddenCommands` would mean "everything visible", so the very first
  // paint would undo the defaults the HTML declares.
  if (firstCollection) {
    hiddenCommands.clear();
    for (const command of defaultHiddenCommands) hiddenCommands.add(command);
  }
}

function applyToolbarVisibility(): void {
  for (const entry of barEntries) {
    if (entry.locked) continue;
    entry.element.classList.toggle('hidden', hiddenCommands.has(entry.command));
  }
  // A group whose buttons are all hidden would leave an empty gap, so it goes too.
  for (const group of ui.toolbar.querySelectorAll<HTMLElement>(':scope > .group')) {
    const buttons = [...group.querySelectorAll<HTMLElement>(':scope > .btn')];
    const fixed = [...group.querySelectorAll<HTMLElement>(':scope > input, :scope > span')];
    const anyButton = buttons.some((b) => !b.classList.contains('hidden'));
    const anyFixed = fixed.some((el) => !el.classList.contains('hidden'));
    group.classList.toggle('hidden', !anyButton && !anyFixed);
  }
  updateToolbarDensity();
}

async function persistToolbar(): Promise<void> {
  const payload = [...hiddenCommands];
  const bridge = desktop;
  if (bridge) {
    await bridge.settings.patch({ hiddenCommands: payload } as never);
    return;
  }
  try {
    const raw = JSON.parse(localStorage.getItem(settingsStorageKey()) ?? '{}') as Record<string, unknown>;
    raw['hiddenCommands'] = payload;
    localStorage.setItem(settingsStorageKey(), JSON.stringify(raw));
  } catch {
    // Losing the arrangement only costs the next launch its custom toolbar.
  }
}

/**
 * Draws the checklist.
 *
 * Each row names a command and carries a tick: ticking adds it to the toolbar, and
 * clicking the name runs it, so a command that is off the bar is still reachable.
 */
function renderMoreMenu(): void {
  ui.moreList.replaceChildren();
  const sections = new Map<string, BarEntry[]>();
  for (const entry of barEntries) {
    if (entry.locked) continue;
    const list = sections.get(entry.section);
    if (list) list.push(entry);
    else sections.set(entry.section, [entry]);
  }

  for (const [section, entries] of sections) {
    const heading = document.createElement('div');
    heading.className = 'menu-section';
    heading.textContent = i18n.t(section);
    ui.moreList.appendChild(heading);

    for (const entry of entries) {
      const row = document.createElement('div');
      row.className = 'more-row';

      const run = document.createElement('button');
      run.type = 'button';
      run.className = 'more-run';
      const resolved = i18n.resolveCommand(entry.command);
      // The full title reads better here than the terse toolbar label.
      run.textContent = resolved?.title ?? entry.element.id;
      run.title = resolved?.title ?? '';
      run.dataset['command'] = String(entry.command);
      row.appendChild(run);

      const tick = document.createElement('input');
      tick.type = 'checkbox';
      tick.className = 'more-check';
      tick.checked = !hiddenCommands.has(entry.command);
      tick.dataset['command'] = String(entry.command);
      tick.title = i18n.t('moreHint');
      tick.addEventListener('change', () => {
        if (tick.checked) hiddenCommands.delete(entry.command);
        else hiddenCommands.add(entry.command);
        applyToolbarVisibility();
        void persistToolbar();
      });
      row.appendChild(tick);

      ui.moreList.appendChild(row);
    }
  }
}

/** Anchors a popup under the button that opened it, kept inside the toolbar. */
function positionPopup(popup: HTMLElement, button: HTMLElement): void {
  const bar = ui.toolbar.getBoundingClientRect();
  const anchor = button.getBoundingClientRect();
  const width = popup.offsetWidth || 240;
  const left = Math.max(4, Math.min(anchor.left - bar.left, bar.width - width - 4));
  popup.style.left = `${left}px`;
  popup.style.right = 'auto';
}

// ------------------------------------------------------------------- find

let findTimer = 0;

function updateFindCount(): void {
  const total = findIndex.matches.length;
  if (total === 0) {
    ui.findCount.textContent = ui.findInput.value.length > 0 ? i18n.t('findNone') : '–';
    return;
  }
  ui.findCount.textContent = `${findIndex.currentIndex + 1}/${total}`;
}

function repaintAllHighlights(): void {
  if (!viewer.hasDocument) return;
  for (let page = 1; page <= viewer.pageCount; page++) {
    const arrays = viewer.textLayerArrays(page);
    if (arrays) findIndex.paint(page, arrays);
  }
}

async function runFind(move: 'none' | 'next' | 'prev' = 'none'): Promise<void> {
  if (!viewer.hasDocument || !currentDoc) return;
  const query = ui.findInput.value;

  if (query.length === 0) {
    findIndex.clear();
    repaintAllHighlights();
    updateFindCount();
    setStatus(i18n.t('findNoQuery'));
    return;
  }

  if (!findIndex.isBuilt) {
    setStatus(i18n.t('findIndexing'));
    await findIndex.build(currentDoc.doc, (done, total) => {
      if (done === 1 || done === total || done % 25 === 0) setStatus(`${i18n.t('findIndexing')} ${done}/${total}`);
    });
  }

  findIndex.search({ query, caseSensitive: ui.findCase.checked, entireWord: ui.findWord.checked });
  repaintAllHighlights();
  updateFindCount();

  const total = findIndex.matches.length;
  if (total === 0) {
    setStatus(`${i18n.t('findNone')}：${query}`);
    return;
  }
  if (move === 'next') findIndex.next();
  else if (move === 'prev') findIndex.prev();

  const hit = findIndex.currentHit;
  if (hit) viewer.gotoPage(hit.page);
  repaintAllHighlights();
  updateFindCount();
  setStatus(`${i18n.t('findCount')} ${findIndex.currentIndex + 1}/${total}`);
}

function scheduleFind(): void {
  window.clearTimeout(findTimer);
  findTimer = window.setTimeout(() => void runFind('none'), 200);
}

function openFindBar(): void {
  ui.findBar.classList.remove('hidden');
  ui.findInput.focus();
  ui.findInput.select();
}

function closeFindBar(): void {
  ui.findBar.classList.add('hidden');
  findIndex.clear();
  repaintAllHighlights();
}

// ------------------------------------------------------------------ sidebar

type TabName = 'thumbnails' | 'outline' | 'annotations';

function showTab(which: TabName): void {
  ui.tabThumbnails.classList.toggle('active', which === 'thumbnails');
  ui.tabOutline.classList.toggle('active', which === 'outline');
  ui.tabAnnotations.classList.toggle('active', which === 'annotations');
  ui.paneThumbnails.classList.toggle('hidden', which !== 'thumbnails');
  ui.paneOutline.classList.toggle('hidden', which !== 'outline');
  ui.paneAnnotations.classList.toggle('hidden', which !== 'annotations');
  if (which === 'annotations') annotPanel.render();
}

// ------------------------------------------------------------- annotations

async function saveAnnotations(): Promise<void> {
  if (annotations.count === 0) {
    setStatus(i18n.t('annotEmpty'));
    return;
  }
  try {
    const bytes = await packAnnotations(annotations.toJSON(), { document: currentName, count: annotations.count });
    if (desktop) {
      const target = currentPath
        ? sidecarPathFor(currentPath)
        : await desktop.saveFileDialog({
            title: i18n.resolveCommand(CMD.SaveAnnotations)?.title ?? 'Save',
            defaultPath: `${currentName || 'annotations'}.arpk`,
            filters: [{ name: 'ARPK', extensions: ['arpk'] }],
          });
      if (!target) return;
      const result = await desktop.writeFile(target, bytes);
      if (!result.ok) {
        setStatus(`${i18n.t('annotSaveFailed')}: ${result.error ?? ''}`, true);
        return;
      }
      annotations.markSaved();
      await refreshTitle();
      setStatus(`${i18n.t('annotSaved')} → ${target.split(/[\\/]/).pop()}`);
      return;
    }
    downloadBlob(new Blob([bytes], { type: 'application/octet-stream' }), `${currentName || 'annotations'}.arpk`);
    annotations.markSaved();
    setStatus(i18n.t('annotSaved'));
  } catch (err) {
    setStatus(`${i18n.t('annotSaveFailed')}: ${String(err)}`, true);
  }
}

async function exportAnnotationsJson(): Promise<void> {
  const json = JSON.stringify(annotations.toJSON(), null, 2);
  if (desktop) {
    const target = await desktop.saveFileDialog({
      title: i18n.t('exportDone'),
      defaultPath: `${currentName || 'annotations'}.annotations.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (!target) return;
    const result = await desktop.writeFile(target, new TextEncoder().encode(json));
    setStatus(result.ok ? i18n.t('exportDone') : `${i18n.t('annotSaveFailed')}: ${result.error ?? ''}`, !result.ok);
    return;
  }
  downloadBlob(new Blob([json], { type: 'application/json' }), `${currentName || 'annotations'}.annotations.json`);
  setStatus(i18n.t('exportDone'));
}

  /**
   * Builds a copy of the open PDF with the annotations written into it.
   *
   * Annotations are grouped by page and handed to the incremental writer, which
   * appends objects to the original bytes rather than re-serialising the document.
   */
  async function buildAnnotatedPdf(onlyPages?: number[]): Promise<Uint8Array> {
    const source = activeSession?.bytes;
    if (!source) throw new Error(i18n.t('pdfNoBytes'));
    const allowed = onlyPages ? new Set(onlyPages) : null;
    const byPage = new Map<number, PdfAnnotationInput[]>();
    for (const item of annotations.all) {
      if (allowed && !allowed.has(item.page)) continue;
      const list = byPage.get(item.page - 1);
      const input: PdfAnnotationInput = {
        kind: item.kind,
        color: item.color,
        rect: item.rect,
        rects: item.rects,
        strokes: item.strokes,
        note: item.note,
        fontSize: item.fontSize,
        strokeWidth: item.strokeWidth,
        strokeDash: item.strokeDash,
      };
      if (list) list.push(input);
      else byPage.set(item.page - 1, [input]);
    }
    const updates = [...byPage.entries()].map(([pageIndex, list]) => ({ pageIndex, annotations: list }));
    const result = await writeAnnotations(new Uint8Array(source), updates);
    return result.bytes;
  }

  /** Writes the annotations into the PDF and saves the result as a new file. */
  async function saveIntoPdf(): Promise<void> {
    const session = activeSession;
    if (!session?.bytes) { setStatus(i18n.t('pdfNoBytes'), true); return; }
    if (annotations.count === 0) { setStatus(i18n.t('annotEmpty'), true); return; }
    setStatus(i18n.t('savingPdf'));
    let bytes: Uint8Array;
    try {
      bytes = await buildAnnotatedPdf();
    } catch (error) {
      const message = String((error as Error)?.message ?? error);
      setStatus(`${i18n.t('pdfSaveFailed')}: ${message}`, true);
      return;
    }
    const stem = (session.name || 'document').replace(/\.pdf$/i, '');
    const suggested = session.path
      ? `${session.path.replace(/\.pdf$/i, '')}-annotated.pdf`
      : `${stem}-annotated.pdf`;
    const bridge = desktop;
    if (bridge) {
      const target = await bridge.saveFileDialog({
        title: i18n.resolveCommand(CMD.SaveIntoPdf)?.title ?? 'Save into PDF',
        defaultPath: suggested,
        filters: [{ name: 'PDF', extensions: ['pdf'] }],
      });
      if (!target) return;
      const result = await bridge.writeFile(target, bytes);
      if (!result.ok) {
        setStatus(`${i18n.t('pdfSaveFailed')}: ${result.error ?? target}`, true);
        return;
      }
      // Re-open the updated file, so the reader now shows what was written.
      await openPath(target, target.split(/[\\/]/).pop() ?? session.name);
      setStatus(`${i18n.t('pdfSaved')} → ${target.split(/[\\/]/).pop()}`);
      return;
    }
    downloadBlob(new Blob([bytes as BlobPart], { type: 'application/pdf' }), `${stem}-annotated.pdf`);
    setStatus(`${i18n.t('pdfSaved')}: ${stem}-annotated.pdf`);
  }

/**
   * Pulls annotations that are already stored in the PDF into the editable model.
   *
   * Returns true when the file carried any of its own, in which case the sidecar is not
   * consulted: the PDF is now the source of truth for this document.
   */
  async function importAnnotationsFromPdf(): Promise<boolean> {
    const source = activeSession?.bytes;
    if (!source) return false;
    let found;
    try {
      found = await readAnnotations(new Uint8Array(source));
    } catch {
      return false;
    }
    if (found.length === 0) return false;

    for (const item of found) {
      // Built field by field: `exactOptionalPropertyTypes` distinguishes an absent key
      // from one explicitly set to undefined.
      const input: Omit<Annotation, 'id' | 'createdAt' | 'updatedAt' | 'author'> = {
        page: item.page,
        kind: item.kind,
        color: item.color,
      };
      if (item.rect) input.rect = item.rect;
      if (item.rects) input.rects = item.rects;
      if (item.strokes) input.strokes = item.strokes;
      if (item.note !== undefined) input.note = item.note;
      if (item.fontSize !== undefined) input.fontSize = item.fontSize;
      if (item.strokeWidth !== undefined) input.strokeWidth = item.strokeWidth;
      if (item.strokeDash !== undefined) input.strokeDash = item.strokeDash;
      annotations.add(input);
    }
    // Imported annotations are the document's existing state, not unsaved edits.
    annotations.load([...annotations.all], true);
    annotationLayer.refreshAll();
    annotPanel.render();
    void refreshTitle();
    return true;
  }

/** Loads `<document>.pdf.arpk` when it exists, without failing the document open. */
async function loadSidecar(): Promise<void> {
  if (!desktop || !currentPath) return;
  try {
    const file = await desktop.readFile(sidecarPathFor(currentPath));
    if (!file?.bytes) return;
    const { payload, info } = await unpackAnnotations(file.bytes);
    const parsed = parseAnnotations(payload, viewer.pageCount);
    if (parsed.issues.length > 0) {
      setStatus(`${i18n.t('annotCount')}: ${parsed.issues.length}`, true);
    }
    annotations.load(parsed.items);
    annotationLayer.refreshAll();
    annotPanel.render();
    setStatus(`${parsed.items.length} ${i18n.t('annotCount')} (${info.app || 'arpk'})`);
  } catch {
    // No sidecar is the normal case; a corrupt one is reported by the parser above.
  }
}

// ------------------------------------------------------------------- view

let viewMode: ViewMode = 'continuous';

/** Display unit for measurements; persisted with the other preferences. */
let measureUnit: MeasureUnit = 'mm';

/**
 * `/UserUnit` per page, read lazily from pdf.js.
 *
 * The reader defaults to 1 — what an absent entry means — and repaints once the
 * real value arrives, so the first measurement on a page is never wrong for long.
 */
const userUnitCache = new Map<number, number>();
function userUnitFor(page: number): number {
  const cached = userUnitCache.get(page);
  if (cached !== undefined) return cached;
  const doc = currentDoc?.doc;
  if (doc) {
    void doc
      .getPage(page)
      .then((proxy) => {
        userUnitCache.set(page, readUserUnit(proxy as unknown as { userUnit?: number }));
        annotationLayer.refreshAll();
      })
      .catch(() => undefined);
  }
  return 1;
}

function setViewMode(mode: ViewMode): void {
  viewMode = mode;
  if (viewer.hasDocument) {
    viewer.setViewMode(mode);
    viewer.markCurrentPage(viewer.page);
  } else {
    ui.pages.dataset['mode'] = mode;
    ui.pages.classList.toggle('mode-single', mode === 'single');
    ui.pages.classList.toggle('mode-spread', mode === 'spread');
  }
  ui.viewContinuous.classList.toggle('active', mode === 'continuous');
  ui.viewSingle.classList.toggle('active', mode === 'single');
  ui.viewSpread.classList.toggle('active', mode === 'spread');
  annotationLayer.refreshAll();
  void desktop?.settings.patch({ viewMode: mode });
}

async function toggleFullscreen(): Promise<void> {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch {
    setStatus(i18n.t('fullscreenOn'), true);
  }
}

async function showProperties(): Promise<void> {
  if (!currentDoc) return;
  const rows: HTMLElement[] = [];
  const add = (itemId: number, value: string): void => {
    const row = document.createElement('div');
    row.className = 'modal-line modal-property';
    row.dataset['itemId'] = String(itemId);
    const label = document.createElement('span');
    label.className = 'prop-label';
    label.textContent = i18n.dialogItem(DIALOG.DocProperties, itemId);
    const val = document.createElement('span');
    val.className = 'prop-value';
    val.textContent = value;
    row.append(label, val);
    rows.push(row);
  };

  const meta = await currentDoc.doc.getMetadata().catch(() => null);
  const info = (meta?.info ?? {}) as Record<string, unknown>;
  const first = viewer.pageCount > 0 ? await currentDoc.doc.getPage(1).catch(() => null) : null;
  const viewport = first?.getViewport({ scale: 1 });
  add(PROPS_ITEM.FileName, currentName || '–');
  add(PROPS_ITEM.PageCount, String(viewer.pageCount));
  add(PROPS_ITEM.PageSize, viewport ? `${Math.round(viewport.width)} × ${Math.round(viewport.height)} pt` : '–');
  add(PROPS_ITEM.Version, typeof info['PDFFormatVersion'] === 'string' ? info['PDFFormatVersion'] : '–');
  add(PROPS_ITEM.Producer, typeof info['Producer'] === 'string' ? info['Producer'] : '–');
  add(PROPS_ITEM.Annotations, `${annotations.count} (${annotations.dirty ? '·' : ''})`);

  await showPackDialog(i18n, DIALOG.DocProperties, { extra: rows });
}

// -------------------------------------------------------------- recent files

function recentsStorageKey(): string {
  return 'pdfreader.recents.v1';
}

async function loadRecents(): Promise<void> {
  const bridge = desktop;
  if (bridge) {
    // A file passed on the command line or through a file association may have been
  // announced before this renderer subscribed, so pull anything still queued.
  const pending = await bridge.takePendingOpen();
  if (pending) void openPath(pending.path, pending.name);

  const settings = await bridge.settings.read();
    recentFiles = Array.isArray(settings.recents) ? settings.recents : [];
    return;
  }
  try {
    recentFiles = JSON.parse(localStorage.getItem(recentsStorageKey()) ?? '[]') as RecentEntry[];
  } catch {
    recentFiles = [];
  }
}

async function rememberRecent(path: string, name: string): Promise<void> {
  recentFiles = [{ path, name, at: Date.now() }, ...recentFiles.filter((r) => r.path !== path)].slice(0, 12);
  if (desktop) await desktop.settings.patch({ recents: recentFiles });
  else {
    try {
      localStorage.setItem(recentsStorageKey(), JSON.stringify(recentFiles));
    } catch {
      // Quota exceeded only costs the recent list.
    }
  }
  await refreshMenu();
}

// ------------------------------------------------------------------- menu

function buildMenuDescriptor(): MenuDescriptor {
  const command = (id: number, accelerator?: string, data?: string): MenuItem => {
    const resolved = i18n.resolveCommand(id);
    const item: MenuItem = {
      type: 'command',
      id,
      label: resolved?.title ?? String(id),
      ...(accelerator ? { accelerator } : {}),
      ...(data !== undefined ? { data } : {}),
    };
    return item;
  };

  const recentItems: MenuItem[] =
    recentFiles.length > 0
      ? recentFiles.slice(0, 8).map((entry) => command(CMD.OpenRecent, undefined, entry.path))
      : [{ type: 'command', id: CMD.OpenRecent, label: i18n.t('menuRecentEmpty'), enabled: false }];
  if (recentFiles.length > 0) {
    // Relabel the recent entries with their file names.
    recentFiles.slice(0, 8).forEach((entry, index) => {
      const item = recentItems[index];
      if (item && item.type === 'command') item.label = entry.name;
    });
  }

  return {
    menus: [
      {
        label: i18n.t('menuFile'),
        items: [
          command(CMD.Open, 'CmdOrCtrl+O'),
          { type: 'submenu', label: i18n.t('menuRecent'), items: recentItems },
          { type: 'separator' },
          // Ctrl+S is the primary save: annotations belong in the PDF now. The sidecar
          // stays available, on a chord of its own.
          command(CMD.SaveIntoPdf, 'CmdOrCtrl+S'),
          command(CMD.SaveAnnotations, 'CmdOrCtrl+Shift+S'),
          command(CMD.ExportAnnotations),
          { type: 'separator' },
          command(CMD.CloseFile, 'CmdOrCtrl+W'),
          command(CMD.Exit, 'CmdOrCtrl+Q'),
        ],
      },
      {
        label: i18n.t('menuView'),
        items: [
          command(CMD.ViewContinuous),
          command(CMD.ViewSingle),
          command(CMD.ViewSpread),
          { type: 'separator' },
          command(CMD.ZoomIn, 'CmdOrCtrl+Plus'),
          command(CMD.ZoomOut, 'CmdOrCtrl+-'),
          command(CMD.FitWidth, 'CmdOrCtrl+0'),
          command(CMD.FitPage),
          command(CMD.Rotate, 'CmdOrCtrl+R'),
          { type: 'separator' },
          command(CMD.ViewFullscreen, 'F11'),
        ],
      },
      {
        label: i18n.t('menuTools'),
        items: [
          command(CMD.Find, 'CmdOrCtrl+F'),
          command(CMD.Sidebar, 'CmdOrCtrl+B'),
          command(CMD.AnnotPanel),
          { type: 'separator' },
          command(CMD.ToolHand, 'CmdOrCtrl+1'),
          command(CMD.ToolSelect, 'CmdOrCtrl+2'),
          command(CMD.ToolZoom, 'CmdOrCtrl+3'),
          command(CMD.ToolSnapshot, 'CmdOrCtrl+4'),
          { type: 'separator' },
          command(CMD.DocProperties),
        ],
      },
      {
        label: i18n.t('menuAnnotate'),
        items: [
          command(CMD.AnnotHighlight, 'CmdOrCtrl+Shift+H'),
          command(CMD.AnnotUnderline),
          command(CMD.AnnotStrikeout),
          { type: 'separator' },
          command(CMD.AnnotInk),
          command(CMD.AnnotNote),
          command(CMD.AnnotRect),
          { type: 'separator' },
          command(CMD.AnnotDelete),
          command(CMD.AnnotClearPage),
        ],
      },
      {
        label: i18n.t('menuHelp'),
        items: [command(CMD.About)],
      },
    ],
  };
}

async function refreshMenu(): Promise<void> {
  await applyMenu(buildMenuDescriptor());
}

// ---------------------------------------------------------------- documents

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const out = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(out).set(bytes);
  return out;
}

async function refreshTitle(): Promise<void> {
  const base = currentName || 'PDF Reader';
  const suffix = annotations.dirty ? ' *' : '';
  ui.title.textContent = `${base}${suffix}`;
  ui.title.title = base;
  if (activeSession && activeSession.name !== base) activeSession.name = base;
  renderTabs();
  await setWindowTitle(`${base} — ${PRODUCT_NAME}`, annotations.dirty);
}

// ------------------------------------------------------------------ sessions

const sessions: DocumentSession[] = [];
let activeSession: DocumentSession | null = null;

const tabBar = new TabBar(ui.tabBar, {
  onActivate: (id) => {
    const session = sessions.find((s) => s.id === id);
    if (session && session !== activeSession) void activateSession(session);
  },
  onClose: (id) => closeSession(id),
  onNew: () => void openViaDialog(),
  newLabel: i18n.t('tabNew'),
});

function renderTabs(): void {
  tabBar.render(
    sessions.map((session) => ({
      id: session.id,
      title: session.title,
      dirty: session.annotations.dirty,
      active: session === activeSession,
      hint: session.path ?? session.title,
        closeLabel: i18n.t('tabClose'),
    })),
  );
  // The style list is localised too, so it follows every tab and language change.
  renderStyles();
}

/** Points every per-document helper at one session. The only place this happens. */
function bindSession(session: DocumentSession): void {
  activeSession = session;
  annotations = session.annotations;
  findIndex = session.findIndex;
  currentDoc = session.opened;
  currentPath = session.path;
  currentName = session.name;
  annotationLayer.setStore(session.annotations);
  annotPanel.setStore(session.annotations);
  ui.pages.classList.toggle('annotations-hidden', session.annotationsHidden);
}

/** Switches to a session, saving the outgoing one's reading position first. */
async function activateSession(session: DocumentSession): Promise<void> {
  const outgoing = activeSession;
  if (outgoing && outgoing !== session && viewer.hasDocument) {
    outgoing.snapshot = viewer.getState();
  }
  bindSession(session);

  userUnitCache.clear();
  ui.outline.replaceChildren();
  ui.pages.replaceChildren();
  closeFindBar();

  if (!session.opened) {
    viewer.unload();
    ui.title.textContent = '';
    ui.pageTotal.textContent = '/ –';
    ui.pageInput.value = '1';
    setStatus(i18n.t('noDocument'));
    await setWindowTitle(PRODUCT_NAME, false);
    renderTabs();
    return;
  }

  setStatus(i18n.t('loading'));
  const saved = session.snapshot ?? loadProgress(session.key ?? '');
  await viewer.load(session.opened.doc, saved);
  if (viewMode !== 'continuous') viewer.setViewMode(viewMode);
  viewer.markCurrentPage(viewer.page);
  tools.applyState();
  updateToolButtons(tools.tool);

  ui.pageInput.value = String(viewer.page);
  ui.pageTotal.textContent = `/ ${session.pageCount}`;

  void thumbnails.load(session.opened.doc).then(
    () => thumbnails.setCurrentPage(viewer.page),
    () => undefined,
  );

  void viewer.outline().then(
    (entries) => {
      renderOutline(ui.outline, entries, { onNavigate: (page) => viewer.gotoPage(page) });
      if (entries.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'outline-empty';
        empty.textContent = i18n.t('outlineEmpty');
        ui.outline.appendChild(empty);
      }
    },
    () => undefined,
  );

  annotationLayer.refreshAll();
  annotPanel.render();
  renderTabs();
  await refreshTitle();
  // Annotations that already live in the file take precedence; the sidecar is only
  // consulted when the PDF itself carried none.
  const imported = await importAnnotationsFromPdf();
  if (!imported) await loadSidecar();
  setStatus(`${session.pageCount} ${i18n.t('page')}`);
}

/**
 * Opens a document and switches to it.
 *
 * An empty tab is reused rather than left behind, so the first document does not
 * strand a blank tab next to it.
 */
async function openDocument(data: ArrayBuffer, name: string, path: string | null): Promise<void> {
  setStatus(i18n.t('loading'));
  // pdf.js transfers the buffer to its worker, which detaches the original. The
  // incremental write needs those bytes, so a copy is taken before the hand-off.
  const original = data.slice(0);
  const opened = await openFromArrayBuffer(data, name);
  const reusable = activeSession && !activeSession.opened && !activeSession.annotations.dirty ? activeSession : null;
  const session = reusable ?? createSession(opened.title || name);
  session.name = opened.title || name;
  session.opened = opened;
  session.bytes = original;
  session.path = path;
  session.key = documentKey(opened.doc.fingerprints, opened.pageCount);
  if (!reusable) sessions.push(session);
  await activateSession(session);
  if (path) await rememberRecent(path, name);
}

/** Opens a URL in a new tab. Used by the `?file=` entry point. */
async function loadUrl(url: string, name?: string): Promise<void> {
  setStatus(i18n.t('loading'));
  // Fetch rather than hand pdf.js the URL: an annotation write is an incremental
  // update of the original bytes, so every open path has to keep them.
  const response = await fetch(url);
  const data = await response.arrayBuffer();
  const original = data.slice(0);
  const opened = await openFromArrayBuffer(data, name ?? url.split('/').pop() ?? 'document.pdf');
  const reusable = activeSession && !activeSession.opened && !activeSession.annotations.dirty ? activeSession : null;
  const session = reusable ?? createSession(opened.title || name || 'document');
  session.name = opened.title || name || 'document';
  session.opened = opened;
  session.bytes = original;
  session.key = documentKey(opened.doc.fingerprints, opened.pageCount);
  if (!reusable) sessions.push(session);
  await activateSession(session);
}

/**
 * Closes a tab. The last tab is not removed but reset to an empty session, so there
 * is always somewhere for a newly opened document to go.
 */
function closeSession(id: string): void {
  const index = sessions.findIndex((s) => s.id === id);
  if (index < 0) return;
  const session = sessions[index];
  if (session.annotations.dirty && !window.confirm(i18n.t('closeConfirm'))) return;
  sessions.splice(index, 1);

  if (sessions.length === 0) {
    const empty = createSession();
    sessions.push(empty);
    void activateSession(empty);
    return;
  }
  if (session === activeSession) {
    void activateSession(sessions[Math.min(index, sessions.length - 1)]);
  } else {
    renderTabs();
  }
}

/** Opens a path the desktop shell already granted access to, in a new tab. */
async function openPath(path: string, name: string): Promise<void> {
  const bridge = desktop;
  if (!bridge) return;
  const file = await bridge.readFile(path);
  if (!file?.bytes) {
    setStatus(`${i18n.t('recentMissing')}: ${name}`, true);
    recentFiles = recentFiles.filter((r) => r.path !== path);
    await bridge.settings.patch({ recents: recentFiles });
    await refreshMenu();
    return;
  }
  await openDocument(toArrayBuffer(file.bytes), file.name || name, file.path);
}

async function openViaDialog(): Promise<void> {
  const bridge = desktop;
  if (bridge) {
    const file = await bridge.openFileDialog();
    if (!file) return;
    if (!file.bytes) {
      setStatus(`${i18n.t('failed')}: ${file.error ?? ''}`, true);
      return;
    }
    await openDocument(toArrayBuffer(file.bytes), file.name, file.path);
    return;
  }
  ui.fileInput.click();
}
function closeDocument(): void {
  if (activeSession) closeSession(activeSession.id);
}


// ------------------------------------------------------- language switching


function applyLanguage(): void {
  applyCommandLabels();
  renderMoreMenu();
  applyStrings();
  updateToolButtons(tools.tool);
  setViewMode(viewMode);
  if (!viewer.hasDocument) setStatus(i18n.t('noDocument'));
  else setStatus(hintFor(tools.tool) || `${viewer.pageCount} ${i18n.t('page')}`);
  void refreshMenu();
}


i18n.onChange(() => {
  applyLanguage();
  ui.outline.replaceChildren();
  if (currentDoc) {
    void viewer.outline().then(
      (entries) => {
        renderOutline(ui.outline, entries, { onNavigate: (page) => viewer.gotoPage(page) });
        if (entries.length === 0) {
          const empty = document.createElement('div');
          empty.className = 'outline-empty';
          empty.textContent = i18n.t('outlineEmpty');
          ui.outline.appendChild(empty);
        }
      },
      () => undefined,
    );
  }
});

// -------------------------------------------------------------------- wiring

bindCommand(CMD.Open, ui.open, { onClick: () => void openViaDialog() });
bindCommand(CMD.Sidebar, ui.btnSidebar, { onClick: () => ui.sidebar.classList.toggle('hidden') });
bindCommand(CMD.PrevPage, ui.prev, { onClick: () => viewer.prevPage() });
bindCommand(CMD.NextPage, ui.next, { onClick: () => viewer.nextPage() });
bindCommand(CMD.ZoomIn, ui.zoomIn, { onClick: () => viewer.zoomIn() });
bindCommand(CMD.ZoomOut, ui.zoomOut, { onClick: () => viewer.zoomOut() });
bindCommand(CMD.FitWidth, ui.fitWidth, { onClick: () => viewer.setZoomMode('fit-width') });
bindCommand(CMD.FitPage, ui.fitPage, { onClick: () => viewer.setZoomMode('fit-page') });
bindCommand(CMD.Rotate, ui.rotate, {
  onClick: () => {
    viewer.rotate();
    annotationLayer.refreshAll();
  },
});
bindCommand(CMD.FirstPage, ui.btnFirst, { onClick: () => viewer.gotoPage(1) });
bindCommand(CMD.LastPage, ui.btnLast, { onClick: () => viewer.gotoPage(viewer.pageCount) });
bindCommand(CMD.CloseFile, ui.btnCloseDoc, { onClick: () => closeDocument() });
bindCommand(CMD.SaveIntoPdf, ui.savePdf, { onClick: () => void saveIntoPdf() });
bindCommand(CMD.Find, ui.findOpen, { onClick: openFindBar });
bindCommand(CMD.Settings, ui.settings, { onClick: () => void openSettings() });
bindCommand(CMD.About, ui.about, {
  onClick: () =>
    void showAboutDialog({
      name: PRODUCT_NAME,
      version: PRODUCT_VERSION,
      tagline: PRODUCT_TAGLINE,
      author: PRODUCT_AUTHOR,
      email: PRODUCT_EMAIL,
      engine: ENGINE_NAME,
      engineLicence: ENGINE_LICENCE,
      description: PRODUCT_DESCRIPTION,
      licenceNote: LICENCE_NOTE,
      closeLabel: i18n.t('ok'),
      iconUrl: pack?.iconUrl('app') ?? null,
      labels: {
        author: i18n.t('aboutAuthor'),
        email: i18n.t('aboutEmail'),
        engine: i18n.t('aboutEngine'),
        version: i18n.t('aboutVersion'),
        licence: i18n.t('aboutLicence'),
      },
    }),
});
bindCommand(CMD.DocProperties, ui.props, { onClick: () => void showProperties() });
bindCommand(CMD.TabThumbnails, ui.tabThumbnails, { onClick: () => showTab('thumbnails') });
bindCommand(CMD.TabOutline, ui.tabOutline, { onClick: () => showTab('outline') });
bindCommand(CMD.TabAnnotations, ui.tabAnnotations, { onClick: () => showTab('annotations') });
bindCommand(CMD.FindPrev, ui.findPrev, { onClick: () => void runFind('prev') });
bindCommand(CMD.FindNext, ui.findNext, { onClick: () => void runFind('next') });
bindCommand(CMD.FindClose, ui.findClose, { onClick: closeFindBar });

bindCommand(CMD.ToolHand, ui.toolHand, { onClick: () => tools.setTool('hand') });
bindCommand(CMD.ToolSelect, ui.toolSelect, { onClick: () => tools.setTool('select') });
bindCommand(CMD.ToolZoom, ui.toolZoom, { onClick: () => tools.setTool('zoom') });
bindCommand(CMD.ToolSnapshot, ui.toolSnapshot, { onClick: () => tools.setTool('snapshot') });

bindCommand(CMD.AnnotHighlight, ui.annotHighlight, { onClick: () => tools.setTool('highlight') });
bindCommand(CMD.AnnotUnderline, ui.annotUnderline, { onClick: () => tools.setTool('underline') });
bindCommand(CMD.AnnotStrikeout, ui.annotStrikeout, { onClick: () => tools.setTool('strikeout') });
bindCommand(CMD.AnnotInk, ui.annotInk, { onClick: () => tools.setTool('ink') });
bindCommand(CMD.AnnotNote, ui.annotNote, { onClick: () => tools.setTool('note') });
bindCommand(CMD.AnnotRect, ui.annotRect, { onClick: () => tools.setTool('rect') });
bindCommand(CMD.AnnotEllipse, ui.annotEllipse, { onClick: () => tools.setTool('ellipse') });
bindCommand(CMD.AnnotArrow, ui.annotArrow, { onClick: () => tools.setTool('arrow') });
bindCommand(CMD.AnnotTextbox, ui.annotTextbox, { onClick: () => tools.setTool('textbox') });
bindCommand(CMD.AnnotCallout, ui.annotCallout, { onClick: () => tools.setTool('callout') });
bindCommand(CMD.ToolPointer, ui.toolPointer, { onClick: () => tools.setTool('pointer') });
bindCommand(CMD.AnnotToggleVisible, ui.annotToggle, { onClick: () => toggleAnnotationVisibility() });
bindCommand(CMD.AnnotMeasureDistance, ui.measureDistance, { onClick: () => tools.setTool('measure-distance') });
bindCommand(CMD.AnnotMeasurePerimeter, ui.measurePerimeter, { onClick: () => tools.setTool('measure-perimeter') });
bindCommand(CMD.AnnotMeasureArea, ui.measureArea, { onClick: () => tools.setTool('measure-area') });
bindCommand(CMD.AnnotExportPage, ui.exportPage, { onClick: () => void exportCurrentPage() });

bindCommand(CMD.ViewContinuous, ui.viewContinuous, { onClick: () => setViewMode('continuous') });
bindCommand(CMD.ViewSingle, ui.viewSingle, { onClick: () => setViewMode('single') });
bindCommand(CMD.ViewSpread, ui.viewSpread, { onClick: () => setViewMode('spread') });
bindCommand(CMD.ViewFullscreen, ui.viewFullscreen, { onClick: () => void toggleFullscreen() });

// Menu-only commands.
registerCommand(CMD.FirstPage, () => viewer.gotoPage(1));
registerCommand(CMD.Settings, () => void openSettings());
registerCommand(CMD.LastPage, () => viewer.gotoPage(viewer.pageCount));
registerCommand(CMD.SaveAnnotations, () => void saveAnnotations());
registerCommand(CMD.SaveIntoPdf, () => void saveIntoPdf());
registerCommand(CMD.ExportAnnotations, () => void exportAnnotationsJson());
registerCommand(CMD.CloseFile, closeDocument);
registerCommand(CMD.Exit, () => window.close());
registerCommand(CMD.AnnotDelete, () => {
  if (!annotationLayer.removeSelected()) setStatus(i18n.t('annotNothingSelected'));
});
registerCommand(CMD.AnnotClearPage, () => {
  const removed = annotations.clearPage(viewer.page);
  setStatus(removed > 0 ? `${removed} ${i18n.t('annotCount')}` : i18n.t('annotEmpty'));
  annotationLayer.refreshAll();
});
registerCommand(CMD.AnnotPanel, () => {
  ui.sidebar.classList.remove('hidden');
  showTab('annotations');
});
registerCommand(CMD.OpenRecent, (data) => {
  if (!data) return;
  const entry = recentFiles.find((r) => r.path === data);
  void openPath(data, entry?.name ?? data.split(/[\\/]/).pop() ?? data);
});

/**
 * Ctrl/Cmd + wheel zooms the view, anchored on the pointer.
 *
 * The listener is non-passive so the default page zoom Chromium would otherwise
 * apply can be suppressed; leaving it in place would scale the whole UI instead of
 * the document.
 */
ui.scroll.addEventListener('wheel', (event) => {
  if (!event.ctrlKey && !event.metaKey) return;
  if (!viewer.hasDocument) return;
  event.preventDefault();
  const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
  viewer.zoomAt(event.clientX, event.clientY, factor);
}, { passive: false });

/** Line style applied to new shapes; also mirrored onto a selection. */
let strokeWidth = 1.5;
let strokeDash = false;
/** Page-space text size for new text annotations, and for the selected one. */
let fontSize = 12;

function applyStrokeState(): void {
  annotationLayer.setStroke(strokeWidth, strokeDash);
  ui.strokeSolid.classList.toggle('active', !strokeDash);
  ui.strokeDash.classList.toggle('active', strokeDash);
  ui.strokeWidthValue.textContent = strokeWidth.toFixed(1);
  annotationLayer.setFontSize(fontSize);
  ui.fontSizeValue.textContent = String(Math.round(fontSize));
}

/**
 * Sets the working colour.
 *
 * When an annotation is selected the change is applied to it, so editing an
 * existing mark and choosing the colour for the next one are the same gesture.
 */
function chooseColor(color: string): void {
  ui.annotColor.value = color;
  annotationLayer.setActiveColor(color);
  if (annotationLayer.applyColorToSelection(color)) setStatus(i18n.t('applyToSelected'));
}

/** Preset colour swatches, plus the native picker for anything else. */
function buildColorSwatches(): void {
  ui.annotSwatches.replaceChildren();
  for (const color of PALETTE) {
    const swatch = document.createElement('button');
    swatch.type = 'button';
    swatch.className = 'swatch';
    swatch.style.background = color;
    swatch.dataset['color'] = color;
    swatch.title = color;
    swatch.setAttribute('aria-label', color);
    swatch.addEventListener('click', () => {
      chooseColor(color);
      for (const other of ui.annotSwatches.querySelectorAll('.swatch')) other.classList.toggle('active', other === swatch);
    });
    ui.annotSwatches.appendChild(swatch);
  }
}

buildColorSwatches();

/** Only one toolbar popup is open at a time. */
function closePopups(): void {
  ui.overflowMenu.classList.add('hidden');
  ui.colorPopup.classList.add('hidden');
  ui.btnMore.classList.remove('active');
  ui.btnColor.classList.remove('active');
}

function togglePopup(popup: HTMLElement, button: HTMLElement): void {
  const willOpen = popup.classList.contains('hidden');
  closePopups();
  popup.classList.toggle('hidden', !willOpen);
  button.classList.toggle('active', willOpen);
  // Measured after unhiding: a hidden element reports a zero width.
  if (willOpen) positionPopup(popup, button);
}

ui.btnMore.addEventListener('click', (event) => {
  event.stopPropagation();
  togglePopup(ui.overflowMenu, ui.btnMore);
});
ui.btnColor.addEventListener('click', (event) => {
  event.stopPropagation();
  togglePopup(ui.colorPopup, ui.btnColor);
});
ui.overflowMenu.addEventListener('click', (event) => {
    // Ticking several boxes in a row must not dismiss the list; only a click outside
    // does. Stopping here keeps the document-level dismisser from firing.
    event.stopPropagation();
    const target = event.target as HTMLElement;

    // Style rows are not `.menu-item`, so they are handled before the generic close.
    const row = target.closest<HTMLElement>('[data-style-id]');
    if (row) {
      const id = row.dataset['styleId'];
      if (!id) return;
      const style = allStyles().find((s) => s.id === id);
      if (!style) return;
      if (target.closest('[data-action="delete"]')) {
        void (async () => {
          styles.remove(id);
          if (activeStyleId === id) activeStyleId = null;
          await persistStyles();
          renderStyles();
          setStatus(i18n.t('styleDeleted'));
        })();
        return;
      }
      applyStyle(style);
      return;
    }

    const run = target.closest<HTMLElement>('.more-run');
    if (run) {
      const command = Number(run.dataset['command']);
      if (Number.isFinite(command)) {
        closePopups();
        dispatchCommand(command);
      }
      return;
    }
    if (target.closest('#more-reset')) {
      hiddenCommands.clear();
      for (const command of defaultHiddenCommands) hiddenCommands.add(command);
      applyToolbarVisibility();
      renderMoreMenu();
      void persistToolbar();
      setStatus(i18n.t('moreResetDone'));
      return;
    }

    if (target.closest('#style-save')) {
      closePopups();
      void saveCurrentStyle();
      return;
    }
    if (target.closest('.menu-item')) closePopups();
  });
ui.colorPopup.addEventListener('click', (event) => event.stopPropagation());
document.addEventListener('click', () => closePopups());
ui.scroll.addEventListener('pointerdown', () => closePopups());

ui.annotColor.addEventListener('input', () => chooseColor(ui.annotColor.value));
ui.annotColor.addEventListener('change', () => chooseColor(ui.annotColor.value));

ui.strokeSolid.addEventListener('click', () => {
  strokeDash = false;
  annotationLayer.applyStrokeToSelection(strokeWidth, false);
  applyStrokeState();
});
ui.strokeDash.addEventListener('click', () => {
  strokeDash = true;
  annotationLayer.applyStrokeToSelection(strokeWidth, true);
  applyStrokeState();
});
ui.fontSize.addEventListener('input', () => {
  fontSize = Number(ui.fontSize.value);
  annotationLayer.applyFontSizeToSelection(fontSize);
  applyStrokeState();
});
ui.strokeWidth.addEventListener('input', () => {
  strokeWidth = Number(ui.strokeWidth.value);
  annotationLayer.applyStrokeToSelection(strokeWidth, strokeDash);
  applyStrokeState();
});
applyStrokeState();

ui.fileInput.addEventListener('change', () => {
  const file = ui.fileInput.files?.[0];
  ui.fileInput.value = '';
  if (!file) return;
  file.arrayBuffer().then(
    (buf) => openDocument(buf, file.name, null),
    (err: unknown) => setStatus(`${i18n.t('failed')}: ${String(err)}`, true),
  );
});

ui.pageInput.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  const n = Number.parseInt(ui.pageInput.value, 10);
  if (Number.isFinite(n)) viewer.gotoPage(n);
  else ui.pageInput.value = String(viewer.page);
});
ui.pageInput.addEventListener('blur', () => {
  ui.pageInput.value = String(viewer.page);
});

ui.findInput.addEventListener('input', scheduleFind);
ui.findCase.addEventListener('change', scheduleFind);
ui.findWord.addEventListener('change', scheduleFind);
ui.findInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    void runFind(e.shiftKey ? 'prev' : 'next');
  } else if (e.key === 'Escape') {
    e.preventDefault();
    closeFindBar();
    ui.scroll.focus();
  }
});

document.addEventListener('selectionchange', () => {
  if (!viewer.hasDocument || tools.tool !== 'select') return;
  const text = viewer.getSelectedText();
  if (text.length > 0) setStatus(`${i18n.t('copied')} · ${text.length}`);
});

document.addEventListener('fullscreenchange', () => {
  ui.viewFullscreen.classList.toggle('active', document.fullscreenElement !== null);
});

// --------------------------------------------------------------- shortcuts

window.addEventListener('keydown', (e) => {
  const mod = e.ctrlKey || e.metaKey;

  // Inside Electron the native menu owns the accelerators, so handling them here as
  // well would fire every shortcut twice.
  if (mod && isDesktop) return;

  if (mod && e.key.toLowerCase() === 'f') {
    e.preventDefault();
    openFindBar();
    return;
  }
  if (e.key === 'F3') {
    e.preventDefault();
    void runFind(e.shiftKey ? 'prev' : 'next');
    return;
  }
  if (e.key === 'Escape' && !ui.findBar.classList.contains('hidden')) {
    closeFindBar();
    return;
  }
  if (mod && (e.key === '=' || e.key === '+')) {
    e.preventDefault();
    viewer.zoomIn();
    return;
  }
  if (mod && e.key === '-') {
    e.preventDefault();
    viewer.zoomOut();
    return;
  }
  if (mod && e.key === '0') {
    e.preventDefault();
    viewer.setZoomMode('fit-width');
    return;
  }
  if (e.ctrlKey || e.metaKey || e.altKey) return;

  // Delete key removes the selected annotation, from anywhere in the window.
  if ((e.key === 'Delete' || e.key === 'Backspace') && annotationLayer.selected) {
    e.preventDefault();
    annotationLayer.removeSelected();
    return;
  }

  const target = e.target as HTMLElement | null;
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) {
    return;
  }

  switch (e.key) {
    case 'PageDown':
      viewer.nextPage();
      e.preventDefault();
      break;
    case 'PageUp':
      viewer.prevPage();
      e.preventDefault();
      break;
    case 'Home':
      viewer.gotoPage(1);
      e.preventDefault();
      break;
    case 'End':
      viewer.gotoPage(viewer.pageCount);
      e.preventDefault();
      break;
    case 'h':
      tools.setTool('hand');
      break;
    case 'v':
      tools.setTool('select');
      break;
    case 'z':
      tools.setTool('zoom');
      break;
    case 's':
      tools.setTool('snapshot');
      break;
    default:
      break;
  }
});

/** Hides or reveals annotations without deleting them. */
/** Hides or reveals annotations for the active document only. */
function toggleAnnotationVisibility(): void {
  if (!activeSession) return;
  activeSession.annotationsHidden = !activeSession.annotationsHidden;
  ui.pages.classList.toggle('annotations-hidden', activeSession.annotationsHidden);
  annotationLayer.refreshAll();
  setStatus(activeSession.annotationsHidden ? i18n.t('annotHidden') : i18n.t('annotShown'));
}

/** Renders the current page, with its annotations, to a PNG. */
async function exportCurrentPage(): Promise<void> {
  if (!viewer.hasDocument) return;
  try {
    const scale = Math.max(viewer.getState().scale * 2, 2);
    const canvas = await viewer.renderPageBitmap(viewer.page, scale);
    const context = canvas.getContext('2d');
    const geometry = viewer.pageGeometry(viewer.page);
    if (context && geometry) {
      for (const item of annotations.byPage(viewer.page)) {
        const box = item.rect ?? item.rects?.[0];
        if (!box) continue;
        const k = scale;
        context.save();
        context.strokeStyle = item.color;
        context.lineWidth = 3;
        context.fillStyle = item.color;
        if (item.kind === 'highlight') {
          context.globalAlpha = 0.38;
          context.fillRect(box.x * k, box.y * k, box.w * k, box.h * k);
        } else if (item.kind === 'ellipse') {
          context.beginPath();
          context.ellipse((box.x + box.w / 2) * k, (box.y + box.h / 2) * k, (box.w / 2) * k, (box.h / 2) * k, 0, 0, Math.PI * 2);
          context.stroke();
        } else {
          context.strokeRect(box.x * k, box.y * k, box.w * k, box.h * k);
        }
        context.restore();
      }
    }
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('PNG encode failed');
    downloadBlob(blob, `${currentName || 'page'}-p${viewer.page}.png`);
    setStatus(`${i18n.t('exportDone')}: p${viewer.page}`);
  } catch (err) {
    setStatus(`${i18n.t('snapshotFail')}: ${String(err)}`, true);
  }
}

/**
 * Keeps the toolbar usable at any window width.
 *
 * The bar wraps onto extra rows rather than scrolling buttons out of reach; once it
 * no longer fits on one row the labels are dropped so it shrinks back to icon-only.
 */
const TOOLBAR_ROW = 44;
/**
 * Drops the button labels only when the window is genuinely narrow.
 *
 * The toolbar is allowed to wrap instead, because stripping the labels at ordinary
 * desktop widths made every command an unlabelled icon — including Settings, which
 * users then could not find at all.
 */
function updateToolbarDensity(): void {
  const bar = document.querySelector<HTMLElement>('.toolbar');
  if (!bar) return;
  bar.classList.remove('compact');
  if (window.innerWidth < 1000 && bar.scrollHeight > TOOLBAR_ROW + 10) bar.classList.add('compact');
}
new ResizeObserver(() => updateToolbarDensity()).observe(document.body);
updateToolbarDensity();
// Drag and drop anywhere over the window.
let dragDepth = 0;
window.addEventListener('dragenter', (e) => {
  e.preventDefault();
  dragDepth++;
  ui.dropHint.classList.add('active');
});
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('dragleave', (e) => {
  e.preventDefault();
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) ui.dropHint.classList.remove('active');
});
window.addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0;
  ui.dropHint.classList.remove('active');
  const file = e.dataTransfer?.files?.[0];
  if (!file) return;
  if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') {
    setStatus(i18n.t('notPdf'), true);
    return;
  }
  // Electron exposes a real path for dropped files; the browser does not.
  const path = (file as File & { path?: string }).path;
  file.arrayBuffer().then(
    (buf) => openDocument(buf, file.name, path ?? null),
    (err: unknown) => setStatus(`${i18n.t('failed')}: ${String(err)}`, true),
  );
});

// --------------------------------------------------------- desktop wiring

async function initDesktop(): Promise<void> {
  const bridge = desktop;
  if (!bridge) return;
  bridge.onMenuCommand((payload) => dispatchCommand(payload.id, payload.data));
  bridge.onOpenFile((payload) => void openPath(payload.path, payload.name));
  bridge.onCloseRequested(() => {
    if (annotations.dirty) {
      const save = window.confirm(`${i18n.t('unsavedTitle')}\n\n${i18n.t('unsavedBody')}`);
      if (save) {
        void saveAnnotations().then(() => bridge.confirmClose());
        return;
      }
    }
    bridge.confirmClose();
  });

  // A file passed on the command line or through a file association may have been
  // announced before this renderer subscribed, so pull anything still queued.
  const pending = await bridge.takePendingOpen();
  if (pending) void openPath(pending.path, pending.name);

  const settings = await bridge.settings.read();
  if (settings.language && settings.language !== i18n.languageId) i18n.setLanguage(settings.language);
  if (settings.viewMode === 'single' || settings.viewMode === 'spread') setViewMode(settings.viewMode);
  await loadRecents();
  await refreshMenu();
}

// ------------------------------------------------------------------- start

function applyIcons(): void {
  if (!pack) return;
  for (const [name, element] of Object.entries(ICON_ELEMENTS)) {
    if (element.querySelector(':scope > .btn-label')) continue;
    const url = pack.iconUrl(name);
    if (!url) continue;
    const label = document.createElement('span');
    label.className = 'btn-label';
    label.textContent = element.textContent ?? '';
    const icon = document.createElement('span');
    icon.className = 'btn-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.style.setProperty('mask-image', `url("${url}")`);
    icon.style.setProperty('-webkit-mask-image', `url("${url}")`);
    element.replaceChildren(icon, label);
    element.classList.add('has-icon');
  }
}

async function initResources(): Promise<void> {
  try {
    pack = await loadResourcePack();
    applyIcons();
    applyCommandLabels();
    applyStrings();
    if (pack.fontFamily) document.documentElement.style.setProperty('--pack-font', `'${pack.fontFamily}'`);
  } catch (err) {
    setStatus(String(err), true);
  } finally {
    packReady = true;
  }
}

applyCommandLabels();
// Read the toolbar only now: `data-command` is written by the pass above.
collectBarEntries();
renderMoreMenu();
applyToolbarVisibility();
applyStrings();
updateToolButtons(tools.tool);
setViewMode('continuous');
void initResources().then(() => initDesktop());
void loadAppSettings();
void loadRecents().then(() => refreshMenu());

// Start with one empty tab so there is always a session to open into.
sessions.push(createSession());
void activateSession(sessions[0]);

const requested = new URLSearchParams(location.search).get('file');
if (requested) {
  void loadUrl(requested, requested.split('/').pop());
} else {
  setStatus(i18n.t('noDocument'));
}
