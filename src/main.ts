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
import {
  addSavedSearch,
  loadSavedSearches,
  removeSavedSearch,
  saveSavedSearches,
  type SavedSearch,
} from './search/saved.js';
import { SearchResults, type ExternalHit } from './sidebar/search-results.js';
import { AnnotationPanel } from './sidebar/annotations.js';
import { ToolManager, type ToolName } from './tools/tool-manager.js';
import { FindIndex } from './tools/find.js';
import { Loupe } from './tools/loupe.js';
import { buildPrintDocument, disposePrintDocument, parsePageRange } from './tools/print.js';
import { showPageOpsDialog, type PageOperation } from './ui/pages-dialog.js';
import { showPrintDialog } from './ui/print-dialog.js';
import { documentKey, loadProgress, saveProgress } from './viewer/progress.js';
import { showChoiceDialog, showConfirmDialog, showInputDialog, showPackDialog, showPromptDialog } from './ui/dialog.js';
import { showSettingsDialog, type SettingsField } from './ui/settings-dialog.js';
import { showAboutDialog } from './ui/about-dialog.js';
import { ENGINE_LICENCE, ENGINE_NAME, LICENCE_NOTE, PRODUCT_AUTHOR, PRODUCT_DESCRIPTION, PRODUCT_EMAIL, PRODUCT_NAME, PRODUCT_TAGLINE, PRODUCT_VERSION } from './product.js';
import { loadResourcePack, type ResourcePack } from './assets/registry.js';
import { AnnotationLayer, annotationKindForTool } from './annotations/layer.js';
import { writeAnnotations, type PdfAnnotationInput } from './pdf/annotate.js';
import { readAnnotations } from './pdf/import.js';
import { flattenPage, type FlattenInput } from './pdf/flatten.js';
import { readUserUnit } from './tools/measure.js';
import { createPdf, type NewPage } from './pdf/create.js';
import { createBlankPdf, createPdfFromJpeg } from './pdf/create.js';
import { mergePdf } from './pdf/merge.js';
import { rewritePdf, type PagePlan } from './pdf/rewrite.js';
import { History } from './annotations/history.js';
import { PdfDocument } from './pdf/document.js';
import type { PdfValue } from './pdf/syntax.js';
import { builtinStyles, StyleStore, type AnnotationStyle } from './annotations/styles.js';
import type { MeasureUnit } from './tools/measure.js';
import type { Annotation } from './annotations/model.js';
import {
  DEFAULT_STAMP,
  STAMP_IDS,
  STAMP_LABEL_KEYS,
  STAMP_PDF_NAMES,
  isStampId,
  type StampId,
} from './annotations/model.js';
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
  tabThumbnails: mustFind<HTMLButtonElement>('tab-thumbnails'),
  tabOutline: mustFind<HTMLButtonElement>('tab-outline'),
  tabAnnotations: mustFind<HTMLButtonElement>('tab-annotations'),
  tabSearch: mustFind<HTMLButtonElement>('tab-search'),
  paneThumbnails: mustFind<HTMLElement>('pane-thumbnails'),
  paneOutline: mustFind<HTMLElement>('pane-outline'),
  paneAnnotations: mustFind<HTMLElement>('pane-annotations'),
  paneSearch: mustFind<HTMLElement>('pane-search'),
  searchResults: mustFind<HTMLElement>('search-results'),
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
  fitVisible: mustFind<HTMLButtonElement>('btn-fit-visible'),
  zoomActual: mustFind<HTMLButtonElement>('btn-zoom-actual'),
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
  print: mustFind<HTMLButtonElement>('btn-print'),
  deletePages: mustFind<HTMLButtonElement>('btn-delete-pages'),
  rotatePages: mustFind<HTMLButtonElement>('btn-rotate-pages'),
  insertPage: mustFind<HTMLButtonElement>('btn-insert-page'),
  extractPages: mustFind<HTMLButtonElement>('btn-extract-pages'),
  cropPages: mustFind<HTMLButtonElement>('btn-crop-pages'),
  newBlank: mustFind<HTMLButtonElement>('btn-new-blank'),
  newImage: mustFind<HTMLButtonElement>('btn-new-image'),
  reorderPages: mustFind<HTMLButtonElement>('btn-reorder-pages'),
  summary: mustFind<HTMLButtonElement>('btn-summary'),
  searchFolder: mustFind<HTMLButtonElement>('btn-search-folder'),
  saveSearch: mustFind<HTMLButtonElement>('btn-save-search'),
  merge: mustFind<HTMLButtonElement>('btn-merge'),
  flatten: mustFind<HTMLButtonElement>('btn-flatten'),
  annotStamp: mustFind<HTMLButtonElement>('annot-stamp'),
  stampPick: mustFind<HTMLButtonElement>('btn-stamp-pick'),
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
  toolLoupe: mustFind<HTMLButtonElement>('tool-loupe'),

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
  viewSpreadCont: mustFind<HTMLButtonElement>('view-spread-cont'),
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
  // Late-bound: the viewer is constructed further down, after the debug hooks.
  Object.defineProperty(window, '__viewer', { get: () => viewer });
  hooks['__setViewMode'] = (mode: ViewMode) => setViewMode(mode);
  hooks['__contentBox'] = (page: number) => viewer.contentBox(page);
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
      author: item.author ?? null,
      stampName: item.stampName ?? null,
      replies: (item.replies ?? []).map((r) => r.text),
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

  /** Rewrites the open document from a page plan; used by the verification suites. */
  /** Merges extra bytes into the open document; used by the verification suite. */
  hooks['__mergePdf'] = async (extra: Uint8Array, at: number) => {
    const source = activeSession?.bytes;
    if (!source) throw new Error('当前文档没有原始数据');
    const result = await mergePdf(new Uint8Array(source), new Uint8Array(extra), at);
    return { pageCount: result.pageCount, inserted: result.inserted, bytes: Array.from(result.bytes) };
  };

  hooks['__rewritePdf'] = async (plan: PagePlan[]) => {
    const source = activeSession?.bytes;
    if (!source) throw new Error('当前文档没有原始数据');
    const result = await rewritePdf(new Uint8Array(source), plan);
    return { pageCount: result.pageCount, size: result.bytes.length, bytes: Array.from(result.bytes) };
  };

  /** Opens bytes with pdf.js and reports what a reader sees. */
  /**
   * Renders a page and hashes the pixels.
   *
   * This is the honest test for a rewrite: if the drawing is byte-identical, nothing in
   * the object graph that matters was lost, whatever the file size says.
   */
  hooks['__rewriteDebug'] = async () => {
    const source = activeSession?.bytes;
    if (!source) return { error: 'no bytes' };
    const bytes = new Uint8Array(source);
    const doc = await PdfDocument.parse(bytes);
    const numbers = doc.objectNumbers();
    const raws = numbers.map((n) => doc.rawObjectText(n));
    const pages = await doc.pages();
    return {
      byteLength: bytes.length,
      objectCount: numbers.length,
      withRaw: raws.filter((r) => r !== null).length,
      withoutRaw: raws.filter((r) => r === null).length,
      rawBytes: raws.reduce((sum, r) => sum + (r ? r.length : 0), 0),
      firstPageObject: pages[0]?.num ?? null,
      firstPageRawHead: (() => {
        const raw = doc.rawObjectText(pages[0]?.num ?? 0);
        return raw === null ? 'null' : raw.slice(0, 120);
      })(),
    };
  };

  hooks['__pageFingerprint'] = async (bytes: Uint8Array, pageNumber: number, scale = 1) => {
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const opened = await openFromArrayBuffer(buffer as ArrayBuffer, 'fingerprint.pdf');
    try {
      const page = await opened.doc.getPage(pageNumber);
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.ceil(viewport.width));
      canvas.height = Math.max(1, Math.ceil(viewport.height));
      const context = canvas.getContext('2d', { alpha: false });
      if (!context) throw new Error('2D 上下文不可用');
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvas, viewport, transform: [1, 0, 0, 1, 0, 0] }).promise;
      const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let hash = 0x811c9dc5;
      let ink = 0;
      for (let i = 0; i < data.length; i += 4) {
        const value = data[i] as number;
        if (value < 250) ink++;
        hash ^= value;
        hash = Math.imul(hash, 0x01000193);
      }
      return { hash: (hash >>> 0).toString(16), ink, width: canvas.width, height: canvas.height };
    } finally {
      await opened.doc.destroy();
    }
  };

  hooks['__pdfSummary'] = async (bytes: Uint8Array) => {
    const buffer =
      bytes instanceof Uint8Array
        ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
        : bytes;
    const opened = await openFromArrayBuffer(buffer as ArrayBuffer, 'summary.pdf');
    try {
      const pages: Array<Record<string, unknown>> = [];
      for (let index = 1; index <= opened.pageCount; index++) {
        const page = await opened.doc.getPage(index);
        const viewport = page.getViewport({ scale: 1 });
        let text = '';
        try {
          const content = await page.getTextContent();
          text = content.items
            .map((item) => ('str' in item ? item.str : ''))
            .join('')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 400);
        } catch {
          text = '';
        }
        pages.push({
          width: Math.round(viewport.width),
          height: Math.round(viewport.height),
          rotate: page.rotate,
          text,
        });
      }
      return { pageCount: opened.pageCount, pages };
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
    save: ui.savePdf,
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
  currentStamp: () => currentStamp,
  stampLabel: (stamp) => i18n.t(STAMP_LABEL_KEYS[stamp]),
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
  replyLabel: () => i18n.t('annotReply'),
  onReply: (id, text) => {
    const item = annotations.byId(id);
    if (!item) return;
    annotations.update(id, {
      replies: [...(item.replies ?? []), { author: annotations.defaultAuthor, text, at: Date.now() }],
    });
    history.record(snapshotAnnotations());
  },
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
    // Coalesced: a drag emits on every pointer move but must undo as one step.
    history.record(snapshotAnnotations());
  });
  return session;
}

