/**
 * Types for the ARPK codec. The implementation is `arpk.mjs`, shared verbatim by
 * the browser reader and the Node packaging tool so the two can never drift.
 */

export declare const ARPK_MAGIC: 'ARP1';
export declare const ARPK_VERSION: 1;
export declare const ARPK_HEADER_SIZE: 32;
export declare const ARPK_SECTION_ENTRY_SIZE: 20;
export declare const ARPK_INDEX_FIXED_SIZE: 28;
export declare const ARPK_FLAG_DEFLATE: 0x01;

export declare const ARPK_ERROR: {
  readonly TRUNCATED: 'truncated';
  readonly BAD_MAGIC: 'bad-magic';
  readonly UNSUPPORTED_VERSION: 'unsupported-version';
  readonly BAD_HEADER_SIZE: 'bad-header-size';
  readonly HEADER_CRC: 'header-crc';
  readonly SIZE_MISMATCH: 'size-mismatch';
  readonly SECTION_RANGE: 'section-range';
  readonly DUPLICATE_SECTION: 'duplicate-section';
  readonly MISSING_SECTION: 'missing-section';
  readonly DIR_TRUNCATED: 'dir-truncated';
  readonly DUPLICATE_NAME: 'duplicate-name';
  readonly DATA_RANGE: 'data-range';
  readonly DECOMPRESS: 'decompress-failed';
  readonly LENGTH_MISMATCH: 'length-mismatch';
  readonly CRC_MISMATCH: 'crc-mismatch';
  readonly NOT_FOUND: 'not-found';
  readonly BAD_META: 'bad-meta';
  readonly BAD_NAME: 'bad-name';
};

export type ArpkErrorCode = (typeof ARPK_ERROR)[keyof typeof ARPK_ERROR];

export declare class ArpkError extends Error {
  readonly name: 'ArpkError';
  readonly code: ArpkErrorCode;
  readonly detail: Record<string, unknown>;
  constructor(code: ArpkErrorCode, message: string, detail?: Record<string, unknown>);
}

export type ByteSource = Uint8Array | ArrayBuffer | string;

export declare function crc32(bytes: Uint8Array): number;
export declare function fnv1a32(bytes: Uint8Array): number;

export interface BuildEntry {
  name: string;
  /** Uncompressed payload. */
  raw: ByteSource;
  /** Pre-compressed payload; defaults to `raw`. */
  stored?: Uint8Array;
  /** Set when `stored` is raw DEFLATE output. */
  deflate?: boolean;
  layer?: number;
}

export interface BuildInput {
  meta?: Map<string, string> | Record<string, string> | [string, string][];
  entries: BuildEntry[];
}

export declare function buildContainer(input: BuildInput): Uint8Array<ArrayBuffer>;

export declare class AssetInfo {
  readonly name: string;
  readonly nameHash: number;
  readonly layer: number;
  readonly deflate: boolean;
  readonly rawLen: number;
  readonly storedLen: number;
  readonly crc32: number;
  readonly dataOffset: number;
}

export declare class Container {
  readonly version: number;
  readonly meta: Map<string, string>;
  /** Sections this reader does not understand, preserved but not interpreted. */
  readonly unknownSections: { id: string; offset: number; size: number }[];
  readonly assets: AssetInfo[];
  layerName(id: number): string;
  has(name: string): boolean;
  info(name: string): AssetInfo | null;
  inLayer(layer: number): AssetInfo[];
  read(name: string): Promise<Uint8Array<ArrayBuffer>>;
  readText(name: string): Promise<string>;
  readDataUrl(name: string, mediaType?: string): Promise<string>;
  readBlobUrl(name: string, mediaType?: string): Promise<string>;
}

export interface OpenOptions {
  DecompressionStream?: typeof DecompressionStream;
}

export declare function openContainer(input: Uint8Array | ArrayBuffer, options?: OpenOptions): Container;
