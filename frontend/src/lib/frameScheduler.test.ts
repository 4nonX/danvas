import { describe, expect, it } from "vitest";
import { createFrameScheduler, type FrameClock } from "./frameScheduler";

/** A clock the test drives: frames and timers run when the test says so. */
function fakeClock() {
  let t = 0;
  let id = 0;
  const frames = new Map<number, () => void>();
  const timers = new Map<number, { at: number; cb: () => void }>();
  const clock: FrameClock = {
    now: () => t,
    raf: (cb) => { frames.set(++id, cb); return id; },
    cancelRaf: (i) => { frames.delete(i); },
    setTimer: (cb, ms) => { timers.set(++id, { at: t + ms, cb }); return id; },
    clearTimer: (i) => { timers.delete(i); },
  };
  return {
    clock,
    /** Advance time; due timers fire, then one frame runs. */
    advance(ms: number) {
      t += ms;
      for (const [i, tm] of [...timers]) if (tm.at <= t) { timers.delete(i); tm.cb(); }
    },
    frame() {
      const due = [...frames];
      frames.clear();
      for (const [, cb] of due) cb();
    },
    pendingFrames: () => frames.size,
    pendingTimers: () => timers.size,
    spend(ms: number) { t += ms; },
  };
}

describe("frame scheduler", () => {
  it("turns a burst of requests into one run per frame", () => {
    const c = fakeClock();
    let runs = 0;
    const s = createFrameScheduler(() => { runs++; }, c.clock);
    for (let i = 0; i < 200; i++) s.request();
    expect(runs).toBe(0);
    c.frame();
    expect(runs).toBe(1);
    s.request();
    s.request();
    c.frame();
    expect(runs).toBe(2);
  });

  it("after a slow run, waits as long again before the next one", () => {
    const c = fakeClock();
    let runs = 0;
    const s = createFrameScheduler(() => { runs++; c.spend(120); }, c.clock);
    s.request();
    c.frame();
    expect(s.lastCost()).toBe(120);
    s.request();
    expect(c.pendingFrames()).toBe(0);
    expect(c.pendingTimers()).toBe(1);
    c.advance(60);
    c.frame();
    expect(runs).toBe(1); // still giving the page its turn
    c.advance(60);
    c.frame();
    expect(runs).toBe(2);
  });

  it("never waits longer than half a second, however slow it was", () => {
    const c = fakeClock();
    let runs = 0;
    const s = createFrameScheduler(() => { runs++; c.spend(5000); }, c.clock);
    s.request();
    c.frame();
    s.request();
    c.advance(500);
    c.frame();
    expect(runs).toBe(2);
  });

  it("runs right away on flush and drops what was pending", () => {
    const c = fakeClock();
    let runs = 0;
    const s = createFrameScheduler(() => { runs++; }, c.clock);
    s.request();
    s.flush();
    expect(runs).toBe(1);
    c.frame();
    expect(runs).toBe(1);
  });

  it("does nothing after cancel, and keeps working after a run that threw", () => {
    const c = fakeClock();
    let runs = 0;
    let fail = true;
    const s = createFrameScheduler(() => { runs++; if (fail) throw new Error("boom"); }, c.clock);
    s.request();
    s.cancel();
    c.frame();
    expect(runs).toBe(0);
    s.request();
    expect(() => c.frame()).toThrow("boom");
    fail = false;
    s.request();
    c.frame();
    expect(runs).toBe(2);
  });
});
