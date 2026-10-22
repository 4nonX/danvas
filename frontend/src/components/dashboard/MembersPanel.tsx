// Workspace member management (team invitations): roster
// with role changes + removal, invite-by-email, and pending invitations with
// resend/revoke. Roles are the workspace's own (F42): the selects list them,
// and what the caller may do or hand out follows their role's actions. The
// backend (accounts members) enforces the real authority + last-owner
// invariants; this UI hides clearly-disallowed controls and surfaces server
// errors via toast. Personal workspaces are single-user, so management is
// hidden.

import { useCallback, useEffect, useState } from "react";
import { Trash2, Mail, Clock, Crown, Shield, Plus, ChevronDown, Users, UserPlus, Pencil, AlertTriangle, LogIn } from "lucide-react";
import { ApiError, type Capability, type CustomRoleView, type WorkspaceInvitation, type WorkspaceMemberView, type WorkspaceRole, type WorkspaceRoleView, type WorkspaceRolesView } from "@hc/sdk";
import { coversActions } from "@hc/authz";
import Link from "next/link";
import { oc } from "@/lib/sdk";
import { roleHint, roleName } from "@/lib/roles";
import { refreshWorkspaceActions } from "@/store/workspaceActions";
import { dashboardPath } from "./views";
import { useToast } from "@/components/ui/Toast";
import { Button } from "@/components/ui/Button";
import { tr } from "@/lib/i18n";

const rank: Record<WorkspaceRole, number> = { viewer: 1, member: 2, admin: 3, owner: 4 };

// Chip styling: the owner role in amber, the seeded admin role in the accent,
// every other role neutral (a team's own roles have no fixed authority).
function badgeClass(r: WorkspaceRoleView | undefined): string {
  if (r?.protected) return "bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200";
  if (r?.seedKey === "admin") return "bg-brand-50 text-brand-ink ring-1 ring-inset ring-brand-200";
  if (r?.seedKey === "viewer") return "bg-slate-100 text-slate-600 ring-1 ring-inset ring-slate-200";
  return "bg-neutral-100 text-neutral-700 ring-1 ring-inset ring-neutral-200";
}

// Capabilities a custom role can grant, with friendly labels.
const capabilities = (): { id: Capability; label: string }[] => [
  { id: "view", label: tr("dashboard.view") },
  { id: "comment", label: tr("dashboard.comment") },
  { id: "edit", label: tr("dashboard.edit") },
  { id: "share", label: tr("dashboard.share") },
  { id: "approve", label: tr("dashboard.approve") },
  { id: "manage-brand", label: tr("dashboard.manage_brand") },
  // "manage-locks" is newer than some @hc/sdk builds' Capability union.
  { id: "manage-locks" as Capability, label: tr("dashboard.manage_locks") },
  { id: "manage-roles", label: tr("dashboard.manage_roles") },
  { id: "delete", label: tr("dashboard.delete") },
];

function initials(nameOrEmail: string): string {
  const s = (nameOrEmail || "?").trim();
  const parts = s.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return s.slice(0, 2).toUpperCase();
}

function relativeExpiry(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  if (Number.isNaN(ms) || ms <= 0) return tr("dashboard.expiry_expired");
  const days = Math.round(ms / 86_400_000);
  if (days >= 1) return tr("dashboard.expiry_in_days", { count: days });
  const hours = Math.round(ms / 3_600_000);
  if (hours >= 1) return tr("dashboard.expiry_in_hours", { count: hours });
  return tr("dashboard.expiry_soon");
}

/** The API's problem code of a failed request, if any. */
const problemCode = (e: unknown) => (e instanceof ApiError ? (e.body as { code?: string } | null)?.code : undefined);

// Small section header: an icon, an uppercase label, an optional count, and an
// optional trailing action (e.g. "New role").
function SectionHeader({
  icon: Icon,
  label,
  count,
  action,
}: {
  icon: typeof Users;
  label: string;
  count?: number;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-2 flex items-center justify-between">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
        <Icon size={14} className="text-neutral-400" />
        <span>{label}</span>
        {count !== undefined && (
          <span className="rounded-full bg-neutral-100 px-1.5 py-0.5 text-[11px] font-semibold text-neutral-500">{count}</span>
        )}
      </div>
      {action}
    </div>
  );
}

