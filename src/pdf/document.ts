/**
 * PDF document reader — enough of one to support an incremental update.
 *
 * The reader resolves the cross-reference chain (classic tables and cross-reference
 * streams, including hybrid files), expands object streams, and walks the page tree. It
 * does not interpret page content: adding annotations means appending objects and
 * rewriting the page dictionaries, not touching what is drawn.
 */
import {
  ByteCursor,
  decodeStream,
  name,
  parseValue,
  type PdfArray,
  type PdfDict,
  type PdfStreamValue,
  type PdfValue,
} from './syntax.js';

interface XrefEntry {
  num: number;
  gen: number;
  /** Byte offset of a plain indirect object. */
  offset: number | null;
  /** Object stream holding it, when it is a compressed object. */
  streamNum: number | null;
  streamIndex: number | null;
}

const ascii = (bytes: Uint8Array): string => {
  let out = '';
  for (const byte of bytes) out += String.fromCharCode(byte);
  return out;
};

export interface PageRecord {
  /** Object number of the page dictionary. */
  num: number;
  gen: number;
  mediaBox: [number, number, number, number];
  /**
   * Crop box, materialised from the page tree.
   *
   * A rewrite flattens the tree into a single `/Pages` node, so anything the page
   * inherited from an intermediate node has to be written onto the page itself or it
   * would be lost.
   */
  cropBox: [number, number, number, number] | null;
  rotate: number;
  /** Inherited `/Resources`, materialised for the same reason as the crop box. */
  resources: PdfValue | null;
  /** Existing `/Annots` value, if the page has one. */
  annots: PdfValue | null;
}

export class PdfDocument {
  private readonly objectStreams = new Map<number, Map<number, PdfValue>>();
  private readonly cache = new Map<number, PdfValue | null>();

  private constructor(
    readonly bytes: Uint8Array,
    readonly trailer: Map<string, PdfValue>,
    /** Offset of the newest cross-reference section, needed for `/Prev`. */
    readonly startxref: number,
    readonly encrypted: boolean,
    /** Every object's location, newest definition winning. */
    private readonly xref: Map<number, XrefEntry>,
  ) {}

  /** Object number one past the highest in use, which is what `/Size` must report. */
  get size(): number {
    let max = 0;
    for (const entry of this.xref.values()) if (entry.num > max) max = entry.num;
    for (const num of this.objectStreams.keys()) if (num > max) max = num;
    return max + 1;
  }

  get rootRef(): PdfValue | null {
    return this.trailer.get('Root') ?? null;
  }

  /** Reads a document from its bytes, or explains why it cannot be written. */
  static async parse(bytes: Uint8Array): Promise<PdfDocument> {
    const startxref = findStartXref(bytes);
    if (startxref === null) throw new Error('找不到 startxref：这不是一个可解析的 PDF');

    const xref = new Map<number, XrefEntry>();
    const trailer = new Map<string, PdfValue>();
    const visited = new Set<number>();
    let cursorOffset: number | null = startxref;
    let first = true;

    while (cursorOffset !== null) {
      if (visited.has(cursorOffset)) break; // guard against a cyclic /Prev chain
      visited.add(cursorOffset);

      const section = await readXrefSection(bytes, cursorOffset);
      // Walking from newest to oldest, the first definition of an object wins.
      for (const [num, entry] of section.entries) if (!xref.has(num)) xref.set(num, entry);
      for (const [key, value] of section.trailer) if (!trailer.has(key)) trailer.set(key, value);

      // A hybrid file points at an additional cross-reference stream.
      const hybrid = section.trailer.get('XRefStm');
      if (hybrid?.kind === 'number') {
        const extra = await readXrefStream(bytes, hybrid.value);
        for (const [num, entry] of extra.entries) if (!xref.has(num)) xref.set(num, entry);
      }

      const prev = section.trailer.get('Prev');
      cursorOffset = prev?.kind === 'number' ? prev.value : null;
      first = false;
    }
    void first;

    const encrypted = trailer.has('Encrypt');
    return new PdfDocument(bytes, trailer, startxref, encrypted, xref);
  }

  /** Follows indirect references until a direct value is reached. */
  async resolve(value: PdfValue | undefined | null): Promise<PdfValue | null> {
    let current = value ?? null;
    for (let hops = 0; hops < 32; hops++) {
      if (!current || current.kind !== 'ref') return current;
      current = await this.getObject(current.num);
    }
    return current;
  }

