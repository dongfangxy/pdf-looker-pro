/**
 * Measurement geometry and unit conversion.
 *
 * PDF user space is measured in points, where 72 points is one inch. A page may also
 * declare a `/UserUnit` that rescales its own coordinate system (used by large-format
 * drawings), so every conversion multiplies by it before converting to a display unit.
 *
 * Nothing here touches the DOM: the annotation layer supplies page-space geometry and
 * this module turns it into a number and a string.
 */

export const POINTS_PER_INCH = 72;
export const MM_PER_INCH = 25.4;
/** One point in millimetres (0.3527…). */
export const MM_PER_POINT = MM_PER_INCH / POINTS_PER_INCH;

export type MeasureUnit = 'mm' | 'cm' | 'in' | 'pt';

export interface MeasurePoint {
  x: number;
  y: number;
}

/** Euclidean distance between two page-space points. */
export function distance(a: MeasurePoint, b: MeasurePoint): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** Total length of an open polyline. */
export function polylineLength(points: readonly MeasurePoint[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const previous = points[i - 1];
    const current = points[i];
    if (previous && current) total += distance(previous, current);
  }
  return total;
}

/** Close the polyline and compute its enclosed area by the shoelace formula. */
export function polygonArea(points: readonly MeasurePoint[]): number {
  if (points.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    if (a && b) sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

/** Converts a page-space length to the chosen display unit. */
export function toDisplayLength(points: number, userUnit: number, unit: MeasureUnit): number {
  const scaled = points * userUnit;
  switch (unit) {
    case 'mm':
      return scaled * MM_PER_POINT;
    case 'cm':
      return (scaled * MM_PER_POINT) / 10;
    case 'in':
      return scaled / POINTS_PER_INCH;
    default:
      return scaled;
  }
}

/** Converts a page-space area to the chosen display unit, squared. */
export function toDisplayArea(pointsSquared: number, userUnit: number, unit: MeasureUnit): number {
  const factor = toDisplayLength(1, userUnit, unit);
  return pointsSquared * factor * factor;
}

function trim(value: number, digits: number): string {
  const fixed = value.toFixed(digits);
  // Drop trailing zeros so "12.00 mm" reads as "12 mm".
  return fixed.replace(/\.?0+$/, '');
}

/** Formats a length with a precision that suits its magnitude. */
export function formatLength(points: number, userUnit: number, unit: MeasureUnit): string {
  const value = toDisplayLength(points, userUnit, unit);
  const digits = Math.abs(value) >= 100 ? 1 : Math.abs(value) >= 10 ? 2 : 3;
  return `${trim(value, digits)} ${unit}`;
}

/** Formats an area; the unit is squared. */
export function formatArea(pointsSquared: number, userUnit: number, unit: MeasureUnit): string {
  const value = toDisplayArea(pointsSquared, userUnit, unit);
  const digits = Math.abs(value) >= 1000 ? 0 : Math.abs(value) >= 100 ? 1 : 2;
  return `${trim(value, digits)} ${unit}²`;
}

/**
 * Reads the page's `/UserUnit`.
 *
 * pdf.js exposes it on the page proxy; a missing or nonsensical value falls back to
 * 1, which is what the specification says an absent entry means.
 */
export function readUserUnit(page: { userUnit?: number } | null | undefined): number {
  const value = page?.userUnit;
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 1;
}
