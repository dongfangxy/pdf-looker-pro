/**
 * Magnifier.
 *
 * A lens that follows the pointer and shows a magnified crop of whatever page is under
 * it. It reads from the page's already-rendered canvas rather than re-rendering, so it
 * costs nothing per frame and always matches what is on screen — including the current
 * zoom, so the lens is a genuine magnification of the page rather than of the window.
 */
export class Loupe {
  private readonly lens: HTMLDivElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly badge: HTMLDivElement;
  private enabled = false;
  private active = false;

  /** Lens diameter in CSS pixels. */
  private static readonly SIZE = 180;
  /** How much the lens magnifies relative to what is already on screen. */
  private static readonly ZOOM = 2.5;

  constructor(
    private readonly host: HTMLElement,
    private readonly pages: HTMLElement,
  ) {
    this.lens = document.createElement('div');
    this.lens.className = 'loupe hidden';
    this.lens.setAttribute('aria-hidden', 'true');

    this.canvas = document.createElement('canvas');
    this.canvas.className = 'loupe-canvas';
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(Loupe.SIZE * dpr);
    this.canvas.height = Math.round(Loupe.SIZE * dpr);
    this.canvas.style.width = `${Loupe.SIZE}px`;
    this.canvas.style.height = `${Loupe.SIZE}px`;
    this.lens.appendChild(this.canvas);

    this.badge = document.createElement('div');
    this.badge.className = 'loupe-badge';
    this.badge.textContent = `${Loupe.ZOOM}x`;
    this.lens.appendChild(this.badge);

    this.host.appendChild(this.lens);
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.hide();
    this.host.classList.toggle('loupe-on', enabled);
  }

  /** Wires the pointer listeners once; the lens stays inert until enabled. */
  attach(): void {
    this.pages.addEventListener('pointermove', this.onMove, { passive: true });
    this.pages.addEventListener('pointerleave', this.hide);
    this.pages.addEventListener('pointerdown', this.hide);
    this.host.addEventListener('scroll', this.hide, { passive: true, capture: true });
  }

  destroy(): void {
    this.pages.removeEventListener('pointermove', this.onMove);
    this.pages.removeEventListener('pointerleave', this.hide);
    this.pages.removeEventListener('pointerdown', this.hide);
    this.host.removeEventListener('scroll', this.hide, { capture: true });
    this.lens.remove();
  }

  private readonly hide = (): void => {
    if (!this.active) return;
    this.active = false;
    this.lens.classList.add('hidden');
  };

  private readonly onMove = (event: PointerEvent): void => {
    if (!this.enabled) return;
    const target = event.target as HTMLElement | null;
    const page = target?.closest('.page') as HTMLElement | null;
    const canvas = page?.querySelector('canvas') as HTMLCanvasElement | null;
    // Nothing rendered under the pointer yet: the lens would only show a blank square.
    if (!canvas || canvas.width === 0 || page?.classList.contains('unrendered')) {
      this.hide();
      return;
    }

    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      this.hide();
      return;
    }

    // The canvas is larger than its CSS box whenever the device pixel ratio or the page
    // scale exceeds one, so convert to canvas pixels before cropping.
    const ratioX = canvas.width / rect.width;
    const ratioY = canvas.height / rect.height;
    const sourceX = (event.clientX - rect.left) * ratioX;
    const sourceY = (event.clientY - rect.top) * ratioY;
    const sourceW = (Loupe.SIZE / Loupe.ZOOM) * ratioX;
    const sourceH = (Loupe.SIZE / Loupe.ZOOM) * ratioY;

    const context = this.canvas.getContext('2d');
    if (!context) return;

    // White rather than transparent: a lens over the page margin should look like paper.
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, this.canvas.width, this.canvas.height);
    context.imageSmoothingEnabled = false;
    try {
      context.drawImage(
        canvas,
        sourceX - sourceW / 2,
        sourceY - sourceH / 2,
        sourceW,
        sourceH,
        0,
        0,
        this.canvas.width,
        this.canvas.height,
      );
    } catch {
      this.hide();
      return;
    }

    this.place(event.clientX, event.clientY);
    this.active = true;
    this.lens.classList.remove('hidden');
  };

  /** Keeps the lens beside the pointer without letting it fall off the window. */
  private place(clientX: number, clientY: number): void {
    const gap = 20;
    const margin = 8;
    let left = clientX + gap;
    let top = clientY + gap;
    if (left + Loupe.SIZE + margin > window.innerWidth) left = clientX - gap - Loupe.SIZE;
    if (top + Loupe.SIZE + margin > window.innerHeight) top = clientY - gap - Loupe.SIZE;
    left = Math.max(margin, left);
    top = Math.max(margin, top);
    this.lens.style.left = `${left}px`;
    this.lens.style.top = `${top}px`;
  }
}