  async dict(value: PdfValue | undefined | null): Promise<PdfDict | null> {
    const resolved = await this.resolve(value);
    return resolved?.kind === 'dict' ? resolved : null;
  }

  async array(value: PdfValue | undefined | null): Promise<PdfArray | null> {
    const resolved = await this.resolve(value);
    return resolved?.kind === 'array' ? resolved : null;
  }

  /** Looks an object up, whether it is plain or packed inside an object stream. */
  async getObject(num: number): Promise<PdfValue | null> {
    if (this.cache.has(num)) return this.cache.get(num) ?? null;
    const value = await this.loadObject(num);
    this.cache.set(num, value);
    return value;
  }

  private async loadObject(num: number): Promise<PdfValue | null> {
    const entry = this.xref.get(num);
    if (!entry) return null;

    if (entry.offset !== null) {
      return parseIndirectAt(this.bytes, entry.offset)?.value ?? null;
    }

    if (entry.streamNum !== null) {
      const table = await this.loadObjectStream(entry.streamNum);
      return table.get(num) ?? null;
    }
    return null;
  }

  private async loadObjectStream(streamNum: number): Promise<Map<number, PdfValue>> {
    const cached = this.objectStreams.get(streamNum);
    if (cached) return cached;

    const empty = new Map<number, PdfValue>();
    const container = await parseIndirectAt(this.bytes, this.xref.get(streamNum)?.offset ?? -1);
    if (!container || container.value.kind !== 'stream') {
      this.objectStreams.set(streamNum, empty);
      return empty;
    }
    const stream = container.value;
    const dictValue = stream.dict;
    const count = numberEntry(dictValue, 'N', 0);
    const first = numberEntry(dictValue, 'First', 0);

    let decoded: Uint8Array;
    try {
      decoded = await decodeStream(stream);
    } catch {
      this.objectStreams.set(streamNum, empty);
      return empty;
    }

    // The header is `num offset` pairs, offsets relative to /First.
    const header = new ByteCursor(decoded);
    const pairs: Array<[number, number]> = [];
    for (let i = 0; i < count; i++) {
      header.skipWhitespace();
      const objNum = Number(header.readRegular());
      header.skipWhitespace();
      const objOffset = Number(header.readRegular());
      if (!Number.isFinite(objNum) || !Number.isFinite(objOffset)) break;
      pairs.push([objNum, objOffset]);
    }

    const table = new Map<number, PdfValue>();
    for (let i = 0; i < pairs.length; i++) {
      const [objNum, objOffset] = pairs[i]!;
      const start = first + objOffset;
      const end = i + 1 < pairs.length ? first + pairs[i + 1]![1] : decoded.length;
      if (start < 0 || start >= decoded.length) continue;
      const cursor = new ByteCursor(decoded, start);
      table.set(objNum, parseValue(cursor, Math.min(end, decoded.length)));
    }
    this.objectStreams.set(streamNum, table);
    return table;
  }

  /** Every page, in reading order, with the attributes it inherits. */
  async pages(): Promise<PageRecord[]> {
    const root = await this.dict(this.rootRef);
    if (!root) throw new Error('文件没有 /Root');
    const pagesRef = root.value.get('Pages');
    const found: PageRecord[] = [];
    const seen = new Set<number>();
    await this.walkPages(
      pagesRef,
      { mediaBox: null, cropBox: null, resources: null, rotate: 0 },
      found,
      seen,
      0,
    );
    return found;
  }

