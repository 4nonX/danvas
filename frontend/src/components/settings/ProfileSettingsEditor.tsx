// Edit every setting of an export profile or a print preset right in its
// list (Settings, or the workspace's Members page), without opening the
// download menu or print dialog. The fields are the menus' own, shown for
// what the chosen format can carry.

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { ExportProfile } from "@hc/sdk";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { userMessage } from "@/lib/errors";
import { BleedInput, MarkInputs, NumField } from "@/components/editor/PrintSettings";
import { FORMAT_LABEL, normalizeSettings, type ExportFormat, type ExportSettings, type ProfilePrint } from "@/lib/exportProfiles";
import { normalizePrintSettings, paperLabel, PRINT_DPIS, printDpiLabel, type PrintSettings } from "@/lib/printPresets";
import { PRINT_PAPERS } from "@/lib/printDocument";
import { listProfileOptions, type ProfileOption } from "@/lib/print/profiles";
import type { PrintOverride } from "@/lib/print/sheet";
import { tr } from "@/lib/i18n";
import { TrimSizeFields } from "@/components/editor/TrimSizeFields";

const FORMATS: ExportFormat[] = ["pdf", "png", "jpg", "svg", "tiff", "eps", "pptx", "md", "hyc", "apng", "gif", "lottie", "mp4"];
const OVERRIDE_DEFAULT: PrintOverride = { bleed: true, bleedMm: 3, marks: false, style: "solid", weightPt: 0.25, lengthMm: 5, offsetMm: 3 };

const select = "h-8 w-full rounded-lg border border-neutral-200 bg-surface px-2 text-xs outline-none focus:border-brand-400";
const box = "h-3.5 w-3.5 accent-brand-500";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-neutral-500">{label}</span>
      {children}
    </label>
  );
}

function Check({ checked, onChange, label, desc }: { checked: boolean; onChange: (v: boolean) => void; label: string; desc?: string }) {
  return (
    <label className="flex cursor-pointer items-start gap-2">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className={`mt-0.5 ${box}`} />
      <span className="min-w-0">
        <span className="block text-xs font-medium text-neutral-700">{label}</span>
        {desc && <span className="mt-0.5 block text-[11px] leading-snug text-neutral-500">{desc}</span>}
      </span>
    </label>
  );
}

/** Bleed and crop marks: the pages' own (each part on or off) or one setting
 *  for the whole output. */
function PrintSourceFields({ value, onChange, designs }: { value: ProfilePrint; onChange: (v: ProfilePrint) => void; designs: boolean }) {
  const fixed = value.source === "fixed";
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-neutral-200 p-2.5">
      <span className="text-xs font-medium text-neutral-500">{tr("editor.print_source")}</span>
      <div role="radiogroup" aria-label={tr("editor.print_source")} className="flex gap-1 rounded-lg bg-neutral-100 p-0.5">
        {(["page", "fixed"] as const).map((src) => (
          <button
            key={src}
            type="button"
            role="radio"
            aria-checked={value.source === src}
            onClick={() => onChange(src === "fixed" ? { source: "fixed", override: value.source === "fixed" ? value.override : OVERRIDE_DEFAULT } : { source: "page", bleed: true, marks: true })}
            className={`flex-1 rounded-md px-2 py-1 text-[11px] font-medium transition ${value.source === src ? "bg-surface text-neutral-900 shadow-sm" : "text-neutral-500 hover:text-neutral-800"}`}
          >
            {src === "page" ? (designs ? tr("editor.print_source_designs") : tr("editor.print_source_pages")) : tr("editor.print_source_fixed")}
          </button>
        ))}
      </div>
      {value.source === "page" ? (
        <>
          <Check checked={value.bleed} onChange={(v) => onChange({ ...value, bleed: v })} label={tr("editor.bleed")} />
          <Check checked={value.marks} onChange={(v) => onChange({ ...value, marks: v })} label={tr("editor.crop_marks")} />
        </>
      ) : fixed && (
        <>
          <Check checked={value.override.bleed} onChange={(v) => onChange({ source: "fixed", override: { ...value.override, bleed: v } })} label={tr("editor.bleed")} />
          {value.override.bleed && <BleedInput mm={value.override.bleedMm} onChange={(mm) => onChange({ source: "fixed", override: { ...value.override, bleedMm: mm } })} />}
          <Check checked={value.override.marks} onChange={(v) => onChange({ source: "fixed", override: { ...value.override, marks: v } })} label={tr("editor.crop_marks")} />
          {value.override.marks && <MarkInputs marks={value.override} onChange={(patch) => onChange({ source: "fixed", override: { ...value.override, ...patch } })} />}
        </>
      )}
    </div>
  );
}

