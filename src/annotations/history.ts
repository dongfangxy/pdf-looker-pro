/**
 * Undo history for annotations.
 *
 * Snapshots rather than inverse operations: the annotation list is small, and a snapshot
 * cannot drift out of step with the model the way a hand-written inverse can.
 *
 * Rapid changes are coalesced. Dragging an annotation emits a change on every pointer
 * move, and a reader expects one Ctrl+Z to undo the drag, not one per pixel.
 */

export interface HistoryState<T> {
  past: T[];
  present: T;
  future: T[];
}

export class History<T> {
  private past: T[] = [];
  private present: T;
  private future: T[] = [];
  private pending: T | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    initial: T,
    /** How long the model must stay quiet before a change becomes one undo step. */
    private readonly quietMs = 350,
    private readonly limit = 200,
  ) {
    this.present = initial;
  }

  get canUndo(): boolean {
    return this.past.length > 0 || this.pending !== null;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  get depth(): number {
    return this.past.length;
  }

  /** Forgets the history and starts again from `state`, e.g. on a fresh document. */
  reset(state: T): void {
    this.cancel();
    this.past = [];
    this.future = [];
    this.present = state;
    this.pending = null;
  }

  /**
   * Records a new state.
   *
   * The entry is held back until the model stops changing, so a burst of edits collapses
   * into a single step. `undo` and `redo` flush it first, so a shortcut never loses the
   * last edit.
   */
  record(state: T): void {
    if (this.equals(state, this.present) && this.pending === null) return;
    this.pending = state;
    this.cancel();
    this.timer = setTimeout(() => this.flush(), this.quietMs);
  }

  /** Promotes a pending entry, so an immediate undo sees the change. */
  flush(): void {
    this.cancel();
    if (this.pending === null) return;
    this.past.push(this.present);
    if (this.past.length > this.limit) this.past.shift();
    this.present = this.pending;
    this.pending = null;
    this.future = [];
  }

  undo(): T | null {
    this.flush();
    const previous = this.past.pop();
    if (previous === undefined) return null;
    this.future.push(this.present);
    this.present = previous;
    return previous;
  }

  redo(): T | null {
    this.flush();
    const next = this.future.pop();
    if (next === undefined) return null;
    this.past.push(this.present);
    this.present = next;
    return next;
  }

  private cancel(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private equals(a: T, b: T): boolean {
    return a === b;
  }
}
