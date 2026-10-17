/**
 * PDF object syntax: parsing and writing.
 *
 * This is a small, self-contained reader for the parts of the PDF object grammar an
 * incremental update needs. It deliberately does not attempt to be a complete PDF
 * interpreter — there is no content-stream handling here, because annotations are added
 * by appending objects, not by touching page content.
 *
 * Everything is byte-oriented and latin1-safe: PDF syntax is ASCII, while strings inside
 * it may hold arbitrary bytes.
 */

export type PdfName = { kind: 'name'; value: string };
export type PdfRef = { kind: 'ref'; num: number; gen: number };
export type PdfDict = { kind: 'dict'; value: Map<string, PdfValue> };
export type PdfArray = { kind: 'array'; value: PdfValue[] };
export type PdfString = { kind: 'string'; bytes: Uint8Array };
export type PdfNumber = { kind: 'number'; value: number };
export type PdfBool = { kind: 'bool'; value: boolean };
export type PdfNull = { kind: 'null' };
export type PdfStreamValue = {
  kind: 'stream';
  dict: PdfDict;
  /** Raw bytes as they appear in the file, before any filter is applied. */
  raw: Uint8Array;
};

export type PdfValue =
  | PdfName
  | PdfRef
  | PdfDict
  | PdfArray
  | PdfString
  | PdfNumber
  | PdfBool
  | PdfNull
  | PdfStreamValue;

export const name = (value: string): PdfName => ({ kind: 'name', value });
export const ref = (num: number, gen = 0): PdfRef => ({ kind: 'ref', num, gen });
export const dict = (entries: Record<string, PdfValue>): PdfDict => ({
  kind: 'dict',
  value: new Map(Object.entries(entries)),
});
export const array = (value: PdfValue[]): PdfArray => ({ kind: 'array', value });
export const num = (value: number): PdfNumber => ({ kind: 'number', value });
export const literal = (value: string): PdfString => ({
  kind: 'string',
  // latin1 keeps one byte per code unit, which is what a PDF literal string holds.
  bytes: Uint8Array.from(value, (ch) => ch.charCodeAt(0) & 0xff),
});
export const hexText = (value: string): PdfString => {
  // PDF text strings are PDFDocEncoding for ASCII and UTF-16BE with a BOM otherwise.
  const ascii = /^[\x20-\x7e]*$/.test(value);
  if (ascii) return literal(value);
  const out = new Uint8Array(2 + value.length * 2);
  out[0] = 0xfe;
  out[1] = 0xff;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    out[2 + i * 2] = (code >> 8) & 0xff;
    out[3 + i * 2] = code & 0xff;
  }
  return { kind: 'string', bytes: out };
};

const WHITESPACE = new Set([0x00, 0x09, 0x0a, 0x0c, 0x0d, 0x20]);
const DELIMITER = new Set([0x28, 0x29, 0x3c, 0x3e, 0x5b, 0x5d, 0x7b, 0x7d, 0x2f, 0x25]);

export function isWhitespace(byte: number): boolean {
  return WHITESPACE.has(byte);
}

export function isDelimiter(byte: number): boolean {
  return DELIMITER.has(byte);
}

/** A cursor over a byte buffer with the accessors the parser needs. */
export class ByteCursor {
  constructor(
    readonly bytes: Uint8Array,
    public pos = 0,
  ) {}

  get eof(): boolean {
    return this.pos >= this.bytes.length;
  }

  peek(): number {
    return this.pos < this.bytes.length ? this.bytes[this.pos]! : -1;
  }

  at(offset: number): number {
    const index = this.pos + offset;
    return index < this.bytes.length ? this.bytes[index]! : -1;
  }

  skipWhitespace(): void {
    while (this.pos < this.bytes.length) {
      const byte = this.bytes[this.pos]!;
      if (WHITESPACE.has(byte)) {
        this.pos++;
        continue;
      }
      // Comments run to the end of the line.
      if (byte === 0x25) {
        while (this.pos < this.bytes.length && this.bytes[this.pos] !== 0x0a && this.bytes[this.pos] !== 0x0d) {
          this.pos++;
        }
        continue;
      }
      break;
    }
  }

