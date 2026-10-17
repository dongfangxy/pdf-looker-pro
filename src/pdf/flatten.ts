/**
 * Flattening annotations into page content.
 *
 * Flattening means two things at once: the marks become part of what the page draws, and
 * the annotations stop being annotations. The first is a content stream appended to the
 * page; the second is dropping `/Annots`. Doing only one of them is worse than doing
 * neither — an annotation that also appears in the content draws twice.
 *
 * The output is vector, not a rasterised page, so text stays text and the file grows by
 * the size of the marks rather than by the size of the paper.
 *
 * Appending rather than rewriting is deliberate: the original content streams are copied
 * through untouched, which is the only way to be sure a page that drew correctly before
 * still draws correctly after.
 */
import type { AnnotKind, AnnotPoint, AnnotRect } from '../annotations/model.js';
import { distance, formatArea, formatLength, polygonArea, polylineLength, type MeasureUnit } from '../tools/measure.js';

/** The subset of an annotation that flattening reads. */
export interface FlattenInput {
  kind: AnnotKind;
  color: string;
  rect?: AnnotRect | undefined;
  rects?: AnnotRect[] | undefined;
  strokes?: AnnotPoint[][] | undefined;
  note?: string | undefined;
  fontSize?: number | undefined;
  strokeWidth?: number | undefined;
  strokeDash?: boolean | undefined;
  /** Word drawn on a stamp. */
  stampLabel?: string | undefined;
}

export interface FlattenPage {
  /** Operators to append. Empty when the page has nothing to draw. */
  operators: string;
  /** True when the operators use `/Helv` and the page needs that font. */
  needsFont: boolean;
}

const TEXT_KINDS: ReadonlySet<AnnotKind> = new Set<AnnotKind>(['textbox', 'callout', 'note']);
const MEASURE_KINDS: ReadonlySet<AnnotKind> = new Set<AnnotKind>([
  'measure-distance',
  'measure-perimeter',
  'measure-area',
]);

/** Page space (top-left origin, y down) to PDF user space (bottom-left origin, y up). */
class Map2Pdf {
  constructor(private readonly box: [number, number, number, number]) {}

  x(value: number): number {
    return this.box[0] + value;
  }

  y(value: number): number {
    return this.box[3] - value;
  }

  /** `[x1 y1 x2 y2]` ascending, in PDF space. */
  rect(r: AnnotRect): [number, number, number, number] {
    const x1 = this.box[0] + r.x;
    const x2 = this.box[0] + r.x + r.w;
    const y1 = this.box[3] - r.y - r.h;
    const y2 = this.box[3] - r.y;
    return [Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2)];
  }
}

