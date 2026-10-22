// "Roles and permissions" (F42): every role and permission of the workspace,
// the actions behind them, and the change log. Everyone in the workspace may
// look; people whose role holds roles.manage create, edit, duplicate and
// delete. The server enforces the guard rails (only what you hold yourself,
// never your own role, the owner role stays whole); the page greys out what
// it would refuse, so nobody fills in a form for nothing.

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Copy, History, KeyRound, Lock, Pencil, Plus, Shield, Trash2, Users } from "lucide-react";
import { ACTION_AREAS, coversActions, unionActions, type Action, type ActionScope, type ActionSet } from "@hc/authz";
import type { RoleEventView, WorkspacePermissionView, WorkspaceRoleView, WorkspaceRolesView } from "@hc/sdk";
import { oc } from "@/lib/sdk";
import { tr } from "@/lib/i18n";
import { userMessage } from "@/lib/errors";
import { useDateFormat } from "@/lib/datetime";
import { actionHint, actionLabel, areaLabel, permissionName, roleHint, roleName } from "@/lib/roles";
import { refreshWorkspaceActions } from "@/store/workspaceActions";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";

type Tab = "roles" | "permissions" | "actions" | "log";

const field = "h-9 w-full rounded-lg border border-neutral-200 bg-surface px-2.5 text-sm text-neutral-800 outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100";
const rowAction = "flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-800 disabled:opacity-40 disabled:hover:bg-transparent";

function SectionHeader({ icon: Icon, label, count, action }: { icon: typeof Shield; label: string; count?: number; action?: React.ReactNode }) {
  return (
    <div className="mb-2.5 flex items-center justify-between gap-2">
      <h3 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-neutral-400">
        <Icon size={15} /> {label}
        {count !== undefined && <span className="rounded-full bg-neutral-100 px-1.5 py-0.5 text-[10px] font-semibold text-neutral-500">{count}</span>}
      </h3>
      {action}
    </div>
  );
}

/** A short "what it allows" line: the first few action names. */
function actionsSummary(set: ActionSet, max = 4): string {
  const labels = actionLabel();
  const keys = (Object.keys(set) as Action[]).filter((k) => labels[k]);
  if (keys.length === 0) return tr("roles.no_actions");
  const named = keys.slice(0, max).map((k) => labels[k] + (set[k] === "own" ? ` (${tr("roles.scope_own_short")})` : ""));
  return keys.length > max ? tr("roles.actions_and_more", { list: named.join(", "), count: keys.length - max }) : named.join(", ");
}

