// Logo versions (F50): a brand kit names the versions its logos come in
// (colour, black, white, ...), each for a light or a dark ground, and every
// logo holds one file per version. Kits and logos from before keep working:
// a kit without named versions has two, the logo and its version for dark
// grounds, and a logo without versions has its main file in the first light
// version and its dark file in the first dark one. Whatever the versions, a
// logo's main file (assetId) and dark file (variants.dark) are kept in step,
// so everything that reads only those (decks, the brand check, older
// clients) sees the right files.

import type { BrandKit, BrandLogo, BrandLogoVersion } from "@hc/sdk";
import { tr } from "@/lib/i18n";

/** The two versions a kit has before it names its own. */
export const LEGACY_VERSIONS: BrandLogoVersion[] = [
  { id: "main", name: "", ground: "light" },
  { id: "dark", name: "", ground: "dark" },
];

/** A version's name; the two a kit has before naming its own read as such. */
export function versionName(v: BrandLogoVersion): string {
  if (v.name) return v.name;
  return v.ground === "dark" ? tr("editor.logo_on_dark") : tr("brand.logo_version_main");
}

/** The versions every new brand starts with (names localized by the caller). */
export const suggestedVersions = (names: { colour: string; black: string; white: string }): BrandLogoVersion[] => [
  { id: `v-${crypto.randomUUID()}`, name: names.colour, ground: "light" },
  { id: `v-${crypto.randomUUID()}`, name: names.black, ground: "light" },
  { id: `v-${crypto.randomUUID()}`, name: names.white, ground: "dark" },
];

/** The kit's logo versions, in order. */
export function kitVersions(kit: Pick<BrandKit, "logoVersions">): BrandLogoVersion[] {
  return kit.logoVersions?.length ? kit.logoVersions : LEGACY_VERSIONS;
}

const firstOf = (versions: BrandLogoVersion[], ground: "light" | "dark") => versions.find((v) => v.ground === ground);

/** The file a logo has for a version, if any. */
export function versionFile(logo: BrandLogo, version: BrandLogoVersion, versions: BrandLogoVersion[]): string | undefined {
  const own = logo.versions?.[version.id];
  if (own) return own;
  if (logo.versions && Object.keys(logo.versions).length) return undefined;
  // A logo from before: its main file in the first light version, its dark
  // file in the first dark one.
  if (version.id === firstOf(versions, "light")?.id) return logo.assetId || undefined;
  if (version.id === firstOf(versions, "dark")?.id) return logo.variants?.dark;
  return undefined;
}

/** Every version of a logo with its file (undefined where it has none). */
export function logoFiles(logo: BrandLogo, versions: BrandLogoVersion[]): { version: BrandLogoVersion; assetId: string | undefined }[] {
  return versions.map((version) => ({ version, assetId: versionFile(logo, version, versions) }));
}

/** The logo with its main and dark file derived from its versions. */
function settle(logo: BrandLogo, files: Record<string, string>, versions: BrandLogoVersion[]): BrandLogo | null {
  const has = versions.filter((v) => files[v.id]);
  if (!has.length) return null;
  const main = files[(has.find((v) => v.ground === "light") ?? has[0]).id];
  const dark = has.find((v) => v.ground === "dark");
  const variants = { ...(logo.variants ?? {}) };
  if (dark) variants.dark = files[dark.id];
  else delete variants.dark;
  const next: BrandLogo = { ...logo, assetId: main, versions: files };
  if (Object.keys(variants).length) next.variants = variants;
  else delete next.variants;
  return next;
}

/** The logo with a version's file set, or cleared with null. A logo left
 *  without any file is removed (null). */
export function withVersionFile(logo: BrandLogo, versions: BrandLogoVersion[], versionId: string, assetId: string | null): BrandLogo | null {
  const files: Record<string, string> = {};
  for (const { version, assetId: id } of logoFiles(logo, versions)) if (id) files[version.id] = id;
  if (assetId) files[versionId] = assetId;
  else delete files[versionId];
  return settle(logo, files, versions);
}

/** A new logo with one file in one version. */
export function newLogo(label: string, versions: BrandLogoVersion[], versionId: string, assetId: string): BrandLogo {
  return settle({ id: `l-${crypto.randomUUID()}`, label, assetId }, { [versionId]: assetId }, versions)!;
}

/**
 * The logos after the kit's versions change from `before` to `after`: each
 * logo keeps its files under their version ids; a kit naming its versions for
 * the first time maps the old main file to the first light version and the
 * dark file to the first dark one. Files of a removed version leave the kit
 * (they stay in the uploads); a logo left with none is removed.
 */
export function relinkLogos(logos: BrandLogo[], before: BrandLogoVersion[], after: BrandLogoVersion[]): BrandLogo[] {
  const fresh = before === LEGACY_VERSIONS || before.every((v, i) => LEGACY_VERSIONS[i]?.id === v.id);
  const out: BrandLogo[] = [];
  for (const l of logos) {
    const files: Record<string, string> = {};
    if (fresh) {
      // The logo's main and dark file, however they were stored.
      const main = versionFile(l, LEGACY_VERSIONS[0], LEGACY_VERSIONS), darkFile = versionFile(l, LEGACY_VERSIONS[1], LEGACY_VERSIONS);
      const light = firstOf(after, "light"), dark = firstOf(after, "dark");
      const mainTo = light ?? after[0];
      if (mainTo && main) files[mainTo.id] = main;
      if (dark && darkFile && dark.id !== mainTo?.id) files[dark.id] = darkFile;
    } else {
      for (const { version, assetId } of logoFiles(l, before)) {
        if (assetId && after.some((v) => v.id === version.id)) files[version.id] = assetId;
      }
    }
    const next = settle(l, files, after);
    if (next) out.push(next);
  }
  return out;
}

/** Whether the change of versions takes files out of the kit. */
export function versionsDropFiles(logos: BrandLogo[], before: BrandLogoVersion[], after: BrandLogoVersion[]): number {
  const count = (ls: BrandLogo[], vs: BrandLogoVersion[]) => ls.reduce((n, l) => n + logoFiles(l, vs).filter((f) => f.assetId).length, 0);
  return count(logos, before) - count(relinkLogos(logos, before, after), after);
}
