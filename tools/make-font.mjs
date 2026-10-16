// Generates a TrueType font from stroke definitions authored here.
//
//   node tools/make-font.mjs <out.ttf>
//
// Why generate rather than ship a font: the project's licence rule admits only
// Apache-2.0 / BSD / MIT components, and every usable UI face is under OFL or a
// proprietary licence. Authoring the outlines and emitting the container by hand
// keeps the font unambiguously self-authored.
//
// How it works: each glyph is a list of polylines plus circular arcs. A polyline is
// expanded into a filled outline by emitting one quad contour per segment and one
// disc contour per joint. TrueType fills with the non-zero winding rule, so
// overlapping contours with the same orientation simply union — no boolean
// geometry is needed, which is what keeps this tractable.
import { writeFileSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';

// ------------------------------------------------------------------- metrics

const UPM = 1000;
const ASCENDER = 800;
const DESCENDER = -220;
const CAP = 700;
const XH = 500;
const PEN = 88;
/** Round glyphs are approximated with this many segments per full turn. */
const ARC_STEPS = 20;

const L = 70;
const R = 550;
const CX = 310;
const HALF_W = 240;

// ------------------------------------------------------------ stroke helpers

/** Points along an elliptical arc, angles in degrees, y measured upward. */
function arc(cx, cy, rx, ry, a0, a1, steps = Math.max(3, Math.round((Math.abs(a1 - a0) / 360) * ARC_STEPS))) {
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const a = ((a0 + ((a1 - a0) * i) / steps) * Math.PI) / 180;
    pts.push([Math.round(cx + rx * Math.cos(a)), Math.round(cy + ry * Math.sin(a))]);
  }
  return pts;
}

/** Full circle as a stroke. */
const circle = (cx, cy, r) => arc(cx, cy, r, r, 0, 360);

/** A straight stroke between two points. */
const line = (x0, y0, x1, y1) => [
  [x0, y0],
  [x1, y1],
];

/** Normalises a literal "x,y x,y ..." string into a stroke. */
const poly = (spec) =>
  spec
    .trim()
    .split(/\s+/)
    .map((pair) => pair.split(',').map(Number));

// ------------------------------------------------------- outline expansion

/**
 * Expands strokes into glyph contours.
 * @param {number[][][]} strokes
 * @param {number} pen stroke width
 * @returns {number[][][]} contours of [x, y] points, all wound counter-clockwise
 */
function strokesToContours(strokes, pen = PEN) {
  const half = pen / 2;
  const contours = [];

  for (const stroke of strokes) {
    if (stroke.length === 0) continue;
    if (stroke.length === 1) {
      // A degenerate "dot" stroke becomes a disc.
      contours.push(circle(stroke[0][0], stroke[0][1], half));
      continue;
    }
    for (let i = 0; i < stroke.length - 1; i++) {
      const [x0, y0] = stroke[i];
      const [x1, y1] = stroke[i + 1];
      const dx = x1 - x0;
      const dy = y1 - y0;
      const len = Math.hypot(dx, dy);
      if (len < 1e-6) continue;
      // Unit normal, then the rectangle corners, wound counter-clockwise.
      const nx = (-dy / len) * half;
      const ny = (dx / len) * half;
      contours.push([
        [x0 + nx, y0 + ny],
        [x1 + nx, y1 + ny],
        [x1 - nx, y1 - ny],
        [x0 - nx, y0 - ny],
      ]);
    }
    // Joints and caps.
    for (const [x, y] of stroke) contours.push(circle(x, y, half));
  }

  // Snap to integers; the rasteriser works in whole font units.
  const snapped = contours.map((c) => c.map(([x, y]) => [Math.round(x), Math.round(y)]));

  // Every contour must wind the same way. TrueType fills with the non-zero rule, so
  // two overlapping contours of *opposite* orientation cancel and punch a hole —
  // which is exactly what happens where a joint disc sits on a segment quad.
  // Segment quads come out clockwise (negative area in these y-up coordinates), so
  // everything is normalised to that.
  return snapped.map((contour) => (signedArea(contour) > 0 ? contour.slice().reverse() : contour));
}

