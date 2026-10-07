// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from "vitest";
import { SvgCanvas } from "./svgCanvas";

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

const canvas = () => new SvgCanvas({ width: 200, height: 100, faces: new Map() });

describe("SvgCanvas", () => {
  it("writes fills in device space with a viewBox mapping back to the page", () => {
    const c = canvas();
    c.scale(2, 2);
    c.fillStyle = "#ff0000";
    c.fillRect(10, 10, 20, 5);
    const svg = c.document(100, 50);
    expect(svg).toContain('width="100" height="50" viewBox="0 0 200 100"');
    expect(svg).toContain('<path d="M20 20L60 20L60 30L20 30Z" fill="#ff0000"/>');
  });

  it("scopes a clip to its save/restore frame", () => {
    const c = canvas();
    c.save();
    c.beginPath();
    c.rect(0, 0, 50, 50);
    c.clip();
    c.fillStyle = "#00ff00";
    c.fillRect(0, 0, 100, 100);
    c.restore();
    c.fillRect(0, 0, 10, 10);
    const svg = c.document(200, 100);
    const body = svg.slice(svg.indexOf("</defs>"));
    // The second fill comes after the clip group is closed.
    expect(body).toMatch(/<g clip-path="url\(#c0\)"><path [^>]+\/><\/g><path d="M0 0L10 0/);
  });

  it("keeps groups balanced when a frame is left open", () => {
    const c = canvas();
    c.save();
    c.rect(0, 0, 5, 5);
    c.clip();
    const svg = c.document(200, 100);
    expect(svg.split("<g ").length - 1).toBe(svg.split("</g>").length - 1);
  });

  it("writes stroke settings scaled to device space", () => {
    const c = canvas();
    c.scale(2, 2);
    c.strokeStyle = "#0000ff";
    c.lineWidth = 3;
    c.setLineDash([4, 2]);
    c.lineCap = "round";
    c.strokeRect(0, 0, 10, 10);
    const svg = c.document(100, 50);
    expect(svg).toContain('fill="none" stroke="#0000ff" stroke-width="6" stroke-linecap="round" stroke-miterlimit="10" stroke-dasharray="8 4"');
  });
});