export function RolesPage({ workspaceId }: { workspaceId: string }) {
  const toast = useToast();
  const [view, setView] = useState<WorkspaceRolesView | null>(null);
  const [tab, setTab] = useState<Tab>("roles");
  const [editRole, setEditRole] = useState<WorkspaceRoleView | "new" | null>(null);
  const [copyRole, setCopyRole] = useState<WorkspaceRoleView | null>(null);
  const [editPerm, setEditPerm] = useState<WorkspacePermissionView | "new" | null>(null);
  const [copyPerm, setCopyPerm] = useState<WorkspacePermissionView | null>(null);
  const [deleting, setDeleting] = useState<WorkspaceRoleView | null>(null);
  const [armedPerm, setArmedPerm] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setView(await oc.workspaceRoles(workspaceId));
    } catch (e) {
      toast.error(userMessage(e, tr("roles.could_not_load")));
    }
  }, [workspaceId, toast]);

  // Keyed by workspace in the dashboard, so a switch starts from an empty view.
  useEffect(() => {
    let cancelled = false;
    oc.workspaceRoles(workspaceId).then(
      (v) => { if (!cancelled) setView(v); },
      (e) => { if (!cancelled) toast.error(userMessage(e, tr("roles.could_not_load"))); },
    );
    return () => { cancelled = true; };
  }, [workspaceId, toast]);

  const changed = useCallback(async () => {
    await reload();
    await refreshWorkspaceActions(workspaceId);
  }, [reload, workspaceId]);

  if (!view) return <div className="h-40 animate-pulse rounded-xl bg-neutral-100" />;

  const mine = view.myActions;
  const manage = view.canManage;
  const permsById = new Map(view.permissions.map((p) => [p.id, p]));
  const rolesById = new Map(view.roles.map((r) => [r.id, r]));
  const myRole = rolesById.get(view.myRoleId);
  // What the server would refuse, so the page can say so up front.
  const mayHandOut = (r: WorkspaceRoleView) => (r.protected ? !!myRole?.protected : coversActions(mine, r.actions));
  const mayEditRole = (r: WorkspaceRoleView) => manage && (r.protected ? !!myRole?.protected : r.id !== view.myRoleId && mayHandOut(r));
  const mayEditPerm = (p: WorkspacePermissionView) => manage && coversActions(mine, p.actions);

  async function removePermission(p: WorkspacePermissionView) {
    if (armedPerm !== p.id) {
      setArmedPerm(p.id);
      setTimeout(() => setArmedPerm((cur) => (cur === p.id ? null : cur)), 3500);
      return;
    }
    setArmedPerm(null);
    try {
      await oc.deleteWorkspacePermission(p.id);
      toast.success(tr("roles.permission_deleted", { name: permissionName(p) }));
      await changed();
    } catch (e) {
      toast.error(userMessage(e, tr("roles.could_not_save")));
    }
  }

  const tabs: { id: Tab; label: string; icon: typeof Shield }[] = [
    { id: "roles", label: tr("roles.tab_roles"), icon: Users },
    { id: "permissions", label: tr("roles.tab_permissions"), icon: KeyRound },
    { id: "actions", label: tr("roles.tab_actions"), icon: Shield },
    ...(mine["activity.view"] ? [{ id: "log" as Tab, label: tr("roles.tab_log"), icon: History }] : []),
  ];

  return (
    <div className="w-full max-w-4xl">
      <p className="mb-4 max-w-2xl px-2 text-sm text-neutral-500">{tr("roles.intro")}</p>
      {!manage && <p className="mb-4 rounded-lg bg-neutral-50 px-3 py-2 text-xs text-neutral-500">{tr("roles.read_only")}</p>}

      <div role="tablist" aria-label={tr("roles.title")} className="mb-5 flex gap-1 rounded-lg bg-neutral-100 p-0.5 sm:w-max">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition ${tab === t.id ? "bg-surface text-neutral-900 shadow-sm" : "text-neutral-500 hover:text-neutral-800"}`}
          >
            <t.icon size={13} /> {t.label}
          </button>
        ))}
      </div>

      {tab === "roles" && (
        <section>
          <SectionHeader
            icon={Users}
            label={tr("roles.tab_roles")}
            count={view.roles.length}
            action={manage && <button type="button" onClick={() => setEditRole("new")} className="flex items-center gap-1 text-xs font-semibold text-brand-ink hover:text-brand-800"><Plus size={14} /> {tr("roles.new_role")}</button>}
          />
          <p className="mb-3 text-xs text-neutral-500">{tr("roles.roles_hint")}</p>
          <ul className="divide-y divide-neutral-100 overflow-hidden rounded-xl border border-neutral-200">
            {view.roles.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3.5 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-sm font-semibold text-neutral-800">{roleName(r)}</span>
                    {r.protected && <span className="flex items-center gap-1 rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 ring-1 ring-inset ring-amber-200"><Lock size={10} /> {tr("roles.protected")}</span>}
                    {r.id === view.myRoleId && <span className="rounded-full bg-brand-50 px-1.5 py-0.5 text-[10px] font-semibold text-brand-ink">{tr("roles.your_role")}</span>}
                  </div>
                  {roleHint(r) && <p className="mt-0.5 text-xs text-neutral-500">{roleHint(r)}</p>}
                  <p className="mt-0.5 text-[11px] text-neutral-400">
                    {r.protected ? tr("roles.everything") : r.permissionIds.map((id) => permsById.get(id)).filter(Boolean).map((p) => permissionName(p!)).join(" · ") || tr("roles.no_permissions")}
                  </p>
                </div>
                <span className="shrink-0 text-xs text-neutral-500">{tr("roles.member_count", { count: r.memberCount })}</span>
                {manage && (
                  <span className="flex shrink-0 items-center gap-0.5">
                    <button type="button" className={rowAction} disabled={!mayEditRole(r)} title={!mayEditRole(r) ? (r.id === view.myRoleId ? tr("roles.cannot_edit_own") : tr("roles.cannot_edit_above")) : undefined} onClick={() => setEditRole(r)}>
                      <Pencil size={13} /> {tr("roles.edit")}
                    </button>
                    {!r.protected && (
                      <button type="button" className={rowAction} disabled={!mayHandOut(r)} onClick={() => setCopyRole(r)}>
                        <Copy size={13} /> {tr("roles.duplicate")}
                      </button>
                    )}
                    {!r.protected && (
                      <button type="button" className={`${rowAction} hover:text-red-600`} disabled={!mayEditRole(r)} onClick={() => setDeleting(r)}>
                        <Trash2 size={13} /> {tr("roles.delete")}
                      </button>
                    )}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {tab === "permissions" && (
        <section>
          <SectionHeader
            icon={KeyRound}
            label={tr("roles.tab_permissions")}
            count={view.permissions.length}
            action={manage && <button type="button" onClick={() => setEditPerm("new")} className="flex items-center gap-1 text-xs font-semibold text-brand-ink hover:text-brand-800"><Plus size={14} /> {tr("roles.new_permission")}</button>}
          />
          <p className="mb-3 text-xs text-neutral-500">{tr("roles.permissions_hint")}</p>
          <ul className="divide-y divide-neutral-100 overflow-hidden rounded-xl border border-neutral-200">
            {view.permissions.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3.5 py-3">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-neutral-800">{permissionName(p)}</div>
                  {p.description && <p className="mt-0.5 text-xs text-neutral-500">{p.description}</p>}
                  <p className="mt-0.5 text-[11px] text-neutral-400">{actionsSummary(p.actions, 6)}</p>
                  <p className="mt-0.5 text-[11px] text-neutral-400">
                    {p.roleIds.length ? tr("roles.used_by", { roles: p.roleIds.map((id) => rolesById.get(id)).filter(Boolean).map((r) => roleName(r!)).join(", ") }) : tr("roles.used_by_none")}
                  </p>
                </div>
                {manage && (
                  <span className="flex shrink-0 items-center gap-0.5">
                    <button type="button" className={rowAction} disabled={!mayEditPerm(p)} title={!mayEditPerm(p) ? tr("roles.cannot_edit_above") : undefined} onClick={() => setEditPerm(p)}>
                      <Pencil size={13} /> {tr("roles.edit")}
                    </button>
                    <button type="button" className={rowAction} disabled={!mayEditPerm(p)} onClick={() => setCopyPerm(p)}>
                      <Copy size={13} /> {tr("roles.duplicate")}
                    </button>
                    <button
                      type="button"
                      disabled={!mayEditPerm(p)}
                      onClick={() => void removePermission(p)}
                      className={`flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium transition disabled:opacity-40 ${armedPerm === p.id ? "bg-red-50 text-red-600 ring-1 ring-red-300" : "text-neutral-500 hover:bg-neutral-100 hover:text-red-600"}`}
                    >
                      <Trash2 size={13} /> {armedPerm === p.id ? (p.roleIds.length ? tr("roles.confirm_delete_used", { count: p.roleIds.length }) : tr("roles.confirm_delete")) : tr("roles.delete")}
                    </button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {tab === "actions" && <ActionsReference view={view} />}
      {tab === "log" && <RoleLog workspaceId={workspaceId} view={view} />}

      {(editRole || copyRole) && (
        <RoleEditor
          workspaceId={workspaceId}
          view={view}
          role={editRole === "new" ? null : editRole ?? null}
          copyOf={copyRole}
          onClose={() => { setEditRole(null); setCopyRole(null); }}
          onSaved={changed}
        />
      )}
      {(editPerm || copyPerm) && (
        <PermissionEditor
          workspaceId={workspaceId}
          mine={mine}
          permission={editPerm === "new" ? null : editPerm ?? null}
          copyOf={copyPerm}
          onClose={() => { setEditPerm(null); setCopyPerm(null); }}
          onSaved={changed}
        />
      )}
      {deleting && <DeleteRoleDialog view={view} role={deleting} mayHandOut={mayHandOut} onClose={() => setDeleting(null)} onDeleted={changed} />}
    </div>
  );
}

function portal(node: React.ReactNode) {
  return typeof document === "undefined" ? null : createPortal(node, document.body);
}

/** Create, edit or duplicate a role: a name, a description and permissions. */
function RoleEditor({ workspaceId, view, role, copyOf, onClose, onSaved }: {
  workspaceId: string;
  view: WorkspaceRolesView;
  role: WorkspaceRoleView | null;
  copyOf: WorkspaceRoleView | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const toast = useToast();
  const base = role ?? copyOf;
  const [name, setName] = useState(role ? roleName(role) : copyOf ? tr("roles.copy_name", { name: roleName(copyOf) }) : "");
  const [description, setDescription] = useState(base ? roleHint(base) : "");
  const [picked, setPicked] = useState<Set<string>>(new Set(base?.permissionIds ?? []));
  const [busy, setBusy] = useState(false);
  const protectedRole = !!role?.protected;
  const effective = useMemo(
    () => unionActions(...view.permissions.filter((p) => picked.has(p.id)).map((p) => p.actions)),
    [view.permissions, picked],
  );
  const toggle = (id: string) => setPicked((s) => {
    const next = new Set(s);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });

  async function save() {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const permissionIds = [...picked];
      if (role) {
        await oc.updateWorkspaceRole(role.id, protectedRole ? { name: name.trim(), description: description.trim() } : { name: name.trim(), description: description.trim(), permissionIds });
        toast.success(tr("roles.role_saved", { name: name.trim() }));
      } else {
        await oc.createWorkspaceRole(workspaceId, { name: name.trim(), description: description.trim(), permissionIds });
        toast.success(tr("roles.role_created", { name: name.trim() }));
      }
      await onSaved();
      onClose();
    } catch (e) {
      toast.error(userMessage(e, tr("roles.could_not_save")));
    } finally {
      setBusy(false);
    }
  }

  return portal(
    <Modal open onClose={busy ? () => {} : onClose} title={role ? tr("roles.edit_role_title", { name: roleName(role) }) : tr("roles.new_role")} width="w-[36rem] max-w-full">
      <div className="flex max-h-[72vh] flex-col gap-4 overflow-hidden">
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pe-1">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-neutral-500">{tr("roles.name")}</span>
            <input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} className={field} autoFocus />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-neutral-500">{tr("roles.description")}</span>
            <input value={description} maxLength={300} onChange={(e) => setDescription(e.target.value)} placeholder={tr("roles.description_placeholder")} className={field} />
          </label>
          {protectedRole ? (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">{tr("roles.owner_role_note")}</p>
          ) : (
            <div>
              <span className="mb-1 block text-xs font-medium text-neutral-500">{tr("roles.pick_permissions")}</span>
              <ul className="divide-y divide-neutral-100 rounded-lg border border-neutral-200">
                {view.permissions.map((p) => {
                  const allowed = coversActions(view.myActions, p.actions);
                  return (
                    <li key={p.id}>
                      <label className={`flex items-start gap-2 px-3 py-2 ${allowed ? "cursor-pointer" : "cursor-not-allowed opacity-50"}`} title={allowed ? undefined : tr("roles.not_yours_to_give")}>
                        <input type="checkbox" checked={picked.has(p.id)} disabled={!allowed} onChange={() => toggle(p.id)} className="mt-0.5 h-3.5 w-3.5 accent-brand-500" />
                        <span className="min-w-0">
                          <span className="block text-xs font-medium text-neutral-700">{permissionName(p)}</span>
                          <span className="mt-0.5 block text-[11px] leading-snug text-neutral-500">{actionsSummary(p.actions, 6)}</span>
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
              <p className="mt-2 text-[11px] text-neutral-500">{tr("roles.role_allows", { list: actionsSummary(effective, 12) })}</p>
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-neutral-100 pt-3">
          <Button variant="secondary" onClick={onClose} disabled={busy}>{tr("roles.cancel")}</Button>
          <Button onClick={() => void save()} disabled={busy || !name.trim()}>{tr("roles.save")}</Button>
        </div>
      </div>
    </Modal>,
  );
}

/** Create, edit or duplicate a permission: actions picked by area, each with
 *  its scope where it has one. */
function PermissionEditor({ workspaceId, mine, permission, copyOf, onClose, onSaved }: {
  workspaceId: string;
  mine: ActionSet;
  permission: WorkspacePermissionView | null;
  copyOf: WorkspacePermissionView | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const toast = useToast();
  const base = permission ?? copyOf;
  const [name, setName] = useState(permission ? permissionName(permission) : copyOf ? tr("roles.copy_name", { name: permissionName(copyOf) }) : "");
  const [description, setDescription] = useState(base?.description ?? "");
  const [actions, setActions] = useState<ActionSet>({ ...(base?.actions ?? {}) });
  const [busy, setBusy] = useState(false);
  const labels = actionLabel();
  const hints = actionHint();
  const areas = areaLabel();
  const [catalog, setCatalog] = useState<{ key: Action; area: string; scoped: boolean }[]>([]);
  useEffect(() => {
    void oc.workspaceRoles(workspaceId).then((v) => setCatalog(v.actions), () => undefined);
  }, [workspaceId]);

  const set = (a: Action, scope: ActionScope | null) => setActions((cur) => {
    const next = { ...cur };
    if (scope) next[a] = scope;
    else delete next[a];
    return next;
  });

  async function save() {
    if (!name.trim()) return;
    setBusy(true);
    try {
      if (permission) {
        await oc.updateWorkspacePermission(permission.id, { name: name.trim(), description: description.trim(), actions });
        toast.success(tr("roles.permission_saved", { name: name.trim() }));
      } else {
        await oc.createWorkspacePermission(workspaceId, { name: name.trim(), description: description.trim(), actions });
        toast.success(tr("roles.permission_created", { name: name.trim() }));
      }
      await onSaved();
      onClose();
    } catch (e) {
      toast.error(userMessage(e, tr("roles.could_not_save")));
    } finally {
      setBusy(false);
    }
  }

  return portal(
    <Modal open onClose={busy ? () => {} : onClose} title={permission ? tr("roles.edit_permission_title", { name: permissionName(permission) }) : tr("roles.new_permission")} width="w-[38rem] max-w-full">
      <div className="flex max-h-[72vh] flex-col gap-4 overflow-hidden">
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pe-1">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-neutral-500">{tr("roles.name")}</span>
            <input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} className={field} autoFocus />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-neutral-500">{tr("roles.description")}</span>
            <input value={description} maxLength={300} onChange={(e) => setDescription(e.target.value)} placeholder={tr("roles.description_placeholder")} className={field} />
          </label>
          <span className="block text-xs font-medium text-neutral-500">{tr("roles.pick_actions")}</span>
          {ACTION_AREAS.map((area) => {
            const inArea = catalog.filter((a) => a.area === area);
            if (inArea.length === 0) return null;
            return (
              <fieldset key={area} className="rounded-lg border border-neutral-200 px-3 py-2">
                <legend className="px-1 text-[11px] font-semibold uppercase tracking-wide text-neutral-400">{areas[area]}</legend>
                {inArea.map((a) => {
                  const held = mine[a.key];
                  const value = actions[a.key];
                  return (
                    <div key={a.key} className={`flex items-start gap-2 py-1.5 ${held ? "" : "opacity-50"}`} title={held ? undefined : tr("roles.not_yours_to_give")}>
                      <input
                        type="checkbox"
                        checked={!!value}
                        disabled={!held}
                        onChange={(e) => set(a.key, e.target.checked ? (a.scoped && held === "own" ? "own" : "all") : null)}
                        className="mt-0.5 h-3.5 w-3.5 accent-brand-500"
                        aria-label={labels[a.key]}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block text-xs font-medium text-neutral-700">{labels[a.key]}</span>
                        <span className="mt-0.5 block text-[11px] leading-snug text-neutral-500">{hints[a.key]}</span>
                      </span>
                      {a.scoped && value && (
                        <select
                          value={value}
                          onChange={(e) => set(a.key, e.target.value as ActionScope)}
                          aria-label={tr("roles.scope")}
                          className="h-7 shrink-0 rounded-md border border-neutral-200 bg-surface px-1.5 text-xs"
                        >
                          <option value="own">{tr("roles.scope_own")}</option>
                          <option value="all" disabled={held !== "all"}>{tr("roles.scope_all")}</option>
                        </select>
                      )}
                    </div>
                  );
                })}
              </fieldset>
            );
          })}
        </div>
        <div className="flex justify-end gap-2 border-t border-neutral-100 pt-3">
          <Button variant="secondary" onClick={onClose} disabled={busy}>{tr("roles.cancel")}</Button>
          <Button onClick={() => void save()} disabled={busy || !name.trim()}>{tr("roles.save")}</Button>
        </div>
      </div>
    </Modal>,
  );
}

/** Deleting a role asks where its members go. */
function DeleteRoleDialog({ view, role, mayHandOut, onClose, onDeleted }: {
  view: WorkspaceRolesView;
  role: WorkspaceRoleView;
  mayHandOut: (r: WorkspaceRoleView) => boolean;
  onClose: () => void;
  onDeleted: () => Promise<void>;
}) {
  const toast = useToast();
  const targets = view.roles.filter((r) => r.id !== role.id && mayHandOut(r) && !r.protected);
  const [to, setTo] = useState(targets.find((r) => r.seedKey === "viewer")?.id ?? targets[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  async function remove() {
    setBusy(true);
    try {
      await oc.deleteWorkspaceRole(role.id, role.memberCount > 0 ? to : to || undefined);
      toast.success(tr("roles.role_deleted", { name: roleName(role) }));
      await onDeleted();
      onClose();
    } catch (e) {
      toast.error(userMessage(e, tr("roles.could_not_save")));
    } finally {
      setBusy(false);
    }
  }
  return portal(
    <Modal open onClose={busy ? () => {} : onClose} title={tr("roles.delete_role_title", { name: roleName(role) })} width="w-[28rem] max-w-full">
      <div className="flex flex-col gap-3">
        {role.memberCount > 0 ? (
          <>
            <p className="text-sm text-neutral-600">{tr("roles.delete_role_move", { count: role.memberCount })}</p>
            <select value={to} onChange={(e) => setTo(e.target.value)} className={field} aria-label={tr("roles.move_members_to")}>
              {targets.map((r) => <option key={r.id} value={r.id}>{roleName(r)}</option>)}
            </select>
          </>
        ) : (
          <p className="text-sm text-neutral-600">{tr("roles.delete_role_unused")}</p>
        )}
        <div className="flex justify-end gap-2 border-t border-neutral-100 pt-3">
          <Button variant="secondary" onClick={onClose} disabled={busy}>{tr("roles.cancel")}</Button>
          <Button variant="danger" onClick={() => void remove()} disabled={busy || (role.memberCount > 0 && !to)}>{tr("roles.delete")}</Button>
        </div>
      </div>
    </Modal>,
  );
}

/** Every action, grouped by area, with the permissions that contain it. */
function ActionsReference({ view }: { view: WorkspaceRolesView }) {
  const labels = actionLabel();
  const hints = actionHint();
  const areas = areaLabel();
  return (
    <section>
      <SectionHeader icon={Shield} label={tr("roles.tab_actions")} count={view.actions.length} />
      <p className="mb-3 text-xs text-neutral-500">{tr("roles.actions_hint")}</p>
      <div className="flex flex-col gap-3">
        {ACTION_AREAS.map((area) => {
          const inArea = view.actions.filter((a) => a.area === area);
          if (inArea.length === 0) return null;
          return (
            <div key={area} className="overflow-hidden rounded-xl border border-neutral-200">
              <div className="bg-neutral-50 px-3.5 py-2 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">{areas[area]}</div>
              <ul className="divide-y divide-neutral-100">
                {inArea.map((a) => {
                  const inPerms = view.permissions.filter((p) => p.actions[a.key]);
                  return (
                    <li key={a.key} className="px-3.5 py-2.5">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <span className="text-sm font-medium text-neutral-800">{labels[a.key]}</span>
                        {a.scoped && <span className="text-[10px] font-semibold uppercase tracking-wide text-neutral-400">{tr("roles.scoped")}</span>}
                      </div>
                      <p className="mt-0.5 text-xs text-neutral-500">{hints[a.key]}</p>
                      <p className="mt-0.5 text-[11px] text-neutral-400">
                        {inPerms.length ? tr("roles.in_permissions", { list: inPerms.map((p) => permissionName(p) + (p.actions[a.key] === "own" ? ` (${tr("roles.scope_own_short")})` : "")).join(", ") }) : tr("roles.in_no_permission")}
                      </p>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** The change log of permissions, roles and assignments. */
function RoleLog({ workspaceId, view }: { workspaceId: string; view: WorkspaceRolesView }) {
  const df = useDateFormat();
  const [events, setEvents] = useState<RoleEventView[] | null>(null);
  useEffect(() => {
    void oc.roleEvents(workspaceId).then(setEvents, () => setEvents([]));
  }, [workspaceId]);
  const kinds: Record<string, string> = {
    "permission.create": tr("roles.event_permission_create"),
    "permission.update": tr("roles.event_permission_update"),
    "permission.delete": tr("roles.event_permission_delete"),
    "role.create": tr("roles.event_role_create"),
    "role.update": tr("roles.event_role_update"),
    "role.delete": tr("roles.event_role_delete"),
    "role.permissions": tr("roles.event_role_update"),
    "member.role": tr("roles.event_member_role"),
    "member.recovery": tr("roles.event_member_recovery"),
  };
  const nameOf = (id?: string) => {
    if (!id) return "";
    const r = view.roles.find((x) => x.id === id);
    if (r) return roleName(r);
    const p = view.permissions.find((x) => x.id === id);
    return p ? permissionName(p) : "";
  };
  return (
    <section>
      <SectionHeader icon={History} label={tr("roles.tab_log")} count={events?.length} />
      {events === null ? (
        <div className="h-24 animate-pulse rounded-xl bg-neutral-100" />
      ) : events.length === 0 ? (
        <p className="rounded-xl border border-dashed border-neutral-200 px-3.5 py-3 text-xs text-neutral-500">{tr("roles.log_empty")}</p>
      ) : (
        <ul className="divide-y divide-neutral-100 overflow-hidden rounded-xl border border-neutral-200">
          {events.map((e) => (
            <li key={e.id} className="flex flex-wrap items-baseline gap-x-3 px-3.5 py-2.5 text-sm">
              <span className="font-medium text-neutral-800">{kinds[e.kind] ?? e.kind}</span>
              {nameOf(e.targetId) && <span className="text-neutral-600">{nameOf(e.targetId)}</span>}
              <span className="ms-auto text-xs text-neutral-400">{e.actorName || tr("roles.log_system")} · {df.relative(e.createdAt)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
