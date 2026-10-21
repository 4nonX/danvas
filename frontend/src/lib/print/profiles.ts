// The CMYK output profiles an export can use: the user's own (Settings ›
// Colour profiles), the workspace's (uploaded by an admin: the coated
// standards may not be redistributed, so they are not shipped) and the
// freely shareable profile that comes with danvas.

import type { PrintProfile } from "@hc/sdk";
import { oc } from "@/lib/sdk";

export interface ProfileOption {
  id: string;
  name: string;
  builtIn: boolean;
  /** Whose it is: the user's own, the workspace's, or built in. */
  owner: "user" | "workspace" | "builtin";
  /** The one chosen when nothing else is: the user's default, else the
   *  workspace's, else the built-in. Exactly one option has it. */
  isDefault: boolean;
}

/** The built-in profile's id (always available, also offline). */
export const BUILTIN_PROFILE_ID = "builtin:pso-uncoated-fogra47";

const BUILT_IN: { id: string; name: string; url: string }[] = [
  { id: "builtin:pso-uncoated-fogra47", name: "PSO Uncoated ISO12647 (FOGRA47)", url: "/icc/PSO_Uncoated_ISO12647_eci.icc" },
];

/** The user's own profiles, then the workspace's, then the built-in. */
export async function listProfileOptions(workspaceId: string | null): Promise<ProfileOption[]> {
  // Either list may fail (offline, no access): the built-in always works.
  const [mine, shared] = await Promise.all([
    oc.listMyPrintProfiles().catch((): PrintProfile[] => []),
    workspaceId ? oc.listPrintProfiles(workspaceId).catch((): PrintProfile[] => []) : Promise.resolve([] as PrintProfile[]),
  ]);
  const out: ProfileOption[] = [
    ...mine.map((p) => ({ id: p.id, name: p.name, builtIn: false, owner: "user" as const, isDefault: false })),
    ...shared.map((p) => ({ id: p.id, name: p.name, builtIn: false, owner: "workspace" as const, isDefault: false })),
    ...BUILT_IN.map((b) => ({ id: b.id, name: b.name, builtIn: true, owner: "builtin" as const, isDefault: false })),
  ];
  const pick = mine.find((p) => p.isDefault)?.id ?? shared.find((p) => p.isDefault)?.id ?? BUILTIN_PROFILE_ID;
  for (const o of out) o.isDefault = o.id === pick;
  return out;
}

/** The profile a design is set up for: its own choice (DesignFile
 *  `colorProfile`) when that is available here, else the default. */
export function designProfileId(options: ProfileOption[], designProfile: string | undefined): string {
  if (designProfile && options.some((o) => o.id === designProfile)) return designProfile;
  return (options.find((o) => o.isDefault) ?? options[options.length - 1])?.id ?? BUILTIN_PROFILE_ID;
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
