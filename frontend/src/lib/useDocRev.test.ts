// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useEditor } from "@/store/editor";
import { GESTURE_PANEL_MS, useDocRev } from "./useDocRev";

const bump = () => useEditor.setState((s) => ({ rev: s.rev + 1 }));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "requestAnimationFrame", "cancelAnimationFrame"] });
  useEditor.setState({ transforming: false });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/** A component using the counter, counting its renders. */
function mount() {
  let renders = 0;
  const hook = renderHook(() => { renders++; return useDocRev(); });
  return { hook, renders: () => renders };
}

describe("useDocRev", () => {
  it("re-renders a panel once per frame, however many changes came in it", () => {
    const { hook, renders } = mount();
    const start = renders();
    act(() => { for (let i = 0; i < 50; i++) bump(); });
    expect(renders()).toBe(start);
    act(() => { vi.advanceTimersToNextFrame(); });
    expect(renders()).toBe(start + 1);
    expect(hook.result.current).toBe(useEditor.getState().rev);
  });

  it("during a drag, updates a few times a second, and shows the end state when it stops", () => {
    const { hook, renders } = mount();
    act(() => { useEditor.setState({ transforming: true }); });
    const start = renders();
    // A one-second drag with a change every 16 ms.
    for (let t = 0; t < 1000; t += 16) act(() => { bump(); vi.advanceTimersByTime(16); });
    const during = renders() - start;
    expect(during).toBeGreaterThan(3);
    expect(during).toBeLessThanOrEqual(Math.ceil(1000 / GESTURE_PANEL_MS) + 1);
    act(() => { bump(); useEditor.setState({ transforming: false }); vi.advanceTimersToNextFrame(); });
    expect(hook.result.current).toBe(useEditor.getState().rev);
  });

  it("stops listening when unmounted", () => {
    const { hook, renders } = mount();
    hook.unmount();
    const after = renders();
    act(() => { bump(); vi.advanceTimersToNextFrame(); });
    expect(renders()).toBe(after);
  });
});
