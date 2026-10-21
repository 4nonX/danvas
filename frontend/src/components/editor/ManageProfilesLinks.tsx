// "Manage: Mine · Workspace" beside a profile picker. Colour profiles, export
// profiles and print presets each exist as your own (Settings) and as the
// workspace's (the dashboard's Members page), so a picker that lists both
// leads to both.

import Link from "next/link";
import { tr } from "@/lib/i18n";
import { settingsPath } from "@/components/settings/tabs";
import { dashboardPath } from "@/components/dashboard/views";

export type ProfileKind = "color-profiles" | "export-profiles" | "print-presets";

/** Where the workspace's profiles of a kind are listed (an anchor on the
 *  Members page). */
export const workspaceProfilesPath = (kind: ProfileKind) => `${dashboardPath("members")}#${kind}`;

export function ManageProfilesLinks({ kind, newTab = false }: { kind: ProfileKind; newTab?: boolean }) {
  const link = "font-medium text-brand-ink hover:underline";
  const target = newTab ? { target: "_blank", rel: "noreferrer" } : {};
  return (
    <span className="shrink-0 text-[11px] text-neutral-400">
      {tr("editor.manage_profiles")}{" "}
      <Link href={settingsPath(kind)} className={link} title={tr("editor.manage_profiles_mine_title")} {...target}>{tr("editor.manage_profiles_mine")}</Link>
      {" · "}
      <Link href={workspaceProfilesPath(kind)} className={link} title={tr("editor.manage_profiles_workspace_title")} {...target}>{tr("editor.manage_profiles_workspace")}</Link>
    </span>
  );
}
