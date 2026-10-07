import { describe, expect, it } from "vitest";
import { parseCanvasFont } from "./fontSource";
import { num } from "./pdfCanvas";

describe("vector PDF helpers", () => {
  it("writes PDF numbers without exponent notation", () => {
    expect(num(1e-7)).toBe("0");
    expect(num(12.5)).toBe("12.5");
    expect(num(-3)).toBe("-3");
    expect(num(1 / 3)).toBe("0.3333");
    expect(num(Number.NaN)).toBe("0");
  });

  it("parses the canvas font strings the engine writes", () => {
    expect(parseCanvasFont('italic 700 16px "Titillium Web", system-ui, sans-serif')).toEqual({
      family: "Titillium Web", weight: 700, italic: true, stretch: 100, size: 16, smallCaps: false,
    });
    expect(parseCanvasFont('small-caps 400 condensed 9.5px "Inter", sans-serif')).toMatchObject({
      family: "Inter", weight: 400, stretch: 75, size: 9.5, smallCaps: true,
    });
    expect(parseCanvasFont("12px system-ui, sans-serif")).toMatchObject({ family: "system-ui", weight: 400, size: 12 });
  });
});
