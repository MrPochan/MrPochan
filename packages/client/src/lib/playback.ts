// Timed playback of battle or field events (spec 6.5: the client only renders the events the core produces).
// Event times are in milliseconds relative to the start of the step; `speed` scales how fast they play (CORE-011).
// DOM-free so the timing rules can be tested.

export interface Timed {
  readonly ms: number;
}

export interface Emitted<E> {
  readonly index: number;
  readonly event: E;
}

export class Playback<E extends Timed> {
  private events: readonly E[];
  private cursor = 0;
  private elapsed = 0;
  private speed: number;
  private isPaused = false;

  constructor(events: readonly E[], speed: 1 | 2 = 1) {
    this.events = events;
    this.speed = speed;
  }

  /** Advances the clock by a real-time delta and returns the events that became due, in order. */
  advance(deltaRealMs: number): Emitted<E>[] {
    if (this.isPaused || this.cursor >= this.events.length || deltaRealMs <= 0) return [];
    this.elapsed += deltaRealMs * this.speed;
    const out: Emitted<E>[] = [];
    while (this.cursor < this.events.length) {
      const event = this.events[this.cursor];
      if (!event || event.ms > this.elapsed) break;
      out.push({ index: this.cursor, event });
      this.cursor++;
    }
    return out;
  }

  /** Stops the clock; the cursor stays where it is. */
  pause(): void {
    this.isPaused = true;
  }

  resume(): void {
    this.isPaused = false;
  }

  get paused(): boolean {
    return this.isPaused;
  }

  setSpeed(speed: 1 | 2): void {
    this.speed = speed;
  }

  /** True when every event has been emitted. */
  get done(): boolean {
    return this.cursor >= this.events.length;
  }

  /** Battle clock in milliseconds of battle time. */
  get elapsedMs(): number {
    return this.elapsed;
  }

  /**
   * Replaces the remaining events after a resurrection decision. `events` must be identical to the old list
   * up to and including `keepThrough`; playback continues right after that index.
   */
  resumeWith(events: readonly E[], keepThrough: number): void {
    this.events = events;
    this.cursor = Math.max(0, keepThrough + 1);
    this.isPaused = false;
  }
}
