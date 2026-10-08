// Template locks through the REAL editor store: the gates every edit passes,
// the notice a blocked user gets, the rights holder's own protection and its
// switch, and copies dropping the lock.

import { beforeEach, describe, expect, it } from "vitest";
import { createBlankDesign, createNode, type DesignFile, type Node } from "@hc/schema";
import { locate } from "@hc/editor";
import { useEditor } from "./editor";
import { useTemplateLock } from "./templateLock";

const WS = "ws-team";
const OTHER = "ws-other";

function node(type: string, id: string, extra: Record<string, unknown> = {}): Node {
  const n = createNode(type as Node["type"], { ...extra } as Partial<Node>);
  return { ...n, id, transform: { x: 10, y: 10, scaleX: 1, scaleY: 1, rotation: 0 } } as Node;
}

// A text node with a styled run, the shape setText edits.
const styled = (t: string) => ({
  content: [{ runs: [{ text: t, style: { fontId: "inter", fontSize: 24, weight: 400 } }], style: {} }],
  box: { width: 300, height: 40 },
});

function load(): void {
  const doc: DesignFile = createBlankDesign({ width: 800, height: 600 });
  const inner = node("text", "inner", styled("Inhalt"));
  doc.pages[0].children = [
    node("text", "title", { ...styled("Titel"), templateLock: { level: "content", workspaceId: WS } }),
    node("shape", "logo", { templateLock: { level: "locked", workspaceId: WS } }),
    node("group", "box", { children: [inner] }),
    node("shape", "free"),
    node("shape", "foreign", { templateLock: { level: "locked", workspaceId: OTHER } }),
  ];
  (doc.pages[0].children[2] as unknown as { children: Node[] }).children[0] = { ...inner, templateLock: { level: "locked", workspaceId: WS } } as Node;
  useEditor.getState().loadDoc(doc);
  useTemplateLock.setState({ designId: "d1", workspaceId: WS, workspaceName: "Team", canManage: false, workspaces: {}, editingTemplate: false, notice: null });
}

const at = (id: string) => locate(useEditor.getState().doc, id)!.node;
const text = (id: string) => ((at(id) as unknown as { content: { runs: { text: string }[] }[] }).content ?? []).map((p) => p.runs.map((r) => r.text).join("")).join("\n");

describe("template locks in the editor", () => {
  beforeEach(load);

  it("keeps a protected object in place and says why", () => {
    useEditor.getState().moveNodeBy("logo", 20, 0);
    expect(at("logo").transform.x).toBe(10);
    const n = useTemplateLock.getState().notice;
    expect(n?.holderId).toBe("logo");
    expect(n?.kind).toBe("structure");
    useEditor.getState().moveNodeBy("free", 20, 0);
    expect(at("free").transform.x).toBe(30);
  });

  it("lets the text of a content-level object change, but not its place", () => {
    useEditor.getState().setText("title", "Neuer Titel");
    expect(text("title")).toBe("Neuer Titel");
    useEditor.getState().moveNodeBy("title", 5, 5);
    expect(at("title").transform.x).toBe(10);
  });

  it("protects a locked object's content too", () => {
    useEditor.getState().setText("inner", "changed");
    expect(text("inner")).toBe("Inhalt");
    expect(useTemplateLock.getState().notice?.kind).toBe("content");
  });

  it("does not delete or ungroup a group holding a protected object", () => {
    useEditor.getState().select(["box"]);
    useEditor.getState().deleteSelection();
    expect(locate(useEditor.getState().doc, "box")).not.toBeNull();
    useEditor.getState().ungroupSelection();
    expect(at("box").type).toBe("group");
    expect(useTemplateLock.getState().notice?.holderId).toBe("inner");
  });

  it("keeps a page with protected objects", () => {
    useEditor.getState().addPage();
    const pages = useEditor.getState().doc.pages.length;
    useEditor.getState().deletePage(0);
    expect(useEditor.getState().doc.pages.length).toBe(pages);
  });

  it("protects rights holders too, until they switch to editing the template", () => {
    useTemplateLock.setState({ canManage: true });
    useEditor.getState().moveNodeBy("logo", 20, 0);
    expect(at("logo").transform.x).toBe(10);
    useTemplateLock.getState().setEditingTemplate(true);
    useEditor.getState().moveNodeBy("logo", 20, 0);
    expect(at("logo").transform.x).toBe(30);
    // The switch does not reach another workspace's locks.
    useEditor.getState().moveNodeBy("foreign", 20, 0);
    expect(at("foreign").transform.x).toBe(10);
    useTemplateLock.setState({ workspaces: { [OTHER]: { workspaceId: OTHER, name: "Other", contacts: [], canManage: true } } });
    useEditor.getState().moveNodeBy("foreign", 20, 0);
    expect(at("foreign").transform.x).toBe(30);
  });

  it("gives copies no lock; the original stays protected", () => {
    useEditor.getState().select(["logo"]);
    const ids = useEditor.getState().duplicateSelection();
    expect(ids.length).toBe(1);
    expect((at(ids[0]) as { templateLock?: unknown }).templateLock).toBeUndefined();
    expect((at("logo") as { templateLock?: unknown }).templateLock).toBeDefined();
  });

  it("sets and lifts locks only with the right, as one undo step", () => {
    expect(useEditor.getState().setTemplateLock(["free"], "content")).toBe(0);
    useTemplateLock.setState({ canManage: true });
    expect(useEditor.getState().setTemplateLock(["free"], "content")).toBe(1);
    expect((at("free") as { templateLock?: unknown }).templateLock).toEqual({ level: "content", workspaceId: WS });
    useEditor.getState().undo();
    expect((at("free") as { templateLock?: unknown }).templateLock).toBeUndefined();
    // Another workspace's lock stays without the right there.
    expect(useEditor.getState().setTemplateLock(["foreign"], null)).toBe(0);
    // Changing the level keeps the lock's own workspace.
    useTemplateLock.setState({ workspaces: { [OTHER]: { workspaceId: OTHER, name: "Other", contacts: [], canManage: true } } });
    expect(useEditor.getState().setTemplateLock(["foreign"], "content")).toBe(1);
    expect((at("foreign") as { templateLock?: unknown }).templateLock).toEqual({ level: "content", workspaceId: OTHER });
  });
});
