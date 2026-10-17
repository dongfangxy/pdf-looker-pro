/**
 * Page-operation dialogue.
 *
 * One module for the four operations that take a page selection, because they differ
 * only in which extra fields they need. A range string is used rather than thumbnail
 * multi-select: it is the same grammar the print dialogue already offers, it is
 * keyboard-friendly, and it makes `1-3, 7` reachable without hunting through pages.
 */
import type { I18n } from '../i18n/i18n.js';

export type PageOperation = 'delete' | 'rotate' | 'insert' | 'extract' | 'crop';

export interface PageOpsResult {
  /** Range as typed (`all` returns the full range when the caller expands it). */
  rangeText: string;
  /** Rotation in degrees, for `rotate`. */
  angle: number;
  /** Repeat count, for `insert`. */
  count: number;
  /** Paper size for an inserted page, in points. */
  width: number;
  height: number;
  /** Margins in points, for `crop`. */
  margins: { top: number; right: number; bottom: number; left: number };
}

export function showPageOpsDialog(
  i18n: I18n,
  options: { operation: PageOperation; pageCount: number; currentPage: number },
): Promise<PageOpsResult | null> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';

    const box = document.createElement('div');
    box.className = 'modal modal-pageops';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');

    const title = document.createElement('div');
    title.className = 'modal-title';
    title.textContent = i18n.t(`pageOps${capitalise(options.operation)}`);
    box.appendChild(title);

    const body = document.createElement('div');
    body.className = 'modal-body';

    const summary = document.createElement('div');
    summary.className = 'print-summary';
    summary.textContent = i18n.t('printPageCount').replace('{n}', String(options.pageCount));
    body.appendChild(summary);

    // ---- range ----
    const rangeRow = document.createElement('div');
    rangeRow.className = 'print-row';
    const rangeLabel = document.createElement('label');
    rangeLabel.className = 'print-label';
    rangeLabel.textContent = i18n.t('pageOpsRange');
    rangeRow.appendChild(rangeLabel);
    const rangeInput = document.createElement('input');
    rangeInput.type = 'text';
    rangeInput.className = 'modal-input print-range-input';
    rangeInput.value = String(options.currentPage);
    rangeInput.placeholder = i18n.t('printRangeHint');
    rangeRow.appendChild(rangeInput);
    body.appendChild(rangeRow);

    // ---- rotation ----
    let angleSelect: HTMLSelectElement | null = null;
    if (options.operation === 'rotate') {
      const row = document.createElement('div');
      row.className = 'print-row';
      const label = document.createElement('label');
      label.className = 'print-label';
      label.textContent = i18n.t('pageOpsAngle');
      row.appendChild(label);
      angleSelect = document.createElement('select');
      angleSelect.className = 'modal-input print-select';
      for (const [value, text] of [
        ['90', i18n.t('pageOpsAngle90')],
        ['180', i18n.t('pageOpsAngle180')],
        ['270', i18n.t('pageOpsAngle270')],
      ] as const) {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = text;
        angleSelect.appendChild(option);
      }
      row.appendChild(angleSelect);
      body.appendChild(row);
    }

    // ---- insert extras ----
    let countInput: HTMLInputElement | null = null;
    let widthInput: HTMLInputElement | null = null;
    let heightInput: HTMLInputElement | null = null;
    if (options.operation === 'insert') {
      rangeLabel.textContent = i18n.t('pageOpsInsertAt');
      rangeRow.remove();
      const atRow = document.createElement('div');
      atRow.className = 'print-row';
      const atLabel = document.createElement('label');
      atLabel.className = 'print-label';
      atLabel.textContent = i18n.t('pageOpsInsertAt');
      atRow.appendChild(atLabel);
      atRow.appendChild(rangeInput);
      body.appendChild(atRow);

      const countRow = document.createElement('div');
      countRow.className = 'print-row';
      const countLabel = document.createElement('label');
      countLabel.className = 'print-label';
      countLabel.textContent = i18n.t('pageOpsCount');
      countRow.appendChild(countLabel);
      countInput = document.createElement('input');
      countInput.type = 'text';
      countInput.inputMode = 'numeric';
      countInput.className = 'modal-input print-percent-input';
      countInput.value = '1';
      countRow.appendChild(countInput);
      body.appendChild(countRow);

      const sizeRow = document.createElement('div');
      sizeRow.className = 'print-row';
      const sizeLabel = document.createElement('label');
      sizeLabel.className = 'print-label';
      sizeLabel.textContent = i18n.t('pageOpsSize');
      sizeRow.appendChild(sizeLabel);
      widthInput = document.createElement('input');
      widthInput.type = 'text';
      widthInput.inputMode = 'decimal';
      widthInput.className = 'modal-input print-percent-input';
      widthInput.value = '595';
      heightInput = document.createElement('input');
      heightInput.type = 'text';
      heightInput.inputMode = 'decimal';
      heightInput.className = 'modal-input print-percent-input';
      heightInput.value = '842';
      sizeRow.append(widthInput, document.createTextNode('×'), heightInput);
      body.appendChild(sizeRow);
    }

    // ---- crop margins ----
    const margins = { top: 0, right: 0, bottom: 0, left: 0 };
    let marginInputs: HTMLInputElement[] = [];
    if (options.operation === 'crop') {
      const row = document.createElement('div');
      row.className = 'print-row';
      const label = document.createElement('label');
      label.className = 'print-label';
      label.textContent = i18n.t('pageOpsMargins');
      row.appendChild(label);
      marginInputs = ['top', 'right', 'bottom', 'left'].map((side) => {
        const input = document.createElement('input');
        input.type = 'text';
        input.inputMode = 'decimal';
        input.className = 'modal-input print-percent-input';
        input.value = '0';
        input.title = side;
        input.dataset['side'] = side;
        row.appendChild(input);
        return input;
      });
      body.appendChild(row);
    }

    box.appendChild(body);

    const footer = document.createElement('div');
    footer.className = 'modal-footer';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'btn modal-cancel';
    cancel.textContent = i18n.t('printCancel');
    const confirm = document.createElement('button');
    confirm.type = 'button';
    confirm.className = 'btn primary modal-confirm';
    confirm.textContent = i18n.t('pageOpsConfirm');
    footer.append(cancel, confirm);
    box.appendChild(footer);
    overlay.appendChild(box);

    let settled = false;
    const finish = (value: PageOpsResult | null): void => {
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
        confirm.click();
      }
    };

    confirm.addEventListener('click', () => {
      for (const input of marginInputs) {
        const side = (input.dataset['side'] ?? 'top') as keyof typeof margins;
        const value = Number(input.value);
        margins[side] = Number.isFinite(value) && value > 0 ? value : 0;
      }
      finish({
        rangeText: rangeInput.value,
        angle: angleSelect ? Number(angleSelect.value) : 90,
        count: Math.max(1, Math.min(200, Math.round(Number(countInput?.value ?? '1')) || 1)),
        width: Math.max(36, Math.min(5000, Number(widthInput?.value ?? '595') || 595)),
        height: Math.max(36, Math.min(5000, Number(heightInput?.value ?? '842') || 842)),
        margins,
      });
    });
    cancel.addEventListener('click', () => finish(null));
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) finish(null);
    });
    document.addEventListener('keydown', onKey, true);

    document.body.appendChild(overlay);
    rangeInput.focus();
    rangeInput.select();
  });
}

function capitalise(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
