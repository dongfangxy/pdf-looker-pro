/**
 * ARPK — Asset Resource PacK, version 1.
 *
 * A self-authored container for the application's own resources (icons, an
 * embedded font, locale data). The design borrows two *ideas* from the REA
 * reverse-engineering findings — content split into typed **layers**, and assets
 * addressed through a **name index** rather than by file offset — but the layout,
 * field set, encoding and every line of this implementation are original. No byte
 * of the analysed product's container format is reused.
 *
 * Layout (all integers little-endian):
 *
 *   header        32 bytes
 *     0  magic         4   "ARP1"
 *     4  version      u16  1
 *     6  headerSize   u16  32
 *     8  flags        u32  reserved, 0
 *    12  sectionCount u16
 *    14  reserved     u16  0
 *    16  fileSize     u64  total file length
 *    24  headerCrc    u32  CRC32 of bytes 0..23
 *    28  reserved2    u32  0
 *
 *   section table sectionCount x 20 bytes
 *     0  id       4   ASCII section id
 *     4  offset   u64  from start of file
 *    12  size     u64
 *
 *   META  repeated [u16 keyLen][key utf8][u16 valueLen][value utf8]
 *   INDX  repeated record, fixed part 28 bytes then the name:
 *           u32 nameHash    FNV-1a 32 over the UTF-8 name
 *           u64 dataOffset  offset within the DATA section
 *           u32 storedLen
 *           u32 rawLen
 *           u32 rawCrc32    CRC32 of the *uncompressed* bytes
 *           u16 nameLen
 *           u8  flags       bit0 = payload is raw DEFLATE
 *           u8  layer       logical layer id, named in META
 *           [nameLen] name  utf8
 *   DATA  concatenated stored payloads
 *
 * Unknown sections are preserved and ignored, so a later version can add sections
 * without breaking this reader.
 */

export const ARPK_MAGIC = 'ARP1';
export const ARPK_VERSION = 1;
export const ARPK_HEADER_SIZE = 32;
export const ARPK_SECTION_ENTRY_SIZE = 20;
export const ARPK_INDEX_FIXED_SIZE = 28;
export const ARPK_FLAG_DEFLATE = 0x01;

/** Typed error codes; every failure path names itself. */
export const ARPK_ERROR = {
  TRUNCATED: 'truncated',
  BAD_MAGIC: 'bad-magic',
  UNSUPPORTED_VERSION: 'unsupported-version',
  BAD_HEADER_SIZE: 'bad-header-size',
  HEADER_CRC: 'header-crc',
  SIZE_MISMATCH: 'size-mismatch',
  SECTION_RANGE: 'section-range',
  DUPLICATE_SECTION: 'duplicate-section',
  MISSING_SECTION: 'missing-section',
  DIR_TRUNCATED: 'dir-truncated',
  DUPLICATE_NAME: 'duplicate-name',
  DATA_RANGE: 'data-range',
  DECOMPRESS: 'decompress-failed',
  LENGTH_MISMATCH: 'length-mismatch',
  CRC_MISMATCH: 'crc-mismatch',
  NOT_FOUND: 'not-found',
  BAD_META: 'bad-meta',
  BAD_NAME: 'bad-name',
};

export class ArpkError extends Error {
  constructor(code, message, detail = {}) {
    super(`${code}: ${message}`);
    this.name = 'ArpkError';
    this.code = code;
    this.detail = detail;
  }
}