/** Twice the signed area of a polygon; the sign gives its orientation. */
function signedArea(points) {
  let total = 0;
  for (let i = 0; i < points.length; i++) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[(i + 1) % points.length];
    total += x0 * y1 - x1 * y0;
  }
  return total;
}

// --------------------------------------------------------------- glyph table
//
// Coordinates are font units with the baseline at y=0. Uppercase occupies
// y = 0..700, lowercase x-height y = 0..500 with ascenders to 700 and descenders
// to -220. Widths are advances.

const W = 620;
const NARROW = 330;

/** @type {Record<string, {w:number, s:number[][][]}>} */
const GLYPHS = {
  ' ': { w: 320, s: [] },

  A: { w: W, s: [poly('70,0 310,700 550,0'), poly('150,220 470,220')] },
  B: {
    w: W,
    s: [
      line(70, 0, 70, CAP),
      poly('70,700 330,700 420,630 420,420 330,360 70,360'),
      poly('70,360 350,360 460,280 460,90 350,0 70,0'),
    ],
  },
  C: { w: W, s: [arc(CX, 350, HALF_W, 350, 55, 305)] },
  D: { w: W, s: [line(70, 0, 70, CAP), poly('70,700 300,700 470,540 470,160 300,0 70,0')] },
  E: { w: W, s: [line(70, 0, 70, CAP), poly('70,700 550,700'), poly('70,360 470,360'), poly('70,0 550,0')] },
  F: { w: W, s: [line(70, 0, 70, CAP), poly('70,700 550,700'), poly('70,360 470,360')] },
  G: { w: W, s: [arc(CX, 350, HALF_W, 350, 55, 305), poly('550,350 550,60 300,60'), line(550, 350, 550, 60)] },
  H: { w: W, s: [line(70, 0, 70, CAP), line(550, 0, 550, CAP), poly('70,350 550,350')] },
  I: { w: NARROW, s: [line(165, 0, 165, CAP)] },
  J: { w: 560, s: [line(480, CAP, 480, 160), poly('480,160 480,120 420,0 160,0 90,110')] },
  K: { w: W, s: [line(70, 0, 70, CAP), poly('550,700 70,300'), poly('240,340 550,0')] },
  L: { w: 560, s: [line(70, 0, 70, CAP), poly('70,0 510,0')] },
  M: { w: 700, s: [line(70, 0, 70, CAP), poly('70,700 350,300 630,700'), line(630, CAP, 630, 0)] },
  N: { w: W, s: [line(70, 0, 70, CAP), poly('70,700 550,0'), line(550, 0, 550, CAP)] },
  O: { w: W, s: [circle(CX, 350, HALF_W)] },
  P: { w: W, s: [line(70, 0, 70, CAP), poly('70,700 340,700 450,610 450,450 340,370 70,370')] },
  Q: { w: W, s: [circle(CX, 350, HALF_W), poly('420,180 580,-30')] },
  R: { w: W, s: [line(70, 0, 70, CAP), poly('70,700 330,700 440,610 440,460 330,380 70,380'), poly('280,380 550,0')] },
  S: {
    w: W,
    s: [
      poly(
        [
          ...arc(310, 540, 220, 160, 20, 165),
          ...arc(310, 350, 220, 190, 165, 195, 3),
          ...arc(310, 175, 220, 175, 195, 340),
        ]
          .map((p) => p.join(','))
          .join(' '),
      ),
    ],
  },
  T: { w: W, s: [poly('70,700 550,700'), line(310, CAP, 310, 0)] },
  U: { w: W, s: [line(70, CAP, 70, 180), arcBody(310, 180, 240, 180), line(550, 180, 550, CAP)] },
  V: { w: W, s: [poly('70,700 310,0 550,700')] },
  W: { w: 820, s: [poly('60,700 220,0 410,470 600,0 760,700')] },
  X: { w: W, s: [poly('70,0 550,700'), poly('70,700 550,0')] },
  Y: { w: W, s: [poly('70,700 310,350 550,700'), line(310, 350, 310, 0)] },
  Z: { w: W, s: [poly('70,700 550,700'), poly('550,700 70,0'), poly('70,0 550,0')] },

  a: { w: 560, s: [circle(280, 250, 190), line(470, XH, 470, 0)] },
  b: { w: 560, s: [line(90, 0, 90, 730), circle(300, 250, 200)] },
  c: { w: 540, s: [arc(300, 250, 210, 250, 50, 310)] },
  d: { w: 560, s: [line(470, 0, 470, 730), circle(260, 250, 200)] },
  e: { w: 560, s: [arc(290, 250, 210, 250, 0, 360), poly('80,250 500,250')] },
  f: { w: 360, s: [poly('330,690 300,700 220,690 200,600 200,0'), poly('80,500 330,500')] },
  g: { w: 560, s: [circle(280, 250, 190), poly('470,500 470,-120 400,-220 180,-220')] },
  h: { w: 560, s: [line(90, 0, 90, 730), poly('90,400 300,500 440,400 470,250 470,0')] },
  i: { w: 280, s: [line(140, 0, 140, XH), circle(140, 640, 46)] },
  j: { w: 280, s: [poly('180,500 180,-120 110,-220'), circle(180, 640, 46)] },
  k: { w: 520, s: [line(90, 0, 90, 730), poly('450,500 90,200'), poly('230,270 460,0')] },
  l: { w: 280, s: [line(140, 0, 140, 730)] },
  m: { w: 840, s: [line(90, 0, 90, XH), poly('90,400 240,500 380,400 380,0'), poly('380,400 530,500 670,400 670,0')] },
  n: { w: 560, s: [line(90, 0, 90, XH), poly('90,400 300,500 440,400 470,250 470,0')] },
  o: { w: 560, s: [circle(280, 250, 200)] },
  p: { w: 560, s: [line(90, -220, 90, XH), circle(300, 250, 200)] },
  q: { w: 560, s: [line(470, -220, 470, XH), circle(260, 250, 200)] },
  r: { w: 420, s: [line(90, 0, 90, XH), poly('90,390 300,500 430,430')] },
  s: { w: 520, s: [poly([...arc(270, 380, 180, 120, 20, 165), ...arc(270, 250, 180, 130, 165, 195, 3), ...arc(270, 120, 180, 120, 195, 340)].map((p) => p.join(',')).join(' '))] },
  t: { w: 380, s: [line(190, 660, 190, 90), poly('60,500 320,500'), poly('190,90 260,0 330,20')] },
  u: { w: 560, s: [line(90, XH, 90, 120), arcBody(280, 120, 190, 120), line(470, 120, 470, XH)] },
  v: { w: 540, s: [poly('70,500 270,0 470,500')] },
  w: { w: 760, s: [poly('60,500 200,0 380,340 560,0 700,500')] },
  x: { w: 520, s: [poly('70,0 450,500'), poly('70,500 450,0')] },
  y: { w: 540, s: [poly('70,500 270,20'), poly('470,500 210,-220')] },
  z: { w: 500, s: [poly('70,500 430,500'), poly('430,500 70,0'), poly('70,0 430,0')] },

  0: { w: 560, s: [arc(280, 350, 190, 350, 0, 360)] },
  1: { w: 560, s: [poly('140,540 280,700 280,0'), poly('110,0 450,0')] },
  2: { w: 560, s: [poly([...arc(280, 520, 180, 180, 170, 20), ...poly('460,520 90,0'), ...poly('90,0 470,0')].map((p) => (Array.isArray(p) ? p.join(',') : p)).join(' '))] },
  3: { w: 560, s: [poly([...arc(280, 530, 170, 170, 170, 20), ...arc(280, 250, 150, 250, -70, -260)].map((p) => p.join(',')).join(' '))] },
  4: { w: 560, s: [poly('400,0 400,700 70,220 490,220')] },
  5: { w: 560, s: [poly('470,700 140,700 120,400 300,430 450,340 450,110 310,0 110,0')] },
  6: { w: 560, s: [poly([...arc(280, 250, 180, 250, 0, 360)].map((p) => p.join(',')).join(' ')), poly('460,620 400,690 200,690 100,560 100,250')] },
  7: { w: 560, s: [poly('90,700 480,700 230,0')] },
  8: { w: 560, s: [circle(280, 520, 170), circle(280, 175, 175)] },
  9: { w: 560, s: [circle(280, 450, 180), poly('460,450 460,150 380,0 180,0')] },

  '.': { w: 280, s: [circle(140, 50, 46)] },
  ',': { w: 280, s: [circle(140, 50, 46), poly('140,50 100,-110')] },
  ':': { w: 280, s: [circle(140, 400, 46), circle(140, 50, 46)] },
  ';': { w: 280, s: [circle(140, 400, 46), circle(140, 50, 46), poly('140,50 100,-110')] },
  '!': { w: 280, s: [line(140, 190, 140, 700), circle(140, 50, 46)] },
  '?': { w: 500, s: [poly([...arc(250, 530, 170, 170, 180, -30), ...poly('300,400 300,300 250,240 230,190')].map((p) => p.join(',')).join(' ')), circle(230, 50, 46)] },
  '-': { w: 400, s: [line(70, 320, 330, 320)] },
  '–': { w: 500, s: [line(70, 320, 430, 320)] },
  '+': { w: 560, s: [line(80, 320, 480, 320), line(280, 120, 280, 520)] },
  '=': { w: 560, s: [line(80, 200, 480, 200), line(80, 430, 480, 430)] },
  '*': { w: 440, s: [line(220, 380, 220, 660), poly('100,440 340,600'), poly('340,440 100,600')] },
  '/': { w: 460, s: [poly('60,-40 400,740')] },
  '\\': { w: 460, s: [poly('60,740 400,-40')] },
  '|': { w: 280, s: [line(140, -80, 140, 740)] },
  '(': { w: 340, s: [arc(360, 300, 300, 480, 120, 240)] },
  ')': { w: 340, s: [arc(-20, 300, 300, 480, 60, -60)] },
  '[': { w: 340, s: [poly('290,760 130,760 130,-160 290,-160')] },
  ']': { w: 340, s: [poly('50,760 210,760 210,-160 50,-160')] },
  '{': { w: 380, s: [poly('300,760 220,700 220,420 130,350 220,280 220,-100 300,-160')] },
  '}': { w: 380, s: [poly('80,760 160,700 160,420 250,350 160,280 160,-100 80,-160')] },
  '<': { w: 500, s: [poly('420,620 90,320 420,20')] },
  '>': { w: 500, s: [poly('80,620 410,320 80,20')] },
  '"': { w: 400, s: [line(130, 480, 130, 700), line(270, 480, 270, 700)] },
  "'": { w: 260, s: [line(140, 480, 140, 700)] },
  '`': { w: 300, s: [poly('80,760 220,620')] },
  '^': { w: 500, s: [poly('90,520 250,720 410,520')] },
  '_': { w: 560, s: [line(40, -160, 520, -160)] },
  '~': { w: 560, s: [poly([...arc(180, 330, 110, 90, 20, 160), ...arc(390, 330, 110, 90, 200, 340)].map((p) => p.join(',')).join(' '))] },
  '@': { w: 760, s: [circle(380, 330, 260), circle(380, 330, 110), poly('490,330 490,150 620,150')] },
  '#': { w: 620, s: [line(200, 0, 200, 700), line(420, 0, 420, 700), line(80, 240, 540, 240), line(80, 470, 540, 470)] },
  '$': { w: 560, s: [poly([...arc(280, 540, 170, 130, 20, 165), ...arc(280, 350, 170, 150, 165, 195, 3), ...arc(280, 160, 170, 150, 195, 340)].map((p) => p.join(',')).join(' ')), line(280, -60, 280, 760)] },
  '%': { w: 700, s: [circle(180, 560, 120), circle(520, 140, 120), poly('600,-40 100,740')] },
  '&': { w: 660, s: [circle(280, 200, 170), poly('150,300 420,560 420,650 340,720 260,650 260,520 560,0 380,0 60,230')] },
  '°': { w: 360, s: [circle(180, 560, 110)] },
  '×': { w: 520, s: [poly('90,120 430,460'), poly('90,460 430,120')] },
  '‹': { w: 380, s: [poly('290,520 100,300 290,80')] },
  '›': { w: 380, s: [poly('90,520 280,300 90,80')] },
  '−': { w: 560, s: [line(80, 320, 480, 320)] },
};

