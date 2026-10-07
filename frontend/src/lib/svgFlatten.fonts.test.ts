import { describe, expect, it } from "vitest";
import { resolveFontFamily } from "./svgFlatten";

describe("resolveFontFamily", () => {
  it("prefers a real family name over a PostScript name when neither is installed", () => {
    expect(resolveFontFamily("'TrajanPro-Bold', 'Trajan Pro', serif")).toBe("Trajan Pro");
    expect(resolveFontFamily("'GoudyOldStyleT-Regular', 'Goudy Old Style', serif")).toBe("Goudy Old Style");
  });

  it("derives a family name from a lone PostScript name", () => {
    expect(resolveFontFamily("'DF-DejavuPro'")).toBe("DF-Dejavu Pro");
  });

  it("takes the first family this app can render", () => {
    expect(resolveFontFamily("'Nonexistent Face', Roboto, sans-serif")).toBe("Roboto");
  });

  it("never returns a generic family", () => {
    expect(resolveFontFamily("serif")).toBe("system");
  });
});
