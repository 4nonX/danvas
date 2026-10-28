// A profile without every colour table print values are computed from is
// refused, never used in part: no value is worked out another way.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { CodedError } from "../errors";
import { createCmykConverter, missingTables } from "./cms";

const PROFILE = resolve(__dirname, "../../../public/icc/PSO_Uncoated_ISO12647_eci.icc");
const full = () => new Uint8Array(readFileSync(PROFILE));

/** The profile with one tag renamed, so the table is gone. */
function without(icc: Uint8Array, sig: string): Uint8Array {
  const out = new Uint8Array(icc);
  const view = new DataView(out.buffer);
  for (let i = 0; i < view.getUint32(128); i++) {
    const at = 132 + i * 12;
    if (String.fromCharCode(out[at], out[at + 1], out[at + 2], out[at + 3]) === sig) {
      out[at] = 0x7a; // "A2B0" becomes "z2B0": gone, and still unique
      return out;
    }
  }
  throw new Error(`the test profile has no ${sig}`);
}

describe("profiles without every table", () => {
  it("finds the complete bundled profile complete", () => {
    expect(missingTables(full())).toEqual([]);
  });

  for (const sig of ["A2B0", "A2B1", "B2A0", "B2A1", "wtpt"]) {
    it(`refuses a profile without ${sig}, naming it`, async () => {
      const icc = without(full(), sig);
      expect(missingTables(icc)).toEqual([sig]);
      const err = await createCmykConverter(icc).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(CodedError);
      expect((err as CodedError).code).toBe("errors.api_print_profile_incomplete");
      expect((err as Error).message).toContain(sig);
    });
  }

  it("does not need the unused saturation tables", async () => {
    const conv = await createCmykConverter(without(without(full(), "A2B2"), "B2A2"));
    try {
      const [L] = conv.lab(0, 0, 0, 0);
      expect(L).toBeGreaterThan(90);
    } finally {
      conv.dispose();
    }
  });

  it("gives every value of a complete profile through its own tables", async () => {
    const conv = await createCmykConverter(full());
    try {
      const black = conv.lab(0, 0, 0, 1);
      expect(black[0]).toBeLessThan(40);
      expect(conv.proof(new Uint8Array([0, 0, 0, 255]), 1, true)[0]).toBeLessThan(120);
    } finally {
      conv.dispose();
    }
  });
});
