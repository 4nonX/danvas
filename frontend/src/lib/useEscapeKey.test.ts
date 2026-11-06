// @vitest-environment jsdom
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useEscapeKey } from "./useEscapeKey";

const press = (key = "Escape") => {
  const e = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
  document.body.dispatchEvent(e);
  return e;
};

afterEach(() => cleanup());

describe("useEscapeKey", () => {
  it("closes the overlay on Escape and stops the key there", () => {
    const close = vi.fn();
    const below = vi.fn();
    document.addEventListener("keydown", below);
    renderHook(() => useEscapeKey(close));
    const e = press();
    expect(close).toHaveBeenCalledTimes(1);
    expect(e.defaultPrevented).toBe(true);
    expect(below).not.toHaveBeenCalled();
    document.removeEventListener("keydown", below);
  });

  it("closes only the topmost of two overlays, then the one under it", () => {
    const outer = vi.fn();
    const inner = vi.fn();
    renderHook(() => useEscapeKey(outer));
    const top = renderHook(() => useEscapeKey(inner));
    press();
    expect(inner).toHaveBeenCalledTimes(1);
    expect(outer).not.toHaveBeenCalled();
    top.unmount();
    press();
    expect(outer).toHaveBeenCalledTimes(1);
  });

  it("ignores other keys, and does nothing while inactive or after closing", () => {
    const close = vi.fn();
    const { rerender, unmount } = renderHook(({ on }) => useEscapeKey(close, on), { initialProps: { on: false } });
    press();
    expect(close).not.toHaveBeenCalled();
    rerender({ on: true });
    press("Enter");
    expect(close).not.toHaveBeenCalled();
    unmount();
    const e = press();
    expect(close).not.toHaveBeenCalled();
    expect(e.defaultPrevented).toBe(false);
  });
});