function RoleBadge({ role }: { role: WorkspaceRoleView | undefined }) {
  return (
    <span className={`inline-flex max-w-[11rem] items-center gap-1 truncate rounded-full px-2.5 py-1 text-xs font-medium ${badgeClass(role)}`}>
      {role?.protected && <Crown size={12} />}
      {role ? roleName(role) : "?"}
    </span>
  );
}

// Styled native <select> for picking a role (accessible, no extra deps). `size`
// "md" matches the invite input; "sm" is the compact inline roster control.
function RoleSelect({
  value,
  roles,
  onChange,
  ariaLabel,
  size = "md",
}: {
  value: string;
  roles: WorkspaceRoleView[];
  onChange: (roleId: string) => void;
  ariaLabel: string;
  size?: "md" | "sm";
}) {
  const dims =
    size === "md"
      ? "h-11 rounded-xl ps-3.5 pe-9 text-sm font-medium"
      : "h-8 rounded-lg ps-2.5 pe-7 text-xs font-medium";
  const chevron = size === "md" ? "end-3" : "end-2";
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={ariaLabel}
        className={`${dims} w-full appearance-none border border-neutral-200 bg-surface text-neutral-700 outline-none transition hover:border-neutral-300 focus:border-brand-500 focus:ring-2 focus:ring-brand-100`}
      >
        {roles.map((r) => (
          <option key={r.id} value={r.id}>
            {roleName(r)}
          </option>
        ))}
      </select>
      <ChevronDown size={size === "md" ? 16 : 14} className={`pointer-events-none absolute ${chevron} top-1/2 -translate-y-1/2 text-neutral-400`} />
    </div>
  );
}

function Avatar({ label }: { label: string }) {
  return (
    <span className="oc-gradient grid h-9 w-9 shrink-0 place-items-center rounded-full text-xs font-bold text-white shadow-sm">
      {initials(label)}
    </span>
  );
}

