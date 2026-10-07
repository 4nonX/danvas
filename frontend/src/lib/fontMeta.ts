// Family, weight and style of a font file, read from the font itself (its
// name and OS/2 tables), so an upload is labelled the way the designer named
// it rather than by its file name.

export interface FontMeta {
  family: string;
  weight: number;
  style: "normal" | "italic";
}

const WEIGHT_WORDS: [RegExp, number][] = [
  [/thin|hairline/i, 100], [/extra\s*light|ultra\s*light/i, 200], [/light/i, 300],
  [/medium/i, 500], [/semi\s*bold|demi\s*bold/i, 600], [/extra\s*bold|ultra\s*bold/i, 800],
  [/black|heavy/i, 900], [/bold/i, 700],
];

/** Null when the bytes are not a font fontkit can read. */
export async function readFontMeta(bytes: Uint8Array, fileName = ""): Promise<FontMeta | null> {
  try {
    const fontkit = await import("fontkit");
    const parsed = fontkit.create(bytes);
    const font = "fonts" in parsed ? parsed.fonts[0] : parsed;
    if (!font) return null;
    const family = (font.getName("preferredFamily") || font.familyName || fileName.replace(/\.[^.]+$/, "")).trim();
    const sub = font.getName("preferredSubfamily") || font.subfamilyName || "";
    let weight = font["OS/2"]?.usWeightClass ?? 0;
    if (!weight || weight > 1000) weight = WEIGHT_WORDS.find(([re]) => re.test(sub))?.[1] ?? 400;
    const italic = !!font["OS/2"]?.fsSelection?.italic || /italic|oblique/i.test(sub) || (font.italicAngle ?? 0) !== 0;
    return { family, weight, style: italic ? "italic" : "normal" };
  } catch {
    return null;
  }
}
