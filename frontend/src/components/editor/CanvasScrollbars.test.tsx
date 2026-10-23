// @vitest-environment jsdom

// The canvas scrollbars: a vertical bar over the stacked pages and none
// across when the page fits; dragging the thumb pans by the content it
// stands for, and a click on the track moves most of a screen.

import { beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { createBlankDesign } from "@hc/schema";
import { useEditor } from "@/store/editor";
import { CanvasScrollbars } from "./CanvasScrollbars";

beforeEach(() => {
  cleanup();
  const doc = createBlankDesign({ title: "t", width: 800, height: 600 });
  doc.pages.push({ ...structuredClone(doc.pages[0]), id: "p2" }, { ...structuredClone(doc.pages[0]), id: "p3" });
  useEditor.getState().loadDoc(doc);
  useEditor.getState().setViewportSize(1000, 700);
  useEditor.getState().setViewport({ zoom: 1, panX: -100, panY: -50 });
});

describe("canvas scrollbars", () => {
  it("shows the vertical bar for a stack of pages, no horizontal one when the width fits", () => {
    const { container } = render(<CanvasScrollbars inset={0} />);
    expect(container.querySelector('[data-oc="scrollbar-y"]')).not.toBeNull();
    expect(container.querySelector('[data-oc="scrollbar-x"]')).toBeNull();
  });

  it("pans when the thumb is dragged and pages on a track click", () => {
    const { container } = render(<CanvasScrollbars inset={0} />);
    const track = container.querySelector('[data-oc="scrollbar-y"]') as HTMLElement;
    const thumb = track.firstElementChild as HTMLElement;
    fireEvent.pointerDown(thumb, { clientY: 10, pointerId: 1 });
    fireEvent.pointerMove(thumb, { clientY: 60, pointerId: 1 });
    fireEvent.pointerUp(thumb, { clientY: 60, pointerId: 1 });
    const after = useEditor.getState().viewport.panY;
    expect(after).toBeGreaterThan(-50 + 50); // more content per px than 1:1
    // A click below the thumb moves down by most of a screen.
    const before = useEditor.getState().viewport.panY;
    fireEvent.pointerDown(track, { clientY: 690, pointerId: 2 });
    expect(useEditor.getState().viewport.panY).toBeCloseTo(before + 700 * 0.9, 5);
  });
});
