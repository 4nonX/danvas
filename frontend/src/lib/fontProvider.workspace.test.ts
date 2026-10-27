// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { fonts } from "./fontProvider";

// A browser that refuses one file ("bad"), as Firefox does with a defective
// character map, and takes the others.
function stubBrowser() {
  const added: string[] = [];
  const loads: string[] = [];
  class FakeFontFace {
    constructor(public family: string, public data: ArrayBuffer, public desc: { weight: string; style: string }) {}
    async load() {
      const name = new TextDecoder().decode(new Uint8Array(this.data));
      loads.push(name);
      if (name === "bad") throw new Error("rejected by sanitizer");
      return this;
    }
  }
  vi.stubGlobal("FontFace", FakeFontFace);
  Object.defineProperty(document, "fonts", { configurable: true, value: { add: (f: FakeFontFace) => added.push(`${f.desc.weight}/${f.desc.style}`) } });
  return { added, loads };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

afterEach(() => vi.unstubAllGlobals());

describe("workspace fonts", () => {
  it("uses the faces that load when one file is refused, and does not fetch the refused one again", async () => {
    const { added, loads } = stubBrowser();
    const files: Record<string, string> = { light: "bad", regular: "ok", bold: "ok" };
    const fetched: string[] = [];
    fonts.setWorkspaceFonts(
      [
        { id: "light", family: "Test Sans", weight: 300, style: "normal" },
        { id: "regular", family: "Test Sans", weight: 400, style: "normal" },
        { id: "bold", family: "Test Sans", weight: 700, style: "normal" },
      ],
      async (id) => { fetched.push(id); return new TextEncoder().encode(files[id]); },
    );

    fonts.ensure("Test Sans");
    await settle();
    await settle();

    expect(fonts.isReady("Test Sans")).toBe(true);
    expect(fonts.isSettled("Test Sans")).toBe(true);
    expect(added.sort()).toEqual(["400/normal", "700/normal"]);
    expect(fonts.faceState("Test Sans", { weight: 300, italic: false })).toBe("failed");
    expect(fonts.faceState("Test Sans", { weight: 700, italic: false })).toBe("ready");

    // Drawing again asks for the family again: nothing is loaded twice.
    fonts.ensure("Test Sans");
    fonts.ensure("Test Sans");
    await settle();
    expect(loads.filter((l) => l === "bad")).toHaveLength(1);
    expect(fetched.sort()).toEqual(["bold", "light", "regular"]);
  });
});
