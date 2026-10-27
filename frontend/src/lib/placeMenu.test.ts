import { describe, expect, it } from "vitest";
import { intersect, placeMenu } from "./placeMenu";

const bounds = { left: 260, top: 0, right: 1000, bottom: 800 };
const menu = { width: 240, height: 300 };

describe("placeMenu", () => {
  it("opens below, its end edge on the button's", () => {
    expect(placeMenu({ left: 600, top: 100, right: 630, bottom: 130 }, menu, bounds)).toEqual({ left: 390, top: 134 });
  });

  it("never reaches past the start of its bounds (the sidebar)", () => {
    const p = placeMenu({ left: 300, top: 100, right: 330, bottom: 130 }, menu, bounds);
    expect(p.left).toBe(268);
  });

  it("never reaches past the end of its bounds", () => {
    const p = placeMenu({ left: 980, top: 100, right: 1010, bottom: 130 }, menu, bounds, { align: "start" });
    expect(p.left + menu.width).toBe(992);
  });

  it("opens above when only that fits", () => {
    expect(placeMenu({ left: 600, top: 700, right: 630, bottom: 730 }, menu, bounds)).toEqual({ left: 390, top: 396 });
  });

  it("scrolls on the larger side when neither fits", () => {
    const p = placeMenu({ left: 600, top: 300, right: 630, bottom: 330 }, { width: 240, height: 700 }, bounds);
    expect(p).toEqual({ left: 390, top: 334, maxHeight: 458 });
    const q = placeMenu({ left: 600, top: 500, right: 630, bottom: 530 }, { width: 240, height: 700 }, bounds);
    expect(q).toEqual({ left: 390, top: 8, maxHeight: 488 });
  });

  it("mirrors in right-to-left", () => {
    expect(placeMenu({ left: 600, top: 100, right: 630, bottom: 130 }, menu, bounds, { rtl: true }).left).toBe(600);
  });

  it("intersects boxes", () => {
    expect(intersect({ left: 0, top: -50, right: 1200, bottom: 900 }, { left: 0, top: 0, right: 1100, bottom: 800 })).toEqual({ left: 0, top: 0, right: 1100, bottom: 800 });
  });
});
