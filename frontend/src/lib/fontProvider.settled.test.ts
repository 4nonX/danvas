import { describe, expect, it } from "vitest";
import { fonts } from "./fontProvider";

describe("fonts.isSettled", () => {
  it("treats a family that can never load as settled, so exports do not wait for it", () => {
    fonts.ensure("Some Font Nobody Has");
    expect(fonts.isReady("Some Font Nobody Has")).toBe(false);
    expect(fonts.isSettled("Some Font Nobody Has")).toBe(true);
  });

  it("treats system fonts as settled", () => {
    expect(fonts.isSettled("Arial")).toBe(true);
  });
});
