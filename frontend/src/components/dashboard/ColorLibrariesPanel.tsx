// Colour libraries of the workspace: a colour book it holds a licence for
// (e.g. a Pantone book as .ase or .acb), a colour atlas (CxF, CGATS) or a
// house colour list (.csv). The file is read here, what was read is shown
// for confirmation, and only the entries are stored; the colour list that
// goes with a print export names, per colour of a design, the nearest entry.
// danvas ships no library. Every member sees the list, since every member
// exports; uploading and removing take the colour profile right.

import { useCallback, useEffect, useRef, useState } from "react";
import { BookOpen, Trash2, Upload } from "lucide-react";
import type { ColorLibrary } from "@hc/sdk";
import { oc } from "@/lib/sdk";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { userMessage } from "@/lib/errors";
import { createCmykConverter, createLabConverter } from "@/lib/print/cms";
import { ColorLibraryError, completeLab, readColorLibrary } from "@/lib/print/colorLibrary";
import { confirmAction } from "@/lib/promptDialog";
import { listProfileOptions, profileBytes } from "@/lib/print/profiles";
import { tr } from "@/lib/i18n";

/** Why a file was refused, in the reader's language. */
function readError(e: ColorLibraryError): string {
  const p = e.params;
  switch (e.reason) {
    case "unsupported_type": return tr("dashboard.color_library_error_unsupported_type", p);
    case "not_ase": return tr("dashboard.color_library_error_not_ase", p);
    case "not_acb": return tr("dashboard.color_library_error_not_acb", p);
    case "acb_space": return tr("dashboard.color_library_error_acb_space", p);
    case "truncated": return tr("dashboard.color_library_error_truncated", p);
    case "bad_line": return tr("dashboard.color_library_error_bad_line", p);
    case "no_colors": return tr("dashboard.color_library_error_no_colors", p);
    case "too_many": return tr("dashboard.color_library_error_too_many", p);
    case "not_cxf": return tr("dashboard.color_library_error_not_cxf", p);
    case "not_cgats": return tr("dashboard.color_library_error_not_cgats", p);
    case "spectral_range": return tr("dashboard.color_library_error_spectral_range", p);
  }
}