  private async walkPages(
    nodeRef: PdfValue | undefined,
    inherited: {
      mediaBox: [number, number, number, number] | null;
      cropBox: [number, number, number, number] | null;
      resources: PdfValue | null;
      rotate: number;
    },
    out: PageRecord[],
    seen: Set<number>,
    depth: number,
  ): Promise<void> {
    if (!nodeRef || depth > 64) return;
    if (nodeRef.kind === 'ref') {
      if (seen.has(nodeRef.num)) return; // a malformed tree must not loop
      seen.add(nodeRef.num);
    }
    const node = await this.dict(nodeRef);
    if (!node) return;

    const mediaBox = readBox(node, 'MediaBox') ?? inherited.mediaBox;
    const cropBox = readBox(node, 'CropBox') ?? inherited.cropBox;
    const resources = node.value.get('Resources') ?? inherited.resources;
    const rotate = numberEntry(node, 'Rotate', inherited.rotate);

    const typeValue = node.value.get('Type');
    const typeName = typeValue?.kind === 'name' ? typeValue.value : '';
    const kids = await this.array(node.value.get('Kids'));

    if (typeName === 'Page' || (!kids && typeName !== 'Pages')) {
      if (nodeRef?.kind === 'ref') {
        out.push({
          num: nodeRef.num,
          gen: nodeRef.gen,
          mediaBox: mediaBox ?? [0, 0, 612, 792],
          cropBox,
          rotate: materialisedRotation(rotate),
          resources,
          annots: node.value.get('Annots') ?? null,
        });
      }
      return;
    }

    for (const kid of kids?.value ?? []) {
      await this.walkPages(kid, { mediaBox, cropBox, resources, rotate }, out, seen, depth + 1);
    }
  }

  /**
   * The verbatim dictionary text of an object, when it is stored uncompressed.
   *
   * Rewriting this text rather than re-serialising the parsed value keeps entries this
   * reader does not model — inline resources, unusual numbers, ordering — exactly as
   * they were. Compressed objects have no such text and must be re-serialised.
   */
  rawBodyOf(num: number): string | null {
    const entry = this.xref.get(num);
    if (!entry || entry.offset === null) return null;
    return parseIndirectAt(this.bytes, entry.offset)?.body ?? null;
  }

  /** Every object number the cross-reference knows about, ascending. */
  objectNumbers(): number[] {
    return [...this.xref.keys()].sort((a, b) => a - b);
  }

  /** The generation the cross-reference records for an object. */
  generationOf(num: number): number {
    return this.xref.get(num)?.gen ?? 0;
  }

  /** True when the object lives in an object stream and has no text of its own. */
  isCompressed(num: number): boolean {
    const entry = this.xref.get(num);
    return !!entry && entry.offset === null;
  }

  /**
   * An object's bytes exactly as they appear in the file, `N G obj` through `endobj`.
   *
   * A rewrite copies this verbatim: re-serialising a content stream or a font program
   * would change bytes that must survive untouched. Returns null for a compressed
   * object, which has no such bytes.
   */
  rawObjectText(num: number): string | null {
    const entry = this.xref.get(num);
    if (!entry || entry.offset === null) return null;
    const offset = entry.offset;
    if (offset < 0 || offset >= this.bytes.length) return null;
    const marker = endobjAfter(this.bytes, offset);
    if (marker < 0) return null;
    return ascii(this.bytes.subarray(offset, marker));
  }

  /** The raw indirect-object text at an offset, which is what an update must preserve. */
  rawObjectAt(offset: number): { num: number; gen: number; body: string } | null {
    const parsed = parseIndirectAt(this.bytes, offset);
    if (!parsed) return null;
    return { num: parsed.num, gen: parsed.gen, body: parsed.body };
  }
}

function numberEntry(value: PdfDict, key: string, fallback: number): number {
  const entry = value.value.get(key);
  return entry?.kind === 'number' ? entry.value : fallback;
}

function readBox(value: PdfDict, key: string): [number, number, number, number] | null {
  const entry = value.value.get(key);
  if (entry?.kind !== 'array' || entry.value.length < 4) return null;
  const parts = entry.value.slice(0, 4).map((v) => (v.kind === 'number' ? v.value : 0));
  return [parts[0]!, parts[1]!, parts[2]!, parts[3]!];
}

/**
 * Normalises a `/Rotate` value to the nearest multiple of 90 in `[0, 360)`.
 *
 * The viewer works in quarter turns, but a rewrite writes the degree value back out,
 * so the normalisation lives here rather than being folded into the record.
 */
function materialisedRotation(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const wrapped = Math.round(value / 90) * 90;
  return ((wrapped % 360) + 360) % 360;
}

/** Locates the last `startxref` and returns the offset it names. */
export function findStartXref(bytes: Uint8Array): number | null {
  const tailLength = Math.min(bytes.length, 4096);
  const tail = ascii(bytes.subarray(bytes.length - tailLength));
  const index = tail.lastIndexOf('startxref');
  if (index < 0) return null;
  const match = /startxref\s+(\d+)/.exec(tail.slice(index));
  if (!match) return null;
  const offset = Number(match[1]);
  return Number.isFinite(offset) && offset >= 0 && offset < bytes.length ? offset : null;
}

