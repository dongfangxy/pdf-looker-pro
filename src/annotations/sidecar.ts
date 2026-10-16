/**
 * Annotation persistence.
 *
 * Annotations are stored in a sidecar next to the PDF, using the project's own ARPK
 * container format. Reusing the container rather than inventing a second one keeps a
 * single well-tested codec, and gives the sidecar the same integrity story: a
 * checksum per asset, a length cross-check, and a named directory entry.
 *
 * The sidecar is deliberately *not* written into the PDF. Editing a PDF requires a
 * PDF writer, which this project does not have; claiming to save "into" the document
 * would be a lie.
 */
import { buildContainer, openContainer } from '../assets/arpk.mjs';

/** Sidecar file suffix. `<document>.pdf` pairs with `<document>.pdf.arpk`. */
export const SIDECAR_SUFFIX = '.arpk';

const ENTRY_NAME = 'annotations.json';
const META_VERSION = '1';

async function deflateRaw(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer()) as Uint8Array<ArrayBuffer>;
}

export interface SidecarInfo {
  document: string;
  savedAt: number;
  app: string;
  count: number;
}

/** Serialises annotation JSON into an ARPK container. */
export async function packAnnotations(
  payload: unknown,
  info: { document: string; count: number; app?: string },
): Promise<Uint8Array<ArrayBuffer>> {
  const raw = new TextEncoder().encode(JSON.stringify(payload)) as Uint8Array<ArrayBuffer>;
  const stored = await deflateRaw(raw);
  return buildContainer({
    meta: new Map([
      ['pack.name', 'pdfreader-annotations'],
      ['pack.version', META_VERSION],
      ['annotations.document', info.document],
      ['annotations.count', String(info.count)],
      ['annotations.savedAt', String(Date.now())],
      ['annotations.app', info.app ?? 'PDF Reader'],
      ['layer.0', 'annotations'],
    ]),
    entries: [{ name: ENTRY_NAME, layer: 0, raw, stored, deflate: true }],
  });
}

export interface UnpackedSidecar {
  payload: unknown;
  info: SidecarInfo;
}

/**
 * Reads a sidecar back. Any container-level corruption surfaces as an `ArpkError`
 * with a specific code, so the caller can report *why* rather than "bad file".
 */
export async function unpackAnnotations(bytes: Uint8Array): Promise<UnpackedSidecar> {
  const container = openContainer(bytes);
  if (!container.has(ENTRY_NAME)) {
    throw new Error(`边车容器里没有 ${ENTRY_NAME} 资源`);
  }
  const text = await container.readText(ENTRY_NAME);
  return {
    payload: JSON.parse(text),
    info: {
      document: container.meta.get('annotations.document') ?? '',
      savedAt: Number(container.meta.get('annotations.savedAt') ?? 0),
      app: container.meta.get('annotations.app') ?? '',
      count: Number(container.meta.get('annotations.count') ?? 0),
    },
  };
}

/** `<file>.pdf` -> `<file>.pdf.arpk`. */
export function sidecarPathFor(documentPath: string): string {
  return `${documentPath}${SIDECAR_SUFFIX}`;
}
