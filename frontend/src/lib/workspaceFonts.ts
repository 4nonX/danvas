// The workspace font library in the editor: fetched once per workspace and
// installed into the font provider, which loads each family's files on first
// use. Pickers list the families via useWorkspaceFontFamilies().

import { useEffect, useState } from "react";
import { oc } from "@/lib/sdk";
import { fonts } from "@/lib/fontProvider";

let loadedFor: string | null = null;

/** Fetch and install the workspace's fonts (no-op when already current;
 *  pass force after an upload or edit). */
export async function loadWorkspaceFonts(workspaceId: string | null, force = false): Promise<void> {
  if (!workspaceId || (!force && loadedFor === workspaceId)) return;
  loadedFor = workspaceId;
  try {
    const list = await oc.listWorkspaceFonts(workspaceId);
    fonts.setWorkspaceFonts(list, (id) => oc.workspaceFontFile(id));
  } catch {
    loadedFor = null; // retry on the next call
  }
}

/** The workspace font families, re-rendering when the library changes. */
export function useWorkspaceFontFamilies(): string[] {
  const [families, setFamilies] = useState(() => fonts.workspaceFamilies());
  useEffect(() => fonts.onChange(() => {
    const next = fonts.workspaceFamilies();
    setFamilies((cur) => (cur.join("\n") === next.join("\n") ? cur : next));
  }), []);
  return families;
}