const styles = new StyleStore();

/**
 * Undo history for annotations.
 *
 * Snapshots of the whole list: it is small, and a snapshot cannot drift out of step
 * with the model the way a hand-written inverse operation can.
 */
const history = new History<string>(JSON.stringify([]));

function snapshotAnnotations(): string {
  return JSON.stringify(annotations.all);
}

/** Replaces the annotation list from a snapshot, without marking it clean. */
function restoreAnnotations(json: string): void {
  annotations.load(JSON.parse(json) as Annotation[], false);
  annotationLayer.refreshAll();
  annotPanel.render();
  renderTabs();
  void refreshTitle();
}

function undoAnnotation(): void {
  const previous = history.undo();
  if (previous === null) { setStatus(i18n.t('undoEmpty')); return; }
  restoreAnnotations(previous);
  setStatus(i18n.t('undo'));
}

function redoAnnotation(): void {
  const next = history.redo();
  if (next === null) { setStatus(i18n.t('redoEmpty')); return; }
  restoreAnnotations(next);
  setStatus(i18n.t('redo'));
}
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

// The magnifier reads the rendered page canvases, so it needs the pages container and
// a positioned host to place its lens in.
const loupe = new Loupe(ui.content, ui.pages);
loupe.attach();

/**
 * Prints the pages the reader asks for.
 *
 * Pages are rasterised into a container that only exists on paper; the print
 * stylesheet hides the whole shell and shows that container. The packaged window and
 * a browser tab run the same path.
 */
async function runPrint(): Promise<void> {
  if (!viewer.hasDocument) return;
  const choice = await showPrintDialog(i18n, {
    pageCount: viewer.pageCount,
    currentPage: viewer.page,
    rangeText: `1-${viewer.pageCount}`,
  });
  if (!choice) return;

  const pages =
    choice.range === 'current'
      ? [viewer.page]
      : choice.range === 'custom'
        ? parsePageRange(choice.rangeText, viewer.pageCount)
        : Array.from({ length: viewer.pageCount }, (_, index) => index + 1);

  if (pages.length === 0) {
    setStatus(i18n.t('printNoPages'), true);
    return;
  }

  setStatus(i18n.t('printPreparing'));
  let prepared: HTMLElement | null = null;
  try {
    prepared = await buildPrintDocument(
      viewer,
      { pages, ...choice.options },
      {
        rendering: (done, total) => i18n.t('printRendering').replace('{a}', String(done)).replace('{b}', String(total)),
        failed: (page, reason) => i18n.t('printRenderFailed').replace('{a}', String(page)).replace('{b}', reason),
        cancelled: () => i18n.t('printNoPages'),
      },
      (text) => setStatus(text),
    );
  } catch (error) {
    setStatus(`${i18n.t('printFailed')}: ${String((error as Error)?.message ?? error)}`, true);
    disposePrintDocument();
    return;
  }

  if (!prepared) {
    setStatus(i18n.t('printFailed'), true);
    disposePrintDocument();
    return;
  }

  if (desktop) {
    const result = await desktop.print({ printBackground: true });
    if (!result.ok && result.reason) setStatus(`${i18n.t('printFailed')}: ${result.reason}`, true);
    else setStatus(i18n.resolveCommand(CMD.Print)?.status ?? i18n.t('printTitle'));
    // The platform dialogue has closed by the time this resolves.
    disposePrintDocument();
    return;
  }

  window.print();
  setStatus(i18n.resolveCommand(CMD.Print)?.status ?? i18n.t('printTitle'));
  // `afterprint` fires when the browser's dialogue closes, which is the right moment to
  // drop the sheets: they are large, but removing them before printing starts would
  // yield blank pages. The timer only covers a browser that never fires the event.
  window.addEventListener('afterprint', () => disposePrintDocument(), { once: true });
  setTimeout(() => disposePrintDocument(), 20000);
}

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
  showSidebar: boolean;
  pageGap: PageGap;
  defaultViewMode: ViewMode;
  defaultZoomMode: DefaultZoom;
  /** Name written as the author of new annotations. */
  author: string;
}

