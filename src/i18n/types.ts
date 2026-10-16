/**
 * Language-pack data model.
 *
 * The shape follows a three-section layout plus a per-command four-slot record.
 * That structure is a design input taken from the REA reverse-engineering findings
 * (see `docs/design-notes.md`); the types, loader and validation here are written
 * from scratch and share no code or text with the analysed product.
 *
 *   commands   a numeric command id -> { title, tooltip, status, short }
 *   dialogs    a dialog id -> caption plus per-control text, addressed by control id
 *   strings    general UI strings addressed by key
 */

/** The four presentations of one command. `title` is mandatory; the rest degrade. */
export interface CommandRecord {
  /** Full label, used where there is room (menus, dialog buttons). */
  title: string;
  /** Hover text; falls back to `title`. */
  tooltip?: string;
  /** Description shown in the status bar while the command is hovered. */
  status?: string;
  /** Compact label for toolbars; falls back to `title`. */
  short?: string;
}

export interface DialogItemRecord {
  id: string;
  text: string;
  tooltip?: string;
}

export interface DialogRecord {
  id: string;
  text: string;
  items: DialogItemRecord[];
}

export interface LanguageMeta {
  /** Stable identifier used for switching, e.g. `zh-CN`. */
  id: string;
  /** English name shown in pickers. */
  name: string;
  /** Name in the language itself. */
  nativeName: string;
  /** Optional locale identifier, kept for parity with platform conventions. */
  lcid?: string;
}

export interface LanguagePack {
  meta: LanguageMeta;
  commands: Record<string, CommandRecord>;
  dialogs: Record<string, DialogRecord>;
  strings: Record<string, string>;
}

export const SECTIONS = ['commands', 'dialogs', 'strings'] as const;
export type SectionName = (typeof SECTIONS)[number];

export interface ValidationIssue {
  /** Slash-separated path into the pack, e.g. `/commands/1020/title`. */
  path: string;
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  issues: ValidationIssue[];
}

/** How a command's slots resolved, for diagnostics and tests. */
export interface ResolvedCommand {
  id: string;
  title: string;
  tooltip: string;
  status: string;
  short: string;
  /** Which language each slot ultimately came from. */
  sources: { title: string; tooltip: string; status: string; short: string };
}
