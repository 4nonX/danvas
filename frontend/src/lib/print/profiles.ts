// The CMYK output profiles an export can use: the workspace's uploaded ones
// (the coated standards may not be redistributed, so an admin uploads the
// one their print shop works to) plus the freely shareable profile shipped
// with HyCanvas.

import type { PrintProfile } from "@hc/sdk";
import { oc } from "@/lib/sdk";

export interface ProfileOption {
  id: string;
  name: string;
  builtIn: boolean;
  isDefault: boolean;
}

const BUILT_IN: { id: string; name: string; url: string }[] = [
  { id: "builtin:pso-uncoated-fogra47", name: "PSO Uncoated ISO12647 (FOGRA47)", url: "/icc/PSO_Uncoated_ISO12647_eci.icc" },
];

/** Workspace profiles first (its default preselected), then the built-in. */
export async function listProfileOptions(workspaceId: string | null): Promise<ProfileOption[]> {
  let mine: PrintProfile[] = [];
  if (workspaceId) {
    try {
      mine = await oc.listPrintProfiles(workspaceId);
    } catch {
      mine = []; // the built-in still works without the list
    }
  }
  const out: ProfileOption[] = mine.map((p) => ({ id: p.id, name: p.name, builtIn: false, isDefault: p.isDefault }));
  for (const b of BUILT_IN) out.push({ id: b.id, name: b.name, builtIn: true, isDefault: !mine.length && b === BUILT_IN[0] });
  return out;
}

const bytesCache = new Map<string, Promise<Uint8Array>>();

/** The ICC bytes of a profile option (cached for the session). */
export function profileBytes(id: string): Promise<Uint8Array> {
  let p = bytesCache.get(id);
  if (!p) {
    const built = BUILT_IN.find((b) => b.id === id);
    p = built
      ? fetch(built.url).then(async (r) => {
          if (!r.ok) throw new Error(`profile: HTTP ${r.status}`);
          return new Uint8Array(await r.arrayBuffer());
        })
      : oc.printProfileData(id);
    p = p.catch((e: unknown) => {
      bytesCache.delete(id);
      throw e;
    });
    bytesCache.set(id, p);
  }
  return p;
}