const DEFAULT_APP_SETTINGS: AppSettings = {
  theme: 'dark',
  showStatusBar: true,
  showSidebar: true,
  pageGap: 'normal',
  defaultViewMode: 'continuous',
  defaultZoomMode: 'fit-width',
  author: '',
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
  ui.sidebar.classList.toggle('hidden', !appSettings.showSidebar);
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
      key: 'author',
      kind: 'text',
      label: i18n.t('annotAuthor'),
      hint: i18n.t('annotAuthorHint'),
      value: appSettings.author,
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
    {
      key: 'showSidebar',
      kind: 'toggle',
      label: i18n.t('showSidebar'),
      hint: i18n.t('showSidebarHint'),
      value: appSettings.showSidebar,
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
  appSettings.showSidebar = result['showSidebar'] === true;
  const view = String(result['defaultViewMode'] ?? appSettings.defaultViewMode) as ViewMode;
  const zoom = String(result['defaultZoomMode'] ?? appSettings.defaultZoomMode) as DefaultZoom;
  applyReadingSettings();

  const author = String(result['author'] ?? '').trim().slice(0, 64);
  appSettings.author = author;
  annotations.defaultAuthor = author || PRODUCT_AUTHOR;

  const language = String(result['language'] ?? i18n.languageId);
  if (language !== i18n.languageId) i18n.setLanguage(language);

  await persistSettings({
    theme,
    pageGap: gap,
    showStatusBar: appSettings.showStatusBar,
    showSidebar: appSettings.showSidebar,
    defaultViewMode: view,
    defaultZoomMode: zoom,
    author,
  });
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
    // Cleared here as well as after a search: an empty bar has its own message.
    searchResults.setSource(findIndex, '');
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
  // After the search, not before it: before, `matches` still holds the previous query's
  // hits and the list would redraw with results that no longer apply.
  searchResults.setSource(findIndex, query);
  repaintAllHighlights();
  updateFindCount();

  const total = findIndex.matches.length;
  if (total === 0) {
    setStatus(`${i18n.t('findNone')}：${query}`);
    return;
  }
  if (move === 'next') findIndex.next();
  else if (move === 'prev') findIndex.prev();

  searchResults.render();
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

type TabName = 'thumbnails' | 'outline' | 'annotations' | 'search';

/** The match list, kept in step with the find bar. */
/**
 * Saved searches, kept in storage.
 *
 * The last folder a search ran against is remembered with it: a saved search that has
 * forgotten where it was pointed can only be re-run after the reader finds the folder
 * again, which is the part they were trying to avoid.
 */
let savedSearches: SavedSearch[] = loadSavedSearches();

/** Tells the panel what is saved, so the list is never out of step with storage. */
function refreshSavedSearches(): void {
  searchResults.setSaved(
    savedSearches.map((item) => ({ id: item.id, name: item.name, query: item.query })),
  );
}

/** Runs a saved search again. */
function applySavedSearch(id: string): void {
  const item = savedSearches.find((entry) => entry.id === id);
  if (!item) return;
  ui.findInput.value = item.query;
  ui.findCase.checked = item.caseSensitive;
  ui.findWord.checked = item.entireWord;
  openFindBar();
  void runFind('none');
}

/** Asks for a name and stores the current term under it. */
async function saveCurrentSearch(): Promise<void> {
  const query = ui.findInput.value.trim();
  if (query === '') {
    openFindBar();
    setStatus(i18n.t('findNoQuery'), true);
    return;
  }
  const name = await showInputDialog(i18n, {
    title: i18n.resolveCommand(CMD.SaveSearch)?.title ?? '保存当前搜索',
    label: i18n.t('searchName'),
    initial: query,
    confirm: i18n.t('pageOpsConfirm'),
    cancel: i18n.t('printCancel'),
  });
  if (name === null || name.trim() === '') return;

  savedSearches = addSavedSearch(savedSearches, {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    name: name.trim(),
    query,
    caseSensitive: ui.findCase.checked,
    entireWord: ui.findWord.checked,
    scope: 'document',
  });
  saveSavedSearches(savedSearches);
  refreshSavedSearches();
  setStatus(`${i18n.t('searchSaved')}：${name.trim()}`);
}

/** Forgets a saved search. */
function deleteSavedSearch(id: string): void {
  savedSearches = removeSavedSearch(savedSearches, id);
  saveSavedSearches(savedSearches);
  refreshSavedSearches();
  setStatus(i18n.t('searchRemoved'));
}

const searchResults = new SearchResults(ui.searchResults, {
  pageLabel: (page) => `${i18n.t('searchResults')} · ${page}`,
  idleText: () => i18n.t('searchIdle'),
  emptyText: () => i18n.t('searchEmpty'),
  summaryText: (matches, pages) =>
    i18n.t('searchSummary').replace('{a}', String(matches)).replace('{b}', String(pages)),
  onOpenExternal: (path, page) => void openSearchHit(path, page),
  onApplySaved: (id) => applySavedSearch(id),
  onDeleteSaved: (id) => deleteSavedSearch(id),
  savedLabel: () => i18n.t('savedSearches'),
  onSelect: (index) => {
    const hit = findIndex.selectAt(index);
    repaintAllHighlights();
    updateFindCount();
    if (hit) viewer.gotoPage(hit.page);
    searchResults.render();
  },
});

function showTab(which: TabName): void {
  ui.tabThumbnails.classList.toggle('active', which === 'thumbnails');
  ui.tabOutline.classList.toggle('active', which === 'outline');
  ui.tabAnnotations.classList.toggle('active', which === 'annotations');
  ui.paneThumbnails.classList.toggle('hidden', which !== 'thumbnails');
  ui.paneOutline.classList.toggle('hidden', which !== 'outline');
  ui.paneAnnotations.classList.toggle('hidden', which !== 'annotations');
  ui.tabSearch.classList.toggle('active', which === 'search');
  ui.paneSearch.classList.toggle('hidden', which !== 'search');
  if (which === 'search') searchResults.render();
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
        stampName: item.stampId ? STAMP_PDF_NAMES[item.stampId] : undefined,
        replies: (item.replies ?? []).map((reply) => ({ author: reply.author, text: reply.text })),
        author: item.author,
      };
      if (list) list.push(input);
      else byPage.set(item.page - 1, [input]);
    }
    const updates = [...byPage.entries()].map(([pageIndex, list]) => ({ pageIndex, annotations: list }));
    const result = await writeAnnotations(new Uint8Array(source), updates);
    return result.bytes;
  }

  /** Writes the annotations into the PDF and saves the result as a new file. */
  /** Debounces a second save landing while the first is still writing. A timestamp
   * cannot get stuck the way a flag can when an early return is added later. */
  let lastSaveAt = 0;

  async function saveIntoPdf(): Promise<void> {
    const now = Date.now();
    if (now - lastSaveAt < 800) return;
    lastSaveAt = now;
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
    const bridge = desktop;

    /** The document now *is* the written file, so mark it saved and stop there. */
    const adopt = (path: string): void => {
      session.bytes = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
      session.path = path;
      annotations.markSaved();
      void refreshTitle();
      setStatus(`${i18n.t('savedTo')} ${path.split(/[\\/]/).pop()}`);
    };

    // Saving over the file that was opened is what Ctrl+S means everywhere else, so
    // there is no dialog unless the write is actually refused.
    if (bridge && session.path) {
      const result = await bridge.writeFile(session.path, bytes);
      if (result.ok) {
        adopt(session.path);
          return;
      }
      setStatus(i18n.t('saveReadOnly'), true);
    }

    // No path to write to, or the file refused: ask where to put the copy.
    if (bridge) {
      const target = await bridge.saveFileDialog({
        title: i18n.resolveCommand(CMD.SaveIntoPdf)?.title ?? 'Save',
        defaultPath: `${stem}.pdf`,
        filters: [{ name: 'PDF', extensions: ['pdf'] }],
      });
      if (!target) return;
      const result = await bridge.writeFile(target, bytes);
      if (!result.ok) {
        setStatus(`${i18n.t('pdfSaveFailed')}: ${result.error ?? target}`, true);
        return;
      }
      adopt(target);
      return;
    }

    downloadBlob(new Blob([bytes as BlobPart], { type: 'application/pdf' }), `${stem}.pdf`);
    setStatus(`${i18n.t('pdfSaved')}: ${stem}.pdf`);
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
      const input: Omit<Annotation, 'id' | 'createdAt' | 'updatedAt'> = {
        page: item.page,
        kind: item.kind,
        color: item.color,
        // Keep the file's own author rather than the reader's name from the settings.
        author: item.author ?? '',
        replies: item.replies,
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
    history.reset(snapshotAnnotations());
    annotationLayer.refreshAll();
    annotPanel.render();
    void refreshTitle();
    return true;
  }

/**
 * Swaps a rewritten file into the open session.
 *
 * The tab, its path and its annotations belong to the reader, not to the bytes, so the
 * document is replaced underneath rather than opened as a second tab.
 */
async function replaceDocumentBytes(bytes: Uint8Array): Promise<void> {
  const session = activeSession;
  if (!session) return;
  const kept = bytes.slice();
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const opened = await openFromArrayBuffer(buffer, session.name);
  session.opened = opened;
  session.bytes = kept.buffer as ArrayBuffer;
  session.key = documentKey(opened.doc.fingerprints, opened.pageCount);
  // Keep the reader where they were, clamped to the new extent.
  session.snapshot = { ...viewer.getState(), page: Math.min(viewer.page, opened.pageCount) };
  await activateSession(session);
}

/**
 * Moves annotations onto the page numbers they now occupy.
 *
 * Pages carry their annotations, so an annotation on a deleted page has nowhere to go
 * and is dropped. Anything else would leave marks floating over unrelated content.
 */
function remapAnnotations(sourceToTarget: Map<number, number>): number {
  if (annotations.count === 0) return 0;
  const kept: Annotation[] = [];
  let dropped = 0;
  let moved = false;
  for (const item of annotations.all) {
    const target = sourceToTarget.get(item.page);
    if (target === undefined) {
      dropped++;
      continue;
    }
    if (target === item.page) {
      kept.push(item);
    } else {
      kept.push({ ...item, page: target });
      moved = true;
    }
  }
  // Reload when pages moved as well as when some were dropped: an annotation whose page
  // number changed has to be written back, or it stays behind on the wrong page.
  if (dropped > 0 || moved) annotations.load(kept, false);
  return dropped;
}

/** Runs one page operation: ask, build a plan, rewrite, install the result. */
async function runPageOperation(operation: PageOperation): Promise<void> {
  const session = activeSession;
  if (!session?.bytes || !viewer.hasDocument) return;

  const choice = await showPageOpsDialog(i18n, {
    operation,
    pageCount: viewer.pageCount,
    currentPage: viewer.page,
  });
  if (!choice) return;

  const total = viewer.pageCount;
  const identity: PagePlan[] = Array.from({ length: total }, (_, index) => ({ sourceIndex: index }));
  let plan: PagePlan[];
  let extracted = false;

  if (operation === 'delete' || operation === 'extract' || operation === 'crop') {
    const selected = parsePageRange(choice.rangeText, total);
    if (selected.length === 0) {
      setStatus(i18n.t('pageOpsNoPages'), true);
      return;
    }
    const chosen = new Set(selected);
    if (operation === 'delete') {
      if (chosen.size >= total) {
        setStatus(i18n.t('pageOpsNoPages'), true);
        return;
      }
      plan = identity.filter((_, index) => !chosen.has(index + 1));
    } else if (operation === 'extract') {
      plan = selected.map((page) => ({ sourceIndex: page - 1 }));
      extracted = true;
    } else {
      plan = identity.map((entry, index) =>
        chosen.has(index + 1) ? { ...entry, cropMargins: choice.margins } : entry,
      );
    }
  } else if (operation === 'rotate') {
    const chosen = new Set(parsePageRange(choice.rangeText, total));
    if (chosen.size === 0) {
      setStatus(i18n.t('pageOpsNoPages'), true);
      return;
    }
    plan = identity.map((entry, index) =>
      chosen.has(index + 1) ? { ...entry, rotateBy: choice.angle } : entry,
    );
  } else {
    const raw = Number.parseInt(choice.rangeText, 10);
    const at = Math.min(total + 1, Math.max(1, Number.isFinite(raw) ? raw : viewer.page));
    plan = [...identity];
    for (let count = 0; count < choice.count; count++) {
      plan.splice(at - 1 + count, 0, {
        sourceIndex: null,
        mediaBox: [0, 0, choice.width, choice.height],
      });
    }
  }

  setStatus(i18n.t('loading'));
  let result;
  try {
    result = await rewritePdf(new Uint8Array(session.bytes), plan);
  } catch (error) {
    setStatus(`${i18n.t('pageOpsFailed')}: ${String((error as Error)?.message ?? error)}`, true);
    return;
  }

  if (extracted) {
    const stem = (session.name || 'document').replace(/\.pdf$/i, '');
    await openDocument(result.bytes.slice().buffer as ArrayBuffer, `${stem}-pages.pdf`, null);
    setStatus(`${i18n.t('pageOpsExtracted')}: ${result.pageCount} 页`);
    return;
  }

  // Map each source page onto the page number it now occupies.
  const sourceToTarget = new Map<number, number>();
  plan.forEach((entry, index) => {
    if (entry.sourceIndex === null) return;
    const sourcePage = entry.sourceIndex + 1;
    if (!sourceToTarget.has(sourcePage)) sourceToTarget.set(sourcePage, index + 1);
  });
  const dropped = remapAnnotations(sourceToTarget);

  await replaceDocumentBytes(result.bytes);
  setStatus(dropped > 0 ? `${i18n.t('pageOpsDone')}（${dropped} 条批注随页面删除）` : i18n.t('pageOpsDone'));
}

/** Creates a document of blank pages and opens it. */
async function newBlankDocument(): Promise<void> {
  const value = await showInputDialog(i18n, {
    title: i18n.resolveCommand(CMD.NewBlankDocument)?.title ?? '新建空白文档',
    label: i18n.t('newDocPages'),
    initial: '1',
    numeric: true,
  });
  if (value === null) return;
  const count = Number.parseInt(value.trim(), 10);
  if (!Number.isFinite(count) || count < 1) {
    setStatus(i18n.t('pageOpsNoPages'), true);
    return;
  }
  const bytes = createBlankPdf(count);
  await openDocument(bytes.buffer as ArrayBuffer, i18n.t('untitled'), null);
  setStatus(`${i18n.t('newDocDone')}：${count} 页`);
}

/** Asks for an image file without leaving a permanent element in the document. */
function pickImageFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.style.display = 'none';
    let settled = false;
    const finish = (file: File | null): void => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(file);
    };
    input.addEventListener('change', () => finish(input.files?.[0] ?? null));
    input.addEventListener('cancel', () => finish(null));
    document.body.appendChild(input);
    input.click();
  });
}

