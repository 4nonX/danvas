// Workspace actions (F42, docs/roadmap/42-roles-and-permissions.md): the
// things the server checks, mirrored from backend/internal/authz/actions.go
// (a test keeps the two equal). Permissions bundle actions with a scope,
// roles bundle permissions; both are data the server sends. The client uses
// this only to name actions and to decide what to show; the server decides.

export type ActionScope = "own" | "all";

export type ActionArea =
  | "designs"
  | "folders"
  | "uploads"
  | "sharing"
  | "approvals"
  | "templates"
  | "brand"
  | "print"
  | "fonts"
  | "ai"
  | "integrations"
  | "team";

export interface ActionDef {
  key: Action;
  area: ActionArea;
  /** Takes "own" (only what the member created) or "all". */
  scoped: boolean;
}

export const ACTIONS = [
  { key: "design.create", area: "designs", scoped: false },
  { key: "design.rename", area: "designs", scoped: true },
  { key: "design.edit", area: "designs", scoped: true },
  { key: "design.trash", area: "designs", scoped: true },
  { key: "design.restore", area: "designs", scoped: true },
  { key: "design.purge", area: "designs", scoped: true },
  { key: "design.download", area: "designs", scoped: false },
  { key: "design.colorList", area: "designs", scoped: false },
  { key: "design.comment", area: "designs", scoped: false },
  { key: "design.present", area: "designs", scoped: false },
  { key: "comment.moderate", area: "designs", scoped: false },
  { key: "folder.create", area: "folders", scoped: false },
  { key: "folder.edit", area: "folders", scoped: true },
  { key: "folder.delete", area: "folders", scoped: true },
  { key: "folder.defaults", area: "folders", scoped: false },
  { key: "asset.upload", area: "uploads", scoped: false },
  { key: "asset.edit", area: "uploads", scoped: true },
  { key: "asset.delete", area: "uploads", scoped: true },
  { key: "share.team", area: "sharing", scoped: false },
  { key: "share.external", area: "sharing", scoped: false },
  { key: "share.requests", area: "sharing", scoped: false },
  { key: "approval.request", area: "approvals", scoped: false },
  { key: "approval.decide", area: "approvals", scoped: false },
  { key: "template.publish", area: "templates", scoped: false },
  { key: "template.publishPublic", area: "templates", scoped: false },
  { key: "template.delete", area: "templates", scoped: false },
  { key: "template.collections", area: "templates", scoped: false },
  { key: "brand.kits", area: "brand", scoped: false },
  { key: "brand.designs", area: "brand", scoped: false },
  { key: "brand.unlock", area: "brand", scoped: false },
  { key: "brand.library", area: "brand", scoped: false },
  { key: "brand.copy", area: "brand", scoped: false },
  { key: "print.colorProfiles", area: "print", scoped: false },
  { key: "print.exportProfiles", area: "print", scoped: false },
  { key: "print.printPresets", area: "print", scoped: false },
  { key: "fonts.manage", area: "fonts", scoped: false },
  { key: "ai.use", area: "ai", scoped: false },
  { key: "ai.configure", area: "ai", scoped: false },
  { key: "canva.use", area: "integrations", scoped: false },
  { key: "canva.configure", area: "integrations", scoped: false },
  { key: "apiKeys.manage", area: "integrations", scoped: false },
  { key: "members.invite", area: "team", scoped: false },
  { key: "members.assign", area: "team", scoped: false },
  { key: "members.remove", area: "team", scoped: false },
  { key: "members.sso", area: "team", scoped: false },
  { key: "roles.manage", area: "team", scoped: false },
  { key: "activity.view", area: "team", scoped: false },
] as const satisfies readonly { key: string; area: ActionArea; scoped: boolean }[];

export type Action = (typeof ACTIONS)[number]["key"];

/** A permission's or a member's actions with their scope. */
export type ActionSet = Partial<Record<Action, ActionScope>>;

export const ACTION_AREAS: ActionArea[] = ["designs", "folders", "uploads", "sharing", "approvals", "templates", "brand", "print", "fonts", "ai", "integrations", "team"];

/** Whether the set allows the action; `own` says the target is the member's. */
export function allowsAction(set: ActionSet | null | undefined, action: Action, own = false): boolean {
  const scope = set?.[action];
  return scope === "all" || (scope === "own" && own);
}

/** Whether the set holds the action at any scope (for showing a control that
 *  may apply to some targets). */
export function hasAction(set: ActionSet | null | undefined, action: Action): boolean {
  return set?.[action] !== undefined;
}

/** The union of sets: an action in any, with the widest scope. */
export function unionActions(...sets: ActionSet[]): ActionSet {
  const out: ActionSet = {};
  for (const s of sets) {
    for (const [k, v] of Object.entries(s) as [Action, ActionScope][]) {
      if (out[k] !== "all") out[k] = v;
    }
  }
  return out;
}

/** The no-escalation rule: mine holds every action of other, as widely. */
export function coversActions(mine: ActionSet, other: ActionSet): boolean {
  return (Object.entries(other) as [Action, ActionScope][]).every(([k, v]) => mine[k] === "all" || (mine[k] === "own" && v === "own"));
}
