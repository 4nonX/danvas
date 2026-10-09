// An edge handle on an image changes its frame AND its crop in one gesture;
// the undo snapshot must carry both, including "no crop" (the whole file).

import { beforeEach, describe, expect, it } from "vitest";
import { createBlankDesign, createNode, type ImageNode, type Node } from "@hc/schema";
import { locate } from "@hc/editor";
import { useEditor } from "./editor";

function load(): void {
  const doc = createBlankDesign({ width: 800, height: 600 });
  const img = createNode("image", {
    source: { assetId: "a", naturalWidth: 1000, naturalHeight: 500 },
    fit: "cover",
  } as Partial<Node>);
  doc.pages[0].children = [{ ...img, id: "img", transform: { x: 100, y: 50, scaleX: 1, scaleY: 1, rotation: 0 }, size: { width: 200, height: 100 } } as Node];
  useEditor.getState().loadDoc(doc);
}

const img = () => locate(useEditor.getState().doc, "img")!.node as unknown as ImageNode;

describe("image edge crop undo", () => {
  beforeEach(load);

  it("restores a frame that had no crop, and redoes the crop", () => {
    const before = { transform: { ...img().transform }, size: { ...img().size }, image: { fit: img().fit } };
    expect(img().crop).toBeUndefined();
    // The gesture: left edge in by 50 units.
    const n = img();
    n.transform = { ...n.transform, x: 150 };
    n.size = { width: 150, height: 100 };
    n.crop = { x: 0.25, y: 0, width: 0.75, height: 1 };
    useEditor.getState().pushNodeSnapshot("img", before);

    useEditor.getState().undo();
    expect(img().crop).toBeUndefined();
    expect(img().size).toEqual({ width: 200, height: 100 });
    expect(img().transform.x).toBe(100);

    useEditor.getState().redo();
    expect(img().crop).toEqual({ x: 0.25, y: 0, width: 0.75, height: 1 });
    expect(img().size).toEqual({ width: 150, height: 100 });
    expect(img().transform.x).toBe(150);
  });

  it("restores an earlier crop", () => {
    const n = img();
    n.crop = { x: 0.1, y: 0, width: 0.8, height: 1 };
    const before = { transform: { ...n.transform }, size: { ...n.size }, image: { fit: n.fit, crop: { ...n.crop } } };
    n.crop = { x: 0.3, y: 0, width: 0.6, height: 1 };
    n.size = { width: 150, height: 100 };
    useEditor.getState().pushNodeSnapshot("img", before);
    useEditor.getState().undo();
    expect(img().crop).toEqual({ x: 0.1, y: 0, width: 0.8, height: 1 });
  });
});