/**
 * Builds a one-page PDF from an image file.
 *
 * The browser decodes the image and re-encodes it as JPEG, so every format the engine
 * understands works and the writer only ever has to embed one filter.
 */
async function newFromImage(): Promise<void> {
  const file = await pickImageFile();
  if (!file) return;
  try {
    const bitmap = await createImageBitmap(file);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('2D 上下文不可用');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
    const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
    const binary = atob(base64);
    const jpeg = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) jpeg[i] = binary.charCodeAt(i);

    // Scale so the long side fits a printable page: one pixel of the image need not
    // become one point of paper.
    const scale = Math.min(1, 842 / Math.max(bitmap.width, bitmap.height));
    const pdf = createPdfFromJpeg(jpeg, Math.round(bitmap.width * scale), Math.round(bitmap.height * scale));
    bitmap.close();
    const stem = file.name.replace(/\.[^.]+$/, '') || 'image';
    await openDocument(pdf.buffer as ArrayBuffer, `${stem}.pdf`, null);
    setStatus(i18n.t('imageDone'));
  } catch (error) {
    setStatus(`${i18n.t('imageFailed')}: ${String((error as Error)?.message ?? error)}`, true);
  }
}

/** Rearranges the pages into the order the reader types. */
async function reorderPages(): Promise<void> {
  const session = activeSession;
  if (!session?.bytes || !viewer.hasDocument) return;
  const value = await showInputDialog(i18n, {
    title: i18n.resolveCommand(CMD.ReorderPages)?.title ?? '页面重排',
    label: `${i18n.t('reorderLabel')}（${i18n.t('reorderHint')}）`,
    initial: Array.from({ length: viewer.pageCount }, (_, index) => index + 1).join(','),
  });
  if (value === null) return;

  const order = parsePageRange(value, viewer.pageCount);
  if (order.length !== viewer.pageCount) {
    setStatus(`${i18n.t('reorderHint')}（当前 ${viewer.pageCount} 页，填写了 ${order.length} 页）`, true);
    return;
  }

  setStatus(i18n.t('loading'));
  let result;
  try {
    result = await rewritePdf(new Uint8Array(session.bytes), order.map((page) => ({ sourceIndex: page - 1 })));
  } catch (error) {
    setStatus(`${i18n.t('pageOpsFailed')}: ${String((error as Error)?.message ?? error)}`, true);
    return;
  }
  const sourceToTarget = new Map<number, number>();
  order.forEach((page, index) => {
    if (!sourceToTarget.has(page)) sourceToTarget.set(page, index + 1);
  });
  const dropped = remapAnnotations(sourceToTarget);
  await replaceDocumentBytes(result.bytes);
  setStatus(dropped > 0 ? `${i18n.t('reorderDone')}（${dropped} 条批注随页面删除）` : i18n.t('reorderDone'));
}

