// Share several designs at once from the dashboard selection: give one
// person access to all of them, or create a view link for each and copy the
// list. Per-design sharing (links, requests, removing access) stays in the
// single-design share dialog.

import { useState } from "react";
import { Check, Copy, Link2 } from "lucide-react";
import type { AccessMode } from "@hc/sdk";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useToast } from "@/components/ui/Toast";
import { ModeSelect, linkUrl } from "@/components/editor/ShareDialog";
import { copyText } from "@/lib/clipboard";
import { oc } from "@/lib/sdk";
import { tr } from "@/lib/i18n";

export function BulkShareDialog({ designs, onClose }: { designs: { id: string; title: string }[]; onClose: () => void }) {
  const toast = useToast();
  const [email, setEmail] = useState("");
  const [mode, setMode] = useState<AccessMode>("view");
  const [busy, setBusy] = useState<"invite" | "links" | null>(null);
  const [links, setLinks] = useState<{ title: string; url: string }[] | null>(null);

  async function invite() {
    const id = email.trim();
    if (!id.includes("@")) { toast.error(tr("editor.enter_an_email_address")); return; }
    setBusy("invite");
    let ok = 0;
    for (const d of designs) {
      try { await oc.addGrant(d.id, { principal: { kind: "email", id }, mode }); ok++; } catch { /* counted below */ }
    }
    setBusy(null);
    if (ok === designs.length) { toast.success(tr("dashboard.bulk_share_granted", { count: ok })); setEmail(""); }
    else toast.error(tr("dashboard.bulk_share_partial", { ok, count: designs.length }));
  }

  async function createLinks() {
    setBusy("links");
    const out: { title: string; url: string }[] = [];
    for (const d of designs) {
      try {
        const l = await oc.createShareLink(d.id, { mode: "view" });
        out.push({ title: d.title, url: linkUrl(l.token) });
      } catch { /* left out of the list */ }
    }
    setBusy(null);
    setLinks(out);
    if (out.length < designs.length) toast.error(tr("dashboard.bulk_share_partial", { ok: out.length, count: designs.length }));
    if (out.length) await copyAll(out);
  }

  async function copyAll(list: { title: string; url: string }[]) {
    const text = list.map((l) => `${l.title}: ${l.url}`).join("\n");
    if (await copyText(text)) toast.success(tr("dashboard.bulk_share_links_copied", { count: list.length }));
  }

  return (
    <Modal open onClose={onClose} title={tr("dashboard.share_n_designs", { count: designs.length })}>
      <div className="flex flex-col gap-4">
        <section>
          <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-neutral-500">{tr("dashboard.bulk_share_people")}</h3>
          <div className="flex gap-2">
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void invite(); }}
              placeholder={tr("dashboard.bulk_share_email_placeholder")}
              aria-label={tr("dashboard.bulk_share_email_placeholder")}
              className="flex-1"
            />
            <ModeSelect value={mode} onChange={setMode} disabled={busy !== null} ariaLabel={tr("editor.access_level_for_the_invitation")} />
          </div>
          <Button className="mt-2 w-full" size="sm" onClick={() => void invite()} disabled={busy !== null || !email.trim()}>
            {busy === "invite" ? tr("dashboard.bulk_share_working") : tr("dashboard.bulk_share_grant", { count: designs.length })}
          </Button>
        </section>

        <section className="border-t border-neutral-100 pt-3">
          <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-neutral-500">{tr("dashboard.bulk_share_links")}</h3>
          <p className="mb-2 text-xs text-neutral-500">{tr("dashboard.bulk_share_links_hint")}</p>
          {!links ? (
            <Button variant="secondary" size="sm" className="w-full" onClick={() => void createLinks()} disabled={busy !== null}>
              <Link2 size={14} /> {busy === "links" ? tr("dashboard.bulk_share_working") : tr("dashboard.bulk_share_create_links", { count: designs.length })}
            </Button>
          ) : (
            <>
              <ul className="max-h-48 overflow-y-auto rounded-lg border border-neutral-200 text-xs">
                {links.map((l) => (
                  <li key={l.url} className="flex items-center gap-2 border-b border-neutral-100 px-2.5 py-1.5 last:border-b-0">
                    <Check size={12} className="shrink-0 text-brand-600" />
                    <span className="min-w-0 flex-1 truncate text-neutral-700" title={l.url}>{l.title}</span>
                  </li>
                ))}
              </ul>
              <Button variant="secondary" size="sm" className="mt-2 w-full" onClick={() => void copyAll(links)}>
                <Copy size={14} /> {tr("dashboard.bulk_share_copy_links")}
              </Button>
            </>
          )}
        </section>
      </div>
    </Modal>
  );
}
