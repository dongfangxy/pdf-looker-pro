/**
 * Language registry.
 *
 * Holds every loaded pack, resolves lookups through a fallback chain, and notifies
 * listeners when the active language changes so the UI can re-render without a
 * reload.
 *
 * Resolution order for any lookup:
 *   active pack -> default pack -> the caller-supplied fallback
 *
 * Nothing here throws on a missing key: an absent string degrades to the fallback
 * (or the key itself) rather than blanking the interface.
 */
import type { CommandRecord, DialogRecord, LanguagePack, ResolvedCommand } from './types.js';
import { assertValidLanguagePack } from './validate.js';

export type I18nListener = (languageId: string) => void;

interface SlotSource {
  title: string;
  tooltip: string;
  status: string;
  short: string;
}

const SLOTS = ['title', 'tooltip', 'status', 'short'] as const;

export class I18n {
  private readonly packs = new Map<string, LanguagePack>();
  private readonly listeners = new Set<I18nListener>();
  private activeId = '';
  private defaultId = '';

  /** Loads and validates a pack. Returns the resulting language list. */
  addPack(input: unknown, options: { makeDefault?: boolean } = {}): LanguagePack {
    assertValidLanguagePack(input);
    const pack = input;
    this.packs.set(pack.meta.id, pack);
    if (options.makeDefault === true || this.defaultId === '') this.defaultId = pack.meta.id;
    if (this.activeId === '') this.activeId = pack.meta.id;
    return pack;
  }

  /** True when the requested language exists and became active. */
  setLanguage(id: string): boolean {
    if (!this.packs.has(id)) return false;
    if (id === this.activeId) return true;
    this.activeId = id;
    for (const listener of this.listeners) listener(id);
    return true;
  }

  onChange(listener: I18nListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  get languageId(): string {
    return this.activeId;
  }

  get defaultLanguageId(): string {
    return this.defaultId;
  }

  get languages(): { id: string; name: string; nativeName: string }[] {
    return [...this.packs.values()].map((p) => ({
      id: p.meta.id,
      name: p.meta.name,
      nativeName: p.meta.nativeName,
    }));
  }

  private pack(id: string): LanguagePack | undefined {
    return this.packs.get(id);
  }

  private active(): LanguagePack | undefined {
    return this.pack(this.activeId);
  }

  private fallback(): LanguagePack | undefined {
    return this.pack(this.defaultId);
  }

  // ------------------------------------------------------------- strings

  /** General UI string from the `strings` section. */
  t(key: string, fallback = ''): string {
    const hit = this.active()?.strings[key];
    if (typeof hit === 'string') return hit;
    const back = this.fallback()?.strings[key];
    if (typeof back === 'string') return back;
    return fallback !== '' ? fallback : key;
  }

  // ------------------------------------------------------------ commands

  /** Raw command record from the active pack, if present. */
  command(id: number | string): CommandRecord | undefined {
    const key = String(id);
    return this.active()?.commands[key] ?? this.fallback()?.commands[key];
  }

  /**
   * A command with every slot filled, recording which language each slot came from.
   * Used by the UI to label controls and by tests to prove fallback behaviour.
   */
  resolveCommand(id: number | string): ResolvedCommand | null {
    const key = String(id);
    const primary = this.active();
    const back = this.fallback();
    const primaryRec = primary?.commands[key];
    const backRec = back?.commands[key];
    if (!primaryRec && !backRec) return null;

    const sources: SlotSource = { title: '', tooltip: '', status: '', short: '' };
    const values: Record<(typeof SLOTS)[number], string> = { title: '', tooltip: '', status: '', short: '' };

    for (const slot of SLOTS) {
      const fromPrimary = primaryRec?.[slot];
      if (typeof fromPrimary === 'string' && fromPrimary.length > 0) {
        values[slot] = fromPrimary;
        sources[slot] = primary?.meta.id ?? '';
        continue;
      }
      const fromBack = backRec?.[slot];
      if (typeof fromBack === 'string' && fromBack.length > 0) {
        values[slot] = fromBack;
        sources[slot] = back?.meta.id ?? '';
      }
    }

    // Slot degradation: tooltip falls back to title, short falls back to title.
    if (values.tooltip === '') {
      values.tooltip = values.title;
      sources.tooltip = sources.title;
    }
    if (values.short === '') {
      values.short = values.title;
      sources.short = sources.title;
    }
    if (values.status === '') sources.status = '';

    return { id: key, ...values, sources };
  }

  // ------------------------------------------------------------- dialogs

  dialog(id: number | string): DialogRecord | undefined {
    const key = String(id);
    return this.active()?.dialogs[key] ?? this.fallback()?.dialogs[key];
  }

  /** Caption of a dialog, with a fallback chain. */
  dialogTitle(id: number | string, fallback = ''): string {
    const rec = this.dialog(id);
    if (rec && rec.text.length > 0) return rec.text;
    const back = this.fallback()?.dialogs[String(id)];
    if (back && back.text.length > 0) return back.text;
    return fallback !== '' ? fallback : `#${String(id)}`;
  }

  /**
   * Text for one control inside a dialog, addressed by the dialog id and the
   * control id — the same indirection the analysed design uses, which keeps control
   * identity independent of layout.
   */
  dialogItem(dialogId: number | string, itemId: number | string, fallback = ''): string {
    const key = String(dialogId);
    const itemKey = String(itemId);
    const find = (rec: DialogRecord | undefined): string | undefined => {
      const item = rec?.items.find((entry) => entry.id === itemKey);
      return item?.text;
    };
    const primary = find(this.dialog(key));
    if (primary !== undefined && primary !== '') return primary;
    const back = find(this.fallback()?.dialogs[key]);
    if (back !== undefined && back !== '') return back;
    return fallback !== '' ? fallback : `#${itemKey}`;
  }

  /** Tooltip for a dialog control, falling back to its text. */
  dialogItemTooltip(dialogId: number | string, itemId: number | string): string {
    const key = String(dialogId);
    const itemKey = String(itemId);
    const find = (rec: DialogRecord | undefined): string | undefined =>
      rec?.items.find((entry) => entry.id === itemKey)?.tooltip;
    const primary = find(this.dialog(key));
    if (typeof primary === 'string' && primary.length > 0) return primary;
    const back = find(this.fallback()?.dialogs[key]);
    if (typeof back === 'string' && back.length > 0) return back;
    return this.dialogItem(key, itemKey);
  }

  /** Coverage summary, used by the language picker and the verification run. */
  coverage(id = this.activeId): { commands: number; dialogs: number; strings: number; missing: string[] } {
    const pack = this.pack(id);
    const back = this.fallback();
    if (!pack) return { commands: 0, dialogs: 0, strings: 0, missing: [] };
    const missing: string[] = [];
    let commands = 0;
    let dialogs = 0;
    let strings = 0;

    for (const key of Object.keys(back?.commands ?? {})) {
      if (pack.commands[key]) commands++;
      else missing.push(`commands/${key}`);
    }
    for (const key of Object.keys(back?.dialogs ?? {})) {
      if (pack.dialogs[key]) dialogs++;
      else missing.push(`dialogs/${key}`);
    }
    for (const key of Object.keys(back?.strings ?? {})) {
      if (typeof pack.strings[key] === 'string') strings++;
      else missing.push(`strings/${key}`);
    }
    return { commands, dialogs, strings, missing };
  }
}
