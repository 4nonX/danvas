// @vitest-environment jsdom

// The colour picker floats at the end of <body>. A panel that holds the
// field (the toolbar's border panel) closes on clicks outside itself, so it
// must recognise clicks in the picker as its own: picking a preset used to
// close the panel, and the picker with it, before the click landed.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";

vi.mock("@/lib/i18n", () => ({ tr: (k: string) => k }));

const { ColorField, isInFloating } = await import("./ColorField");

afterEach(() => cleanup());

describe("colour picker in a panel", () => {
  it("applies a preset, and its clicks count as inside the panel", () => {
    const onChange = vi.fn();
    const { container } = render(
      <ColorField value={{ srgb: { r: 1, g: 1, b: 1, a: 1 } }} onChange={onChange} palette={["#EF4444", "#3B82F6"]} block={false} />,
    );
    fireEvent.click(container.querySelector("button")!);
    const pop = document.querySelector("[data-oc-floating]") as HTMLElement;
    expect(pop).not.toBeNull();
    expect(container.contains(pop)).toBe(false); // rendered at the end of <body>
    const swatch = pop.querySelector('button[title="#EF4444"]') as HTMLElement;
    expect(isInFloating(swatch)).toBe(true);
    expect(isInFloating(container)).toBe(false);
    fireEvent.click(swatch);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0].srgb).toMatchObject({ r: 239 / 255, g: 68 / 255, b: 68 / 255 });
  });
});
