// What the signed-in user's role allows in each workspace (F42): loaded once
// per workspace and refreshed when roles change, so the UI shows a control
// only to people whose role holds its action. The server checks every
// request anyway; this only spares people buttons that would be refused.

import { useEffect } from "react";
import { create } from "zustand";
import { allowsAction, hasAction, type Action, type ActionSet } from "@hc/authz";
import type { MyWorkspaceRole } from "@hc/sdk";
import { oc } from "@/lib/sdk";
import { useAuth } from "@/store/auth";

interface WorkspaceActionsState {
  byWorkspace: Record<string, MyWorkspaceRole | undefined>;
  loading: Record<string, boolean>;
  load: (workspaceId: string, force?: boolean) => Promise<void>;
}

export const useWorkspaceActions = create<WorkspaceActionsState>((set, get) => ({
  byWorkspace: {},
  loading: {},
  async load(workspaceId, force = false) {
    if (!workspaceId || get().loading[workspaceId] || (!force && get().byWorkspace[workspaceId])) return;
    set((s) => ({ loading: { ...s.loading, [workspaceId]: true } }));
    try {
      const mine = await oc.myWorkspaceActions(workspaceId);
      set((s) => ({ byWorkspace: { ...s.byWorkspace, [workspaceId]: mine } }));
    } catch {
      // Not a member (any more), or offline: nothing is shown as allowed.
      set((s) => ({ byWorkspace: { ...s.byWorkspace, [workspaceId]: undefined } }));
    } finally {
      set((s) => ({ loading: { ...s.loading, [workspaceId]: false } }));
    }
  },
}));

/** Reload a workspace's actions (after a role change). */
export function refreshWorkspaceActions(workspaceId: string | null | undefined): Promise<void> {
  return workspaceId ? useWorkspaceActions.getState().load(workspaceId, true) : Promise.resolve();
}

/** The caller's actions in a workspace (default: the active one), loading
 *  them on first use. null until known. */
export function useMyActions(workspaceId?: string | null): ActionSet | null {
  const active = useAuth((s) => s.activeWorkspaceId);
  const ws = workspaceId ?? active;
  const mine = useWorkspaceActions((s) => (ws ? s.byWorkspace[ws] : undefined));
  useEffect(() => {
    if (ws) void useWorkspaceActions.getState().load(ws);
  }, [ws]);
  return mine?.actions ?? null;
}

/** Whether the caller's role holds the action (at any scope) in a workspace. */
export function useCan(action: Action, workspaceId?: string | null): boolean {
  return hasAction(useMyActions(workspaceId), action);
}

/** For a known target: whether the action is allowed on something the caller
 *  did (own) or did not create. */
export function canOn(actions: ActionSet | null, action: Action, creatorId: string | null | undefined, userId: string | null | undefined): boolean {
  return allowsAction(actions, action, !!creatorId && creatorId === userId);
}