  /** Reads a run of regular characters as a latin1 string. */
  readRegular(): string {
    const start = this.pos;
    while (this.pos < this.bytes.length) {
      const byte = this.bytes[this.pos]!;
      if (WHITESPACE.has(byte) || DELIMITER.has(byte)) break;
      this.pos++;
    }
    let out = '';
    for (let i = start; i < this.pos; i++) out += String.fromCharCode(this.bytes[i]!);
    return out;
  }

  /** Reads a balanced `(...)` literal string, honouring escapes and nesting. */
  readLiteralString(): Uint8Array {
    this.pos++; // consume '('
    const out: number[] = [];
    let depth = 1;
    while (this.pos < this.bytes.length) {
      const byte = this.bytes[this.pos++]!;
      if (byte === 0x5c) {
        const next = this.bytes[this.pos++];
        if (next === undefined) break;
        switch (next) {
          case 0x6e: out.push(0x0a); break;
          case 0x72: out.push(0x0d); break;
          case 0x74: out.push(0x09); break;
          case 0x62: out.push(0x08); break;
          case 0x66: out.push(0x0c); break;
          case 0x0a: break; // line continuation
          case 0x0d:
            if (this.bytes[this.pos] === 0x0a) this.pos++;
            break;
          default:
            if (next >= 0x30 && next <= 0x37) {
              // Up to three octal digits, the first already consumed.
              let value = next - 0x30;
              for (let i = 0; i < 2; i++) {
                const digit = this.bytes[this.pos];
                if (digit === undefined || digit < 0x30 || digit > 0x37) break;
                value = value * 8 + (digit - 0x30);
                this.pos++;
              }
              out.push(value & 0xff);
            } else {
              out.push(next);
            }
        }
        continue;
      }
      if (byte === 0x28) depth++;
      else if (byte === 0x29) {
        depth--;
        if (depth === 0) break;
      }
      out.push(byte);
    }
    return Uint8Array.from(out);
  }

