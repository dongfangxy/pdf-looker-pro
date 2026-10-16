/**
 * Tool modes.
 *
 *   hand       drag anywhere to pan the scroll container
 *   select     text-layer interaction enabled so text can be selected and copied
 *   zoom       click to zoom in, Alt/Option-click to zoom out, anchored on the pointer
 *   snapshot   drag a rectangle over a page and export that region as a PNG
 *   highlight  \
 *   underline   |  text markup: the drag produces a selection, consumed on release
 *   strikeout  /
 *   ink        freehand drawing
 *   note       click to drop a sticky note
 *   rect       drag out a rectangle
 *
 * The last six are owned by the annotation layer, which handles their gestures. This
 * class still tracks them so the cursor, the text layer's pointer behaviour and the
 * toolbar state stay consistent.
 */
import type { Viewer } from '../viewer/viewer.js';

export type ToolName =
  | 'hand'
  | 'select'
  | 'zoom'
  | 'snapshot'
  | 'pointer'
  | 'highlight'
  | 'underline'
  | 'strikeout'
  | 'ink'
  | 'note'
  | 'rect'
  | 'ellipse'
  | 'arrow'
  | 'textbox'
  | 'callout'
  | 'measure-distance'
  | 'measure-perimeter'
  | 'measure-area';

/** Tools that need the text layer to accept pointer input. */
const TEXT_INTERACTIVE: ReadonlySet<ToolName> = new Set<ToolName>(['select', 'highlight', 'underline', 'strikeout']);

export interface ToolManagerOptions {
  /** Positioned ancestor the snapshot rubber band is appended to. */
  overlayHost: HTMLElement;
  scroll: HTMLElement;
  viewer: Viewer;
  onStatus(text: string, isError?: boolean): void;
  onSnapshot(blob: Blob, suggestedName: string): void;
  onToolChange?(tool: ToolName): void;
  /** Localised messages; the tool layer never hard-codes user-visible text. */
  messages: ToolMessages;
}

export interface ToolMessages {
  snapshotExported(width: number, height: number): string;
  snapshotFailed(reason: string): string;
  reasonNotOnPage: string;
  reasonNoElement: string;
  reasonOutOfPage: string;
}

/** Export resolution multiplier applied on top of the on-screen scale. */
const SNAPSHOT_SUPERSAMPLE = 2;
/** Ignore accidental click-sized drags. */
const MIN_SNAPSHOT_PX = 8;

export class ToolManager {
  private readonly overlayHost: HTMLElement;
  private readonly scroll: HTMLElement;
  private readonly viewer: Viewer;
  private readonly onStatus: ToolManagerOptions['onStatus'];
  private readonly onSnapshot: ToolManagerOptions['onSnapshot'];
  private readonly onToolChange: ToolManagerOptions['onToolChange'];
  private readonly messages: ToolMessages;

  private current: ToolName = 'select';
  private rubber: HTMLDivElement | null = null;
  private dragStart: { x: number; y: number } | null = null;
  private panStart: { x: number; y: number; left: number; top: number } | null = null;
  private busy = false;

  constructor(options: ToolManagerOptions) {
    this.overlayHost = options.overlayHost;
    this.scroll = options.scroll;
    this.viewer = options.viewer;
    this.onStatus = options.onStatus;
    this.onSnapshot = options.onSnapshot;
    this.onToolChange = options.onToolChange;
    this.messages = options.messages;

    this.scroll.addEventListener('pointerdown', this.onPointerDown);
    this.scroll.addEventListener('pointermove', this.onPointerMove);
    this.scroll.addEventListener('pointerup', this.onPointerUp);
    this.scroll.addEventListener('pointercancel', this.onPointerUp);
    this.scroll.addEventListener('click', this.onClick, true);
  }

  get tool(): ToolName {
    return this.current;
  }

  setTool(tool: ToolName): void {
    if (tool === this.current) return;
    this.cancelDrag();
    this.current = tool;
    this.applyState();
    this.onToolChange?.(tool);
  }

  /** Applies the mode's pointer behaviour; call again after a document loads. */
  applyState(): void {
    const textInteractive = TEXT_INTERACTIVE.has(this.current);
    this.viewer.setTextSelection(textInteractive);
    this.viewer.setPanningHint(this.current === 'hand');
    this.scroll.dataset['tool'] = this.current;
  }

  private cancelDrag(): void {
    this.dragStart = null;
    this.panStart = null;
    this.scroll.classList.remove('panning');
    this.removeRubber();
  }

  private removeRubber(): void {
    this.rubber?.remove();
    this.rubber = null;
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) return;

    if (this.current === 'hand') {
      this.panStart = {
        x: event.clientX,
        y: event.clientY,
        left: this.scroll.scrollLeft,
        top: this.scroll.scrollTop,
      };
      this.scroll.classList.add('panning');
      this.scroll.setPointerCapture(event.pointerId);
      event.preventDefault();
      return;
    }

