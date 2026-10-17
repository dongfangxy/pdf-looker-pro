/**
 * Settings dialog.
 *
 * Unlike the About and Properties dialogs, which present read-only text, Settings
 * hosts live controls. It is described by a small field list so the caller owns the
 * available options while this module owns only the rendering and the result.
 */
import type { I18n } from '../i18n/i18n.js';

export interface SettingsOption {
  value: string;
  label: string;
}

export interface SettingsField {
  key: string;
  kind: 'select' | 'toggle' | 'text';
  label: string;
  hint?: string;
  /** Shown inside an empty text field. */
  placeholder?: string;
  value: string | boolean;
  options?: SettingsOption[];
}

export type SettingsValues = Record<string, string | boolean>;

export interface SettingsDialogOptions {
  title: string;
  confirm: string;
  cancel: string;
  reset: string;
  /** Returns the field list restored to defaults; the dialog re-renders in place. */
  onReset(): SettingsField[];
}

export function showSettingsDialog(
  i18n: I18n,
  fields: SettingsField[],
  options: SettingsDialogOptions,
): Promise<SettingsValues | null> {
  void i18n;
  return new Promise((resolve) => {
    let current = fields;
    let settled = false;

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';

    const box = document.createElement('div');
    box.className = 'modal modal-settings';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');

    const title = document.createElement('div');
    title.className = 'modal-title';
    title.textContent = options.title;
    box.appendChild(title);

    const body = document.createElement('div');
    body.className = 'modal-body settings-body';
    box.appendChild(body);

    const readValues = (): SettingsValues => {
      const values: SettingsValues = {};
      for (const field of current) {
        const input = body.querySelector<HTMLInputElement | HTMLSelectElement>(`[data-key="${field.key}"]`);
        if (!input) continue;
        values[field.key] = input instanceof HTMLInputElement && input.type === 'checkbox' ? input.checked : input.value;
      }
      return values;
    };

    const render = (): void => {
      body.replaceChildren();
      for (const field of current) {
        const row = document.createElement('label');
        row.className = 'settings-row';

        const text = document.createElement('div');
        text.className = 'settings-label';
        const name = document.createElement('span');
        name.className = 'settings-name';
        name.textContent = field.label;
        text.appendChild(name);
        if (field.hint) {
          const hint = document.createElement('span');
          hint.className = 'settings-hint';
          hint.textContent = field.hint;
          text.appendChild(hint);
        }
        row.appendChild(text);

        if (field.kind === 'toggle') {
          const input = document.createElement('input');
          input.type = 'checkbox';
          input.className = 'settings-toggle';
          input.dataset['key'] = field.key;
          input.checked = field.value === true;
          row.appendChild(input);
        } else if (field.kind === 'text') {
          const input = document.createElement('input');
          input.type = 'text';
          input.className = 'settings-text';
          input.dataset['key'] = field.key;
          input.value = String(field.value ?? '');
          input.placeholder = field.placeholder ?? '';
          row.appendChild(input);
        } else {
          const select = document.createElement('select');
          select.className = 'settings-select';
          select.dataset['key'] = field.key;
          for (const option of field.options ?? []) {
            const node = document.createElement('option');
            node.value = option.value;
            node.textContent = option.label;
            select.appendChild(node);
          }
          select.value = String(field.value);
          row.appendChild(select);
        }
        body.appendChild(row);
      }
    };

    render();

    const footer = document.createElement('div');
    footer.className = 'modal-footer';

    const reset = document.createElement('button');
    reset.type = 'button';
    reset.className = 'btn modal-reset';
    reset.textContent = options.reset;
    reset.addEventListener('click', () => {
      current = options.onReset();
      render();
    });

    const spacer = document.createElement('span');
    spacer.className = 'modal-spacer';

    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'btn modal-cancel';
    cancel.textContent = options.cancel;

    const confirm = document.createElement('button');
    confirm.type = 'button';
    confirm.className = 'btn primary modal-confirm';
    confirm.textContent = options.confirm;

    footer.append(reset, spacer, cancel, confirm);
    box.appendChild(footer);
    overlay.appendChild(box);

    const finish = (value: SettingsValues | null): void => {
      if (settled) return;
      settled = true;
      document.removeEventListener('keydown', onKey, true);
      overlay.remove();
      resolve(value);
    };

    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        finish(null);
      } else if (event.key === 'Enter' && event.ctrlKey) {
        event.preventDefault();
        finish(readValues());
      }
    };

    confirm.addEventListener('click', () => finish(readValues()));
    cancel.addEventListener('click', () => finish(null));
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) finish(null);
    });
    document.addEventListener('keydown', onKey, true);

    document.body.appendChild(overlay);
    body.querySelector<HTMLElement>('select, input')?.focus();
  });
}