/** Loads `<document>.pdf.arpk` when it exists, without failing the document open. */
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

/** Asks for a zoom percentage and applies it. */
async function zoomToDialog(): Promise<void> {
  const current = Math.round(viewer.getState().scale * 100);
  const value = await showInputDialog(i18n, {
    title: i18n.resolveCommand(CMD.ZoomTo)?.title ?? '缩放至',
    label: i18n.t('zoomPercent'),
    initial: String(current),
    suffix: '%',
    numeric: true,
  });
  if (value === null) return;
  const percent = Number(value.replace('%', '').trim());
  if (!Number.isFinite(percent) || percent <= 0) {
    setStatus(i18n.t('zoomInvalid'), true);
    return;
  }
  viewer.setScale(percent / 100);
}

/** Asks for a page number and jumps to it. */
async function goToPageDialog(): Promise<void> {
  const value = await showInputDialog(i18n, {
    title: i18n.resolveCommand(CMD.GoToPage)?.title ?? '转到页面',
    label: i18n.t('pageNumber'),
    initial: String(viewer.page),
    numeric: true,
  });
  if (value === null) return;
  const page = Number.parseInt(value.trim(), 10);
  if (!Number.isFinite(page) || page < 1 || page > viewer.pageCount) {
    setStatus(i18n.t('pageInvalid'), true);
    return;
  }
  viewer.gotoPage(page);
}

