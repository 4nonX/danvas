// @vitest-environment jsdom

// The properties panel's rotation knob and size slider change the selected
// element live and record a whole drag as one undo step.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createBlankDesign, createNode, type Node } from "@hc/schema";
import { useEditor } from "@/store/editor";

vi.mock("@/lib/i18n", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/i18n")>()), tr: (k: string) => k }));

const { PropertiesPanel } = await import("./PropertiesPanel");
const { ToastProvider } = await import("@/components/ui/Toast");

const node = () => useEditor.getState().doc.pages[0].children[0];

beforeEach(() => {
  cleanup();
  const doc = createBlankDesign({ title: "t", width: 800, height: 600 });
  doc.pages[0].children.push(createNode("shape", { id: "a", transform: { x: 100, y: 100, scaleX: 1, scaleY: 1, rotation: 0 }, size: { width: 200, height: 100 } } as Partial<Node>));
  useEditor.getState().loadDoc(doc);
  useEditor.getState().select(["a"]);
});

describe("geometry drag controls", () => {
  it("turns with the knob as one undo step", () => {
    render(<ToastProvider><PropertiesPanel /></ToastProvider>);
    const knob = screen.getByRole("slider", { name: "editor.rotation" });
    knob.getBoundingClientRect = () => ({ left: 0, top: 0, width: 36, height: 36, right: 36, bottom: 36, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    fireEvent.pointerDown(knob, { clientX: 36, clientY: 18, pointerId: 1 });
    expect(node().transform.rotation).toBe(90); // live
    fireEvent.pointerMove(knob, { clientX: 18, clientY: 36, pointerId: 1 });
    fireEvent.pointerUp(knob, { pointerId: 1 });
    expect(node().transform.rotation).toBe(180);
    useEditor.getState().undo();
    expect(node().transform.rotation).toBe(0);
    expect(node().transform.x).toBeCloseTo(100, 6); // turned about the centre and back
  });

  it("scales proportionally with the slider as one undo step", () => {
    render(<ToastProvider><PropertiesPanel /></ToastProvider>);
    const slider = screen.getByRole("slider", { name: "editor.size_slider" }) as HTMLInputElement;
    fireEvent.pointerDown(slider);
    fireEvent.change(slider, { target: { value: String(Number(slider.value) + 100) } });
    fireEvent.change(slider, { target: { value: String(Number(slider.value) + 100) } });
    fireEvent.pointerUp(slider);
    const { width, height } = node().size;
    expect(width).toBeGreaterThan(200);
    expect(height / width).toBeCloseTo(0.5, 6);
    useEditor.getState().undo();
    expect(node().size).toEqual({ width: 200, height: 100 });
  });
});
