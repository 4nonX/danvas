import { describe, expect, it } from "vitest";
import type { DesignRecord } from "@hc/sdk";
import { emptyableDesigns, mayOnTrashed } from "./trash";

const design = (id: string, createdById?: string) => ({ id, createdById }) as DesignRecord;
const trash = [design("a", "me"), design("b", "other"), design("c")];

describe("emptyableDesigns", () => {
  it("takes everything with the right on all", () => {
    expect(emptyableDesigns(trash, { "design.emptyTrash": "all" }, "me").map((d) => d.id)).toEqual(["a", "b", "c"]);
  });
  it("takes only the member's own with the right on own", () => {
    expect(emptyableDesigns(trash, { "design.emptyTrash": "own" }, "me").map((d) => d.id)).toEqual(["a"]);
  });
  it("takes nothing without the right, or with own and no known user", () => {
    expect(emptyableDesigns(trash, { "design.purge": "all" }, "me")).toEqual([]);
    expect(emptyableDesigns(trash, { "design.emptyTrash": "own" }, undefined)).toEqual([]);
  });
});

describe("mayOnTrashed", () => {
  it("follows each action's own scope", () => {
    const actions = { "design.restore": "all", "design.purge": "own" } as const;
    expect(mayOnTrashed(trash[1], "design.restore", actions, "me")).toBe(true);
    expect(mayOnTrashed(trash[0], "design.purge", actions, "me")).toBe(true);
    expect(mayOnTrashed(trash[1], "design.purge", actions, "me")).toBe(false);
    expect(mayOnTrashed(trash[2], "design.purge", actions, "me")).toBe(false);
  });
  it("allows nothing without the right", () => {
    expect(mayOnTrashed(trash[0], "design.restore", {}, "me")).toBe(false);
    expect(mayOnTrashed(trash[0], "design.purge", null, "me")).toBe(false);
  });
});