function setViewMode(mode: ViewMode): void {
  viewMode = mode;
  const facing = mode === 'spread' || mode === 'spread-continuous';
  if (viewer.hasDocument) {
    viewer.setViewMode(mode);
    viewer.markCurrentPage(viewer.page);
  } else {
    ui.pages.dataset['mode'] = mode;
    ui.pages.classList.toggle('mode-single', mode === 'single');
    ui.pages.classList.toggle('mode-spread', mode === 'spread');
    ui.pages.classList.toggle('mode-spread-continuous', mode === 'spread-continuous');
  }
  ui.viewContinuous.classList.toggle('active', mode === 'continuous');
  ui.viewSingle.classList.toggle('active', mode === 'single');
  ui.viewSpread.classList.toggle('active', mode === 'spread');
  ui.viewSpreadCont.classList.toggle('active', mode === 'spread-continuous');
  void facing;
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
          { type: 'separator' },
          command(CMD.NewBlankDocument),
          command(CMD.NewFromImage),
          { type: 'separator' },
          command(CMD.ReorderPages),
          command(CMD.DeletePages),
          command(CMD.RotatePages),
          command(CMD.InsertBlankPage),
          command(CMD.ExtractPages),
          command(CMD.MergeDocument),
          command(CMD.SaveSearch),
          command(CMD.SearchFolder),
          command(CMD.SummaryAnnotations),
          command(CMD.FlattenAnnotations),
          command(CMD.CropPages),
          command(CMD.Print, 'CmdOrCtrl+P'),
          command(CMD.Undo, 'CmdOrCtrl+Z'),
          command(CMD.Redo, 'CmdOrCtrl+Shift+Z'),
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
command(CMD.ViewSpreadContinuous),
command(CMD.ZoomActual, 'CmdOrCtrl+0'),
command(CMD.FitVisible),
command(CMD.ZoomTo),
{ type: 'separator' },
command(CMD.PrevView, 'Alt+Left'),
command(CMD.NextView, 'Alt+Right'),
command(CMD.GoToPage, 'CmdOrCtrl+G'),
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
          command(CMD.AnnotStamp),
          command(CMD.StampPick),
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
  // A freshly opened document starts with an empty history.
  history.reset(snapshotAnnotations());
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
// The toolbar toggle is gone: sidebar visibility lives in Settings now. The shortcut
// and the View menu entry stay, because a reader who knows Ctrl+B still wants it.
registerCommand(CMD.Sidebar, () => {
  appSettings.showSidebar = ui.sidebar.classList.contains('hidden');
  applyReadingSettings();
  void persistSettings({ showSidebar: appSettings.showSidebar });
});
bindCommand(CMD.PrevPage, ui.prev, { onClick: () => viewer.prevPage() });
bindCommand(CMD.NextPage, ui.next, { onClick: () => viewer.nextPage() });
bindCommand(CMD.ZoomIn, ui.zoomIn, { onClick: () => viewer.zoomIn() });
bindCommand(CMD.ZoomOut, ui.zoomOut, { onClick: () => viewer.zoomOut() });
bindCommand(CMD.FitWidth, ui.fitWidth, { onClick: () => viewer.setZoomMode('fit-width') });
bindCommand(CMD.FitPage, ui.fitPage, { onClick: () => viewer.setZoomMode('fit-page') });
bindCommand(CMD.FitVisible, ui.fitVisible, { onClick: () => viewer.setZoomMode('fit-visible') });
bindCommand(CMD.ZoomActual, ui.zoomActual, { onClick: () => viewer.setZoomMode('actual') });
registerCommand(CMD.ZoomTo, () => void zoomToDialog());
registerCommand(CMD.GoToPage, () => void goToPageDialog());
registerCommand(CMD.PrevView, () => {
  if (!viewer.previousView()) setStatus(i18n.t('noPrevView'));
});
registerCommand(CMD.NextView, () => {
  if (!viewer.nextView()) setStatus(i18n.t('noNextView'));
});
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
/**
 * Opens the document a folder-search hit belongs to, at the page it names.
 *
 * Reuses an already-open tab when there is one: searching a folder and then clicking a
 * result should not open a second copy of a document the reader already has in front of
 * them.
 */
async function openSearchHit(path: string, page: number): Promise<void> {
  const existing = sessions.find((session) => session.path === path);
  if (existing) {
    await activateSession(existing);
    viewer.gotoPage(page);
    return;
  }
  if (!desktop) return;
  const file = await desktop.readFile(path);
  if (!file || !file.bytes) {
    setStatus(i18n.t('folderFailed'), true);
    return;
  }
  const buffer = file.bytes.buffer.slice(
    file.bytes.byteOffset,
    file.bytes.byteOffset + file.bytes.byteLength,
  ) as ArrayBuffer;
  await openDocument(buffer, file.name, path);
  viewer.gotoPage(page);
}

/**
 * Searches a folder and its subfolders for the current find term.
 *
 * Each file is opened on its own and thrown away again: a folder search is a scan, not
 * a shelf of open documents, and holding every parsed document would cost far more than
 * it saves.
 */
async function searchFolder(): Promise<void> {
  if (!desktop) {
    setStatus(i18n.t('folderNeedsDesktop'), true);
    return;
  }
  const query = ui.findInput.value.trim();
  if (query === '') {
    openFindBar();
    setStatus(i18n.t('findNoQuery'), true);
    return;
  }

  const folder = await showInputDialog(i18n, {
    title: i18n.resolveCommand(CMD.SearchFolder)?.title ?? '在文件夹中搜索',
    label: `${i18n.t('folderPath')}（${i18n.t('folderPathHint')}）`,
    initial: '',
    confirm: i18n.t('pageOpsConfirm'),
    cancel: i18n.t('printCancel'),
  });
  if (folder === null || folder.trim() === '') return;

  setStatus(i18n.t('folderScanning'));
  const listed = await desktop.listPdfs(folder.trim());
  if (!listed.ok) {
    setStatus(`${i18n.t('folderFailed')}: ${listed.error ?? ''}`, true);
    return;
  }

  const files = listed.files ?? [];
  const hits: ExternalHit[] = [];
  let scanned = 0;
  for (const path of files) {
    if (hits.length >= MAX_FOLDER_HITS) break;
    const file = await desktop.readFile(path);
    if (!file || !file.bytes) continue;
    scanned++;
    let opened: OpenedDocument | null = null;
    try {
      const buffer = file.bytes.buffer.slice(
        file.bytes.byteOffset,
        file.bytes.byteOffset + file.bytes.byteLength,
      ) as ArrayBuffer;
      opened = await openFromArrayBuffer(buffer, file.name);
      const index = new FindIndex();
      await index.build(opened.doc);
      index.search({
        query,
        caseSensitive: ui.findCase.checked,
        entireWord: ui.findWord.checked,
      });
      for (const hit of index.matches) {
        if (hits.length >= MAX_FOLDER_HITS) break;
        const text = index.textFor(hit.page);
        hits.push({
          path,
          name: file.name,
          page: hit.page,
          before: text.slice(Math.max(0, hit.start - 40), hit.start).replace(/\s+/g, ' '),
          match: text.slice(hit.start, hit.start + hit.length),
          after: text.slice(hit.start + hit.length, hit.start + hit.length + 40).replace(/\s+/g, ' '),
        });
      }
    } catch {
      // A file that will not parse is skipped, not fatal: one damaged PDF in a folder
      // should not stop the search.
    } finally {
      await opened?.doc.destroy();
    }
  }

  const base = i18n.t('folderDone').replace('{a}', String(scanned)).replace('{b}', String(hits.length));
  const note = listed.truncated
    ? `${base}${i18n.t('folderTruncated').replace('{a}', String(files.length))}`
    : base;
  searchResults.setExternal(query, hits, note);
  showTab('search');
  setStatus(hits.length === 0 ? i18n.t('folderNone') : note);
}

bindCommand(CMD.TabSearch, ui.tabSearch, { onClick: () => showTab('search') });
bindCommand(CMD.TabSearch, ui.tabSearch, { onClick: () => showTab('search') });
bindCommand(CMD.TabAnnotations, ui.tabAnnotations, { onClick: () => showTab('annotations') });
bindCommand(CMD.FindPrev, ui.findPrev, { onClick: () => void runFind('prev') });
bindCommand(CMD.FindNext, ui.findNext, { onClick: () => void runFind('next') });
bindCommand(CMD.FindClose, ui.findClose, { onClick: closeFindBar });

bindCommand(CMD.ToolHand, ui.toolHand, { onClick: () => tools.setTool('hand') });
bindCommand(CMD.ToolSelect, ui.toolSelect, { onClick: () => tools.setTool('select') });
bindCommand(CMD.ToolZoom, ui.toolZoom, { onClick: () => tools.setTool('zoom') });
bindCommand(CMD.ToolSnapshot, ui.toolSnapshot, { onClick: () => tools.setTool('snapshot') });
bindCommand(CMD.Loupe, ui.toolLoupe, {
  onClick: () => {
    loupe.setEnabled(!loupe.isEnabled);
    ui.toolLoupe.classList.toggle('active', loupe.isEnabled);
    setStatus(i18n.t(loupe.isEnabled ? 'loupeOn' : 'loupeOff'));
  },
});
registerCommand(CMD.Print, () => void runPrint());
bindCommand(CMD.Print, ui.print, { onClick: () => void runPrint() });

bindCommand(CMD.AnnotHighlight, ui.annotHighlight, { onClick: () => tools.setTool('highlight') });
bindCommand(CMD.AnnotUnderline, ui.annotUnderline, { onClick: () => tools.setTool('underline') });
bindCommand(CMD.AnnotStrikeout, ui.annotStrikeout, { onClick: () => tools.setTool('strikeout') });
bindCommand(CMD.AnnotInk, ui.annotInk, { onClick: () => tools.setTool('ink') });
bindCommand(CMD.AnnotStamp, ui.annotStamp, { onClick: () => tools.setTool('stamp') });
bindCommand(CMD.StampPick, ui.stampPick, { onClick: () => void pickStamp() });
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
bindCommand(CMD.ViewSpreadContinuous, ui.viewSpreadCont, { onClick: () => setViewMode('spread-continuous') });
bindCommand(CMD.ViewFullscreen, ui.viewFullscreen, { onClick: () => void toggleFullscreen() });

// The percentage readout is the natural place to click to type an exact zoom.
ui.zoomLabel.addEventListener('click', () => void zoomToDialog());
ui.zoomLabel.classList.add('clickable');
ui.zoomLabel.title = i18n.resolveCommand(CMD.ZoomTo)?.tooltip ?? '缩放至';

// Menu-only commands.
registerCommand(CMD.FirstPage, () => viewer.gotoPage(1));
registerCommand(CMD.Settings, () => void openSettings());
registerCommand(CMD.LastPage, () => viewer.gotoPage(viewer.pageCount));
registerCommand(CMD.SaveAnnotations, () => void saveAnnotations());
// Bound rather than only registered: a command with no button has no place in the
// overflow menu, which is built from the toolbar's own entries.
bindCommand(CMD.DeletePages, ui.deletePages, { onClick: () => void runPageOperation('delete') });
bindCommand(CMD.RotatePages, ui.rotatePages, { onClick: () => void runPageOperation('rotate') });
bindCommand(CMD.InsertBlankPage, ui.insertPage, { onClick: () => void runPageOperation('insert') });
bindCommand(CMD.ExtractPages, ui.extractPages, { onClick: () => void runPageOperation('extract') });
bindCommand(CMD.NewBlankDocument, ui.newBlank, { onClick: () => void newBlankDocument() });
bindCommand(CMD.NewFromImage, ui.newImage, { onClick: () => void newFromImage() });
bindCommand(CMD.MergeDocument, ui.merge, { onClick: () => void mergeDocument() });
bindCommand(CMD.SaveSearch, ui.saveSearch, { onClick: () => void saveCurrentSearch() });
bindCommand(CMD.SearchFolder, ui.searchFolder, { onClick: () => void searchFolder() });
bindCommand(CMD.SummaryAnnotations, ui.summary, { onClick: () => void summarizeAnnotations() });
bindCommand(CMD.FlattenAnnotations, ui.flatten, { onClick: () => void flattenAnnotations() });
bindCommand(CMD.ReorderPages, ui.reorderPages, { onClick: () => void reorderPages() });
bindCommand(CMD.CropPages, ui.cropPages, { onClick: () => void runPageOperation('crop') });
/**
 * Draws every annotation into the page content and drops the annotations themselves.
 *
 * Flattening is one-way by nature, so it asks first. The rewritten document replaces the
 * open one and the annotation store is emptied: leaving the marks in the store would
 * draw them a second time on top of the ones now baked into the page.
 */
async function flattenAnnotations(): Promise<void> {
  const session = activeSession;
  if (!session?.bytes || !viewer.hasDocument) return;
  if (annotations.count === 0) {
    setStatus(i18n.t('flattenNone'), true);
    return;
  }

  const confirmed = await showConfirmDialog(i18n, {
    title: i18n.resolveCommand(CMD.FlattenAnnotations)?.title ?? '展平注释',
    message: i18n.t('flattenConfirm').replace('{n}', String(annotations.count)),
    confirm: i18n.t('pageOpsConfirm'),
    cancel: i18n.t('printCancel'),
  });
  if (!confirmed) return;

  setStatus(i18n.t('loading'));
  try {
    const source = new Uint8Array(session.bytes);
    const doc = await PdfDocument.parse(source);
    const records = await doc.pages();

    const byPage = new Map<number, FlattenInput[]>();
    for (const item of annotations.all) {
      const list = byPage.get(item.page);
      const input: FlattenInput = {
        kind: item.kind,
        color: item.color,
        rect: item.rect,
        rects: item.rects,
        strokes: item.strokes,
        note: item.note,
        fontSize: item.fontSize,
        strokeWidth: item.strokeWidth,
        strokeDash: item.strokeDash,
        // The flattened word is the standard English name, not the localised one: the
        // page carries Helvetica with WinAnsi, which cannot encode CJK, and a stamp that
        // flattens to question marks is worse than one that flattens to English. The
        // interactive stamp still shows the reader's own language.
        stampLabel: item.stampId ? STAMP_PDF_NAMES[item.stampId] : item.note,
      };
      if (list) list.push(input);
      else byPage.set(item.page, [input]);
    }

    const unit = measureUnit;
    const plan = records.map((record, index) => ({
      sourceIndex: index,
      flatten: flattenPage(
        byPage.get(index + 1) ?? [],
        record.mediaBox,
        readUserUnit({ userUnit: record.userUnit }),
        unit,
      ),
    }));

    const result = await rewritePdf(source, plan);
    annotations.load([], false);
    await replaceDocumentBytes(result.bytes);
    setStatus(i18n.t('flattenDone'));
  } catch (error) {
    setStatus(`${i18n.t('flattenFailed')}: ${String((error as Error)?.message ?? error)}`, true);
  }
}

/** Which standard stamp the tool places. */
let currentStamp: StampId = DEFAULT_STAMP;

/** Asks which stamp to place, and remembers the answer. */
async function pickStamp(): Promise<void> {
  const chosen = await showChoiceDialog(i18n, {
    title: i18n.t('stampPickTitle'),
    label: i18n.t('stampNow'),
    value: currentStamp,
    choices: STAMP_IDS.map((id) => ({ value: id, label: i18n.t(STAMP_LABEL_KEYS[id]) })),
    confirm: i18n.t('pageOpsConfirm'),
    cancel: i18n.t('printCancel'),
  });
  if (chosen === null || !isStampId(chosen)) return;
  currentStamp = chosen;
  setStatus(`${i18n.t('stampNow')}：${i18n.t(STAMP_LABEL_KEYS[currentStamp])}`);
}

/** Resolution the summary renders at. 2 means 144 DPI, the same as printing. */
const SUMMARY_SCALE = 2;
/** Upper bound on the matches a folder search collects. */
const MAX_FOLDER_HITS = 2000;

/** Base64 from a data URL, as bytes. */
function dataUrlBytes(dataUrl: string): Uint8Array {
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Builds a document holding the annotated pages, marks and all.
 *
 * Rendered rather than transcribed. A list of comments in text would need a font that
 * covers whatever the reader typed, and embedding one is a large amount of machinery
 * for a summary; a rendered page carries the marks and the words in them, in any
 * language, with no font of its own.
 */
async function summarizeAnnotations(): Promise<void> {
  const session = activeSession;
  if (!session?.bytes || !viewer.hasDocument) return;
  if (annotations.count === 0) {
    setStatus(i18n.t('flattenNone'), true);
    return;
  }

  setStatus(i18n.t('summaryPreparing'));
  try {
    const source = new Uint8Array(session.bytes);
    const doc = await PdfDocument.parse(source);
    const records = await doc.pages();

    const byPage = new Map<number, FlattenInput[]>();
    for (const item of annotations.all) {
      const list = byPage.get(item.page);
      const input: FlattenInput = {
        kind: item.kind,
        color: item.color,
        rect: item.rect,
        rects: item.rects,
        strokes: item.strokes,
        note: item.note,
        fontSize: item.fontSize,
        strokeWidth: item.strokeWidth,
        stampLabel: item.stampId ? STAMP_PDF_NAMES[item.stampId] : item.note,
        strokeDash: item.strokeDash,
      };
      if (list) list.push(input);
      else byPage.set(item.page, [input]);
    }

    const pages = [...byPage.keys()].sort((a, b) => a - b);
    if (pages.length === 0) throw new Error(i18n.t('flattenNone'));

    // Flatten first, so the render below shows the marks as part of the page.
    const flattened = await rewritePdf(
      source,
      records.map((record, index) => ({
        sourceIndex: index,
        flatten: flattenPage(
          byPage.get(index + 1) ?? [],
          record.mediaBox,
          readUserUnit({ userUnit: record.userUnit }),
          measureUnit,
        ),
      })),
    );

    const opened = await openFromArrayBuffer(
      flattened.bytes.slice().buffer as ArrayBuffer,
      'summary-source.pdf',
    );

    const sheets: NewPage[] = [];
    try {
      for (const pageNumber of pages) {
        const page = await opened.doc.getPage(pageNumber);
        const base = page.getViewport({ scale: 1 });
        const render = page.getViewport({ scale: SUMMARY_SCALE });
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.ceil(render.width));
        canvas.height = Math.max(1, Math.ceil(render.height));
        const context = canvas.getContext('2d', { alpha: false });
        if (!context) throw new Error('2D 上下文不可用');
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvas, viewport: render, transform: [1, 0, 0, 1, 0, 0] }).promise;
        const jpeg = dataUrlBytes(canvas.toDataURL('image/jpeg', 0.9));
        sheets.push({
          box: [0, 0, Math.round(base.width), Math.round(base.height)],
          jpeg: { bytes: jpeg, width: canvas.width, height: canvas.height },
        });
      }
    } finally {
      await opened.doc.destroy();
    }

    const summary = createPdf(sheets);
    const stem = (session.name || 'document').replace(/\.pdf$/i, '');
    await openDocument(summary.buffer as ArrayBuffer, `${stem}-summary.pdf`, null);
    setStatus(`${i18n.t('summaryDone')}：${sheets.length} 页`);
  } catch (error) {
    setStatus(`${i18n.t('summaryFailed')}: ${String((error as Error)?.message ?? error)}`, true);
  }
}

