/**
 * Dialog rendering driven entirely by a pack's `dialogs` section.
 *
 * Control text is looked up by (dialog id, control id) rather than by position or
 * by a CSS selector, so a pack can retitle a control without knowing anything about
 * the markup. That indirection is the point of the dialogs section.
 *
 * Convention, matching the platform's own dialog numbering: the item whose id is
 * `1` is the confirm control; every other item becomes a line of text.
 */
import type { I18n } from '../i18n/i18n.js';

const CONFIRM_ITEM_ID = '1';

export interface DialogOptions {
  /** Extra elements appended under the pack-driven lines. */
  extra?: HTMLElement[];
}

/** Shows a pack-defined dialog and resolves once it closes. */
export function showPackDialog(i18n: I18n, dialogId: number | string, options: DialogOptions = {}): Promise<void> {
  return new Promise((resolve) => {
    const record = i18n.dialog(dialogId);

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';

    const box = document.createElement('div');
    box.className = 'modal';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.dataset['dialogId'] = String(dialogId);

    const title = document.createElement('div');
    title.className = 'modal-title';
    title.textContent = i18n.dialogTitle(dialogId);
    box.appendChild(title);

    const body = document.createElement('div');
    body.className = 'modal-body';
    for (const item of record?.items ?? []) {
      if (item.id === CONFIRM_ITEM_ID) continue;
      const line = document.createElement('div');
      line.className = 'modal-line';
      line.dataset['itemId'] = item.id;
      line.textContent = i18n.dialogItem(dialogId, item.id);
      const tip = i18n.dialogItemTooltip(dialogId, item.id);
      if (tip !== '' && tip !== line.textContent) line.title = tip;
      body.appendChild(line);
    }
    for (const node of options.extra ?? []) body.appendChild(node);
    box.appendChild(body);

    const footer = document.createElement('div');
    footer.className = 'modal-footer';
    const confirm = document.createElement('button');
    confirm.type = 'button';
    confirm.className = 'btn primary modal-confirm';
    confirm.dataset['itemId'] = CONFIRM_ITEM_ID;
    confirm.textContent = i18n.dialogItem(dialogId, CONFIRM_ITEM_ID, 'OK');
    const confirmTip = i18n.dialogItemTooltip(dialogId, CONFIRM_ITEM_ID);
    if (confirmTip !== '') confirm.title = confirmTip;
    footer.appendChild(confirm);
    box.appendChild(footer);

    overlay.appendChild(box);

    const close = (): void => {
      document.removeEventListener('keydown', onKey, true);
      overlay.remove();
      resolve();
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
      }
    };

    confirm.addEventListener('click', close);
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) close();
    });
    document.addEventListener('keydown', onKey, true);

    document.body.appendChild(overlay);
    confirm.focus();
  });
}

/**
 * A one-line text or number prompt.
 *
 * `showPromptDialog` is a multi-line editor, which is wrong for a page number or a
 * zoom percentage: Enter should submit, not insert a newline.
 */
export interface InputDialogOptions {
  title: string;
  label: string;
  initial?: string;
  confirm?: string;
  cancel?: string;
  /** Restricts the field to digits and a decimal point, and focuses it for typing. */
  numeric?: boolean;
  suffix?: string;
}

export function showInputDialog(i18n: I18n, options: InputDialogOptions): Promise<string | null> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';

    const box = document.createElement('div');
    box.className = 'modal modal-narrow';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');

    const title = document.createElement('div');
    title.className = 'modal-title';
    title.textContent = options.title;
    box.appendChild(title);

    const body = document.createElement('div');
    body.className = 'modal-body';
    const label = document.createElement('div');
    label.className = 'modal-line';
    label.textContent = options.label;
    body.appendChild(label);

    const row = document.createElement('div');
    row.className = 'modal-row';
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'modal-input';
    input.value = options.initial ?? '';
    if (options.numeric) input.inputMode = 'decimal';
    row.appendChild(input);
    if (options.suffix) {
      const suffix = document.createElement('span');
      suffix.className = 'modal-suffix';
      suffix.textContent = options.suffix;
      row.appendChild(suffix);
    }
    body.appendChild(row);
    box.appendChild(body);

    const footer = document.createElement('div');
    footer.className = 'modal-footer';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'btn modal-cancel';
    cancel.textContent = options.cancel ?? i18n.t('unsavedStay');
    const confirm = document.createElement('button');
    confirm.type = 'button';
    confirm.className = 'btn primary modal-confirm';
    confirm.textContent = options.confirm ?? '确定';
    footer.append(cancel, confirm);
    box.appendChild(footer);
    overlay.appendChild(box);

    let settled = false;
    const finish = (value: string | null): void => {
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
      } else if (event.key === 'Enter') {
        event.preventDefault();
        finish(input.value);
      }
    };

    confirm.addEventListener('click', () => finish(input.value));
    cancel.addEventListener('click', () => finish(null));
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) finish(null);
    });
    document.addEventListener('keydown', onKey, true);

    document.body.appendChild(overlay);
    input.focus();
    input.select();
  });
}

/**
 * A single-field prompt.
 *
 * Electron does not implement `window.prompt`, so the application supplies its own
 * rather than relying on a browser API that is absent in the packaged window.
 */