    if (this.current === 'snapshot') {
      this.dragStart = { x: event.clientX, y: event.clientY };
      this.scroll.setPointerCapture(event.pointerId);
      this.removeRubber();
      const rect = this.overlayHost.getBoundingClientRect();
      const rubber = document.createElement('div');
      rubber.className = 'snap-rubber';
      rubber.style.left = `${event.clientX - rect.left}px`;
      rubber.style.top = `${event.clientY - rect.top}px`;
      rubber.style.width = '0px';
      rubber.style.height = '0px';
      this.overlayHost.appendChild(rubber);
      this.rubber = rubber;
      event.preventDefault();
    }
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (this.panStart) {
      this.scroll.scrollLeft = this.panStart.left - (event.clientX - this.panStart.x);
      this.scroll.scrollTop = this.panStart.top - (event.clientY - this.panStart.y);
      return;
    }
    if (!this.dragStart || !this.rubber) return;
    const rect = this.overlayHost.getBoundingClientRect();
    const x1 = Math.min(this.dragStart.x, event.clientX) - rect.left;
    const y1 = Math.min(this.dragStart.y, event.clientY) - rect.top;
    this.rubber.style.left = `${x1}px`;
    this.rubber.style.top = `${y1}px`;
    this.rubber.style.width = `${Math.abs(event.clientX - this.dragStart.x)}px`;
    this.rubber.style.height = `${Math.abs(event.clientY - this.dragStart.y)}px`;
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    if (this.panStart) {
      this.panStart = null;
      this.scroll.classList.remove('panning');
      return;
    }
    if (!this.dragStart) return;

    const start = this.dragStart;
    this.dragStart = null;
    const box = {
      left: Math.min(start.x, event.clientX),
      top: Math.min(start.y, event.clientY),
      width: Math.abs(event.clientX - start.x),
      height: Math.abs(event.clientY - start.y),
    };
    if (box.width < MIN_SNAPSHOT_PX || box.height < MIN_SNAPSHOT_PX) {
      this.removeRubber();
      return;
    }
    void this.captureRegion(box);
  };

  /** Zoom mode acts on click, and must not disturb text selection in other modes. */
  private readonly onClick = (event: MouseEvent): void => {
    if (this.current !== 'zoom') return;
    event.preventDefault();
    event.stopPropagation();
    this.viewer.zoomAt(event.clientX, event.clientY, event.altKey ? 1 / 1.25 : 1.25);
  };

  private async captureRegion(box: { left: number; top: number; width: number; height: number }): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const centreX = box.left + box.width / 2;
      const centreY = box.top + box.height / 2;
      const pageNumber = this.viewer.pageAtPoint(centreX, centreY);
      if (pageNumber === null) {
        this.onStatus(this.messages.snapshotFailed(this.messages.reasonNotOnPage), true);
        return;
      }
      const pageEl = this.viewer.pageElement(pageNumber);
      if (!pageEl) {
        this.onStatus(this.messages.snapshotFailed(this.messages.reasonNoElement), true);
        return;
      }

      const state = this.viewer.getState();
      const pageRect = pageEl.getBoundingClientRect();
      // Region in the page element's own (already scaled) coordinate space.
      const localX = box.left - pageRect.left;
      const localY = box.top - pageRect.top;
      const clampedW = Math.min(box.width, pageRect.width - localX);
      const clampedH = Math.min(box.height, pageRect.height - localY);
      if (clampedW <= 0 || clampedH <= 0) {
        this.onStatus(this.messages.snapshotFailed(this.messages.reasonOutOfPage), true);
        return;
      }

      const exportScale = Math.max(state.scale * SNAPSHOT_SUPERSAMPLE, 2);
      const k = exportScale / state.scale;

      const full = await this.viewer.renderPageBitmap(pageNumber, exportScale);
      const out = document.createElement('canvas');
      out.width = Math.max(1, Math.round(clampedW * k));
      out.height = Math.max(1, Math.round(clampedH * k));
      const ctx = out.getContext('2d');
      if (!ctx) throw new Error('2D canvas context unavailable');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, out.width, out.height);
      ctx.drawImage(
        full,
        Math.round(localX * k),
        Math.round(localY * k),
        out.width,
        out.height,
        0,
        0,
        out.width,
        out.height,
      );

      const blob = await new Promise<Blob | null>((resolve) => out.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error(this.messages.reasonNoElement);
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      this.onSnapshot(blob, `snapshot-p${pageNumber}-${stamp}.png`);
      this.onStatus(this.messages.snapshotExported(out.width, out.height));
    } catch (err) {
      this.onStatus(this.messages.snapshotFailed(String(err)), true);
    } finally {
      this.removeRubber();
      this.busy = false;
    }
  }
}
