/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { AnchoredMenu } from "./AnchoredMenu";

// jsdom has no layout: a button near the bottom of an 800 px window, a menu
// 700 px tall, so it has to scroll.
beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(700);
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(240);
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1200 });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: 800 });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function setup() {
  const view = render(
    <div data-testid="anchor">
      <button type="button">more</button>
      <AnchoredMenu className="w-60"><div>items</div></AnchoredMenu>
    </div>,
  );
  const anchor = view.getByTestId("anchor");
  const rect = vi.spyOn(anchor, "getBoundingClientRect").mockReturnValue({ left: 600, top: 500, right: 630, bottom: 530, width: 30, height: 30, x: 600, y: 500, toJSON: () => ({}) });
  const menu = document.body.querySelector<HTMLElement>("[data-anchored-menu]")!;
  window.dispatchEvent(new Event("resize"));
  return { rect, menu };
}

describe("AnchoredMenu", () => {
  it("limits its height and scrolls when it does not fit", () => {
    const { menu } = setup();
    expect(menu.style.maxHeight).toBe("488px");
    expect(menu.style.top).toBe("8px");
  });

  it("keeps its scroll position when the menu itself scrolls", () => {
    const { rect, menu } = setup();
    rect.mockClear();
    menu.scrollTop = 120;
    menu.dispatchEvent(new Event("scroll"));
    expect(rect).not.toHaveBeenCalled();
    expect(menu.scrollTop).toBe(120);
  });

  it("follows its button when the page scrolls, without lifting the height limit", () => {
    const { rect, menu } = setup();
    rect.mockClear();
    const seen: string[] = [];
    const style = menu.style;
    Object.defineProperty(style, "maxHeight", {
      configurable: true,
      get: () => style.getPropertyValue("max-height"),
      set: (v: string) => { seen.push(v); style.setProperty("max-height", v); },
    });
    document.dispatchEvent(new Event("scroll"));
    expect(rect).toHaveBeenCalled();
    expect(seen).toEqual(["488px"]);
    expect(menu.style.maxHeight).toBe("488px");
  });
});