/** Bottom arc used by U and u; kept as a helper for symmetry with `arc`. */
function arcBody(cx, cy, rx, ry) {
  return arc(cx, cy, rx, ry, 180, 360);
}

// ------------------------------------------------------------- cmap coverage

/** Code points the font maps, in ascending order. */
const CODEPOINTS = Object.keys(GLYPHS)
  .map((ch) => ch.codePointAt(0))
  .filter((cp) => cp !== undefined && cp >= 0x20 && cp <= 0x7e || cp === 0x2013 || cp === 0x2018 || cp === 0x2019 || cp === 0x201c || cp === 0x201d || cp === 0x00b0 || cp === 0x00d7 || cp === 0x2039 || cp === 0x203a || cp === 0x2212)
  .sort((a, b) => a - b);

// --------------------------------------------------------------- TTF writer

class Buf {
  constructor() {
    this.parts = [];
    this.length = 0;
  }
  u8(v) {
    this.parts.push(new Uint8Array([v & 0xff]));
    this.length += 1;
    return this;
  }
  u16(v) {
    const b = new Uint8Array(2);
    new DataView(b.buffer).setUint16(0, v & 0xffff, false);
    this.parts.push(b);
    this.length += 2;
    return this;
  }
  i16(v) {
    const b = new Uint8Array(2);
    new DataView(b.buffer).setInt16(0, Math.max(-32768, Math.min(32767, Math.round(v))), false);
    this.parts.push(b);
    this.length += 2;
    return this;
  }
  u32(v) {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setUint32(0, v >>> 0, false);
    this.parts.push(b);
    this.length += 4;
    return this;
  }
  i32(v) {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setInt32(0, Math.round(v), false);
    this.parts.push(b);
    this.length += 4;
    return this;
  }
  i64(v) {
    const b = new Uint8Array(8);
    new DataView(b.buffer).setBigInt64(0, BigInt(Math.round(v)), false);
    this.parts.push(b);
    this.length += 8;
    return this;
  }
  raw(bytes) {
    this.parts.push(bytes);
    this.length += bytes.length;
    return this;
  }
  pad(to) {
    while (this.length % to !== 0) this.u8(0);
    return this;
  }
  done() {
    const out = new Uint8Array(this.length);
    let at = 0;
    for (const part of this.parts) {
      out.set(part, at);
      at += part.length;
    }
    return out;
  }
}

