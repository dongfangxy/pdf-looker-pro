/**
 * Document loading and lifecycle.
 *
 * pdf.js is Apache-2.0. The worker is referenced through Vite's `?url` import so
 * the URL stays correct in both dev and production builds.
 *
 * Supplementary assets live under `public/` and are served at the app base URL:
 *
 *   cmaps/          169 files, 1.1 MB  — CJK character maps (the analogue of the
 *                                       `CMAPs` resource the REA analysis found
 *                                       inside the target's own container)
 *   standard_fonts/  16 files, 762 KB  — non-embedded base fonts (the analogue of
 *                                       its bundled Symbol / ZapfDingBats / MM fonts)
 *   wasm/            13 files, 1.4 MB  — WASM codecs (JPEG 2000, JBIG2) matching
 *                                       the JPXDecode / JBIG2Decode filters
 *   iccs/             2 files,  15 KB  — ICC profiles for colour management
 *
 * Without these, CJK text and some scanned-image PDFs render incorrectly.
 */
import * as pdfjsLib from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

export type PdfDocument = pdfjsLib.PDFDocumentProxy;
export type PdfPage = pdfjsLib.PDFPageProxy;

export interface OpenedDocument {
  doc: PdfDocument;
  pageCount: number;
  title: string;
}

const BASE = import.meta.env.BASE_URL;

/** Supplementary asset locations, shared by every open path. */
const ASSET_PARAMS = {
  cMapUrl: `${BASE}cmaps/`,
  cMapPacked: true,
  standardFontDataUrl: `${BASE}standard_fonts/`,
  wasmUrl: `${BASE}wasm/`,
  iccUrl: `${BASE}iccs/`,
};

async function finish(doc: PdfDocument, fallbackName: string): Promise<OpenedDocument> {
  let title = fallbackName;
  try {
    const meta = await doc.getMetadata();
    const info = meta.info as { Title?: unknown } | undefined;
    if (info && typeof info.Title === 'string' && info.Title.trim().length > 0) {
      title = info.Title.trim();
    }
  } catch {
    // Metadata is optional; a missing or malformed block is not a failure.
  }
  return { doc, pageCount: doc.numPages, title };
}

export async function openFromArrayBuffer(data: ArrayBuffer, name = 'document.pdf'): Promise<OpenedDocument> {
  const doc = await pdfjsLib.getDocument({ ...ASSET_PARAMS, data: new Uint8Array(data) }).promise;
  return finish(doc, name);
}

export async function openFromUrl(url: string, name?: string): Promise<OpenedDocument> {
  const doc = await pdfjsLib.getDocument({ ...ASSET_PARAMS, url }).promise;
  return finish(doc, name ?? url.split('/').pop() ?? 'document.pdf');
}
