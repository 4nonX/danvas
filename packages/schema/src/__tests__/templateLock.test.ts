// Schema v27: template locks. `templateLock` ({ level, workspaceId }) is an
// optional key on every node. What is worth testing is the contract that keeps
// files openable: the level validates as ANY string, so a level added later
// never makes this client reject a whole file, and the version step rewrites
// nothing.

import { describe, expect, it } from "vitest";
import { createBlankDesign, createNode, currentSchemaVersion, migrate, NodeBaseSchema, validate, type Node } from "../index";

const text = (extra: Record<string, unknown> = {}) => createNode("text", { ...extra } as Partial<Node>);

describe("migration to v27", () => {
  it("pins the exact version pair (see the Go twin in v27_test.go)", () => {
    // The paired EXACT pins are the cross-language drift alarm: a future bump
    // must update this line, the Go pin, and both currentSchemaVersion mirrors
    // in the SAME change (CLAUDE.md bump protocol).
    expect(currentSchemaVersion).toBe(27);
  });

  it("is a pure no-op on a v26 document", () => {
    const before = { ...createBlankDesign(), schemaVersion: 26 } as Record<string, unknown>;
    const after = migrate(structuredClone(before) as never, 27) as unknown as Record<string, unknown>;
    expect(after.schemaVersion).toBe(27);
    expect({ ...after, schemaVersion: 26 }).toEqual(before);
  });

  it("carries a v1 document all the way up", () => {
    const old = { ...createBlankDesign(), schemaVersion: 1 } as Record<string, unknown>;
    const after = migrate(structuredClone(old) as never, 27) as unknown as Record<string, unknown>;
    expect(after.schemaVersion).toBe(27);
  });
});

describe("v27 template lock", () => {
  it("accepts a node without a lock, the shape every existing design has", () => {
    expect(NodeBaseSchema.safeParse(text()).success).toBe(true);
  });

  it("accepts both levels and keeps extra keys", () => {
    for (const level of ["locked", "content"]) {
      expect(NodeBaseSchema.safeParse(text({ templateLock: { level, workspaceId: "ws1" } })).success).toBe(true);
    }
    const parsed = NodeBaseSchema.safeParse(text({ templateLock: { level: "content", workspaceId: "ws1", by: "u1" } }));
    expect(parsed.success && (parsed.data.templateLock as Record<string, unknown>).by).toBe("u1");
  });

  it("accepts a level this client does not know rather than rejecting the file", () => {
    const file = createBlankDesign();
    file.pages[0].children = [text({ templateLock: { level: "some-future-level", workspaceId: "ws1" } }) as Node];
    expect(validate(file).ok).toBe(true);
  });

  it("rejects a lock without its workspace", () => {
    expect(NodeBaseSchema.safeParse(text({ templateLock: { level: "locked" } })).success).toBe(false);
  });
});
