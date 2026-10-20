import { describe, expect, it } from "vitest";
import { synthesis } from "./fontSource";
import { emboldenWidth } from "./pdfCanvas";

const req = (weight: number, italic = false) => ({ family: "Any", weight, italic, stretch: 100 });

describe("synthesized faces", () => {
  it("synthesizes bold only when bold is asked for and the face is lighter", () => {
    expect(synthesis(req(700), 400, false).synthBold).toBe(true);
    expect(synthesis(req(600), 500, false).synthBold).toBe(true);
    expect(synthesis(req(700), 700, false).synthBold).toBe(false);
    expect(synthesis(req(500), 400, false).synthBold).toBe(false);
  });

  it("synthesizes an oblique only when italic is asked for and the face is upright", () => {
    expect(synthesis(req(400, true), 400, false).synthItalic).toBe(true);
    expect(synthesis(req(400, true), 400, true).synthItalic).toBe(false);
    expect(synthesis(req(400), 400, false).synthItalic).toBe(false);
  });

  it("emboldens by the width the browser adds", () => {
    expect(emboldenWidth(48, true)).toBeCloseTo(2);
    expect(emboldenWidth(9, false)).toBeCloseTo(9 / 24);
    expect(emboldenWidth(64, false)).toBeCloseTo(2);
    expect(emboldenWidth(22.5, false)).toBeCloseTo(22.5 * (1 / 24 + 0.5 * (1 / 32 - 1 / 24)));
  });
});