interface XrefSection {
  entries: Map<number, XrefEntry>;
  trailer: Map<string, PdfValue>;
}

async function readXrefSection(bytes: Uint8Array, offset: number): Promise<XrefSection> {
  // A cross-reference stream begins with `N G obj`; a table begins with `xref`.
  let probe = offset;
  while (probe < bytes.length && (bytes[probe] === 0x20 || bytes[probe] === 0x0a || bytes[probe] === 0x0d || bytes[probe] === 0x09)) {
    probe++;
  }
  if (ascii(bytes.subarray(probe, probe + 4)) === 'xref') return readXrefTable(bytes, probe);
  return readXrefStream(bytes, offset);
}

function readXrefTable(bytes: Uint8Array, offset: number): XrefSection {
  const cursor = new ByteCursor(bytes, offset + 4);
  const entries = new Map<number, XrefEntry>();

  for (;;) {
    cursor.skipWhitespace();
    if (ascii(cursor.bytes.subarray(cursor.pos, cursor.pos + 7)) === 'trailer') {
      cursor.pos += 7;
      const trailerValue = parseValue(cursor);
      const trailer = trailerValue.kind === 'dict' ? trailerValue.value : new Map<string, PdfValue>();
      return { entries, trailer };
    }
    const startWord = cursor.readRegular();
    if (startWord === '') return { entries, trailer: new Map() };
    const start = Number(startWord);
    cursor.skipWhitespace();
    const count = Number(cursor.readRegular());
    if (!Number.isFinite(start) || !Number.isFinite(count)) return { entries, trailer: new Map() };

    for (let i = 0; i < count; i++) {
      cursor.skipWhitespace();
      const offsetWord = cursor.readRegular();
      cursor.skipWhitespace();
      const genWord = cursor.readRegular();
      cursor.skipWhitespace();
      const kind = cursor.readRegular();
      const objOffset = Number(offsetWord);
      const gen = Number(genWord);
      if (kind === 'n' && Number.isFinite(objOffset)) {
        entries.set(start + i, { num: start + i, gen: Number.isFinite(gen) ? gen : 0, offset: objOffset, streamNum: null, streamIndex: null });
      }
    }
  }
}

async function readXrefStream(bytes: Uint8Array, offset: number): Promise<XrefSection> {
  const parsed = parseIndirectAt(bytes, offset);
  if (!parsed || parsed.value.kind !== 'stream') {
    return { entries: new Map(), trailer: new Map() };
  }
  const stream: PdfStreamValue = parsed.value;
  const widths = stream.dict.value.get('W');
  if (widths?.kind !== 'array' || widths.value.length < 3) {
    return { entries: new Map(), trailer: stream.dict.value };
  }
  const w = widths.value.slice(0, 3).map((v) => (v.kind === 'number' ? v.value : 0));
  const size = numberEntry(stream.dict, 'Size', 0);
  const indexEntry = stream.dict.value.get('Index');

  const ranges: Array<[number, number]> = [];
  if (indexEntry?.kind === 'array') {
    const flat = indexEntry.value.map((v) => (v.kind === 'number' ? v.value : 0));
    for (let i = 0; i + 1 < flat.length; i += 2) ranges.push([flat[i]!, flat[i + 1]!]);
  } else {
    ranges.push([0, size]);
  }

  let decoded: Uint8Array;
  try {
    decoded = await decodeStream(stream);
  } catch {
    return { entries: new Map(), trailer: stream.dict.value };
  }

  const entries = new Map<number, XrefEntry>();
  const rowLength = w[0]! + w[1]! + w[2]!;
  let position = 0;
  for (const [start, count] of ranges) {
    for (let i = 0; i < count; i++) {
      if (rowLength === 0 || position + rowLength > decoded.length) break;
      const fields = readRow(decoded, position, w);
      position += rowLength;
      const type = w[0] === 0 ? 1 : fields[0]!;
      const num = start + i;
      if (type === 1) {
        entries.set(num, { num, gen: fields[2]!, offset: fields[1]!, streamNum: null, streamIndex: null });
      } else if (type === 2) {
        entries.set(num, { num, gen: 0, offset: null, streamNum: fields[1]!, streamIndex: fields[2]! });
      }
    }
  }
  return { entries, trailer: stream.dict.value };
}