const sum32 = (bytes) => {
  let total = 0;
  for (let i = 0; i < bytes.length; i += 4) {
    total = (total + ((bytes[i] << 24) | (bytes[i + 1] << 16) | (bytes[i + 2] << 8) | bytes[i + 3])) >>> 0;
  }
  return total;
};

/** Serialises one glyph's contours into glyf format. */
function glyfEntry(contours) {
  if (contours.length === 0) return new Uint8Array(0);

  const points = [];
  const endPts = [];
  for (const contour of contours) {
    for (const [x, y] of contour) points.push([x, y]);
    endPts.push(points.length - 1);
  }

  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const b = new Buf();
  b.i16(contours.length);
  b.i16(Math.min(...xs));
  b.i16(Math.min(...ys));
  b.i16(Math.max(...xs));
  b.i16(Math.max(...ys));
  for (const end of endPts) b.u16(end);
  b.u16(0); // no instructions

  // Every point is on-curve; coordinates are stored as signed 16-bit deltas, so
  // the flag byte is a constant and needs no repeat compression.
  for (let i = 0; i < points.length; i++) b.u8(0x01);
  let px = 0;
  for (const [x] of points) {
    b.i16(x - px);
    px = x;
  }
  let py = 0;
  for (const [, y] of points) {
    b.i16(y - py);
    py = y;
  }
  b.pad(4);
  return b.done();
}

