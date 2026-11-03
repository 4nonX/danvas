// What this member may do with designs in the trash. The actions are scoped:
// on everything, or on the designs the member created.

import { allowsAction, type Action, type ActionSet } from "@hc/authz";
import type { DesignRecord } from "@hc/sdk";

export function mayOnTrashed(d: DesignRecord, action: Action, actions: ActionSet | null | undefined, userId: string | undefined): boolean {
  return allowsAction(actions, action, !!userId && d.createdById === userId);
}

/** The designs "Empty trash" removes for this member. */
export function emptyableDesigns(trash: DesignRecord[], actions: ActionSet | null | undefined, userId: string | undefined): DesignRecord[] {
  return trash.filter((d) => mayOnTrashed(d, "design.emptyTrash", actions, userId));
}