function readRow(data: Uint8Array, position: number, widths: number[]): [number, number, number] {
  const out: [number, number, number] = [0, 0, 0];
  let cursor = position;
  for (let f = 0; f < 3; f++) {
    let value = 0;
    for (let i = 0; i < widths[f]!; i++) value = value * 256 + (data[cursor++] ?? 0);
    out[f] = value;
  }
  return out;
}

interface IndirectObject {
  num: number;
  gen: number;
  value: PdfValue;
  /** Raw text of the object body, which is what a rewrite preserves. */
  body: string;
}

/** Parses the indirect object that starts at `offset`. */
export function parseIndirectAt(bytes: Uint8Array, offset: number): IndirectObject | null {
  if (offset < 0 || offset >= bytes.length) return null;
  const cursor = new ByteCursor(bytes, offset);
  cursor.skipWhitespace();
  const numWord = cursor.readRegular();
  cursor.skipWhitespace();
  const genWord = cursor.readRegular();
  cursor.skipWhitespace();
  const keyword = cursor.readRegular();
  if (keyword !== 'obj') return null;
  const num = Number(numWord);
  const gen = Number(genWord);
  if (!Number.isFinite(num) || !Number.isFinite(gen)) return null;

  const bodyStart = cursor.pos;
  const value = parseValue(cursor);

  if (value.kind === 'dict') {
    // A stream keyword may follow the dictionary.
    const afterDict = cursor.pos;
    cursor.skipWhitespace();
    if (ascii(bytes.subarray(cursor.pos, cursor.pos + 6)) === 'stream') {
      let dataStart = cursor.pos + 6;
      if (bytes[dataStart] === 0x0d) dataStart++;
      if (bytes[dataStart] === 0x0a) dataStart++;
      const endIndex = findEndstream(bytes, dataStart);
      const raw = bytes.subarray(dataStart, endIndex);
      const body = ascii(bytes.subarray(bodyStart, afterDict));
      return { num, gen, value: { kind: 'stream', dict: value, raw }, body };
    }
    cursor.pos = afterDict;
  }

  const body = ascii(bytes.subarray(bodyStart, cursor.pos));
  return { num, gen, value, body };
}

/**
 * Finds the byte just past the `endobj` that closes the object starting at `from`.
 *
 * A plain forward search is wrong here: a content stream may contain the literal
 * text `endobj` inside its data. The scan therefore skips over `stream … endstream`
 * regions and only accepts `endobj` outside one.
 */
function endobjAfter(bytes: Uint8Array, from: number): number {
  let index = from;
  while (index < bytes.length) {
    if (bytes[index] === 0x73 && ascii(bytes.subarray(index, index + 6)) === 'stream') {
      // Skip the stream data and its terminating keyword.
      let dataStart = index + 6;
      if (bytes[dataStart] === 0x0d) dataStart++;
      if (bytes[dataStart] === 0x0a) dataStart++;
      // Resume *after* the whole keyword. Resuming mid-keyword is what made the `s` of
      // `endstream` look like a fresh `stream` and swallow the rest of the file.
      const endstream = endstreamAt(bytes, dataStart);
      index = endstream >= 0 ? endstream + 9 : bytes.length;
      continue;
    }
    if (bytes[index] === 0x65 && ascii(bytes.subarray(index, index + 6)) === 'endobj') {
      return index + 6;
    }
    index++;
  }
  return -1;
}

/**
 * Finds the `endstream` keyword at or after `from`, returning its first byte.
 *
 * Kept separate from `findEndstream` on purpose: that one trims the line break before
 * the keyword, which is right when slicing stream data and wrong when the caller needs
 * to resume scanning after the keyword.
 */
function endstreamAt(bytes: Uint8Array, from: number): number {
  for (let i = from; i + 9 <= bytes.length; i++) {
    if (bytes[i] === 0x65 && ascii(bytes.subarray(i, i + 9)) === 'endstream') return i;
  }
  return -1;
}

function findEndstream(bytes: Uint8Array, from: number): number {
  const at = endstreamAt(bytes, from);
  if (at < 0) return bytes.length;
  let end = at;
  if (end > from && bytes[end - 1] === 0x0a) end--;
  if (end > from && bytes[end - 1] === 0x0d) end--;
  return end;
}

export { name as pdfName };