export function MembersPanel({
  workspaceId,
  workspaceName,
  workspaceKind,
  myUserId,
  onExit,
}: {
  workspaceId: string | null;
  workspaceName: string;
  workspaceKind: string;
  myUserId: string;
  onExit?: () => void; // the caller left or deleted this workspace -> leave the page
}) {
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [members, setMembers] = useState<WorkspaceMemberView[]>([]);
  const [invites, setInvites] = useState<WorkspaceInvitation[]>([]);
  const [email, setEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<string>("");
  // The workspace's roles and what the caller's role allows (F42).
  const [rolesView, setRolesView] = useState<WorkspaceRolesView | null>(null);
  const [busy, setBusy] = useState(false);
  // Delete-workspace confirmation (owner-only, non-personal). The user must type
  // the workspace name to arm the destructive action.
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [deleting, setDeleting] = useState(false);

  const isPersonal = workspaceKind === "personal";
  const mine = rolesView?.myActions ?? {};
  const roles = rolesView?.roles ?? [];
  const roleById = new Map(roles.map((r) => [r.id, r]));
  const myRoleView = rolesView ? roleById.get(rolesView.myRoleId) : undefined;
  const canInvite = !!mine["members.invite"];
  const canAssign = !!mine["members.assign"];
  const canRemove = !!mine["members.remove"];
  const canSso = !!mine["members.sso"];
  const canManageRoles = !!mine["roles.manage"];
  // Only what the caller holds may be handed out; the owner role by owners.
  const mayHandOut = (r: WorkspaceRoleView | undefined) => !!r && (r.protected ? !!myRoleView?.protected : coversActions(mine, r.actions));
  const roleOf = (m: { role: WorkspaceRole; roleId?: string }) => (m.roleId && roleById.get(m.roleId)) || roles.find((r) => r.seedKey === m.role);

  async function deleteWorkspace() {
    if (!workspaceId || deleteConfirm !== workspaceName) return;
    setDeleting(true);
    try {
      await oc.deleteWorkspace(workspaceId);
      toast.success(tr("dashboard.workspace_deleted", { name: workspaceName }));
      onExit?.();
    } catch {
      toast.error(tr("dashboard.could_not_delete_the_workspace"));
    } finally {
      setDeleting(false);
    }
  }

  const reload = useCallback(async () => {
    if (!workspaceId || isPersonal) return;
    try {
      const [m, rv] = await Promise.all([oc.workspaceMembers(workspaceId), oc.workspaceRoles(workspaceId).catch(() => null)]);
      setMembers(m);
      if (rv) setRolesView(rv);
      if (rv?.myActions["members.invite"]) {
        setInvites(await oc.workspaceInvitations(workspaceId).catch(() => []));
      }
    } catch {
      toast.error(tr("dashboard.could_not_load_members"));
    }
  }, [workspaceId, isPersonal, toast]);

  useEffect(() => {
    if (!workspaceId || isPersonal) return;
    let cancelled = false;
    void (async () => {
      setLoading(true);
      try {
        const [m, rv] = await Promise.all([oc.workspaceMembers(workspaceId), oc.workspaceRoles(workspaceId).catch(() => null)]);
        if (cancelled) return;
        setMembers(m);
        setRolesView(rv);
        const memberRole = rv?.roles.find((r) => r.seedKey === "member") ?? rv?.roles.find((r) => !r.protected);
        if (memberRole) setInviteRole((cur) => cur || memberRole.id);
        if (rv?.myActions["members.invite"]) {
          const inv = await oc.workspaceInvitations(workspaceId).catch(() => []);
          if (!cancelled) setInvites(inv);
        }
      } catch {
        if (!cancelled) toast.error(tr("dashboard.could_not_load_members"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [workspaceId, isPersonal, toast]);

  async function sendInvite(toEmail = email, role = inviteRole, isResend = false) {
    const addr = toEmail.trim();
    if (!workspaceId || !addr) return;
    setBusy(true);
    try {
      await oc.invite(workspaceId, { email: addr, roleId: role });
      if (!isResend) setEmail("");
      toast.success(isResend ? tr("dashboard.invitation_resent", { email: addr }) : tr("dashboard.invitation_sent", { email: addr }));
      await reload();
    } catch (e) {
      // Someone who is already a member needs no invitation: their role is
      // changed in the list.
      if (problemCode(e) === "already_workspace_member") toast.error(tr("dashboard.invite_already_member", { email: addr }));
      else toast.error(tr("dashboard.could_not_send_the_invitation"));
    } finally {
      setBusy(false);
    }
  }

  async function changeRole(m: WorkspaceMemberView, roleId: string) {
    if (!workspaceId || roleId === roleOf(m)?.id) return;
    try {
      await oc.changeMemberRole(workspaceId, m.userId, roleId);
      const r = roleById.get(roleId);
      toast.success(tr("dashboard.member_role_changed", { name: m.name || m.email, role: r ? roleName(r) : "" }));
      await reload();
      if (m.userId === myUserId) await refreshWorkspaceActions(workspaceId);
    } catch {
      toast.error(tr("dashboard.could_not_change_the_role"));
    }
  }

  async function removeMember(m: WorkspaceMemberView) {
    if (!workspaceId) return;
    const self = m.userId === myUserId;
    try {
      await oc.removeMember(workspaceId, m.userId);
      toast.success(self ? tr("dashboard.you_left_the_workspace") : tr("dashboard.member_removed", { name: m.name || m.email }));
      if (self) {
        onExit?.();
        return;
      }
      await reload();
    } catch {
      toast.error(self ? tr("dashboard.could_not_leave_a_workspace_needs_an_owner") : tr("dashboard.could_not_remove_this_member"));
    }
  }

  // An invitation to someone who has become a member since (for example by
  // signing in through SSO): give them the invited role, and the invitation
  // is no longer needed.
  async function applyInvitedRole(inv: WorkspaceInvitation, m: WorkspaceMemberView) {
    if (!workspaceId) return;
    setBusy(true);
    try {
      const invited = roleOf(inv);
      const current = roleOf(m);
      // Like before: the invited role only when it ranks higher.
      const raise = !!invited && rank[inv.role] > rank[m.role];
      if (raise && invited) await oc.changeMemberRole(workspaceId, m.userId, invited.id);
      await oc.revokeInvitation(workspaceId, inv.id);
      const shown = raise ? invited : current;
      toast.success(tr("dashboard.member_role_changed", { name: m.name || m.email, role: shown ? roleName(shown) : "" }));
      await reload();
    } catch {
      toast.error(tr("dashboard.could_not_change_the_role"));
    } finally {
      setBusy(false);
    }
  }

  async function revoke(inv: WorkspaceInvitation) {
    if (!workspaceId) return;
    try {
      await oc.revokeInvitation(workspaceId, inv.id);
      toast.success(tr("dashboard.invitation_revoked"));
      await reload();
    } catch {
      toast.error(tr("dashboard.could_not_revoke_the_invitation"));
    }
  }

  // Whether the caller may manage (change role / remove) the given member:
  // never themselves (that is "Leave"), never someone above them.
  const canManageTarget = (m: WorkspaceMemberView) => m.userId !== myUserId && (canAssign || canRemove) && mayHandOut(roleOf(m));
  // The roles this caller may assign: those they could hand out, plus the
  // member's current one so the select shows it.
  const assignableRoles = (m: WorkspaceMemberView) => {
    const cur = roleOf(m);
    return roles.filter((r) => mayHandOut(r) || r.id === cur?.id);
  };
  const invitableRoles = roles.filter((r) => mayHandOut(r));
  const inviteRoleView = roleById.get(inviteRole);
  const alone = members.length <= 1;

  return (
    <div className="w-full">
      {isPersonal ? (
        <div className="rounded-xl border border-dashed border-neutral-300 bg-neutral-50 p-8 text-center">
          <Users size={28} className="mx-auto mb-3 text-neutral-400" />
          <p className="text-sm font-medium text-neutral-700">{tr("dashboard.this_is_your_personal_workspace")}</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-neutral-500">
            {tr("dashboard.solo_workspace_invite_hint")}
          </p>
        </div>
      ) : (
        <div className="space-y-7">
          {/* Invite (members.invite). */}
          {canInvite && (
            <section>
              <SectionHeader
                icon={UserPlus}
                label={tr("dashboard.invite_people")}
                action={
                  <Link href={dashboardPath("roles")} className="flex items-center gap-1 text-xs font-semibold text-brand-ink hover:text-brand-800">
                    <Shield size={14} /> {canManageRoles ? tr("roles.manage_roles") : tr("roles.view_roles")}
                  </Link>
                }
              />
              <div className="flex items-stretch gap-2">
                <div className="relative min-w-0 flex-1">
                  <Mail size={16} className="pointer-events-none absolute start-3.5 top-1/2 -translate-y-1/2 text-neutral-400" />
                  <input
                    type="email"
                    placeholder={tr("dashboard.teammate_example_com")}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && email.trim() && !busy) void sendInvite();
                    }}
                    aria-label={tr("dashboard.invite_by_email")}
                    className="h-11 w-full rounded-xl border border-neutral-200 bg-surface ps-10 pe-3 text-sm text-neutral-900 placeholder:text-neutral-400 outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
                  />
                </div>
                <div className="w-40 shrink-0">
                  <RoleSelect value={inviteRole} roles={invitableRoles} onChange={setInviteRole} ariaLabel={tr("dashboard.invite_role")} />
                </div>
                <Button className="h-11 shrink-0 px-5" disabled={busy || !email.trim()} onClick={() => void sendInvite()}>
                  <Mail size={16} /> {tr("dashboard.invite")}
                </Button>
              </div>
              <p className="mt-2 text-xs text-neutral-500">
                {inviteRoleView && <span className="font-medium text-neutral-600">{roleName(inviteRoleView)}:</span>} {inviteRoleView ? roleHint(inviteRoleView) : ""} {tr("dashboard.invite_email_hint")}
              </p>
            </section>
          )}

          {/* Everyone signing in through SSO joins (members.sso). */}
          {canSso && workspaceId && <SsoJoinSection workspaceId={workspaceId} roles={roles.filter((r) => !r.protected && mayHandOut(r))} onChanged={() => void reload()} />}

          {/* Roster. */}
          <section>
            <SectionHeader icon={Users} label={tr("dashboard.people_with_access")} count={members.length} />
            {loading ? (
              <SkeletonList />
            ) : (
              <ul className="divide-y divide-neutral-100 overflow-hidden rounded-xl border border-neutral-200">
                {members.map((m) => {
                  const self = m.userId === myUserId;
                  const manageable = canManageTarget(m);
                  return (
                    <li key={m.userId} className="flex items-center gap-3 px-3.5 py-3 transition-colors hover:bg-neutral-50/70">
                      <Avatar label={m.name || m.email} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate text-sm font-semibold text-neutral-800">{m.name || m.email}</span>
                          {self && <span className="shrink-0 text-xs font-normal text-neutral-400">(you)</span>}
                        </div>
                        <div className="truncate text-xs text-neutral-500">{m.email}</div>
                      </div>
                      {manageable ? (
                        canAssign ? (
                          <div className="w-36 shrink-0">
                            <RoleSelect
                              value={roleOf(m)?.id ?? ""}
                              roles={assignableRoles(m)}
                              onChange={(r) => void changeRole(m, r)}
                              ariaLabel={tr("dashboard.role_for", { name: m.name || m.email })}
                              size="sm"
                            />
                          </div>
                        ) : (
                          <RoleBadge role={roleOf(m)} />
                        )
                      ) : (
                        <RoleBadge role={roleOf(m)} />
                      )}
                      {self && !alone ? (
                        <button
                          onClick={() => void removeMember(m)}
                          className="shrink-0 rounded-lg px-2.5 py-1 text-xs font-medium text-neutral-500 transition-colors hover:bg-red-50 hover:text-red-600"
                          title={tr("dashboard.leave_workspace")}
                        >
                          {tr("dashboard.leave")}
                        </button>
                      ) : manageable && canRemove ? (
                        <button
                          onClick={() => void removeMember(m)}
                          aria-label={tr("dashboard.remove_member_named", { name: m.name || m.email })}
                          className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-neutral-400 transition-colors hover:bg-red-50 hover:text-red-600"
                          title={tr("dashboard.remove_member")}
                        >
                          <Trash2 size={15} />
                        </button>
                      ) : (
                        <span className="w-8 shrink-0" />
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {/* Pending invitations (members.invite). */}
          {canInvite && invites.length > 0 && (
            <section>
              <SectionHeader icon={Clock} label={tr("dashboard.pending_invitations")} count={invites.length} />
              <ul className="divide-y divide-neutral-100 overflow-hidden rounded-xl border border-neutral-200">
                {invites.map((inv) => {
                  const member = members.find((x) => x.email.toLowerCase() === inv.email.toLowerCase());
                  return (
                  <li key={inv.id} className="flex items-center gap-3 px-3.5 py-3 transition-colors hover:bg-neutral-50/70">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-100">
                      <Clock size={16} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-neutral-800">{inv.email}</div>
                      <div className="truncate text-xs text-neutral-500">
                        {member
                          ? tr("dashboard.invite_to_member", { role: roleOf(member) ? roleName(roleOf(member)!) : "", invited: roleOf(inv) ? roleName(roleOf(inv)!) : "" })
                          : tr("dashboard.invited_as_role_expires", { role: roleOf(inv) ? roleName(roleOf(inv)!) : "", expiry: relativeExpiry(inv.expiresAt) })}
                      </div>
                    </div>
                    {member ? (
                      <button
                        onClick={() => void applyInvitedRole(inv, member)}
                        disabled={busy}
                        className="shrink-0 rounded-lg px-2.5 py-1 text-xs font-medium text-brand-ink transition-colors hover:bg-brand-50 disabled:opacity-50"
                      >
                        {tr("dashboard.apply_invited_role")}
                      </button>
                    ) : (
                      <button
                        onClick={() => void sendInvite(inv.email, roleOf(inv)?.id ?? inviteRole, true)}
                        disabled={busy}
                        className="shrink-0 rounded-lg px-2.5 py-1 text-xs font-medium text-brand-ink transition-colors hover:bg-brand-50 disabled:opacity-50"
                      >
                        {tr("dashboard.resend")}
                      </button>
                    )}
                    <button
                      onClick={() => void revoke(inv)}
                      className="shrink-0 rounded-lg px-2.5 py-1 text-xs font-medium text-neutral-500 transition-colors hover:bg-red-50 hover:text-red-600"
                    >
                      {tr("dashboard.revoke")}
                    </button>
                  </li>
                  );
                })}
              </ul>
            </section>
          )}

          {/* Roles for single designs (attached to share grants; roles.manage). */}
          {canManageRoles && workspaceId && (
            <section className="border-t border-neutral-100 pt-5">
              <CustomRolesSection workspaceId={workspaceId} />
            </section>
          )}

          {/* Danger zone: delete the workspace (the owner role only). */}
          {myRoleView?.protected && workspaceId && (
            <section className="border-t border-neutral-100 pt-5">
              <SectionHeader icon={AlertTriangle} label={tr("dashboard.danger_zone")} />
              <div className="rounded-xl border border-red-200 bg-red-50/40 p-4">
                <p className="text-sm font-semibold text-neutral-800">{tr("dashboard.delete_this_workspace")}</p>
                <p className="mt-1 text-xs text-neutral-600">
                  {tr("dashboard.permanently_deletes")} <span className="font-semibold">{workspaceName}</span> {tr("dashboard.delete_workspace_contents")}
                </p>
                {!confirmingDelete ? (
                  <Button variant="danger" size="sm" className="mt-3" onClick={() => setConfirmingDelete(true)}>
                    <Trash2 size={15} /> {tr("dashboard.delete_workspace")}
                  </Button>
                ) : (
                  <div className="mt-3">
                    <label htmlFor="ws-delete-confirm" className="block text-xs font-medium text-neutral-700">
                      {tr("dashboard.type")} <span className="font-semibold">{workspaceName}</span> {tr("dashboard.to_confirm")}
                    </label>
                    <input
                      id="ws-delete-confirm"
                      value={deleteConfirm}
                      onChange={(e) => setDeleteConfirm(e.target.value)}
                      autoFocus
                      placeholder={workspaceName}
                      className="mt-1.5 h-10 w-full rounded-xl border border-neutral-200 bg-surface px-3 text-sm text-neutral-900 placeholder:text-neutral-300 outline-none transition focus:border-red-400 focus:ring-2 focus:ring-red-100"
                    />
                    <div className="mt-3 flex justify-end gap-2">
                      <Button variant="ghost" size="sm" onClick={() => { setConfirmingDelete(false); setDeleteConfirm(""); }}>
                        {tr("dashboard.cancel")}
                      </Button>
                      <Button variant="danger" size="sm" disabled={deleting || deleteConfirm !== workspaceName} onClick={() => void deleteWorkspace()}>
                        {deleting ? tr("dashboard.deleting") : tr("dashboard.delete_forever")}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}

// Placeholder rows while the roster loads.
/** A workspace that takes in everyone signing in through single sign-on, at
 *  a fixed role (member or viewer). Switching it on adds everyone who already
 *  has an SSO account; the server never lowers a higher role, and people
 *  removed from the workspace are not added back. */
function SsoJoinSection({ workspaceId, roles, onChanged }: { workspaceId: string; roles: WorkspaceRoleView[]; onChanged: () => void }) {
  const toast = useToast();
  // What the server holds (null while loading), mapped to a role id at render
  // time: an older server sends only the base role name.
  const [join, setJoin] = useState<{ role: string; roleId?: string } | null>(null);
  const [picked, setPicked] = useState<string>("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let cancelled = false;
    oc.getSsoJoin(workspaceId).then(
      (j) => { if (!cancelled) setJoin({ role: j.role, roleId: j.roleId }); },
      () => { if (!cancelled) setJoin({ role: "" }); },
    );
    return () => { cancelled = true; };
  }, [workspaceId]);
  // The role id people join with ("" = off); null while loading.
  const role = join === null ? null : join.role ? join.roleId || roles.find((r) => r.seedKey === join.role)?.id || "" : "";
  const pick = picked || role || (roles.find((r) => r.seedKey === "member") ?? roles[0])?.id || "";
  const setPick = setPicked;

  async function apply(next: string) {
    setBusy(true);
    try {
      const r = await oc.setSsoJoin(workspaceId, next);
      setJoin({ role: r.role, roleId: r.roleId ?? next });
      if (r.role && r.added > 0) toast.success(tr("dashboard.sso_join_added", { count: r.added }));
      if (!r.role) toast.success(tr("dashboard.sso_join_off"));
      onChanged();
    } catch {
      toast.error(tr("dashboard.could_not_change_sso_join"));
    } finally {
      setBusy(false);
    }
  }

  if (role === null) return null;
  const on = role !== "";
  return (
    <section>
      <SectionHeader icon={LogIn} label={tr("dashboard.sso_join_title")} />
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-neutral-200 bg-surface p-3">
        <label className="flex min-w-0 flex-1 items-center gap-2.5 text-sm text-neutral-800">
          <input
            type="checkbox"
            checked={on}
            disabled={busy}
            onChange={() => void apply(on ? "" : pick)}
            className="h-4 w-4 shrink-0 accent-brand-600"
          />
          {tr("dashboard.sso_join_toggle")}
        </label>
        <div className="w-36 shrink-0">
          <RoleSelect
            value={pick}
            roles={roles}
            onChange={(next) => {
              setPick(next);
              if (on && next !== role) void apply(next);
            }}
            ariaLabel={tr("dashboard.sso_join_role")}
          />
        </div>
      </div>
      <p className="mt-2 text-xs text-neutral-500">{tr("dashboard.sso_join_hint")}</p>
    </section>
  );
}

function SkeletonList() {
  return (
    <ul className="divide-y divide-neutral-100 overflow-hidden rounded-xl border border-neutral-200">
      {[0, 1, 2].map((i) => (
        <li key={i} className="flex items-center gap-3 px-3.5 py-3">
          <span className="h-9 w-9 shrink-0 animate-pulse rounded-full bg-neutral-200" />
          <div className="flex-1 space-y-1.5">
            <span className="block h-3 w-32 animate-pulse rounded bg-neutral-200" />
            <span className="block h-2.5 w-48 animate-pulse rounded bg-neutral-100" />
          </div>
          <span className="h-6 w-16 animate-pulse rounded-full bg-neutral-100" />
        </li>
      ))}
    </ul>
  );
}

// CustomRolesSection: list + create + delete workspace custom roles (a named set
// of capabilities that can be assigned per design from the editor's Share
// dialog). Manage-roles is owner/admin only (the parent already gates this).
function CustomRolesSection({ workspaceId }: { workspaceId: string }) {
  const toast = useToast();
  const [roles, setRoles] = useState<CustomRoleView[]>([]);
  const [creating, setCreating] = useState(false);
  // The role being edited (null = the form, when open, creates a new role).
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [caps, setCaps] = useState<Capability[]>(["view", "comment"]);
  const formOpen = creating || editingId !== null;

  function startEdit(r: CustomRoleView) {
    setEditingId(r.id);
    setCreating(false);
    setName(r.name);
    setCaps(r.capabilities);
  }
  function closeForm() {
    setCreating(false);
    setEditingId(null);
    setName("");
    setCaps(["view", "comment"]);
  }

  const reload = useCallback(async () => {
    try {
      setRoles((await oc.listCustomRoles(workspaceId)).filter((r) => r.scope === "workspace"));
    } catch {
      /* surfaced on create/delete instead */
    }
  }, [workspaceId]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const r = await oc.listCustomRoles(workspaceId).catch(() => []);
      if (!cancelled) setRoles(r.filter((x) => x.scope === "workspace"));
    })();
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  const toggleCap = (c: Capability) => setCaps((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]));

  async function save() {
    if (!name.trim() || caps.length === 0) return;
    try {
      if (editingId) {
        await oc.updateCustomRole(editingId, { name: name.trim(), capabilities: caps });
        toast.success(tr("dashboard.custom_role_updated"));
      } else {
        await oc.createCustomRole(workspaceId, { name: name.trim(), capabilities: caps });
        toast.success(tr("dashboard.custom_role_created"));
      }
      closeForm();
      await reload();
    } catch {
      toast.error(editingId ? tr("dashboard.could_not_update_the_role") : tr("dashboard.could_not_create_the_role"));
    }
  }

  async function remove(r: CustomRoleView) {
    try {
      await oc.deleteCustomRole(r.id);
      toast.success(tr("dashboard.role_deleted"));
      await reload();
    } catch {
      toast.error(tr("dashboard.could_not_delete_the_role"));
    }
  }

  return (
    <div>
      <SectionHeader
        icon={Shield}
        label={tr("dashboard.custom_roles")}
        count={roles.length || undefined}
        action={
          !formOpen && (
            <button onClick={() => { closeForm(); setCreating(true); }} className="flex items-center gap-1 text-xs font-semibold text-brand-ink transition-colors hover:text-brand-800">
              <Plus size={14} /> {tr("dashboard.new_role")}
            </button>
          )
        }
      />

      {roles.length === 0 && !formOpen ? (
        <p className="rounded-xl border border-dashed border-neutral-200 bg-neutral-50/60 px-3.5 py-3 text-xs text-neutral-500">
          {tr("dashboard.no_custom_roles_yet_create_one_to_assign_a_n")}
        </p>
      ) : (
        roles.length > 0 && (
          <ul className="divide-y divide-neutral-100 overflow-hidden rounded-xl border border-neutral-200">
            {roles.map((r) => (
              <li key={r.id} className={`flex items-center gap-3 px-3.5 py-3 transition-colors hover:bg-neutral-50/70 ${editingId === r.id ? "bg-brand-50/40" : ""}`}>
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-50 text-brand-ink ring-1 ring-inset ring-brand-100">
                  <Shield size={16} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-neutral-800">{r.name}</div>
                  <div className="truncate text-xs capitalize text-neutral-500">{r.capabilities.join(", ").replace(/-/g, " ")}</div>
                </div>
                <button
                  onClick={() => startEdit(r)}
                  aria-label={tr("dashboard.edit_role_named", { name: r.name })}
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-700"
                  title={tr("dashboard.edit_role")}
                >
                  <Pencil size={15} />
                </button>
                <button
                  onClick={() => void remove(r)}
                  aria-label={tr("dashboard.delete_role_named", { name: r.name })}
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-neutral-400 transition-colors hover:bg-red-50 hover:text-red-600"
                  title={tr("dashboard.delete_role")}
                >
                  <Trash2 size={15} />
                </button>
              </li>
            ))}
          </ul>
        )
      )}

      {formOpen && (
        <div className="mt-3 rounded-xl border border-neutral-200 bg-neutral-50/40 p-4">
          <label htmlFor="custom-role-name" className="mb-1.5 block text-sm font-medium text-neutral-700">
            {editingId ? tr("dashboard.edit_role") : tr("dashboard.role_name")}
          </label>
          <input
            id="custom-role-name"
            placeholder={tr("dashboard.e_g_reviewer")}
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            className="h-11 w-full rounded-xl border border-neutral-200 bg-surface px-3.5 text-sm text-neutral-900 placeholder:text-neutral-400 outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
          />
          <p className="mb-2 mt-3 text-xs font-medium text-neutral-600">{tr("dashboard.capabilities")}</p>
          <div className="flex flex-wrap gap-2">
            {capabilities().map((c) => (
              <label
                key={c.id}
                className={`flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors ${
                  caps.includes(c.id) ? "border-brand-300 bg-brand-50 font-medium text-brand-ink" : "border-neutral-200 text-neutral-600 hover:border-neutral-300"
                }`}
              >
                <input type="checkbox" className="sr-only" checked={caps.includes(c.id)} onChange={() => toggleCap(c.id)} />
                {c.label}
              </label>
            ))}
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={closeForm}>
              {tr("dashboard.cancel")}
            </Button>
            <Button size="sm" disabled={!name.trim() || caps.length === 0} onClick={() => void save()}>
              {editingId ? tr("dashboard.save_changes") : tr("dashboard.create_role")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
