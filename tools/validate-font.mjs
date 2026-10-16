// Structural validator for the generated TrueType file. Node-side so the byte
// arithmetic is done in one language rather than shelled out.
//
//   node tools/validate-font.mjs <font.ttf>
import { readFileSync } from 'node:fs';

const bytes = readFileSync(process.argv[2] ?? 'assets-src/ui-sans.ttf');
const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
const u16 = (o) => view.getUint16(o, false);
const i16 = (o) => view.getInt16(o, false);
const u32 = (o) => view.getUint32(o, false);
const tag = (o) => String.fromCharCode(bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3]);

const problems = [];
const notes = [];
const bad = (msg) => problems.push(msg);
const note = (msg) => notes.push(msg);

// ---- sfnt header ----
const sfnt = u32(0);
if (sfnt !== 0x00010000) bad(`sfntVersion 0x${sfnt.toString(16)} (expected 0x00010000)`);
const numTables = u16(4);
const searchRange = u16(6);
const entrySelector = u16(8);
const rangeShift = u16(10);
const expectSearch = 2 ** Math.floor(Math.log2(numTables)) * 16;
if (searchRange !== expectSearch) bad(`searchRange ${searchRange} (expected ${expectSearch})`);
if (entrySelector !== Math.log2(expectSearch / 16)) bad(`entrySelector ${entrySelector}`);
if (rangeShift !== numTables * 16 - searchRange) bad(`rangeShift ${rangeShift}`);

const dir = new Map();
for (let i = 0; i < numTables; i++) {
  const o = 12 + i * 16;
  dir.set(tag(o), { checksum: u32(o + 4), offset: u32(o + 8), length: u32(o + 12) });
}

// ---- table checksums ----
const sum32 = (start, length) => {
  let total = 0;
  for (let i = 0; i < length; i += 4) {
    const w = ((bytes[start + i] << 24) | (bytes[start + i + 1] << 16) | (bytes[start + i + 2] << 8) | bytes[start + i + 3]) >>> 0;
    total = (total + w) >>> 0;
  }
  return total >>> 0;
};
for (const [id, rec] of dir) {
  // head's directory checksum is defined over the table with checkSumAdjustment = 0.
  let computed;
  if (id === 'head') {
    const copy = Uint8Array.from(bytes.subarray(rec.offset, rec.offset + rec.length));
    copy[8] = copy[9] = copy[10] = copy[11] = 0;
    const padded = new Uint8Array(Math.ceil(copy.length / 4) * 4);
    padded.set(copy);
    computed = sum32(0, 0) || (() => {
      let t = 0;
      for (let i = 0; i < padded.length; i += 4) {
        const w = ((padded[i] << 24) | (padded[i + 1] << 16) | (padded[i + 2] << 8) | padded[i + 3]) >>> 0;
        t = (t + w) >>> 0;
      }
      return t >>> 0;
    })();
  } else {
    computed = sum32(rec.offset, Math.ceil(rec.length / 4) * 4);
  }
  if (computed !== rec.checksum) bad(`table ${id} checksum ${computed.toString(16)} != directory ${rec.checksum.toString(16)}`);
}

// ---- whole-file checksum ----
const total = sum32(0, bytes.length);
if (total !== 0xb1b0afba) bad(`whole-file checksum 0x${total.toString(16)} (expected 0xb1b0afba)`);

// ---- spec lengths ----
const numGlyphs = u16(dir.get('maxp').offset + 4);
const spec = {
  head: 54,
  hhea: 36,
  maxp: 32,
  post: 32,
  'OS/2': 96,
  hmtx: 4 * numGlyphs,
  loca: 4 * (numGlyphs + 1),
};
for (const [id, expected] of Object.entries(spec)) {
  const rec = dir.get(id);
  if (!rec) bad(`missing table ${id}`);
  else if (rec.length !== expected) bad(`table ${id} length ${rec.length} (expected ${expected})`);
}
note(`numGlyphs=${numGlyphs}, tables=${numTables}`);

// ---- head ----
const head = dir.get('head').offset;
if (u32(head + 12) !== 0x5f0f3cf5) bad('head.magicNumber wrong');
if (u16(head + 18) !== 1000) bad(`head.unitsPerEm ${u16(head + 18)}`);
const indexToLocFormat = i16(head + 50);
if (indexToLocFormat !== 1) bad(`head.indexToLocFormat ${indexToLocFormat} (expected 1 for long loca)`);

// ---- hhea / maxp ----
if (u16(dir.get('hhea').offset + 34) !== numGlyphs) bad('hhea.numberOfHMetrics != numGlyphs');
if (u16(dir.get('maxp').offset + 6) === 0) bad('maxp.maxPoints is 0');