/** cmap format 4, platform 3 / encoding 1. */
function cmapFormat4(entries) {
  // entries: [{ code, glyphId }] ascending by code
  const segments = [];
  let prev = null;
  for (const entry of entries) {
    if (prev && entry.code === prev.end + 1 && entry.glyphId === prev.startGlyph + (entry.code - prev.start)) {
      prev.end = entry.code;
    } else {
      prev = { start: entry.code, end: entry.code, startGlyph: entry.glyphId };
      segments.push(prev);
    }
  }
  segments.push({ start: 0xffff, end: 0xffff, startGlyph: 0 });

  const segCount = segments.length;
  const endCodes = segments.map((s) => s.end);
  const startCodes = segments.map((s) => s.start);
  const idDeltas = segments.map((s) => (s.startGlyph - s.start) & 0xffff);
  const idRangeOffsets = segments.map(() => 0);

  const length = 16 + segCount * 8;
  const b = new Buf();
  b.u16(4);
  b.u16(length);
  b.u16(0); // language
  b.u16(segCount * 2);
  const searchRange = 2 ** Math.floor(Math.log2(segCount)) * 2;
  b.u16(searchRange);
  b.u16(Math.log2(searchRange / 2));
  b.u16(segCount * 2 - searchRange); // rangeShift - the format 4 header is seven uint16 fields
  for (const v of endCodes) b.u16(v);
  b.u16(0); // reservedPad
  for (const v of startCodes) b.u16(v);
  for (const v of idDeltas) b.u16(v);
  for (const v of idRangeOffsets) b.u16(v);
  return b.done();
}