function ExportFields({ s, set, icc }: { s: ExportSettings; set: (patch: Partial<ExportSettings>) => void; icc: ProfileOption[] }) {
  const pdf = s.format === "pdf";
  const vectorLike = (pdf && s.pdfMode === "vector") || s.format === "eps";
  const printCapable = (pdf && s.pdfMode !== "tagged") || s.format === "tiff" || s.format === "eps";
  const cmyk = printCapable && s.color === "cmyk";
  const sheetCapable = ["png", "jpg", "svg", "tiff", "eps"].includes(s.format) || (pdf && s.pdfMode !== "tagged");
  const scaled = ["png", "jpg", "apng", "gif"].includes(s.format) || (pdf && s.pdfMode === "image");
  return (
    <div className="flex flex-col gap-3">
      <Field label={tr("editor.profile_format")}>
        <select value={s.format} onChange={(e) => set({ format: e.target.value as ExportFormat })} className={select}>
          {FORMATS.map((f) => <option key={f} value={f}>{FORMAT_LABEL[f]}</option>)}
        </select>
      </Field>
      {pdf && (
        <Field label={tr("editor.pdf_type")}>
          <select value={s.pdfMode} onChange={(e) => set({ pdfMode: e.target.value as ExportSettings["pdfMode"] })} className={select}>
            <option value="vector">{tr("editor.pdf_print_vector")}</option>
            <option value="image">{tr("editor.pdf_flattened_image")}</option>
            <option value="tagged">{tr("editor.accessible_pdf_tagged")}</option>
          </select>
        </Field>
      )}
      {scaled && <NumField label={tr("editor.size")} value={s.scale} onCommit={(n) => set({ scale: Math.max(0.1, Math.min(10, n)) })} />}
      {s.format === "png" && <Check checked={s.transparent} onChange={(v) => set({ transparent: v })} label={tr("editor.transparent_background")} />}
      {s.format === "jpg" && <NumField label={tr("editor.quality")} value={s.quality} onCommit={(n) => set({ quality: Math.round(Math.max(1, Math.min(100, n))) })} />}
      {s.format === "tiff" && <NumField label={tr("editor.resolution")} value={s.tiffDpi} onCommit={(n) => set({ tiffDpi: Math.round(Math.max(72, Math.min(2400, n))) })} />}

      {printCapable && (
        <Field label={tr("editor.print_color")}>
          <select value={s.color} onChange={(e) => set({ color: e.target.value as ExportSettings["color"] })} className={select}>
            <option value="cmyk">{tr("editor.cmyk_for_print")}</option>
            {/* i18n-ignore: the colour model's name */}
            <option value="rgb">RGB</option>
          </select>
        </Field>
      )}
      {cmyk && (
        <>
          <Field label={tr("editor.color_profile")}>
            <select value={s.iccProfileId ?? ""} onChange={(e) => set({ iccProfileId: e.target.value || null })} className={select}>
              <option value="">{tr("editor.design_color_profile_default", { name: icc.find((o) => o.isDefault)?.name ?? "" })}</option>
              {([["user", tr("editor.profiles_mine")], ["workspace", tr("editor.profiles_workspace")], ["builtin", tr("dashboard.built_in")]] as const).map(([owner, label]) => {
                const group = icc.filter((p) => p.owner === owner);
                return group.length ? <optgroup key={owner} label={label}>{group.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</optgroup> : null;
              })}
            </select>
          </Field>
          <Field label={tr("editor.rendering_intent")}>
            <select value={s.intent} onChange={(e) => set({ intent: e.target.value as ExportSettings["intent"] })} className={select}>
              <option value="relative">{tr("editor.intent_relative")}</option>
              <option value="perceptual">{tr("editor.intent_perceptual")}</option>
            </select>
          </Field>
          <Field label={tr("editor.tac_limit")}>
            <input
              key={s.tacLimit ?? "none"}
              inputMode="numeric"
              defaultValue={s.tacLimit ?? ""}
              placeholder="%"
              onBlur={(e) => { const n = parseInt(e.target.value, 10); set({ tacLimit: Number.isFinite(n) ? Math.min(400, Math.max(200, n)) : null }); }}
              className={select}
            />
          </Field>
          {vectorLike && <Check checked={s.blackOnly} onChange={(v) => set({ blackOnly: v })} label={tr("editor.black_ink_only")} desc={tr("editor.black_ink_only_desc")} />}
          {vectorLike && s.blackOnly && <Check checked={s.overprintBlack} onChange={(v) => set({ overprintBlack: v })} label={tr("editor.overprint_black")} desc={tr("editor.overprint_black_desc")} />}
          {pdf && <Check checked={s.pdfx} onChange={(v) => set({ pdfx: v })} label={tr("editor.pdfx4")} desc={tr("editor.pdfx4_desc")} />}
          {vectorLike && <Check checked={s.registration} onChange={(v) => set({ registration: v })} label={tr("editor.registration_marks")} desc={tr("editor.registration_marks_desc")} />}
          {vectorLike && (
            <div className="flex flex-col gap-2">
              <Check checked={s.dieLine.on} onChange={(v) => set({ dieLine: { ...s.dieLine, on: v } })} label={tr("editor.die_line")} desc={tr("editor.die_line_desc")} />
              {s.dieLine.on && (
                <div className="grid grid-cols-2 gap-2 ps-5">
                  <Field label={tr("editor.die_line_name")}>
                    <input value={s.dieLine.name} maxLength={40} onChange={(e) => set({ dieLine: { ...s.dieLine, name: e.target.value } })} className={select} />
                  </Field>
                  <div className="self-end">
                    <NumField label={tr("editor.die_line_radius_mm")} value={s.dieLine.radiusMm} onCommit={(n) => set({ dieLine: { ...s.dieLine, radiusMm: Math.max(0, Math.min(50, n)) } })} />
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {sheetCapable && (
        <>
          <TrimSizeFields value={s.trimSize} onChange={(trimSize) => set({ trimSize })} />
          <PrintSourceFields value={s.print} onChange={(print) => set({ print })} designs />
          <Check checked={s.extendBleed} onChange={(v) => set({ extendBleed: v })} label={tr("editor.extend_into_bleed")} desc={tr("editor.extend_into_bleed_desc")} />
          <Check checked={s.roundMm} onChange={(v) => set({ roundMm: v })} label={tr("editor.round_to_mm")} desc={tr("editor.round_to_mm_desc")} />
        </>
      )}
      <Check checked={s.zip} onChange={(v) => set({ zip: v })} label={tr("editor.combine_pages_into_a_zip")} />
      {!["hyc", "md", "lottie"].includes(s.format) && (
        <>
          <Check
            checked={!!s.colorList}
            onChange={(v) => set({ colorList: v ? { pdf: true, csv: true, ase: true } : null })}
            label={tr("editor.color_list")}
            desc={tr("editor.color_list_profile_desc")}
          />
          {s.colorList && (
            <div className="ms-5 flex flex-wrap gap-x-4 gap-y-1">
              {([["pdf", tr("editor.color_list_as_pdf")], ["csv", tr("editor.color_list_as_csv")], ["ase", tr("editor.color_list_as_ase")]] as const).map(([k, label]) => (
                <label key={k} className="flex cursor-pointer items-center gap-1.5 text-xs text-neutral-700">
                  <input
                    type="checkbox"
                    checked={s.colorList![k]}
                    onChange={(e) => {
                      const next = { ...s.colorList!, [k]: e.target.checked };
                      set({ colorList: next.pdf || next.csv || next.ase ? next : null });
                    }}
                    className={box}
                  />
                  {label}
                </label>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function PrintFields({ s, set }: { s: PrintSettings; set: (patch: Partial<PrintSettings>) => void }) {
  return (
    <div className="flex flex-col gap-3">
      <Field label={tr("editor.pages")}>
        <select value={s.pages} onChange={(e) => set({ pages: e.target.value as PrintSettings["pages"] })} className={select}>
          <option value="all">{tr("editor.profile_all_pages")}</option>
          <option value="current">{tr("editor.current_page")}</option>
        </select>
      </Field>
      <Field label={tr("editor.print_paper")}>
        <select value={s.paper} onChange={(e) => set({ paper: e.target.value as PrintSettings["paper"] })} className={select}>
          {PRINT_PAPERS.map((p) => <option key={p} value={p}>{paperLabel(p)}</option>)}
        </select>
      </Field>
      <Field label={tr("editor.print_size")}>
        <select value={s.size} onChange={(e) => set({ size: e.target.value as PrintSettings["size"] })} className={select}>
          <option value="actual">{tr("editor.print_size_actual")}</option>
          <option value="fit">{tr("editor.print_size_fit")}</option>
        </select>
      </Field>
      <Field label={tr("editor.print_resolution")}>
        <select value={s.dpi} onChange={(e) => set({ dpi: Number(e.target.value) as PrintSettings["dpi"] })} className={select}>
          {PRINT_DPIS.map((d) => <option key={d} value={d}>{printDpiLabel(d)}</option>)}
        </select>
      </Field>
      <PrintSourceFields value={s.print} onChange={(print) => set({ print })} designs={false} />
    </div>
  );
}

export function ProfileSettingsEditor({ profile, print, workspaceId, onSave, onClose }: {
  profile: ExportProfile;
  print: boolean;
  workspaceId: string | null;
  onSave: (settings: ExportProfile["settings"]) => Promise<void>;
  onClose: () => void;
}) {
  const [exp, setExp] = useState<ExportSettings>(() => normalizeSettings(profile.settings));
  const [prn, setPrn] = useState<PrintSettings>(() => normalizePrintSettings(profile.settings));
  const [icc, setIcc] = useState<ProfileOption[]>([]);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  useEffect(() => {
    if (print) return;
    let cancelled = false;
    void listProfileOptions(workspaceId).then((l) => { if (!cancelled) setIcc(l); }, () => undefined);
    return () => { cancelled = true; };
  }, [print, workspaceId]);

  async function save() {
    setBusy(true);
    try {
      await onSave((print ? normalizePrintSettings(prn) : normalizeSettings(exp)) as unknown as ExportProfile["settings"]);
      onClose();
    } catch (e) {
      toast.error(userMessage(e, print ? tr("editor.could_not_save_print_preset") : tr("editor.could_not_save_export_profile")));
    } finally {
      setBusy(false);
    }
  }

  // Rendered into the body: the lists sit deep inside scrolled pages, and a
  // dialog there can make the browser scroll those pages to show a field.
  if (typeof document === "undefined") return null;
  return createPortal(
    <Modal open onClose={busy ? () => {} : onClose} title={tr("editor.profile_edit_title", { name: profile.name })} width="w-[30rem] max-w-full">
      <div className="flex max-h-[70vh] flex-col gap-4 overflow-hidden">
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto pe-1">
          {print
            ? <PrintFields s={prn} set={(patch) => setPrn((cur) => ({ ...cur, ...patch }))} />
            : <ExportFields s={exp} set={(patch) => setExp((cur) => ({ ...cur, ...patch }))} icc={icc} />}
        </div>
        <div className="flex justify-end gap-2 border-t border-neutral-100 pt-3">
          <Button variant="secondary" onClick={onClose} disabled={busy}>{tr("editor.export_profile_cancel")}</Button>
          <Button onClick={() => void save()} disabled={busy}>{tr("editor.export_profile_save")}</Button>
        </div>
      </div>
    </Modal>,
    document.body,
  );
}
