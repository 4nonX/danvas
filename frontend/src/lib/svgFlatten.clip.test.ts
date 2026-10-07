// @vitest-environment jsdom
// Outlined text as design tools export it: each word is a filled rectangle
// clipped by the letter outlines. jsdom has no layout (no getBBox), so this
// also proves the conversion does not depend on the browser measuring anything.
import { describe, expect, it } from "vitest";
import { flattenSvgToNodes } from "./svgFlatten";

const LOGO = `<?xml version="1.0" encoding="UTF-8" standalone="no"?><!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">
<svg width="100%" height="100%" viewBox="0 0 4167 4167" xmlns="http://www.w3.org/2000/svg"><g>
<path d="M1100,3120h400v360h-400zM1600,3120h300v360h-300z" style="fill:#196141;fill-rule:nonzero;"/>
<clipPath id="_clip1"><path d="M1100,3120h400v360h-400zM1600,3120h300v360h-300z" clip-rule="nonzero"/></clipPath>
<g clip-path="url(#_clip1)"><rect x="1086.58" y="3106.72" width="1985.9" height="393.275" style="fill:#196141;fill-rule:nonzero;"/></g>
<path d="M1100,2720h500v260h-500z" style="fill:#749e8b;fill-rule:nonzero;"/>
<clipPath id="_clip2"><path d="M1100,2720h500v260h-500z" clip-rule="nonzero"/></clipPath>
<g clip-path="url(#_clip2)"><rect x="1083.33" y="2707.18" width="2004.17" height="277.075" style="fill:#749e8b;fill-rule:nonzero;"/></g>
</g></svg>`;

describe("clipped fills (outlined text)", () => {
  it("turns a clipped rectangle into the clip's letter shapes, never a bare bar", () => {
    const { nodes } = flattenSvgToNodes(LOGO, { fallbackFill: true });
    expect(nodes.some((n) => n.type === "shape")).toBe(false);
    const paths = nodes.filter((n) => n.type === "path");
    expect(paths).toHaveLength(4); // two outlines + the two clipped words as letter shapes
    const colors = paths.map((n) => {
      const c = (n as unknown as { fills: { color: { srgb: { r: number; g: number; b: number } } }[] }).fills[0].color.srgb;
      return [c.r, c.g, c.b].map((v) => Math.round(v * 255));
    });
    expect(colors).toContainEqual([0x19, 0x61, 0x41]);
    expect(colors).toContainEqual([0x74, 0x9e, 0x8b]);
  });
});
