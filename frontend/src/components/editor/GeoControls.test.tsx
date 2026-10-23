// @vitest-environment jsdom

// The size slider and the rotation knob: the knob reads the angle the
// pointer points at (0 = up, clockwise, Shift in 15° steps), a drag is one
// gesture (start, live changes, done), keys and double-click are gestures of
// their own; the slider is logarithmic and round-trips its values.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { knobAngle, normalizeAngle, RotationKnob, sizeRange, sizeToSlider, sliderToSize } from "./GeoControls";

afterEach(() => cleanup());

describe("knob maths", () => {
  it("reads 0 up, 90 right, 180 down, -90 left", () => {
    expect(knobAngle(0, -10)).toBe(0);
    expect(knobAngle(10, 0)).toBe(90);
    expect(knobAngle(0, 10)).toBe(180);
    expect(knobAngle(-10, 0)).toBe(-90);
    expect(normalizeAngle(370)).toBe(10);
    expect(normalizeAngle(-190)).toBe(170);
  });

  it("maps sizes logarithmically and back", () => {
    const r = sizeRange(1000, 500, 120);
    expect(r).toEqual({ min: 2, max: 2000 });
    for (const v of [2, 10, 120, 999, 2000]) expect(sliderToSize(sizeToSlider(v, r), r)).toBeCloseTo(v, -Math.log10(v) + 1.5);
    expect(sizeToSlider(Math.sqrt(2 * 2000), r)).toBe(500); // the middle is the geometric mean
    // A size outside the page's range widens it.
    expect(sizeRange(100, 100, 5000).max).toBe(5000);
  });
});

describe("rotation knob", () => {
  const box = { left: 0, top: 0, width: 36, height: 36, right: 36, bottom: 36, x: 0, y: 0, toJSON: () => ({}) };

  it("turns as one gesture and snaps with Shift", () => {
    const on = { onLive: vi.fn(), onDone: vi.fn() };
    const { getByRole } = render(<RotationKnob label="Rotation" value={0} {...on} />);
    const knob = getByRole("slider");
    knob.getBoundingClientRect = () => box as DOMRect;
    fireEvent.pointerDown(knob, { clientX: 36, clientY: 18, pointerId: 1 }); // right: 90
    fireEvent.pointerMove(knob, { clientX: 18, clientY: 36, pointerId: 1 }); // down: 180
    fireEvent.pointerMove(knob, { clientX: 30, clientY: 31, pointerId: 1, shiftKey: true }); // ~137 -> 135
    fireEvent.pointerUp(knob, { pointerId: 1 });
    expect(on.onLive.mock.calls.map((c) => c[0])).toEqual([90, 180, 135]);
    expect(on.onDone).toHaveBeenCalledTimes(1);
    expect(on.onDone).toHaveBeenCalledWith(135, 0);
  });

  it("steps with the arrow keys and resets on double-click", () => {
    const on = { onLive: vi.fn(), onDone: vi.fn() };
    const { getByRole } = render(<RotationKnob label="Rotation" value={178} {...on} />);
    const knob = getByRole("slider");
    fireEvent.keyDown(knob, { key: "ArrowRight", shiftKey: true });
    expect(on.onDone).toHaveBeenLastCalledWith(-167, 178); // 193 folds over
    fireEvent.doubleClick(knob);
    expect(on.onDone).toHaveBeenLastCalledWith(0, 178);
    expect(on.onLive).not.toHaveBeenCalled();
  });

  it("does nothing when locked", () => {
    const on = { onLive: vi.fn(), onDone: vi.fn() };
    const { getByRole } = render(<RotationKnob label="Rotation" value={0} disabled {...on} />);
    fireEvent.pointerDown(getByRole("slider"), { clientX: 36, clientY: 18 });
    fireEvent.keyDown(getByRole("slider"), { key: "ArrowRight" });
    expect(on.onLive).not.toHaveBeenCalled();
    expect(on.onDone).not.toHaveBeenCalled();
  });
});
