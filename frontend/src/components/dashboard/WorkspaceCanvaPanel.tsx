// Import from Canva (docs/roadmap/41-canva-import.md): the workspace's Canva
// integration and the member's own Canva connection.
//
// Canva lets each app use only redirect URLs registered on its integration,
// so every instance brings its own (a draft public integration in Canva's
// developer portal). An admin pastes its Client ID and secret here; the panel
// shows the redirect URL and scopes to register there, ready to copy. Every
// member then connects their own Canva account from the import dialog and can
// disconnect it here.

import { useCallback, useEffect, useState } from "react";
import { Copy, ExternalLink, Link2 } from "lucide-react";
import type { CanvaConnection, CanvaIntegration } from "@hc/sdk";
import { oc } from "@/lib/sdk";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { userMessage } from "@/lib/errors";
import { tr } from "@/lib/i18n";

const DEVELOPER_PORTAL = "https://www.canva.com/developers/integrations";

export function WorkspaceCanvaPanel({ workspaceId, canEdit }: { workspaceId: string; canEdit: boolean }) {
  const toast = useToast();
  const [integration, setIntegration] = useState<CanvaIntegration | null>(null);
  const [connection, setConnection] = useState<CanvaConnection | null>(null);
  const [clientId, setClientId] = useState("");
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [armed, setArmed] = useState(false);

  const load = useCallback(() => Promise.all([
    oc.getCanvaIntegration(workspaceId).catch(() => null),
    oc.getCanvaConnection(workspaceId).catch(() => null),
  ]).then(([i, c]) => {
    setIntegration(i);
    setConnection(c);
    setClientId(i?.clientId ?? "");
    setSecret("");
  }), [workspaceId]);

  useEffect(() => { void load(); }, [load]);

  async function save() {
    setBusy(true);
    try {
      await oc.setCanvaIntegration(workspaceId, { clientId: clientId.trim(), clientSecret: secret.trim() || undefined });
      toast.success(tr("dashboard.canva_integration_saved"));
      await load();
    } catch (e) {
      toast.error(userMessage(e, tr("dashboard.canva_could_not_save")));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!armed) { setArmed(true); return; }
    setArmed(false);
    setBusy(true);
    try {
      await oc.deleteCanvaIntegration(workspaceId);
      await load();
    } catch (e) {
      toast.error(userMessage(e, tr("dashboard.canva_could_not_save")));
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    try {
      await oc.disconnectCanva(workspaceId);
      await load();
    } catch (e) {
      toast.error(userMessage(e, tr("dashboard.canva_could_not_save")));
    }
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(tr("dashboard.copied"));
    } catch {
      /* the text stays selectable */
    }
  }

  if (!integration) return null;
  const changedId = clientId.trim() !== integration.clientId;

  return (
    <section className="mt-8">
      <h2 className="mb-1 flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-neutral-400">
        <Link2 size={15} /> {tr("dashboard.canva_import")}
      </h2>
      <p className="mb-3 max-w-xl text-xs text-neutral-500">{tr("dashboard.canva_import_hint")}</p>

      {canEdit && (
        <div className="flex max-w-2xl flex-col gap-3 rounded-xl border border-neutral-200 bg-neutral-50/60 p-3">
          <p className="text-xs text-neutral-600">
            {tr("dashboard.canva_setup_hint")}{" "}
            <a href={DEVELOPER_PORTAL} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 font-medium text-brand-ink hover:underline">
              {tr("dashboard.canva_developer_portal")} <ExternalLink size={11} />
            </a>
          </p>
          <CopyRow label={tr("dashboard.canva_redirect_url")} value={integration.redirectUri} onCopy={copy} />
          <CopyRow label={tr("dashboard.canva_scopes")} value={integration.scopes.join(" ")} onCopy={copy} />
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-xs font-medium text-neutral-600">
              {tr("dashboard.canva_client_id")}
              <input
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                autoComplete="off"
                spellCheck={false}
                className="h-8 rounded-md border border-neutral-300 bg-surface px-2 font-mono text-xs outline-none focus:border-brand-400"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-neutral-600">
              {tr("dashboard.canva_client_secret")}
              <input
                type="password"
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                autoComplete="new-password"
                placeholder={integration.configured && !changedId ? tr("dashboard.canva_secret_stored") : ""}
                className="h-8 rounded-md border border-neutral-300 bg-surface px-2 font-mono text-xs outline-none focus:border-brand-400"
              />
            </label>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {integration.configured && (
              <Button size="sm" variant={armed ? "danger" : "ghost"} disabled={busy} onClick={() => void remove()} onBlur={() => setArmed(false)}>
                {armed ? tr("dashboard.canva_confirm_remove") : tr("dashboard.canva_remove_integration")}
              </Button>
            )}
            <Button
              size="sm"
              disabled={busy || !clientId.trim() || !secret.trim()}
              onClick={() => void save()}
            >
              {tr("dashboard.save")}
            </Button>
          </div>
        </div>
      )}

      {!canEdit && (
        <p className="text-xs text-neutral-500">
          {integration.configured ? tr("dashboard.canva_integration_ready") : tr("dashboard.canva_integration_missing_member")}
        </p>
      )}

      {connection?.connected && (
        <div className="mt-3 flex max-w-2xl flex-wrap items-center gap-2 rounded-xl border border-neutral-200 bg-surface px-3 py-2">
          <p className="min-w-0 flex-1 text-xs text-neutral-600">
            {connection.displayName
              ? tr("dashboard.canva_connected_as", { name: connection.displayName })
              : tr("dashboard.canva_connected")}
          </p>
          <Button size="sm" variant="secondary" onClick={() => void disconnect()}>{tr("dashboard.canva_disconnect")}</Button>
        </div>
      )}
    </section>
  );
}

function CopyRow({ label, value, onCopy }: { label: string; value: string; onCopy: (v: string) => void }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium text-neutral-600">{label}</span>
      <div className="flex items-center gap-1">
        <code className="min-w-0 flex-1 truncate rounded-md border border-neutral-200 bg-surface px-2 py-1.5 font-mono text-[11px] text-neutral-700" title={value}>
          {value}
        </code>
        <button
          type="button"
          onClick={() => onCopy(value)}
          aria-label={tr("dashboard.copy")}
          className="rounded-md p-1.5 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800"
        >
          <Copy size={14} />
        </button>
      </div>
    </div>
  );
}
