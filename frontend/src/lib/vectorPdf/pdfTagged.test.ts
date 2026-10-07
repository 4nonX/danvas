// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from "vitest";
import type { Node } from "@hc/schema";
import { PdfCanvas, PdfResources } from "./pdfCanvas";

// jsdom has no canvas; the recorder only needs one to normalize colours.
beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = function () {
    let fill = "#000000";
    return {
      get fillStyle() { return fill; },
      set fillStyle(v: string) { fill = v; },
    } as unknown as CanvasRenderingContext2D;
  } as typeof HTMLCanvasElement.prototype.getContext;
});

const node = (id: string, type: string, extra: Record<string, unknown> = {}) => ({ id, type, ...extra }) as unknown as Node;

function draw(tagged: boolean) {
  const c = new PdfCanvas({ width: 100, height: 100, faces: new Map(), resources: new PdfResources(), tagged });
  c.fillStyle = "#ffffff";
  c.fillRect(0, 0, 100, 100); // page background
  const t = node("t", "text");
  c.nodeEnter(t); c.fillStyle = "#000000"; c.fillRect(1, 1, 5, 5); c.nodeExit(t);
  const g = node("g", "group");
  const img = node("i", "image", { alt: "Logo" });
  const deco = node("d", "shape", { decorative: true });
  c.nodeEnter(g);
  c.nodeEnter(img); c.fillRect(2, 2, 5, 5); c.nodeExit(img);
  c.nodeEnter(deco); c.fillRect(3, 3, 5, 5); c.nodeExit(deco);
  c.nodeExit(g);
  const s = node("s", "shape");
  c.nodeEnter(s); c.fillRect(4, 4, 5, 5); c.nodeExit(s);
  return c;
}

describe("tagged PDF recording", () => {
  it("marks each element and leaves decoration as artifacts", () => {
    const c = draw(true);
    const ops = c.content();
    expect(ops.startsWith("/Artifact BMC")).toBe(true); // the background
    expect(ops).toContain("/P <</MCID 0>> BDC");
    expect(ops).toContain("/Figure <</MCID 1>> BDC");
    expect((ops.match(/BDC|BMC/g) ?? []).length).toBe((ops.match(/EMC/g) ?? []).length);
    const { tags, tops } = c.structure();
    expect(tags.map((t) => [t.role, t.alt, tops[t.top]])).toEqual([["P", "", "t"], ["Figure", "Logo", "g"]]);
  });

  it("writes nothing extra when not tagged", () => {
    expect(draw(false).content()).not.toMatch(/BDC|BMC|EMC/);
  });
});
