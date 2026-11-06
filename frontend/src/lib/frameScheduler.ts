// Runs a piece of work (the canvas redraw) at most once per frame, however many
// changes ask for it, and never back to back when it is slow: after a run that
// took longer than a frame, the same time passes before the next one starts, so
// input, scrolling and the browser itself always get their turn. A slow redraw
// then makes the canvas update less often instead of freezing the page.

export interface FrameScheduler {
  /** Ask for a run; any number of requests before it starts give one run. */
  request(): void;
  /** Run now, dropping a pending request (for code that needs it drawn). */
  flush(): void;
  /** Drop a pending request (on unmount). */
  cancel(): void;
  /** How long the last run took, in ms. */
  lastCost(): number;
}

export interface FrameClock {
  now(): number;
  raf(cb: () => void): number;
  cancelRaf(id: number): void;
  setTimer(cb: () => void, ms: number): number;
  clearTimer(id: number): void;
}

/** One frame at 60 Hz: a run longer than this earns the page a pause. */
const FRAME_MS = 16;
/** The longest pause, so a very slow run still repaints now and then. */
const MAX_GAP_MS = 500;

export const browserClock = (): FrameClock => ({
  now: () => performance.now(),
  raf: (cb) => requestAnimationFrame(cb),
  cancelRaf: (id) => cancelAnimationFrame(id),
  setTimer: (cb, ms) => window.setTimeout(cb, ms),
  clearTimer: (id) => window.clearTimeout(id),
});

export function createFrameScheduler(run: () => void, clock: FrameClock = browserClock()): FrameScheduler {
  let frame = 0;
  let timer = 0;
  let cost = 0;
  let endedAt = -Infinity;
  const exec = () => {
    frame = 0;
    const start = clock.now();
    try {
      run();
    } finally {
      const end = clock.now();
      cost = end - start;
      endedAt = end;
    }
  };
  const cancel = () => {
    if (frame) clock.cancelRaf(frame);
    if (timer) clock.clearTimer(timer);
    frame = 0;
    timer = 0;
  };
  return {
    request() {
      if (frame || timer) return;
      const wait = cost > FRAME_MS ? Math.min(MAX_GAP_MS, endedAt + cost - clock.now()) : 0;
      if (wait > 0) {
        timer = clock.setTimer(() => {
          timer = 0;
          frame = clock.raf(exec);
        }, wait);
      } else {
        frame = clock.raf(exec);
      }
    },
    flush() {
      cancel();
      exec();
    },
    cancel,
    lastCost: () => cost,
  };
}