  /** Reads a `<...>` hex string into bytes. */
  readHexString(): Uint8Array {
    this.pos++; // consume '<'
    const digits: number[] = [];
    while (this.pos < this.bytes.length) {
      const byte = this.bytes[this.pos++]!;
      if (byte === 0x3e) break;
      const value = hexDigit(byte);
      if (value >= 0) digits.push(value);
    }
    if (digits.length % 2 === 1) digits.push(0);
    const out = new Uint8Array(digits.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = (digits[i * 2]! << 4) | digits[i * 2 + 1]!;
    return out;
  }
}

function hexDigit(byte: number): number {
  if (byte >= 0x30 && byte <= 0x39) return byte - 0x30;
  if (byte >= 0x41 && byte <= 0x46) return byte - 0x41 + 10;
  if (byte >= 0x61 && byte <= 0x66) return byte - 0x61 + 10;
  return -1;
}

/**
 * Parses one object.
 *
 * `limit` bounds the search when reading a value out of a larger buffer, which matters
 * for object streams where several objects share one decoded block.
 */
export function parseValue(cursor: ByteCursor, limit = cursor.bytes.length): PdfValue {
  cursor.skipWhitespace();
  if (cursor.pos >= limit) return { kind: 'null' };
  const byte = cursor.peek();

  if (byte === 0x2f) {
    cursor.pos++;
    return name(cursor.readRegular());
  }
  if (byte === 0x28) return { kind: 'string', bytes: cursor.readLiteralString() };
  if (byte === 0x3c) {
    // `<<` opens a dictionary; a single `<` opens a hex string.
    if (cursor.at(1) === 0x3c) {
      cursor.pos += 2;
      const value = new Map<string, PdfValue>();
      for (;;) {
        cursor.skipWhitespace();
        if (cursor.pos >= limit) break;
        if (cursor.peek() === 0x3e && cursor.at(1) === 0x3e) {
          cursor.pos += 2;
          break;
        }
        const key = parseValue(cursor, limit);
        if (key.kind !== 'name') {
          // Malformed dictionary: skip a token so the loop cannot spin.
          if (cursor.pos >= limit) break;
          cursor.pos++;
          continue;
        }
        value.set(key.value, parseValue(cursor, limit));
      }
      return { kind: 'dict', value };
    }
    return { kind: 'string', bytes: cursor.readHexString() };
  }
  if (byte === 0x5b) {
    cursor.pos++;
    const value: PdfValue[] = [];
    for (;;) {
      cursor.skipWhitespace();
      if (cursor.pos >= limit) break;
      if (cursor.peek() === 0x5d) {
        cursor.pos++;
        break;
      }
      value.push(parseValue(cursor, limit));
    }
    return { kind: 'array', value };
  }

  const start = cursor.pos;
  const word = cursor.readRegular();
  if (word === 'true') return { kind: 'bool', value: true };
  if (word === 'false') return { kind: 'bool', value: false };
  if (word === 'null') return { kind: 'null' };
  if (word === '') {
    cursor.pos = start + 1;
    return { kind: 'null' };
  }

  const numeric = Number(word);
  if (Number.isFinite(numeric)) {
    // `N G R` is a reference. Look ahead without consuming on failure.
    const afterFirst = cursor.pos;
    cursor.skipWhitespace();
    const second = cursor.readRegular();
    if (/^\d+$/.test(second)) {
      cursor.skipWhitespace();
      if (cursor.peek() === 0x52) {
        const afterR = cursor.pos + 1;
        const boundary = cursor.at(1);
        if (boundary < 0 || isWhitespace(boundary) || isDelimiter(boundary)) {
          cursor.pos = afterR;
          return { kind: 'ref', num: Math.trunc(numeric), gen: Number(second) };
        }
      }
    }
    cursor.pos = afterFirst;
    return { kind: 'number', value: numeric };
  }

  // An unrecognised keyword; report it as null rather than looping forever.
  return { kind: 'null' };
}

/** Follows a dictionary's `/Filter` and `/DecodeParms` to produce the decoded bytes. */
export async function decodeStream(value: PdfStreamValue): Promise<Uint8Array> {
  const filters = filterList(value.dict);
  let data = value.raw;
  for (let i = 0; i < filters.length; i++) {
    const filter = filters[i]!;
    if (filter === 'FlateDecode' || filter === 'Fl') {
      data = await inflate(data);
      data = applyPredictor(data, predictorParams(value.dict, i));
      continue;
    }
    if (filter === 'ASCIIHexDecode' || filter === 'AHx') {
      data = asciiHex(data);
      continue;
    }
    throw new Error(`unsupported stream filter: ${filter}`);
  }
  return data;
}

function filterList(value: PdfDict): string[] {
  const filter = value.value.get('Filter');
  if (!filter) return [];
  if (filter.kind === 'name') return [filter.value];
  if (filter.kind === 'array') {
    return filter.value.filter((v): v is PdfName => v.kind === 'name').map((v) => v.value);
  }
  return [];
}

function predictorParams(value: PdfDict, index: number): { predictor: number; colors: number; bits: number; columns: number } {
  const defaults = { predictor: 1, colors: 1, bits: 8, columns: 1 };
  const parms = value.value.get('DecodeParms') ?? value.value.get('DP');
  const entry =
    parms?.kind === 'array' ? parms.value[index] ?? parms.value[0] : parms;
  if (!entry || entry.kind !== 'dict') return defaults;
  const read = (key: string, fallback: number): number => {
    const found = entry.value.get(key);
    return found?.kind === 'number' ? found.value : fallback;
  };
  return {
    predictor: read('Predictor', 1),
    colors: read('Colors', 1),
    bits: read('BitsPerComponent', 8),
    columns: read('Columns', 1),
  };
}

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  // A zlib stream may carry a trailing newline; DecompressionStream tolerates it.
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function asciiHex(data: Uint8Array): Uint8Array {
  const digits: number[] = [];
  for (const byte of data) {
    if (byte === 0x3e) break;
    const value = hexDigit(byte);
    if (value >= 0) digits.push(value);
  }
  if (digits.length % 2 === 1) digits.push(0);
  const out = new Uint8Array(digits.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = (digits[i * 2]! << 4) | digits[i * 2 + 1]!;
  return out;
}

/** Undoes the PNG/TIFF row predictors used by cross-reference and object streams. */
function applyPredictor(
  data: Uint8Array,
  { predictor, colors, bits, columns }: { predictor: number; colors: number; bits: number; columns: number },
): Uint8Array {
  if (predictor <= 1) return data;
  const bytesPerPixel = Math.max(1, Math.ceil((colors * bits) / 8));
  const rowLength = Math.max(1, Math.ceil((colors * bits * columns) / 8));

  if (predictor === 2) {
    // TIFF predictor: only defined for 8-bit components here.
    if (bits !== 8) return data;
    const out = data.slice();
    for (let row = 0; row + rowLength <= out.length; row += rowLength) {
      for (let i = bytesPerPixel; i < rowLength; i++) {
        out[row + i] = (out[row + i]! + out[row + i - bytesPerPixel]!) & 0xff;
      }
    }
    return out;
  }

  // PNG predictors: each row is prefixed with a filter-type byte.
  const rows = Math.floor(data.length / (rowLength + 1));
  const out = new Uint8Array(rows * rowLength);
  let previous = new Uint8Array(rowLength);
  for (let row = 0; row < rows; row++) {
    const type = data[row * (rowLength + 1)]!;
    const src = data.subarray(row * (rowLength + 1) + 1, row * (rowLength + 1) + 1 + rowLength);
    const line = new Uint8Array(rowLength);
    for (let i = 0; i < rowLength; i++) {
      const raw = src[i]!;
      const left = i >= bytesPerPixel ? line[i - bytesPerPixel]! : 0;
      const up = previous[i]!;
      const upLeft = i >= bytesPerPixel ? previous[i - bytesPerPixel]! : 0;
      let value: number;
      switch (type) {
        case 0: value = raw; break;
        case 1: value = raw + left; break;
        case 2: value = raw + up; break;
        case 3: value = raw + ((left + up) >> 1); break;
        case 4: {
          const p = left + up - upLeft;
          const pa = Math.abs(p - left);
          const pb = Math.abs(p - up);
          const pc = Math.abs(p - upLeft);
          value = raw + (pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft);
          break;
        }
        default: value = raw;
      }
      line[i] = value & 0xff;
    }
    out.set(line, row * rowLength);
    previous = line;
  }
  return out;
}

// ------------------------------------------------------------------ serialising

export function serializeValue(value: PdfValue): string {
  switch (value.kind) {
    case 'name':
      return `/${escapeName(value.value)}`;
    case 'ref':
      return `${value.num} ${value.gen} R`;
    case 'number':
      return formatNumber(value.value);
    case 'bool':
      return value.value ? 'true' : 'false';
    case 'null':
      return 'null';
    case 'string':
      return `<${toHex(value.bytes)}>`;
    case 'array':
      return `[${value.value.map(serializeValue).join(' ')}]`;
    case 'dict': {
      const parts: string[] = [];
      for (const [key, entry] of value.value) parts.push(`/${escapeName(key)} ${serializeValue(entry)}`);
      return `<<${parts.length ? ` ${parts.join(' ')} ` : ''}>>`;
    }
    case 'stream':
      return serializeValue(value.dict);
  }
}

/** PDF numbers are ASCII with no exponent and at most a handful of decimals. */
export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return '0';
  const rounded = Math.round(value * 1000) / 1000;
  if (Number.isInteger(rounded)) return String(rounded);
  return rounded.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
}

function escapeName(value: string): string {
  let out = '';
  for (const ch of value) {
    const code = ch.charCodeAt(0);
    if (code < 0x21 || code > 0x7e || DELIMITER.has(code) || code === 0x23) {
      out += `#${code.toString(16).padStart(2, '0')}`;
    } else {
      out += ch;
    }
  }
  return out;
}

function toHex(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0');
  return out;
}

/** Reduces a parsed value to plain JavaScript, for callers that only need to read it. */
export function toPlain(value: PdfValue): unknown {
  switch (value.kind) {
    case 'name':
      return `/${value.value}`;
    case 'ref':
      return { ref: value.num, gen: value.gen };
    case 'number':
      return value.value;
    case 'bool':
      return value.value;
    case 'null':
      return null;
    case 'string':
      return decodeText(value.bytes);
    case 'array':
      return value.value.map(toPlain);
    case 'dict': {
      const out: Record<string, unknown> = {};
      for (const [key, entry] of value.value) out[key] = toPlain(entry);
      return out;
    }
    case 'stream':
      return { ...(toPlain(value.dict) as Record<string, unknown>), stream: value.raw.length };
  }
}

/** Decodes a PDF text string: UTF-16BE when it carries a BOM, PDFDocEncoding otherwise. */
export function decodeText(bytes: Uint8Array): string {
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    let out = '';
    for (let i = 2; i + 1 < bytes.length; i += 2) {
      out += String.fromCharCode((bytes[i]! << 8) | bytes[i + 1]!);
    }
    return out;
  }
  let out = '';
  for (const byte of bytes) out += String.fromCharCode(byte);
  return out;
}
