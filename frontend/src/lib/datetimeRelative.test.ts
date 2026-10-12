import { describe, expect, it, vi } from "vitest";

vi.mock("@/store/auth", () => ({ useAuth: () => null }));

const { formatRelative, formatDate } = await import("./datetime");

const user = { locale: "en-US", timezone: "UTC" } as never;
const now = Date.parse("2026-10-12T12:00:00Z");
const ago = (ms: number) => new Date(now - ms).toISOString();

describe("formatRelative", () => {
  it("says how long ago within a week", () => {
    expect(formatRelative(ago(5 * 60_000), user, now)).toBe("5 minutes ago");
    expect(formatRelative(ago(3 * 3_600_000), user, now)).toBe("3 hours ago");
    expect(formatRelative(ago(26 * 3_600_000), user, now)).toBe("yesterday");
    expect(formatRelative(ago(6 * 86_400_000), user, now)).toBe("6 days ago");
  });

  it("speaks the user's language", () => {
    expect(formatRelative(ago(26 * 3_600_000), { locale: "de-DE", timezone: "UTC" } as never, now)).toBe("gestern");
  });

  it("falls back to the date past a week and for the future", () => {
    expect(formatRelative(ago(8 * 86_400_000), user, now)).toBe(formatDate(ago(8 * 86_400_000), user));
    expect(formatRelative(ago(-60_000), user, now)).toBe(formatDate(ago(-60_000), user));
  });
});