/**
 * Asks for a PDF, through the desktop dialogue when there is one.
 *
 * The browser falls back to a file input for the same reason the image path does: the
 * feature should not be a desktop-only one when the same bytes are one input away.
 */
async function pickPdfFile(): Promise<{ name: string; bytes: Uint8Array } | null> {
  if (desktop) {
    const picked = await desktop.openFileDialog();
    if (!picked || !picked.bytes) return null;
    return { name: picked.name, bytes: picked.bytes };
  }
  const file = await new Promise<File | null>((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/pdf,.pdf';
    input.style.display = 'none';
    let settled = false;
    const finish = (value: File | null): void => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(value);
    };
    input.addEventListener('change', () => finish(input.files?.[0] ?? null));
    input.addEventListener('cancel', () => finish(null));
    document.body.appendChild(input);
    input.click();
  });
  if (!file) return null;
  return { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) };
}

/**
 * Brings every page of another PDF into this one.
 *
 * The pages are inserted, not appended to the end: a reader merging a cover sheet wants
 * it in front, and making them extract-and-reorder afterwards would be the same work
 * this feature exists to save.
 */
async function mergeDocument(): Promise<void> {
  const session = activeSession;
  if (!session?.bytes || !viewer.hasDocument) return;
  const picked = await pickPdfFile();
  if (!picked) return;

  const total = viewer.pageCount;
  const where = await showInputDialog(i18n, {
    title: i18n.resolveCommand(CMD.MergeDocument)?.title ?? '合并文档',
    label: i18n.t('mergeAt').replace('{n}', String(total + 1)),
    initial: String(viewer.page),
    numeric: true,
    confirm: i18n.t('pageOpsConfirm'),
    cancel: i18n.t('printCancel'),
  });
  if (where === null) return;
  const at = Number.parseInt(where.trim(), 10);

  setStatus(i18n.t('loading'));
  let result;
  try {
    result = await mergePdf(new Uint8Array(session.bytes), new Uint8Array(picked.bytes), Number.isFinite(at) ? at : total + 1);
  } catch (error) {
    setStatus(`${i18n.t('mergeFailed')}: ${String((error as Error)?.message ?? error)}`, true);
    return;
  }

  // Base pages from the insertion point onwards have moved down by the inserted count.
  const sourceToTarget = new Map<number, number>();
  const position = Math.max(1, Math.min(total + 1, Number.isFinite(at) ? at : total + 1));
  for (let page = 1; page <= total; page++) {
    sourceToTarget.set(page, page < position ? page : page + result.inserted);
  }
  const dropped = remapAnnotations(sourceToTarget);
  await replaceDocumentBytes(result.bytes);
  const note = i18n.t('mergeDone').replace('{n}', String(result.inserted));
  setStatus(dropped > 0 ? `${note}（${dropped} 条批注随页面删除）` : note);
}