export function ColorLibrariesPanel({ workspaceId, canEdit }: { workspaceId: string; canEdit: boolean }) {
  const toast = useToast();
  const [libraries, setLibraries] = useState<ColorLibrary[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [armedDelete, setArmedDelete] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const reload = useCallback(async () => {
    try {
      setLibraries(await oc.listColorLibraries(workspaceId));
    } catch {
      setLibraries([]);
    }
  }, [workspaceId]);

  useEffect(() => {
    let cancelled = false;
    void oc.listColorLibraries(workspaceId).then(
      (l) => { if (!cancelled) setLibraries(l); },
      () => { if (!cancelled) setLibraries([]); },
    );
    return () => { cancelled = true; };
  }, [workspaceId]);

  async function upload(file: File) {
    setBusy(true);
    try {
      let read;
      try {
        read = readColorLibrary(file.name, new Uint8Array(await file.arrayBuffer()));
      } catch (e) {
        if (e instanceof ColorLibraryError) {
          // Say what is wrong with the file; nothing is stored.
          toast.error(`${tr("dashboard.color_library_not_readable")} ${readError(e)}`);
          return;
        }
        throw e;
      }
      // What was read, before anything is stored: a file of another layout
      // must not slip in as believable but wrong colours.
      const c = read.counts;
      const parts = [
        c.lab ? tr("dashboard.color_library_read_lab", { count: c.lab }) : "",
        c.spectral ? tr("dashboard.color_library_read_spectral", { count: c.spectral }) : "",
        c.cmyk ? tr("dashboard.color_library_read_cmyk", { count: c.cmyk }) : "",
        c.rgb ? tr("dashboard.color_library_read_rgb", { count: c.rgb }) : "",
        read.skipped ? tr("dashboard.color_library_read_skipped", { count: read.skipped }) : "",
      ].filter(Boolean);
      const sample = read.entries.slice(0, 3).map((e) => e.name).join(", ");
      const ok = await confirmAction({
        title: tr("dashboard.color_library_confirm_title", { name: file.name }),
        message: `${tr("dashboard.color_library_confirm", { count: read.entries.length })} ${parts.join(" · ")}. ${tr("dashboard.color_library_confirm_sample", { names: sample })}`,
        confirmText: tr("dashboard.upload_color_library"),
      });
      if (!ok) return;
      let entries = read.entries;
      // Matching needs Lab: entries given only as RGB or CMYK get it worked
      // out (CMYK through the workspace's default profile).
      if (entries.some((e) => !e.lab)) {
        const lab = await createLabConverter();
        let cmyk: Awaited<ReturnType<typeof createCmykConverter>> | null = null;
        try {
          if (entries.some((e) => !e.lab && e.cmyk)) {
            const def = (await listProfileOptions(workspaceId)).find((o) => o.isDefault);
            if (def) cmyk = await createCmykConverter(await profileBytes(def.id));
          }
          entries = completeLab(entries, { rgb: (r, g, b) => lab.fromSrgb(r, g, b), cmyk: cmyk ? (c, m, y, k) => cmyk!.lab(c, m, y, k) : undefined });
        } finally {
          lab.dispose();
          cmyk?.dispose();
        }
      }
      const name = file.name.replace(/\.(ase|acb|csv|txt|cxf|cgats|it8|cgt)$/i, "");
      const lib = await oc.createColorLibrary(workspaceId, { name, sourceFile: file.name, entries });
      toast.success(tr("dashboard.color_library_added", { name: lib.name, count: lib.entryCount }));
      await reload();
    } catch (e) {
      toast.error(userMessage(e, tr("dashboard.could_not_upload_color_library")));
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function remove(l: ColorLibrary) {
    if (armedDelete !== l.id) {
      setArmedDelete(l.id);
      setTimeout(() => setArmedDelete((cur) => (cur === l.id ? null : cur)), 3500);
      return;
    }
    setArmedDelete(null);
    try {
      await oc.deleteColorLibrary(l.id);
      await reload();
    } catch (e) {
      toast.error(userMessage(e, tr("dashboard.could_not_remove_color_library")));
    }
  }

  return (
    <section className="mt-8">
      <h2 className="mb-1 flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-neutral-400">
        <BookOpen size={15} /> {tr("dashboard.color_libraries")}
      </h2>
      <p className="mb-3 max-w-xl text-xs text-neutral-500">{tr("dashboard.color_libraries_hint")}</p>

      {canEdit && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-neutral-200 bg-neutral-50/60 p-3">
          <p className="min-w-0 flex-1 text-xs text-neutral-500">{tr("dashboard.color_libraries_upload_hint")}</p>
          <input
            ref={fileRef}
            type="file"
            accept=".ase,.acb,.cxf,.csv,.txt,.cgats,.it8"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); }}
          />
          <Button size="sm" className="gap-1" disabled={busy} onClick={() => fileRef.current?.click()}>
            <Upload size={15} /> {busy ? tr("dashboard.reading_color_library") : tr("dashboard.upload_color_library")}
          </Button>
        </div>
      )}

      <ul className="mt-3 flex flex-col gap-1.5">
        {(libraries ?? []).map((l) => (
          <li key={l.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-neutral-200 bg-surface px-3 py-2 text-sm">
            <span className="min-w-0 truncate font-medium text-neutral-800">{l.name}</span>
            {l.sourceFile && l.sourceFile !== l.name && <span className="truncate text-xs text-neutral-400">{l.sourceFile}</span>}
            <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[11px] text-neutral-500">{tr("dashboard.color_library_count", { count: l.entryCount })}</span>
            {canEdit && (
              <span className="ms-auto flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => void remove(l)}
                  className={`flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium transition ${armedDelete === l.id ? "bg-red-50 text-red-600 ring-1 ring-red-300" : "text-neutral-400 hover:bg-neutral-100 hover:text-red-600"}`}
                >
                  <Trash2 size={13} /> {armedDelete === l.id ? tr("dashboard.click_again_to_remove") : tr("dashboard.remove")}
                </button>
              </span>
            )}
          </li>
        ))}
        {libraries !== null && libraries.length === 0 && (
          <li className="rounded-xl border border-dashed border-neutral-200 px-3 py-2 text-sm text-neutral-500">{tr("dashboard.no_color_libraries_yet")}</li>
        )}
      </ul>
    </section>
  );
}
