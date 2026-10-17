/**
 * Print settings dialog.
 *
 * Purpose-built rather than pack-driven: the pack describes dialogs as lines of text,
 * and these controls need real inputs whose values come back to the caller.
 */
import type { I18n } from '../i18n/i18n.js';
import type { PrintOptions, PrintScale } from '../tools/print.js';

export type PrintRangeChoice = 'all' | 'current' | 'custom';

export interface PrintDialogResult {
  options: Pick<PrintOptions, 'scale' | 'percent' | 'orientation'>;
  /** Which pages to print; the caller resolves it against the page count. */
  range: PrintRangeChoice;
  /** Only meaningful when `range` is `custom`. */
  rangeText: string;
}

type RangeChoice = PrintRangeChoice;

export function showPrintDialog(
  i18n: I18n,
  defaults: { pageCount: number; currentPage: number; rangeText: string },
): Promise<PrintDialogResult | null> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';

    const box = document.createElement('div');
    box.className = 'modal modal-print';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');

    const title = document.createElement('div');
    title.className = 'modal-title';
    title.textContent = i18n.t('printTitle');
    box.appendChild(title);

    const body = document.createElement('div');
    body.className = 'modal-body';

    // ---- page range ----
    const rangeRow = document.createElement('div');
    rangeRow.className = 'print-row';
    const rangeLabel = document.createElement('label');
    rangeLabel.className = 'print-label';
    rangeLabel.textContent = i18n.t('printRange');
    rangeRow.appendChild(rangeLabel);

    const rangeControls = document.createElement('div');
    rangeControls.className = 'print-controls';

    const choices: Array<{ id: RangeChoice; text: string }> = [
      { id: 'all', text: i18n.t('printRangeAll') },
      { id: 'current', text: i18n.t('printRangeCurrent') },
      { id: 'custom', text: i18n.t('printRangeCustom') },
    ];
    const radios = new Map<RangeChoice, HTMLInputElement>();
    for (const choice of choices) {
      const label = document.createElement('label');
      label.className = 'print-radio';
      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = 'print-range';
      radio.value = choice.id;
      radio.checked = choice.id === 'all';
      radios.set(choice.id, radio);
      label.append(radio, document.createTextNode(choice.text));
      rangeControls.appendChild(label);
    }

    const rangeInput = document.createElement('input');
    rangeInput.type = 'text';
    rangeInput.className = 'modal-input print-range-input';
    rangeInput.placeholder = i18n.t('printRangeHint');
    rangeInput.value = defaults.rangeText;
    rangeInput.disabled = true;
    rangeControls.appendChild(rangeInput);
    rangeRow.appendChild(rangeControls);
    body.appendChild(rangeRow);

    const syncRange = (): void => {
      rangeInput.disabled = radios.get('custom')?.checked !== true;
    };
    for (const radio of radios.values()) radio.addEventListener('change', syncRange);

    // ---- scale ----
    const scaleRow = document.createElement('div');
    scaleRow.className = 'print-row';
    const scaleLabel = document.createElement('label');
    scaleLabel.className = 'print-label';
    scaleLabel.textContent = i18n.t('printScale');
    scaleRow.appendChild(scaleLabel);

    const scaleControls = document.createElement('div');
    scaleControls.className = 'print-controls';
    const scaleSelect = document.createElement('select');
    scaleSelect.className = 'modal-input print-select';
    const scaleChoices: Array<{ value: PrintScale; text: string }> = [
      { value: 'fit', text: i18n.t('printScaleFit') },
      { value: 'actual', text: i18n.t('printScaleActual') },
      { value: 'percent', text: i18n.t('printScalePercent') },
    ];
    for (const choice of scaleChoices) {
      const option = document.createElement('option');
      option.value = choice.value;
      option.textContent = choice.text;
      scaleSelect.appendChild(option);
    }
    const percentInput = document.createElement('input');
    percentInput.type = 'text';
    percentInput.inputMode = 'decimal';
    percentInput.className = 'modal-input print-percent-input';
    percentInput.value = '100';
    percentInput.disabled = true;
    scaleSelect.addEventListener('change', () => {
      percentInput.disabled = scaleSelect.value !== 'percent';
    });
    scaleControls.append(scaleSelect, percentInput);
    scaleRow.appendChild(scaleControls);
    body.appendChild(scaleRow);

    // ---- orientation ----
    const orientationRow = document.createElement('div');
    orientationRow.className = 'print-row';
    const orientationLabel = document.createElement('label');
    orientationLabel.className = 'print-label';
    orientationLabel.textContent = i18n.t('printOrientation');
    orientationRow.appendChild(orientationLabel);

    const orientationControls = document.createElement('div');
    orientationControls.className = 'print-controls';
    const orientationSelect = document.createElement('select');
    orientationSelect.className = 'modal-input print-select';
    for (const [value, text] of [
      ['auto', i18n.t('printOrientationAuto')],
      ['portrait', i18n.t('printOrientationPortrait')],
      ['landscape', i18n.t('printOrientationLandscape')],
    ] as const) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = text;
      orientationSelect.appendChild(option);
    }
    orientationControls.appendChild(orientationSelect);
    orientationRow.appendChild(orientationControls);
    body.appendChild(orientationRow);

    const summary = document.createElement('div');
    summary.className = 'print-summary';
    summary.textContent = i18n.t('printPageCount').replace('{n}', String(defaults.pageCount));
    body.appendChild(summary);

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
    confirm.textContent = i18n.t('printConfirm');
    footer.append(cancel, confirm);
    box.appendChild(footer);
    overlay.appendChild(box);

    let settled = false;
    const finish = (value: PrintDialogResult | null): void => {
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
      }
    };

    confirm.addEventListener('click', () => {
      const range: RangeChoice =
        radios.get('current')?.checked === true
          ? 'current'
          : radios.get('custom')?.checked === true
            ? 'custom'
            : 'all';
      finish({
        range,
        rangeText: rangeInput.value,
        options: {
          scale: scaleSelect.value as PrintScale,
          percent: Math.max(10, Math.min(400, Number(percentInput.value) || 100)),
          orientation: orientationSelect.value as PrintOptions['orientation'],
        },
      });
    });

    cancel.addEventListener('click', () => finish(null));
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) finish(null);
    });
    document.addEventListener('keydown', onKey, true);

    document.body.appendChild(overlay);
    confirm.focus();
  });
}
