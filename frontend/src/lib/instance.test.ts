import { afterEach, describe, expect, it } from "vitest";
import { withInstanceName } from "./instance";
import { resolvedLocale, DEFAULT_LOCALE } from "./locale";

const w = globalThis as unknown as { window?: { __HC_INSTANCE__?: unknown } };

describe("instance identity", () => {
  afterEach(() => { delete w.window; });

  it("leaves texts alone without an instance name", () => {
    expect(withInstanceName("Sign in · danvas")).toBe("Sign in · danvas");
  });

  it("names the product after the instance, but never in the licensor's notice", () => {
    w.window = { __HC_INSTANCE__: { name: "Atelier" } };
    expect(withInstanceName("Sign in · danvas")).toBe("Sign in · Atelier");
    const notice = "danvas is based on HyCanvas. © 2026 HyScaler. HyCanvas is a HyScaler® product.";
    expect(withInstanceName(notice)).toBe(notice);
  });

  it("uses the instance language as the default, over the browser's", () => {
    expect(resolvedLocale(null)).toBe(typeof navigator !== "undefined" && navigator.language ? navigator.language : DEFAULT_LOCALE);
    w.window = { __HC_INSTANCE__: { locale: "en-GB" } };
    expect(resolvedLocale(null)).toBe("en-GB");
    expect(resolvedLocale("fr")).toBe("fr");
  });
});