// ---- loca ----
const loca = dir.get('loca').offset;
const glyf = dir.get('glyf').offset;
const glyfLen = dir.get('glyf').length;
let prev = 0;
for (let i = 0; i <= numGlyphs; i++) {
  const off = u32(loca + i * 4);
  if (off < prev) bad(`loca[${i}] = ${off} goes backwards from ${prev}`);
  if (off > glyfLen) bad(`loca[${i}] = ${off} past glyf (${glyfLen})`);
  if (off % 2 !== 0) bad(`loca[${i}] = ${off} is odd`);
  prev = off;
}
if (u32(loca + numGlyphs * 4) !== glyfLen) bad(`loca last ${u32(loca + numGlyphs * 4)} != glyf length ${glyfLen}`);

// ---- glyf walk ----
let glyphErrors = 0;
for (let g = 0; g < numGlyphs; g++) {
  const start = u32(loca + g * 4);
  const end = u32(loca + (g + 1) * 4);
  if (end === start) continue;
  const base = glyf + start;
  const nc = i16(base);
  if (nc < 0) continue; // composite, not emitted
  if (nc === 0) continue;
  const endPts = [];
  for (let c = 0; c < nc; c++) endPts.push(u16(base + 10 + c * 2));
  const nPoints = endPts[endPts.length - 1] + 1;
  let p = base + 10 + nc * 2;
  const instrLen = u16(p);
  p += 2 + instrLen;
  p += nPoints; // flags
  p += nPoints * 2; // x deltas
  p += nPoints * 2; // y deltas
  if (p > glyf + end) {
    glyphErrors++;
    if (glyphErrors < 4) bad(`glyph ${g} needs ${p - base} bytes but occupies ${end - start}`);
  }
  for (let c = 1; c < endPts.length; c++) {
    if (endPts[c] <= endPts[c - 1]) {
      glyphErrors++;
      if (glyphErrors < 4) bad(`glyph ${g} endPtsOfContours not increasing`);
      break;
    }
  }
}

// ---- cmap ----
const cmap = dir.get('cmap').offset;
if (u16(cmap) !== 0) bad('cmap version != 0');
const cmapCount = u16(cmap + 2);
let sub = -1;
for (let i = 0; i < cmapCount; i++) {
  const o = cmap + 4 + i * 8;
  if (u16(o) === 3 && u16(o + 2) === 1) sub = cmap + u32(o + 4);
}
if (sub < 0) bad('no Windows BMP cmap subtable');
else {
  const format = u16(sub);
  const length = u16(sub + 2);
  const segCountX2 = u16(sub + 6);
  const segCount = segCountX2 / 2;
  const expectedLength = 16 + segCount * 8;
  if (format !== 4) bad(`cmap subtable format ${format}`);
  if (length !== expectedLength) bad(`cmap length ${length} (expected ${expectedLength})`);
  const endO = sub + 14;
  const startO = endO + segCountX2 + 2;
  const deltaO = startO + segCountX2;
  const rangeO = deltaO + segCountX2;
  const segs = [];
  for (let s = 0; s < segCount; s++) {
    segs.push({ end: u16(endO + s * 2), start: u16(startO + s * 2), delta: i16(deltaO + s * 2), range: u16(rangeO + s * 2) });
  }
  for (let s = 1; s < segs.length; s++) {
    if (segs[s].start <= segs[s - 1].end) bad(`cmap segment ${s} does not start after the previous end`);
  }
  const lookup = (cp) => {
    for (const seg of segs) {
      if (cp > seg.end) continue;
      if (cp < seg.start) return 0;
      if (seg.range === 0) return (cp + seg.delta) & 0xffff;
      const idx = rangeO + (segs.indexOf(seg) * 2) + seg.range + (cp - seg.start) * 2;
      const gid = u16(idx);
      return gid === 0 ? 0 : (gid + seg.delta) & 0xffff;
    }
    return 0;
  };
  globalThis.__lookup = lookup;
  const samples = ['A', 'a', '0', ' ', '.', '~'];
  const mapped = samples.map((ch) => `${ch}->${lookup(ch.codePointAt(0))}`);
  note(`cmap: ${mapped.join(' ')}`);
  for (const ch of samples) {
    const gid = lookup(ch.codePointAt(0));
    if (gid === 0) bad(`cmap does not map "${ch}"`);
    else if (gid >= numGlyphs) bad(`cmap maps "${ch}" to glyph ${gid} >= ${numGlyphs}`);
  }
}

console.log(`文件: ${process.argv[2] ?? 'assets-src/ui-sans.ttf'} (${bytes.length} 字节)`);
for (const n of notes) console.log(`  · ${n}`);
if (problems.length === 0) {
  console.log('  ✓ 结构校验通过');
} else {
  console.log(`  ✗ ${problems.length} 项问题:`);
  for (const p of problems.slice(0, 20)) console.log(`    - ${p}`);
  process.exitCode = 1;
}