// ------------------------------------------------------------------ primitives

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** CRC32 (IEEE 802.3), returned as an unsigned 32-bit number. */
export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** FNV-1a 32 over bytes; used as the name-index hash. */
export function fnv1a32(bytes) {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

const utf8 = new TextEncoder();
const utf8Decoder = new TextDecoder('utf-8', { fatal: true });

function toBytes(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (typeof value === 'string') return utf8.encode(value);
  throw new ArpkError(ARPK_ERROR.BAD_META, 'expected Uint8Array, ArrayBuffer or string');
}

// --------------------------------------------------------------------- writer

class ByteWriter {
  constructor() {
    this.chunks = [];
    this.length = 0;
  }
  bytes(chunk) {
    this.chunks.push(chunk);
    this.length += chunk.length;
  }
  u16(value) {
    const b = new Uint8Array(2);
    new DataView(b.buffer).setUint16(0, value, true);
    this.bytes(b);
  }
  u32(value) {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setUint32(0, value >>> 0, true);
    this.bytes(b);
  }
  u64(value) {
    const b = new Uint8Array(8);
    new DataView(b.buffer).setBigUint64(0, BigInt(value), true);
    this.bytes(b);
  }
  concat() {
    const out = new Uint8Array(this.length);
    let at = 0;
    for (const chunk of this.chunks) {
      out.set(chunk, at);
      at += chunk.length;
    }
    return out;
  }
}

function encodeMeta(meta) {
  const w = new ByteWriter();
  for (const [key, value] of meta) {
    const k = utf8.encode(String(key));
    const v = utf8.encode(String(value));
    if (k.length > 0xffff || v.length > 0xffff) {
      throw new ArpkError(ARPK_ERROR.BAD_META, `meta entry "${key}" is too long`);
    }
    w.u16(k.length);
    w.bytes(k);
    w.u16(v.length);
    w.bytes(v);
  }
  return w.concat();
}

function encodeDir(entries) {
  const w = new ByteWriter();
  for (const entry of entries) {
    const name = utf8.encode(entry.name);
    if (name.length === 0 || name.length > 0xffff) {
      throw new ArpkError(ARPK_ERROR.BAD_NAME, `invalid asset name "${entry.name}"`);
    }
    const raw = toBytes(entry.raw);
    const stored = entry.stored ? toBytes(entry.stored) : raw;
    w.u32(fnv1a32(name));
    w.u64(entry.dataOffset);
    w.u32(stored.length);
    w.u32(raw.length);
    w.u32(crc32(raw));
    w.u16(name.length);
    w.bytes(new Uint8Array([entry.deflate ? ARPK_FLAG_DEFLATE : 0, entry.layer & 0xff]));
    w.bytes(name);
  }
  return w.concat();
}

/**
 * Assembles a container.
 *
 * Compression is the caller's business: pass `stored` for a pre-compressed payload
 * and set `deflate: true`. That keeps this module free of any compression
 * dependency and lets the Node toolchain use `zlib` while a browser writer could
 * use `CompressionStream`.
 *
 * @param {{ meta?: Map<string,string>|Record<string,string>|[string,string][],
 *           entries: Array<{name:string, raw:Uint8Array|string, stored?:Uint8Array,
 *                            deflate?:boolean, layer?:number}> }} input
 * @returns {Uint8Array}
 */
export function buildContainer(input) {
  const entries = input.entries ?? [];
  const metaInput = input.meta ?? [];

  // DATA section: concatenate payloads, recording each one's offset.
  const data = new ByteWriter();
  const placed = [];
  const seen = new Set();
  for (const entry of entries) {
    if (seen.has(entry.name)) {
      throw new ArpkError(ARPK_ERROR.DUPLICATE_NAME, `asset "${entry.name}" was added twice`, { name: entry.name });
    }
    seen.add(entry.name);
    const stored = entry.stored ? toBytes(entry.stored) : toBytes(entry.raw);
    placed.push({ ...entry, dataOffset: data.length });
    data.bytes(stored);
  }

  const metaBytes = encodeMeta(
    metaInput instanceof Map ? metaInput : Object.entries(metaInput),
  );
  const dirBytes = encodeDir(placed);
  const dataBytes = data.concat();

  const sections = [
    { id: 'META', payload: metaBytes },
    { id: 'INDX', payload: dirBytes },
    { id: 'DATA', payload: dataBytes },
  ];

  const tableSize = sections.length * ARPK_SECTION_ENTRY_SIZE;
  let offset = ARPK_HEADER_SIZE + tableSize;
  const table = new ByteWriter();
  const payloads = [];
  for (const section of sections) {
    const id = utf8.encode(section.id);
    if (id.length !== 4) throw new ArpkError(ARPK_ERROR.BAD_META, `section id "${section.id}" must be 4 ASCII bytes`);
    table.bytes(id);
    table.u64(offset);
    table.u64(section.payload.length);
    offset += section.payload.length;
    payloads.push(section.payload);
  }

  const out = new Uint8Array(offset);
  const view = new DataView(out.buffer);
  out.set(utf8.encode(ARPK_MAGIC), 0);
  view.setUint16(4, ARPK_VERSION, true);
  view.setUint16(6, ARPK_HEADER_SIZE, true);
  view.setUint32(8, 0, true);
  view.setUint16(12, sections.length, true);
  view.setUint16(14, 0, true);
  view.setBigUint64(16, BigInt(out.length), true);
  view.setUint32(28, 0, true);
  // headerCrc covers the first 24 bytes, so it must be written last.
  view.setUint32(24, crc32(out.subarray(0, 24)), true);

  out.set(table.concat(), ARPK_HEADER_SIZE);
  let at = ARPK_HEADER_SIZE + tableSize;
  for (const payload of payloads) {
    out.set(payload, at);
    at += payload.length;
  }
  return out;
}

// --------------------------------------------------------------------- reader

async function decompressRaw(bytes, DecompressionStreamImpl) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStreamImpl('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Metadata about one asset, as recorded in the directory. */
export class AssetInfo {
  constructor(record) {
    this.name = record.name;
    this.nameHash = record.nameHash;
    this.layer = record.layer;
    this.deflate = record.deflate;
    this.rawLen = record.rawLen;
    this.storedLen = record.storedLen;
    this.crc32 = record.crc32;
    this.dataOffset = record.dataOffset;
  }
}

export class Container {
  constructor(parts) {
    this.version = parts.version;
    this.meta = parts.meta;
    this.unknownSections = parts.unknownSections;
    this.assets = parts.assets;
    this.bytes = parts.bytes;
    this._byName = new Map(parts.assets.map((a) => [a.name, a]));
    this._byHash = new Map();
    for (const asset of parts.assets) {
      const list = this._byHash.get(asset.nameHash);
      if (list) list.push(asset);
      else this._byHash.set(asset.nameHash, [asset]);
    }
  }

  /** Layer id -> name, from `<layer>.<id>` keys in META. */
  layerName(id) {
    return this.meta.get(`layer.${id}`) ?? `layer-${id}`;
  }

  has(name) {
    return this._byName.has(name);
  }

  /** Directory record for a name, or null. Hash collisions are resolved by name. */
  info(name) {
    const exact = this._byName.get(name);
    if (exact) return exact;
    const candidates = this._byHash.get(fnv1a32(utf8.encode(name)));
    return candidates?.find((a) => a.name === name) ?? null;
  }

  /** Assets belonging to one layer id. */
  inLayer(layer) {
    return this.assets.filter((a) => a.layer === layer);
  }

  /** Stored bytes for an asset, without decompression. */
  _stored(asset) {
    const start = asset.dataOffset;
    const end = start + asset.storedLen;
    if (end > this._dataLength || start > end) {
      throw new ArpkError(ARPK_ERROR.DATA_RANGE, `asset "${asset.name}" points outside the DATA section`, {
        name: asset.name,
        start,
        end,
        dataLength: this._dataLength,
      });
    }
    return this._data.subarray(start, end);
  }

  /**
   * Decompresses and integrity-checks one asset.
   * @returns {Promise<Uint8Array>}
   */
  async read(name) {
    const asset = this.info(name);
    if (!asset) throw new ArpkError(ARPK_ERROR.NOT_FOUND, `no asset named "${name}"`, { name });
    const stored = this._stored(asset);

    let raw;
    if (asset.deflate) {
      try {
        raw = await decompressRaw(stored, this._DecompressionStream);
      } catch (err) {
        throw new ArpkError(ARPK_ERROR.DECOMPRESS, `could not inflate "${name}": ${String(err)}`, { name });
      }
    } else {
      raw = stored;
    }

    if (raw.length !== asset.rawLen) {
      throw new ArpkError(
        ARPK_ERROR.LENGTH_MISMATCH,
        `asset "${name}" inflated to ${raw.length} bytes, directory says ${asset.rawLen}`,
        { name, actual: raw.length, expected: asset.rawLen },
      );
    }
    const actual = crc32(raw);
    if (actual !== asset.crc32) {
      throw new ArpkError(
        ARPK_ERROR.CRC_MISMATCH,
        `asset "${name}" failed its checksum`,
        { name, actual, expected: asset.crc32 },
      );
    }
    return raw;
  }

  /** Reads an asset as UTF-8 text. */
  async readText(name) {
    return utf8Decoder.decode(await this.read(name));
  }

  /** Reads an asset as a data: URL, for direct use in `src` or `url()`. */
  async readDataUrl(name, mediaType = 'application/octet-stream') {
    const raw = await this.read(name);
    let binary = '';
    for (let i = 0; i < raw.length; i++) binary += String.fromCharCode(raw[i]);
    return `data:${mediaType};base64,${btoa(binary)}`;
  }

  /** Builds a blob URL for an asset. Callers own revocation. */
  async readBlobUrl(name, mediaType) {
    const raw = await this.read(name);
    return URL.createObjectURL(new Blob([raw], mediaType ? { type: mediaType } : undefined));
  }
}

/**
 * Parses and verifies a container.
 *
 * Everything is range-checked before use: a malformed file produces an `ArpkError`
 * naming the failing structure rather than an out-of-bounds read.
 *
 * @param {Uint8Array|ArrayBuffer} input
 * @param {{ DecompressionStream?: typeof DecompressionStream }} [options]
 * @returns {Container}
 */
export function openContainer(input, options = {}) {
  const bytes = toBytes(input);
  if (bytes.length < ARPK_HEADER_SIZE) {
    throw new ArpkError(ARPK_ERROR.TRUNCATED, `need at least ${ARPK_HEADER_SIZE} bytes, got ${bytes.length}`);
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  const magic = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
  if (magic !== ARPK_MAGIC) {
    throw new ArpkError(ARPK_ERROR.BAD_MAGIC, `expected "${ARPK_MAGIC}", got "${magic}"`, { magic });
  }
  const version = view.getUint16(4, true);
  if (version !== ARPK_VERSION) {
    throw new ArpkError(ARPK_ERROR.UNSUPPORTED_VERSION, `version ${version} is not supported`, { version });
  }
  const headerSize = view.getUint16(6, true);
  if (headerSize !== ARPK_HEADER_SIZE) {
    throw new ArpkError(ARPK_ERROR.BAD_HEADER_SIZE, `header size ${headerSize} is not ${ARPK_HEADER_SIZE}`, { headerSize });
  }
  const headerCrc = view.getUint32(24, true);
  const computed = crc32(bytes.subarray(0, 24));
  if (headerCrc !== computed) {
    throw new ArpkError(ARPK_ERROR.HEADER_CRC, 'header checksum does not match', { actual: computed, expected: headerCrc });
  }
  const fileSize = Number(view.getBigUint64(16, true));
  if (fileSize !== bytes.length) {
    throw new ArpkError(ARPK_ERROR.SIZE_MISMATCH, `header says ${fileSize} bytes, file is ${bytes.length}`, {
      expected: fileSize,
      actual: bytes.length,
    });
  }

  const sectionCount = view.getUint16(12, true);
  const tableEnd = ARPK_HEADER_SIZE + sectionCount * ARPK_SECTION_ENTRY_SIZE;
  if (tableEnd > bytes.length) {
    throw new ArpkError(ARPK_ERROR.TRUNCATED, `section table of ${sectionCount} entries runs past the end of the file`, {
      sectionCount,
    });
  }

  const sections = new Map();
  const unknownSections = [];
  for (let i = 0; i < sectionCount; i++) {
    const at = ARPK_HEADER_SIZE + i * ARPK_SECTION_ENTRY_SIZE;
    const id = String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);
    const offset = Number(view.getBigUint64(at + 4, true));
    const size = Number(view.getBigUint64(at + 12, true));
    if (offset < tableEnd || offset + size > bytes.length || offset + size < offset) {
      throw new ArpkError(ARPK_ERROR.SECTION_RANGE, `section "${id}" lies outside the file`, { id, offset, size, fileSize: bytes.length });
    }
    const payload = bytes.subarray(offset, offset + size);
    if (id === 'META' || id === 'INDX' || id === 'DATA') {
      if (sections.has(id)) throw new ArpkError(ARPK_ERROR.DUPLICATE_SECTION, `section "${id}" appears twice`, { id });
      sections.set(id, payload);
    } else {
      unknownSections.push({ id, offset, size });
    }
  }
  for (const required of ['META', 'INDX', 'DATA']) {
    if (!sections.has(required)) {
      throw new ArpkError(ARPK_ERROR.MISSING_SECTION, `required section "${required}" is missing`, { section: required });
    }
  }

  // ---- META ----
  const meta = new Map();
  {
    const payload = sections.get('META');
    const mv = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
    let at = 0;
    while (at < payload.length) {
      if (at + 2 > payload.length) throw new ArpkError(ARPK_ERROR.BAD_META, 'truncated key length');
      const keyLen = mv.getUint16(at, true);
      at += 2;
      if (at + keyLen + 2 > payload.length) throw new ArpkError(ARPK_ERROR.BAD_META, 'truncated key');
      const key = utf8Decoder.decode(payload.subarray(at, at + keyLen));
      at += keyLen;
      const valueLen = mv.getUint16(at, true);
      at += 2;
      if (at + valueLen > payload.length) throw new ArpkError(ARPK_ERROR.BAD_META, `truncated value for "${key}"`);
      meta.set(key, utf8Decoder.decode(payload.subarray(at, at + valueLen)));
      at += valueLen;
    }
  }

  // ---- DIR ----
  const assets = [];
  const names = new Set();
  {
    const payload = sections.get('INDX');
    const dv = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
    let at = 0;
    while (at < payload.length) {
      if (at + ARPK_INDEX_FIXED_SIZE > payload.length) {
        throw new ArpkError(ARPK_ERROR.DIR_TRUNCATED, `directory record at ${at} is cut short`, { at });
      }
      const nameHash = dv.getUint32(at, true);
      const dataOffset = Number(dv.getBigUint64(at + 4, true));
      const storedLen = dv.getUint32(at + 12, true);
      const rawLen = dv.getUint32(at + 16, true);
      const rawCrc32 = dv.getUint32(at + 20, true);
      const nameLen = dv.getUint16(at + 24, true);
      const flags = payload[at + 26];
      const layer = payload[at + 27];
      at += ARPK_INDEX_FIXED_SIZE;
      if (at + nameLen > payload.length) {
        throw new ArpkError(ARPK_ERROR.DIR_TRUNCATED, 'asset name runs past the directory section');
      }
      const name = utf8Decoder.decode(payload.subarray(at, at + nameLen));
      at += nameLen;
      if (name.length === 0) throw new ArpkError(ARPK_ERROR.BAD_NAME, 'asset name is empty');
      if (names.has(name)) throw new ArpkError(ARPK_ERROR.DUPLICATE_NAME, `asset "${name}" appears twice`, { name });
      names.add(name);
      assets.push(
        new AssetInfo({ name, nameHash, layer, deflate: (flags & ARPK_FLAG_DEFLATE) !== 0, rawLen, storedLen, crc32: rawCrc32, dataOffset }),
      );
    }
  }

  const dataPayload = sections.get('DATA');
  const container = new Container({
    version,
    meta,
    unknownSections,
    assets,
    bytes,
  });
  container._data = dataPayload;
  container._dataLength = dataPayload.length;
  container._DecompressionStream = options.DecompressionStream ?? globalThis.DecompressionStream;
  if (!container._DecompressionStream) {
    throw new ArpkError(ARPK_ERROR.DECOMPRESS, 'no DecompressionStream available to inflate entries');
  }
  return container;
}
