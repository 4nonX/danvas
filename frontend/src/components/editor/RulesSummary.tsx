// The print shop's rules of an export profile: what the download is checked
// against. Edited with the profile (RulesFields, in its settings); the
// download menu shows them (RulesSummary) without letting them be changed
// there, so a profile's rules hold for every download made with it.

import { useState } from "react";
import { ChevronDown, ListChecks } from "lucide-react";
import { blockingRules, defaultRules, type PrintRules, type RuleLevel } from "@/lib/exportProfiles";
import { tr } from "@/lib/i18n";

type Valued = "minPpi" | "minLinePt" | "richTextPt" | "minTextPt";

const VALUED: { key: Valued; label: () => string; unit: string; step: number }[] = [
  { key: "minPpi", label: () => tr("editor.rule_min_ppi"), unit: "dpi", step: 10 },
  { key: "minLinePt", label: () => tr("editor.rule_min_line"), unit: "pt", step: 0.05 },
  { key: "richTextPt", label: () => tr("editor.rule_rich_text"), unit: "pt", step: 0.5 },
  { key: "minTextPt", label: () => tr("editor.rule_min_text"), unit: "pt", step: 0.5 },
];

const levelLabel = (l: RuleLevel) => (l === "block" ? tr("editor.rule_level_block") : l === "warn" ? tr("editor.rule_level_warn") : tr("editor.rule_level_off"));

/** The rules as lines ("Images under 300 dpi: refuse"). */
function ruleLines(r: PrintRules): { text: string; level: RuleLevel }[] {
  const out = VALUED.map((v) => ({ text: `${v.label()} ${r[v.key].value.toLocaleString()} ${v.unit}`, level: r[v.key].level }));
  out.push({ text: r.spots.allowed.length ? tr("editor.rule_spots_list", { names: r.spots.allowed.join(", ") }) : `${tr("editor.rule_spots")}: ${tr("editor.rule_spots_none")}`, level: r.spots.level });
  out.push({ text: tr("editor.rule_cmyk_only"), level: r.cmykOnly.level });
  out.push({ text: tr("editor.rule_bleed"), level: r.bleed.level });
  return out;
}

/** The download menu's view of the rules: only when a profile set its own. */
export function RulesSummary({ rules }: { rules: PrintRules }) {
  const [open, setOpen] = useState(false);
  if (JSON.stringify(rules) === JSON.stringify(defaultRules())) return null;
  const blocking = blockingRules(rules);
  return (
    <div className="mb-3 rounded-xl border border-neutral-200 p-2.5 text-xs">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-center justify-between gap-2 text-start">
        <span className="flex items-center gap-1.5 font-medium text-neutral-700">
          <ListChecks size={14} className="shrink-0" />
          {blocking ? tr("editor.rules_summary_blocking", { count: blocking }) : tr("editor.rules_summary")}
        </span>
        <ChevronDown size={14} className={`shrink-0 text-neutral-400 transition ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <>
          <ul className="mt-2 flex flex-col gap-1 text-[11px]">
            {ruleLines(rules).filter((l) => l.level !== "off").map((l) => (
              <li key={l.text} className="flex justify-between gap-3">
                <span className="text-neutral-600">{l.text}</span>
                <span className={l.level === "block" ? "font-semibold text-red-600" : "text-amber-700"}>{levelLabel(l.level)}</span>
              </li>
            ))}
          </ul>
          <p className="mt-1.5 text-[11px] leading-snug text-neutral-400">{tr("editor.rules_summary_hint")}</p>
        </>
      )}
    </div>
  );
}

const select = "h-7 rounded-md border border-neutral-200 bg-surface px-1.5 text-xs outline-none focus:border-brand-400";

function LevelSelect({ value, onChange, label }: { value: RuleLevel; onChange: (l: RuleLevel) => void; label: string }) {
  return (
    <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value as RuleLevel)} className={`${select} w-28 shrink-0`}>
      {(["off", "warn", "block"] as const).map((l) => <option key={l} value={l}>{levelLabel(l)}</option>)}
    </select>
  );
}

/** The rules in an export profile's settings. */
export function RulesFields({ value, onChange }: { value: PrintRules; onChange: (r: PrintRules) => void }) {
  const [spotText, setSpotText] = useState(value.spots.allowed.join(", "));
  const row = "flex items-center justify-between gap-2";
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-neutral-200 p-2.5">
      <span className="text-xs font-medium text-neutral-500">{tr("editor.rules_title")}</span>
      <span className="text-[11px] leading-snug text-neutral-500">{tr("editor.rules_desc")}</span>
      {VALUED.map((v) => (
        <div key={v.key} className={row}>
          <span className="min-w-0 flex-1 text-xs text-neutral-700">{v.label()}</span>
          <span className="flex h-7 w-24 shrink-0 items-center gap-1 rounded-md border border-neutral-200 bg-surface px-1.5 text-xs focus-within:border-brand-400">
            <input
              key={value[v.key].value}
              inputMode="decimal"
              aria-label={v.label()}
              defaultValue={value[v.key].value}
              disabled={value[v.key].level === "off"}
              onBlur={(e) => {
                const n = Number(e.target.value.replace(",", "."));
                if (Number.isFinite(n) && n > 0) onChange({ ...value, [v.key]: { ...value[v.key], value: n } });
              }}
              className="w-full min-w-0 bg-transparent text-neutral-800 outline-none disabled:text-neutral-400"
            />
            <span className="shrink-0 text-neutral-400">{v.unit}</span>
          </span>
          <LevelSelect label={v.label()} value={value[v.key].level} onChange={(level) => onChange({ ...value, [v.key]: { ...value[v.key], level } })} />
        </div>
      ))}
      <div className="flex flex-col gap-1">
        <div className={row}>
          <span className="min-w-0 flex-1 text-xs text-neutral-700">{tr("editor.rule_spots")}</span>
          <LevelSelect label={tr("editor.rule_spots")} value={value.spots.level} onChange={(level) => onChange({ ...value, spots: { ...value.spots, level } })} />
        </div>
        {value.spots.level !== "off" && (
          <>
            <input
              value={spotText}
              placeholder={tr("editor.rule_spots_placeholder")}
              aria-label={tr("editor.rule_spots")}
              onChange={(e) => setSpotText(e.target.value)}
              onBlur={() => onChange({ ...value, spots: { ...value.spots, allowed: [...new Set(spotText.split(/[,;\n]/).map((s) => s.trim()).filter(Boolean))] } })}
              className={`${select} w-full`}
            />
            <span className="text-[11px] leading-snug text-neutral-400">{tr("editor.rule_spots_desc")}</span>
          </>
        )}
      </div>
      <div className={row}>
        <span className="min-w-0 flex-1 text-xs text-neutral-700">{tr("editor.rule_cmyk_only")}</span>
        <LevelSelect label={tr("editor.rule_cmyk_only")} value={value.cmykOnly.level} onChange={(level) => onChange({ ...value, cmykOnly: { level } })} />
      </div>
      <div className={row}>
        <span className="min-w-0 flex-1 text-xs text-neutral-700">{tr("editor.rule_bleed")}</span>
        <LevelSelect label={tr("editor.rule_bleed")} value={value.bleed.level} onChange={(level) => onChange({ ...value, bleed: { level } })} />
      </div>
    </div>
  );
}