registerCommand(CMD.SaveIntoPdf, () => void saveIntoPdf());
registerCommand(CMD.Undo, undoAnnotation);
registerCommand(CMD.Redo, redoAnnotation);
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
  if (willOpen) {
    positionPopup(popup, button);
    // Measure again once layout has settled. A web font arriving or the toolbar
    // rewrapping between the first measurement and the paint moved the menu by a
    // button's width; anchoring it again on the next frame removes that race.
    requestAnimationFrame(() => positionPopup(popup, button));
  }
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

// Shortcuts are handled here as well as on the native menu. A real keystroke is consumed
// by the menu accelerator before it reaches the page, so only one path runs; synthetic
// key events in the verification suites never reach the menu, so this is what they
// exercise.
  window.addEventListener('keydown', (event) => {
    // A text field owns its own clipboard, undo and cursor behaviour.
    const target = event.target as HTMLElement | null;
    const typing =
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target?.isContentEditable === true;
    if (typing) return;

    const key = event.key.toLowerCase();

    // Alt+Left / Alt+Right step through visited views. This chord uses neither Ctrl
    // nor Meta, so it has to be handled before the modifier guard below.
    if (event.altKey && !event.ctrlKey && !event.metaKey) {
      if (key === 'arrowleft') {
        event.preventDefault();
        if (!viewer.previousView()) setStatus(i18n.t('noPrevView'));
        return;
      }
      if (key === 'arrowright') {
        event.preventDefault();
        if (!viewer.nextView()) setStatus(i18n.t('noNextView'));
        return;
      }
    }

    if (!event.ctrlKey && !event.metaKey) return;

    if (key === 'p') {
      event.preventDefault();
      void runPrint();
      return;
    }
    if (key === 'z') {
      event.preventDefault();
      if (event.shiftKey) redoAnnotation();
      else undoAnnotation();
      return;
    }
    if (key === 's') {
      event.preventDefault();
      if (event.shiftKey) void saveAnnotations();
      else void saveIntoPdf();
      return;
    }
    // Ctrl+0 lives in the shortcuts block below, which already owns the zoom chords;
    // keeping a second binding here would fight it for the same key.
    if (key === 'g') {
      event.preventDefault();
      void goToPageDialog();
      return;
    }
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
    // Ctrl+0 is actual size, matching the original: 100%, not the window width.
    viewer.setZoomMode('actual');
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
refreshSavedSearches();
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
