import { describe, expect, it } from "vitest";
import type { PrintPolicy } from "@hc/sdk";
import { clearanceOf } from "./printApproval";

const policy = (p: Partial<PrintPolicy>): PrintPolicy => ({ requireApproval: true, canChange: false, canBypass: false, approved: [], ...p });

describe("clearanceOf (F47)", () => {
  it("lets everything through when the rule is off or not loaded", () => {
    expect(clearanceOf(null, ["a"]).blocked).toBe(false);
    expect(clearanceOf(policy({ requireApproval: false }), ["a"]).blocked).toBe(false);
  });

  it("does not hold up those who decide approvals", () => {
    expect(clearanceOf(policy({ canBypass: true }), ["a", "b"])).toMatchObject({ blocked: false, waiting: 0 });
  });

  it("counts the designs still waiting for their approval", () => {
    expect(clearanceOf(policy({ approved: ["a"] }), ["a", "b", "c"])).toMatchObject({ blocked: true, waiting: 2 });
    expect(clearanceOf(policy({ approved: ["a", "b"] }), ["a", "b"])).toMatchObject({ blocked: false, waiting: 0 });
  });

  it("holds back a design that is not saved yet", () => {
    expect(clearanceOf(policy({}), [])).toMatchObject({ blocked: true, waiting: 1 });
  });
});