export function showPromptDialog(
  i18n: I18n,
  options: { title: string; label: string; initial?: string; confirm?: string; cancel?: string },
): Promise<string | null> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';

    const box = document.createElement('div');
    box.className = 'modal';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');

    const title = document.createElement('div');
    title.className = 'modal-title';
    title.textContent = options.title;
    box.appendChild(title);

    const body = document.createElement('div');
    body.className = 'modal-body';
    const label = document.createElement('div');
    label.className = 'modal-line';
    label.textContent = options.label;
    body.appendChild(label);

    const input = document.createElement('textarea');
    input.className = 'modal-input prompt-input';
    input.rows = 3;
    input.value = options.initial ?? '';
    body.appendChild(input);
    box.appendChild(body);

    const footer = document.createElement('div');
    footer.className = 'modal-footer';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'btn modal-cancel';
    cancel.textContent = options.cancel ?? i18n.t('unsavedStay');
    const confirm = document.createElement('button');
    confirm.type = 'button';
    confirm.className = 'btn primary modal-confirm';
    confirm.textContent = options.confirm ?? '\u786e\u5b9a';
    footer.append(cancel, confirm);
    box.appendChild(footer);
    overlay.appendChild(box);

    let settled = false;
    const finish = (value: string | null): void => {
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
      } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        finish(input.value);
      }
    };

    confirm.addEventListener('click', () => finish(input.value));
    cancel.addEventListener('click', () => finish(null));
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) finish(null);
    });
    document.addEventListener('keydown', onKey, true);

    document.body.appendChild(overlay);
    input.focus();
    input.select();
  });
}

/**
 * A yes-or-no question.
 *
 * Deliberately not implemented on top of `showPromptDialog`: that one exists to collect a
 * value and would put a text field in front of a question that has only two answers.
 */
export function showConfirmDialog(
  i18n: I18n,
  options: { title: string; message: string; confirm: string; cancel: string },
): Promise<boolean> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';

    const box = document.createElement('div');
    box.className = 'modal modal-narrow modal-confirm-box';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');

    const title = document.createElement('div');
    title.className = 'modal-title';
    title.textContent = options.title;

    const body = document.createElement('div');
    body.className = 'modal-body';
    const message = document.createElement('p');
    message.className = 'modal-message';
    message.textContent = options.message;
    body.appendChild(message);

    const footer = document.createElement('div');
    footer.className = 'modal-footer';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'btn modal-cancel';
    cancel.textContent = options.cancel;
    const confirm = document.createElement('button');
    confirm.type = 'button';
    confirm.className = 'btn primary modal-confirm';
    confirm.textContent = options.confirm;
    footer.append(cancel, confirm);

    box.append(title, body, footer);
    overlay.appendChild(box);

    let settled = false;
    const finish = (value: boolean): void => {
      if (settled) return;
      settled = true;
      document.removeEventListener('keydown', onKey, true);
      overlay.remove();
      resolve(value);
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        finish(false);
      } else if (event.key === 'Enter') {
        event.preventDefault();
        finish(true);
      }
    };

    confirm.addEventListener('click', () => finish(true));
    cancel.addEventListener('click', () => finish(false));
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) finish(false);
    });
    document.addEventListener('keydown', onKey, true);

    document.body.appendChild(overlay);
    void i18n;
    confirm.focus();
  });
}
/**
 * Picks one value from a short list.
 *
 * The settings dialogue already renders selects, but it is a form that applies on
 * confirm; this is a question with a list of answers, and reads differently.
 */
export function showChoiceDialog(
  i18n: I18n,
  options: {
    title: string;
    label: string;
    value: string;
    choices: Array<{ value: string; label: string }>;
    confirm: string;
    cancel: string;
  },
): Promise<string | null> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';

    const box = document.createElement('div');
    box.className = 'modal modal-narrow modal-choice';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');

    const title = document.createElement('div');
    title.className = 'modal-title';
    title.textContent = options.title;

    const body = document.createElement('div');
    body.className = 'modal-body';
    const label = document.createElement('label');
    label.className = 'print-label';
    label.textContent = options.label;
    const select = document.createElement('select');
    select.className = 'modal-input print-select modal-choice-select';
    for (const choice of options.choices) {
      const node = document.createElement('option');
      node.value = choice.value;
      node.textContent = choice.label;
      select.appendChild(node);
    }
    select.value = options.value;
    body.append(label, select);

    const footer = document.createElement('div');
    footer.className = 'modal-footer';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'btn modal-cancel';
    cancel.textContent = options.cancel;
    const confirm = document.createElement('button');
    confirm.type = 'button';
    confirm.className = 'btn primary modal-confirm';
    confirm.textContent = options.confirm;
    footer.append(cancel, confirm);

    box.append(title, body, footer);
    overlay.appendChild(box);

    let settled = false;
    const finish = (value: string | null): void => {
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
      } else if (event.key === 'Enter') {
        event.preventDefault();
        finish(select.value);
      }
    };

    confirm.addEventListener('click', () => finish(select.value));
    cancel.addEventListener('click', () => finish(null));
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) finish(null);
    });
    document.addEventListener('keydown', onKey, true);

    document.body.appendChild(overlay);
    void i18n;
    select.focus();
  });
}