function nameTable(family, style, uniqueId) {
  const strings = [
    [1, family],
    [2, style],
    [3, uniqueId],
    [4, `${family} ${style}`],
    [5, 'Version 1.000'],
    [6, family.replace(/\s+/g, '')],
  ];
  const encoded = strings.map(([id, text]) => {
    const bytes = new Uint8Array(text.length * 2);
    const dv = new DataView(bytes.buffer);
    for (let i = 0; i < text.length; i++) dv.setUint16(i * 2, text.charCodeAt(i), false);
    return { id, bytes };
  });

  const count = encoded.length;
  const storageOffset = 6 + count * 12;
  const b = new Buf();
  b.u16(0); // format
  b.u16(count);
  b.u16(storageOffset);
  let cursor = 0;
  for (const { id, bytes } of encoded) {
    b.u16(3); // platform: Windows
    b.u16(1); // encoding: Unicode BMP
    b.u16(0x0409); // en-US
    b.u16(id);
    b.u16(bytes.length);
    b.u16(cursor);
    cursor += bytes.length;
  }
  for (const { bytes } of encoded) b.raw(bytes);
  return b.done();
}

/** Builds a complete TrueType file. */
function buildFont() {
  const order = ['.notdef', ...Object.keys(GLYPHS)];
  const advance = [500, ...Object.values(GLYPHS).map((g) => g.w)];
  const contours = [[circle(250, 350, 240)], ...Object.values(GLYPHS).map((g) => strokesToContours(g.s, PEN))];

  // glyf + loca
  const glyfParts = [];
  const loca = [0];
  let glyfLength = 0;
  for (const glyphContours of contours) {
    const data = glyfEntry(glyphContours);
    const padded = new Uint8Array(Math.ceil(data.length / 4) * 4);
    padded.set(data);
    glyfParts.push(padded);
    glyfLength += padded.length;
    loca.push(glyfLength);
  }
  const glyf = new Uint8Array(glyfLength);
  {
    let at = 0;
    for (const part of glyfParts) {
      glyf.set(part, at);
      at += part.length;
    }
  }

  const locaBuf = new Buf();
  for (const offset of loca) locaBuf.u32(offset);
  const locaBytes = locaBuf.done();

  // cmap: code point -> glyph id
  const cmapEntries = [];
  const nameToGid = new Map(order.map((n, i) => [n, i]));
  for (const ch of Object.keys(GLYPHS)) {
    const cp = ch.codePointAt(0);
    if (cp === undefined) continue;
    const gid = nameToGid.get(ch);
    if (gid !== undefined) cmapEntries.push({ code: cp, glyphId: gid });
  }
  cmapEntries.sort((a, b) => a.code - b.code);
  const cmapSubtable = cmapFormat4(cmapEntries);
  const cmap = (() => {
    const b = new Buf();
    b.u16(0);
    b.u16(1);
    b.u16(3);
    b.u16(1);
    b.u32(12);
    b.raw(cmapSubtable);
    return b.done();
  })();

  // hmtx
  const hmtx = (() => {
    const b = new Buf();
    for (let i = 0; i < order.length; i++) {
      b.u16(advance[i]);
      b.i16(contours[i].length > 0 ? Math.min(...contours[i].flat().map((p) => p[0])) : 0);
    }
    return b.done();
  })();

  const allX = contours.flat(2).map((p) => p[0]);
  const allY = contours.flat(2).map((p) => p[1]);
  const xMin = Math.min(...allX);
  const yMin = Math.min(...allY);
  const xMax = Math.max(...allX);
  const yMax = Math.max(...allY);
  const maxPoints = Math.max(...contours.map((c) => c.reduce((n, k) => n + k.length, 0)));
  const maxContours = Math.max(...contours.map((c) => c.length));

  const head = (() => {
    const b = new Buf();
    b.u32(0x00010000);
    b.u32(0x00010000);
    b.u32(0); // checkSumAdjustment, patched later
    b.u32(0x5f0f3cf5);
    b.u16(0x000b);
    b.u16(UPM);
    b.i64(0); // created
    b.i64(0); // modified
    b.i16(xMin);
    b.i16(yMin);
    b.i16(xMax);
    b.i16(yMax);
    b.u16(0); // macStyle
    b.u16(8); // lowestRecPPEM
    b.i16(2); // fontDirectionHint
    b.i16(1); // indexToLocFormat: long
    b.i16(0); // glyphDataFormat
    return b.done();
  })();

  const hhea = (() => {
    const b = new Buf();
    b.u32(0x00010000);
    b.i16(ASCENDER);
    b.i16(DESCENDER);
    b.i16(200); // lineGap
    b.u16(Math.max(...advance));
    b.i16(xMin);
    b.i16(0);
    b.i16(xMax);
    b.i16(1);
    b.i16(0);
    b.i16(0);
    b.i16(0);
    b.i16(0);
    b.i16(0);
    b.i16(0);
    b.i16(0); // metricDataFormat
    b.u16(order.length);
    return b.done();
  })();

    // maxp version 1.0, 32 bytes: version, numGlyphs, then 12 more uint16 fields.
    const maxp = (() => {
      const b = new Buf();
      b.u32(0x00010000);
      b.u16(order.length); // numGlyphs
      b.u16(maxPoints);
      b.u16(maxContours);
      b.u16(0); // maxCompositePoints
      b.u16(0); // maxCompositeContours
      b.u16(2); // maxZones
      b.u16(0); // maxTwilightPoints
      b.u16(0); // maxStorage
      b.u16(0); // maxFunctionDefs
      b.u16(0); // maxInstructionDefs
      b.u16(0); // maxStackElements
      b.u16(0); // maxSizeOfInstructions
      b.u16(0); // maxComponentElements
      b.u16(0); // maxComponentDepth
      return b.done();
    })();

    // OS/2 version 4, 96 bytes. Field order and widths follow the specification
    // exactly; note panose is 10 bytes, not 10 uint16s.
    const os2 = (() => {
      const b = new Buf();
      b.u16(4); // version
      b.i16(500); // xAvgCharWidth
      b.u16(400); // usWeightClass
      b.u16(5); // usWidthClass
      b.u16(0); // fsType
      b.i16(650); // ySubscriptXSize
      b.i16(600); // ySubscriptYSize
      b.i16(0); // ySubscriptXOffset
      b.i16(75); // ySubscriptYOffset
      b.i16(650); // ySuperscriptXSize
      b.i16(600); // ySuperscriptYSize
      b.i16(0); // ySuperscriptXOffset
      b.i16(350); // ySuperscriptYOffset
      b.i16(50); // yStrikeoutSize
      b.i16(300); // yStrikeoutPosition
      b.i16(0); // sFamilyClass
      b.raw(new Uint8Array([2, 0, 5, 3, 0, 0, 0, 0, 0, 0])); // panose
      b.u32(1); // ulUnicodeRange1: Basic Latin
      b.u32(0);
      b.u32(0);
      b.u32(0);
      b.raw(new TextEncoder().encode("ARPK")); // achVendID
      b.u16(0x0040); // fsSelection: regular
      b.u16(0x0020); // usFirstCharIndex
      b.u16(0x00ff); // usLastCharIndex
      b.i16(ASCENDER - 100); // sTypoAscender
      b.i16(DESCENDER); // sTypoDescender
      b.i16(200); // sTypoLineGap
      b.u16(ASCENDER); // usWinAscent
      b.u16(-DESCENDER); // usWinDescent
      b.u32(1); // ulCodePageRange1: Latin 1
      b.u32(0);
      b.i16(XH); // sxHeight
      b.i16(CAP); // sCapHeight
      b.u16(0); // usDefaultChar
      b.u16(0x0020); // usBreakChar
      b.u16(1); // usMaxContext
      return b.done();
    })();

  const post = (() => {
    const b = new Buf();
    b.u32(0x00030000);
    b.i32(0);
    b.i16(0);
    b.i16(0);
    b.u32(0);
    b.u32(0);
    b.u32(0);
    b.u32(0);
    b.u32(0);
    return b.done();
  })();

  const tables = {
    'OS/2': os2,
    cmap,
    glyf,
    head,
    hhea,
    hmtx,
    loca: locaBytes,
    maxp,
    name: nameTable('ARPK Sans', 'Regular', 'ARPK Sans Regular;1.000'),
    post,
  };

  const ids = Object.keys(tables).sort();
  const numTables = ids.length;
  const searchRange = 2 ** Math.floor(Math.log2(numTables)) * 16;

  const directory = new Buf();
  directory.u32(0x00010000);
  directory.u16(numTables);
  directory.u16(searchRange);
  directory.u16(Math.log2(searchRange / 16));
  directory.u16(numTables * 16 - searchRange);

  let offset = 12 + numTables * 16;
  const records = [];
  for (const id of ids) {
    const data = tables[id];
    const padded = new Uint8Array(Math.ceil(data.length / 4) * 4);
    padded.set(data);
    // The directory records the true table length; padding exists only so the
    // checksum can be computed over whole 32-bit words, and must not be counted.
    records.push({ id, data: padded, length: data.length, checksum: sum32(padded), offset });
    offset += padded.length;
  }

  for (const record of records) {
    directory.raw(new TextEncoder().encode(record.id));
    directory.u32(record.checksum);
    directory.u32(record.offset);
    directory.u32(record.length);
  }

  const out = new Uint8Array(offset);
  out.set(directory.done(), 0);
  for (const record of records) out.set(record.data, record.offset);

  // head.checkSumAdjustment = 0xB1B0AFBA - checksum(entire file)
  const headRecord = records.find((r) => r.id === 'head');
  const total = sum32(out);
  const adjustment = (0xb1b0afba - total) >>> 0;
  new DataView(out.buffer).setUint32(headRecord.offset + 8, adjustment, false);

  return out;
}

// ---------------------------------------------------------------------- main

const outPath = process.argv[2];
if (!outPath) {
  console.error('usage: node tools/make-font.mjs <out.ttf>');
  process.exit(2);
}

const font = buildFont();
writeFileSync(outPath, font);

const glyphCount = Object.keys(GLYPHS).length + 1;
console.log(`字体已生成: ${outPath}`);
console.log(`  大小      : ${font.length} 字节 (deflate 后约 ${deflateRawSync(font).length} 字节)`);
console.log(`  字形数    : ${glyphCount} (.notdef + ${Object.keys(GLYPHS).length})`);
console.log(`  码位      : ${CODEPOINTS.length}`);
console.log(`  unitsPerEm: ${UPM}`);
