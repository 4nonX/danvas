import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ACTIONS, allowsAction, coversActions, unionActions } from "../actions";

// The catalog is defined in Go (the server enforces it); this mirror must
// list the same actions, in the same order, with the same area and scope.
describe("action catalog parity with the Go backend", () => {
  it("matches backend/internal/authz/actions.go", () => {
    const go = readFileSync(resolve(__dirname, "../../../../backend/internal/authz/actions.go"), "utf8");
    const consts = new Map<string, string>();
    for (const m of go.matchAll(/\t(\w+)\s+Action = "([\w.]+)"/g)) consts.set(m[1], m[2]);
    const goCatalog = [...go.matchAll(/\{(\w+), "(\w+)", (true|false), "\w+"\}/g)].map((m) => ({
      key: consts.get(m[1]),
      area: m[2],
      scoped: m[3] === "true",
    }));
    expect(goCatalog.length).toBeGreaterThan(30);
    expect(ACTIONS.map((a) => ({ ...a }))).toEqual(goCatalog);
  });
});

describe("action sets", () => {
  it("allows by scope", () => {
    expect(allowsAction({ "design.trash": "own" }, "design.trash", true)).toBe(true);
    expect(allowsAction({ "design.trash": "own" }, "design.trash", false)).toBe(false);
    expect(allowsAction({ "design.trash": "all" }, "design.trash")).toBe(true);
    expect(allowsAction({}, "design.trash", true)).toBe(false);
  });
  it("unions with the widest scope and covers like the server", () => {
    const u = unionActions({ "design.trash": "own" }, { "design.trash": "all", "fonts.manage": "all" });
    expect(u).toEqual({ "design.trash": "all", "fonts.manage": "all" });
    expect(coversActions({ "design.trash": "own" }, { "design.trash": "all" })).toBe(false);
    expect(coversActions(u, { "design.trash": "own" })).toBe(true);
  });
});