/** Mixes a colour most of the way to white, for fills that should read as a wash. */
function lighten(color: string): string {
  const match = /^#?([0-9a-f]{6})$/i.exec(color.trim());
  if (!match) return '#ffffff';
  const value = Number.parseInt(match[1]!, 16);
  const mix = (channel: number): number => Math.round(channel + (255 - channel) * 0.78);
  const parts = [mix((value >> 16) & 0xff), mix((value >> 8) & 0xff), mix(value & 0xff)];
  return `#${parts.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}
/** `#rrggbb` to a `r g b` operator fragment. */
function rgb(color: string): string {
  const match = /^#?([0-9a-f]{6})$/i.exec(color.trim());
  if (!match) return '0 0 0';
  const value = Number.parseInt(match[1]!, 16);
  const parts = [((value >> 16) & 0xff) / 255, ((value >> 8) & 0xff) / 255, (value & 0xff) / 255];
  return parts.map((v) => v.toFixed(3)).join(' ');
}

function num(value: number): string {
  const rounded = Math.round(value * 1000) / 1000;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
}

/** A PDF literal string with the characters that would break it escaped. */
function literal(text: string): string {
  let out = '';
  for (const ch of text) {
    if (ch === '(' || ch === ')' || ch === '\\') out += `\\${ch}`;
    else if (ch === '\n') out += '\\n';
    else if (ch === '\r') continue;
    else if (ch.codePointAt(0)! < 0x20) out += ' ';
    else if (ch.codePointAt(0)! > 0xff) out += '?';
    else out += ch;
  }
  return `(${out})`;
}

/** Four cubic segments standing in for an ellipse inside `box`. */
function ellipseOperators(x1: number, y1: number, x2: number, y2: number): string {
  const cx = (x1 + x2) / 2;
  const cy = (y1 + y2) / 2;
  const rx = (x2 - x1) / 2;
  const ry = (y2 - y1) / 2;
  const k = 0.5522847498;
  const ox = rx * k;
  const oy = ry * k;
  return [
    `${num(cx + rx)} ${num(cy)} m`,
    `${num(cx + rx)} ${num(cy + oy)} ${num(cx + ox)} ${num(cy + ry)} ${num(cx)} ${num(cy + ry)} c`,
    `${num(cx - ox)} ${num(cy + ry)} ${num(cx - rx)} ${num(cy + oy)} ${num(cx - rx)} ${num(cy)} c`,
    `${num(cx - rx)} ${num(cy - oy)} ${num(cx - ox)} ${num(cy - ry)} ${num(cx)} ${num(cy - ry)} c`,
    `${num(cx + ox)} ${num(cy - ry)} ${num(cx + rx)} ${num(cy - oy)} ${num(cx + rx)} ${num(cy)} c`,
    'h',
  ].join('\n');
}

function strokeWidthOf(item: FlattenInput): number {
  return Math.max(0.2, item.strokeWidth ?? 1.5);
}

function dashOperator(item: FlattenInput): string {
  const width = strokeWidthOf(item);
  return item.strokeDash ? `[${num(width * 4)} ${num(width * 3)}] 0 d` : '[] 0 d';
}

/**
 * Builds the operators that draw one page's annotations.
 *
 * `pageHeight` is the unrotated page height: annotations are stored with the origin at
 * the top-left, which is the inverse of what PDF wants.
 */
export function flattenPage(
  items: readonly FlattenInput[],
  box: [number, number, number, number],
  userUnit: number,
  unit: MeasureUnit,
): FlattenPage {
  if (items.length === 0) return { operators: '', needsFont: false };
  const map = new Map2Pdf(box);
  const parts: string[] = ['q'];
  let needsFont = false;

  for (const item of items) {
    const color = rgb(item.color);
    const width = strokeWidthOf(item);

    switch (item.kind) {
      case 'highlight': {
        // A translucent fill by default would need a graphics state; a solid light fill
        // reads the same at 38% alpha and cannot be lost by a reader that ignores /CA.
        parts.push(`q ${color} rg`);
        for (const r of item.rects ?? (item.rect ? [item.rect] : [])) {
          const [x1, y1, x2, y2] = map.rect(r);
          parts.push(`${num(x1)} ${num(y1)} ${num(x2 - x1)} ${num(y2 - y1)} re f`);
        }
        parts.push('Q');
        break;
      }
      case 'underline':
      case 'strikeout': {
        parts.push(`q ${color} rg`);
        const fraction = item.kind === 'underline' ? 0.92 : 0.5;
        for (const r of item.rects ?? (item.rect ? [item.rect] : [])) {
          const [x1, y1, x2, y2] = map.rect(r);
          const height = Math.max(0.6, (y2 - y1) * 0.07);
          const y = y1 + (y2 - y1) * (1 - fraction);
          parts.push(`${num(x1)} ${num(y)} ${num(x2 - x1)} ${num(height)} re f`);
        }
        parts.push('Q');
        break;
      }
      case 'ink': {
        parts.push(`q ${color} RG ${num(width)} w 1 J 1 j`);
        for (const stroke of item.strokes ?? []) {
          if (stroke.length === 0) continue;
          const commands = stroke.map((point, index) => {
            const x = num(map.x(point.x));
            const y = num(map.y(point.y));
            return `${x} ${y} ${index === 0 ? 'm' : 'l'}`;
          });
          parts.push(`${commands.join('\n')}\nS`);
        }
        parts.push('Q');
        break;
      }
      case 'rect': {
        if (!item.rect) break;
        const [x1, y1, x2, y2] = map.rect(item.rect);
        parts.push(
          `q ${color} RG ${num(width)} w ${dashOperator(item)}\n` +
            `${num(x1)} ${num(y1)} ${num(x2 - x1)} ${num(y2 - y1)} re S Q`,
        );
        break;
      }
      case 'ellipse': {
        if (!item.rect) break;
        const [x1, y1, x2, y2] = map.rect(item.rect);
        parts.push(`q ${color} RG ${num(width)} w ${dashOperator(item)}\n${ellipseOperators(x1, y1, x2, y2)}\nS Q`);
        break;
      }
      case 'arrow': {
        const stroke = item.strokes?.[0];
        if (!stroke || stroke.length < 2) break;
        const from = stroke[0]!;
        const to = stroke[1]!;
        const ax = map.x(from.x);
        const ay = map.y(from.y);
        const bx = map.x(to.x);
        const by = map.y(to.y);
        const angle = Math.atan2(by - ay, bx - ax);
        const head = Math.max(6, width * 4);
        const left = [bx - head * Math.cos(angle - 0.4), by - head * Math.sin(angle - 0.4)];
        const right = [bx - head * Math.cos(angle + 0.4), by - head * Math.sin(angle + 0.4)];
        parts.push(
          `q ${color} RG ${color} rg ${num(width)} w\n` +
            `${num(ax)} ${num(ay)} m ${num(bx)} ${num(by)} l S\n` +
            `${num(bx)} ${num(by)} m ${num(left[0]!)} ${num(left[1]!)} l ${num(right[0]!)} ${num(right[1]!)} l h f Q`,
        );
        break;
      }
      case 'measure-distance': {
        const stroke = item.strokes?.[0];
        if (!stroke || stroke.length < 2) break;
        parts.push(`q ${color} RG ${num(width)} w`);
        parts.push(
          stroke
            .map((point, index) => `${num(map.x(point.x))} ${num(map.y(point.y))} ${index === 0 ? 'm' : 'l'}`)
            .join('\n') + '\nS',
        );
        parts.push('Q');
        needsFont = true;
        parts.push(labelOperators(map, stroke, item, userUnit, unit, color));
        break;
      }
      case 'measure-perimeter':
      case 'measure-area': {
        const points = item.strokes?.[0];
        if (!points || points.length < 2) break;
        const [x1, y1, x2, y2] = (item.rect ? map.rect(item.rect) : boundsOf(points, map));
        if (item.kind === 'measure-area') {
          // A translucent fill would need an ExtGState object of its own; a fill mixed
          // toward white reads the same on paper and carries nothing extra.
          parts.push(`q ${rgb(lighten(item.color))} rg`);
          parts.push(
            points
              .map((point, index) => `${num(map.x(point.x))} ${num(map.y(point.y))} ${index === 0 ? 'm' : 'l'}`)
              .join('\n') + '\nh f',
          );
          parts.push('Q');
          parts.push(`q ${color} RG ${num(width)} w`);
          parts.push(
            points
              .map((point, index) => `${num(map.x(point.x))} ${num(map.y(point.y))} ${index === 0 ? 'm' : 'l'}`)
              .join('\n') + '\nh S',
          );
          parts.push('Q');
        } else {
          parts.push(`q ${color} RG ${num(width)} w`);
          parts.push(
            points
              .map((point, index) => `${num(map.x(point.x))} ${num(map.y(point.y))} ${index === 0 ? 'm' : 'l'}`)
              .join('\n') + '\nS',
          );
          parts.push('Q');
        }
        needsFont = true;
        parts.push(labelOperators(map, points, item, userUnit, unit, color, x1, y1, x2, y2));
        break;
      }
      case 'stamp': {
        if (!item.rect) break;
        const [x1, y1, x2, y2] = map.rect(item.rect);
        const word = (item.stampLabel ?? '').slice(0, 24);
        const border = Math.max(1, width);
        parts.push(`q ${color} RG ${num(border)} w`);
        parts.push(`${num(x1)} ${num(y1)} ${num(x2 - x1)} ${num(y2 - y1)} re S`);
        const inset = border * 1.8;
        parts.push(
          `${num(x1 + inset)} ${num(y1 + inset)} ${num(x2 - x1 - inset * 2)} ` +
            `${num(y2 - y1 - inset * 2)} re S`,
        );
        parts.push('Q');
        if (word !== '') {
          needsFont = true;
          // Fitted to the box rather than fixed: a long word must not spill outside
          // the border it is meant to sit inside.
          const size = Math.max(
            4,
            Math.min((y2 - y1) * 0.42, ((x2 - x1) * 0.82) / Math.max(1, word.length * 0.62)),
          );
          const textWidth = word.length * size * 0.62;
          parts.push(
            textOperators(
              word.toUpperCase(),
              (x1 + x2) / 2 - textWidth / 2,
              (y1 + y2) / 2 - size * 0.36,
              size,
              color,
            ),
          );
        }
        break;
      }
      case 'textbox':
      case 'callout':
      case 'note': {
        if (!item.note || item.note.trim() === '') break;
        const area = item.rect;
        if (!area) break;
        const [x1, y1, x2, y2] = map.rect(area);
        const size = Math.max(4, item.fontSize ?? 12);
        needsFont = true;
        parts.push(
          `q ${color} RG ${num(Math.max(0.5, width * 0.6))} w ${num(x1)} ${num(y1)} ` +
            `${num(x2 - x1)} ${num(y2 - y1)} re S Q`,
        );
        parts.push(textOperators(item.note, x1 + 2, y2 - size, size, color));
        break;
      }
      default:
        break;
    }
  }

  parts.push('Q');
  return { operators: parts.filter((part) => part !== '').join('\n'), needsFont };
}

function boundsOf(points: readonly AnnotPoint[], map: Map2Pdf): [number, number, number, number] {
  const xs = points.map((p) => map.x(p.x));
  const ys = points.map((p) => map.y(p.y));
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

/** Multi-line text at a baseline point, in the page's own colour. */
function textOperators(text: string, x: number, y: number, size: number, color: string): string {
  const lines = text.split('\n').slice(0, 60);
  const body = lines.map((line) => `${literal(line)} Tj T*`).join('\n');
  return `q ${color} rg BT /Helv ${num(size)} Tf ${num(size * 1.25)} TL ${num(x)} ${num(y)} Td\n${body}\nET Q`;
}

/** A measurement's value, placed at the midpoint of the shape it measures. */
function labelOperators(
  map: Map2Pdf,
  points: readonly AnnotPoint[],
  item: FlattenInput,
  userUnit: number,
  unit: MeasureUnit,
  color: string,
  x1?: number,
  y1?: number,
  x2?: number,
  y2?: number,
): string {
  const value = measureValue(item, points, userUnit, unit);
  if (value === '') return '';
  const bounds = x1 !== undefined && y1 !== undefined && x2 !== undefined && y2 !== undefined
    ? [x1, y1, x2, y2] as const
    : boundsOf(points, map);
  const size = 9;
  const cx = (bounds[0] + bounds[2]) / 2;
  const cy = (bounds[1] + bounds[3]) / 2;
  return textOperators(value, cx - value.length * size * 0.25, cy - size * 0.35, size, color);
}

function measureValue(
  item: FlattenInput,
  points: readonly AnnotPoint[],
  userUnit: number,
  unit: MeasureUnit,
): string {
  if (item.kind === 'measure-distance') {
    const [a, b] = points;
    return a && b ? formatLength(distance(a, b), userUnit, unit) : '';
  }
  if (item.kind === 'measure-perimeter') {
    // A perimeter closes the outline, so the last side back to the first counts.
    const first = points[0];
    const last = points[points.length - 1];
    const closing = first && last ? distance(last, first) : 0;
    return formatLength(polylineLength(points) + closing, userUnit, unit);
  }
  if (item.kind === 'measure-area') return formatArea(polygonArea(points), userUnit, unit);
  return '';
}

export { MEASURE_KINDS, TEXT_KINDS };
