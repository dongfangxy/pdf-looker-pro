/**
 * Annotation style presets.
 *
 * A style is a named combination of kind, colour and text size. Presets are **global**
 * rather than per document, because a reader's preferences about how a highlight looks
 * do not change from one file to the next.
 *
 * Built-in presets are generated from the model's defaults instead of being persisted,
 * so their names stay in the active language and they cannot drift from the code.
 */
import { ANNOT_KINDS, DEFAULT_COLORS, type AnnotKind } from './model.js';

export interface AnnotationStyle {
  id: string;
  name: string;
  kind: AnnotKind;
  color: string;
  /** Page-space text size, for the kinds that carry text. */
  fontSize?: number;
  /** Built-ins cannot be renamed or deleted. */
  builtin: boolean;
}

/** One built-in preset per kind, named through the caller's language pack. */
export function builtinStyles(nameFor: (kind: AnnotKind) => string): AnnotationStyle[] {
  return ANNOT_KINDS.map((kind) => ({
    id: `builtin:${kind}`,
    name: nameFor(kind),
    kind,
    color: DEFAULT_COLORS[kind],
    fontSize: 12,
    builtin: true,
  }));
}

let counter = 0;

export class StyleStore {
  private items: AnnotationStyle[] = [];
  private listeners = new Set<() => void>();

  get all(): readonly AnnotationStyle[] {
    return this.items;
  }

  get count(): number {
    return this.items.length;
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }

  byId(id: string): AnnotationStyle | null {
    return this.items.find((s) => s.id === id) ?? null;
  }

  /** Replaces the stored presets from persisted data; returns what was rejected. */
  load(raw: unknown): string[] {
    const issues: string[] = [];
    if (!Array.isArray(raw)) {
      this.items = [];
      return issues;
    }
    const accepted: AnnotationStyle[] = [];
    raw.forEach((entry, index) => {
      if (!entry || typeof entry !== 'object') {
        issues.push(`[${index}] 不是对象`);
        return;
      }
      const s = entry as Record<string, unknown>;
      const kind = s['kind'];
      if (typeof kind !== 'string' || !(ANNOT_KINDS as readonly string[]).includes(kind)) {
        issues.push(`[${index}].kind 未知: ${String(kind)}`);
        return;
      }
      if (typeof s['name'] !== 'string' || s['name'].trim().length === 0) {
        issues.push(`[${index}].name 为空`);
        return;
      }
      accepted.push({
        id: typeof s['id'] === 'string' && s['id'].length > 0 ? s['id'] : this.nextId(),
        name: s['name'].slice(0, 60),
        kind: kind as AnnotKind,
        color: typeof s['color'] === 'string' ? s['color'] : DEFAULT_COLORS[kind as AnnotKind],
        fontSize: typeof s['fontSize'] === 'number' && s['fontSize'] > 0 ? s['fontSize'] : 12,
        builtin: false,
      });
    });
    this.items = accepted;
    this.emit();
    return issues;
  }

  private nextId(): string {
    counter += 1;
    return `style${Date.now().toString(36)}${counter.toString(36)}`;
  }

  add(name: string, kind: AnnotKind, color: string, fontSize = 12): AnnotationStyle {
    const style: AnnotationStyle = {
      id: this.nextId(),
      name: name.trim().slice(0, 60) || kind,
      kind,
      color,
      fontSize,
      builtin: false,
    };
    this.items.push(style);
    this.emit();
    return style;
  }

  rename(id: string, name: string): boolean {
    const style = this.items.find((s) => s.id === id);
    if (!style || name.trim().length === 0) return false;
    style.name = name.trim().slice(0, 60);
    this.emit();
    return true;
  }

  remove(id: string): boolean {
    const before = this.items.length;
    this.items = this.items.filter((s) => s.id !== id);
    if (this.items.length === before) return false;
    this.emit();
    return true;
  }

  clear(): void {
    if (this.items.length === 0) return;
    this.items = [];
    this.emit();
  }

  toJSON(): AnnotationStyle[] {
    return this.items.map((s) => ({ ...s, builtin: false }));
  }
}
