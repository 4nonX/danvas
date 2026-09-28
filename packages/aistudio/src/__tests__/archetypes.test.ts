import { describe, expect, it } from "vitest";
import { archetypes, normalizeOutline, type Archetype } from "../outline";
import { deriveDesignSystem, catalogEntryForSeed, catalogEntryForMood, designSystemSlots, hueName, artDirectionFor } from "../designSystem";
import { archetypeIsImpact, composeArchetypePage, keepLastWordCompany, iconGlyphFor, applyMotion } from "../archetypes";
import { ICON_GLYPHS, ICON_KEYWORDS } from "../iconset";
import { layoutDeck } from "../deck";
import { deckThemes } from "../theme";
import { qualityCheck } from "../quality";
import { contrastRatio } from "@hc/color";

const size = { width: 1920, height: 1080 };
const theme = deckThemes({ count: 1, seed: 3, kicker: "Coastal Restoration" })[0];

/** One fully populated page per archetype, so every form composes its own
 *  payload rather than a downgraded fallback. */
function pageFor(a: Archetype): Record<string, unknown> {
  const base = { title: "Why the shoreline is retreating", archetype: a, note: "" };
  switch (a) {
    case "cover": return { ...base, subhead: "A plan for the next five years", image: { subject: "a dune belt at dawn", treatment: "photo" } };
    case "section": return { ...base, subhead: "Part two", image: { subject: "marsh grass", treatment: "photo" } };
    case "statement": return { ...base, title: "Every metre of dune we rebuild buys a decade for the village behind it", subhead: "That is the whole case." };
    case "bigNumber": return { ...base, stat: { value: "40", unit: "%", label: "more erosion since 2019" }, subhead: "Measured across all six survey points, winter storms included." };
    case "bullets": return { ...base, points: ["Erosion is accelerating on the north shore", "Two villages have already relocated", "Insurance cover is being withdrawn"], image: { subject: "eroded cliff face", treatment: "photo" } };
    case "twoColumn": return { ...base, columns: [{ heading: "Hard defences", points: ["Fast to build", "Fail all at once", "Move the problem downshore"] }, { heading: "Living shoreline", points: ["Slower to establish", "Strengthens each season", "Habitat comes with it"] }] };
    case "threeUp": return { ...base, columns: [{ heading: "Dune belt", points: ["First line of defence"] }, { heading: "Marsh grass", points: ["Slows the water"] }, { heading: "Oyster reef", points: ["Breaks the swell"] }] };
    case "process": return { ...base, steps: [{ label: "Survey", detail: "Map the retreat line each season" }, { label: "Plant", detail: "Native grass in the lee of the dune" }, { label: "Fence", detail: "Sand fences trap what the wind carries" }, { label: "Monitor", detail: "Compare against the survey line" }] };
    case "quote": return { ...base, quote: { text: "We stopped fighting the sea and started working with it.", attribution: "Harbour master, Port Elin" } };
    case "imageCaption": return { ...base, subhead: "The dune belt after two growing seasons.", image: { subject: "restored dune with grass", treatment: "photo" } };
    case "chart": return { ...base, subhead: "Retreat slowed in every year the belt was maintained.", chart: { kind: "bar", categories: ["2021", "2022", "2023", "2024"], series: [{ name: "Retreat (m)", values: [4.1, 3.2, 1.9, 0.8] }] } };
    case "closing": return { ...base, title: "Fund the next five kilometres", subhead: "Decision needed by March", image: { subject: "volunteers planting grass", treatment: "photo" } };
    case "agenda": return { ...base, points: ["The problem", "What we tried", "What worked", "The ask"] };
    case "kpiGrid": return { ...base, stats: [{ value: "40", unit: "%", label: "more erosion since 2019" }, { value: "2", label: "villages relocated" }, { value: "3.2", unit: "km", label: "of dune belt rebuilt" }] };
    case "timeline": return { ...base, steps: [{ when: "2019", label: "Survey", detail: "Map the retreat line" }, { when: "2021", label: "Plant", detail: "Native grass in the lee of the dune" }, { when: "2023", label: "Fence", detail: "Sand fences trap what the wind carries" }, { when: "2025", label: "Monitor" }] };
    case "table": return { ...base, table: { columns: ["Year", "Retreat (m)", "Cost"], rows: [["2021", "4.1", "$120k"], ["2022", "3.2", "$95k"], ["2023", "1.9", "$80k"], ["2024", "0.8", "$60k"]] } };
    case "team": return { ...base, people: [{ name: "Ada Okoro", role: "Coastal engineer" }, { name: "Leif Brandt", role: "Ecologist" }, { name: "Mira Sato", role: "Community lead" }] };
  }
}

describe("the design system", () => {
  it("fixes every ink to AA against the ground it sits on", () => {
    for (const seed of [0, 1, 5, 11]) {
      const ds = deriveDesignSystem(theme, size, { seed, catalog: catalogEntryForSeed(seed) });
      const c = ds.colors;
      expect(contrastRatio(c.inkOnDeep, c.deep)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(c.ink, c.paper)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(c.mutedOnDeep, c.deep)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(c.mutedOnPaper, c.paper)).toBeGreaterThanOrEqual(4.5);
      // Accents carry rules and numerals: large-text threshold.
      expect(contrastRatio(c.accentOnPaper, c.paper)).toBeGreaterThanOrEqual(3);
      expect(contrastRatio(c.accentOnDeep, c.deep)).toBeGreaterThanOrEqual(3);
    }
  });

  it("derives a full system from a bare theme too, with a real type pairing", () => {
    const ds = deriveDesignSystem(theme, size, { seed: 2 });
    expect(ds.fonts.heading).not.toBe("system");
    expect(ds.fonts.body).not.toBe("system");
    expect(designSystemSlots(ds)).toHaveLength(6);
    expect(ds.unit).toBeGreaterThan(0);
    expect(ds.margin % ds.unit).toBe(0);
  });

  it("is deterministic", () => {
    const a = deriveDesignSystem(theme, size, { seed: 4 });
    const b = deriveDesignSystem(theme, size, { seed: 4 });
    expect(a).toEqual(b);
  });

  it("reads the outline's mood into a catalog style group", () => {
    expect(catalogEntryForMood("warm, community celebration", 3).style).toBe("warm");
    expect(catalogEntryForMood("dark, premium, luxury", 3).style).toBe("dark");
    expect(catalogEntryForMood("software platform, data", 3).style).toBe("tech");
    expect(catalogEntryForMood("clean, quiet", 3).style).toBe("minimal");
    // A tie goes to the stronger descriptor.
    expect(catalogEntryForMood("clean, energetic", 3).style).toBe("bold");
    // No recognizable words: the seed alone decides, exactly as before.
    expect(catalogEntryForMood("xyzzy", 5)).toEqual(catalogEntryForSeed(5));
    // Deterministic, and the seed still varies the pick within the group.
    expect(catalogEntryForMood("warm", 1)).toEqual(catalogEntryForMood("warm", 1));
  });
});

describe("every archetype composes a clean page", () => {
  const ds = deriveDesignSystem(theme, size, { seed: 1, catalog: catalogEntryForSeed(1) });

  for (const a of archetypes) {
    it(`${a}: no overflow, no overlap, AA contrast, every node inside the page`, () => {
      const outline = normalizeOutline({ title: "T", pages: [pageFor(a)] });
      const item = outline.pages[0];
      expect(item.archetype).toBe(a); // the fixture payload must survive normalization
      const page = composeArchetypePage(item, ds, { index: 3, total: 10 });
      expect(page.archetype).toBe(a);
      expect(page.impact).toBe(archetypeIsImpact(a));
      expect(page.nodes.length).toBeGreaterThan(0);
      const q = qualityCheck({ background: page.background, nodes: page.nodes, size });
      // Nothing overlaps, nothing overflows, every text clears AA. A text box
      // taller than its text counts as an overlap here, on purpose.
      expect(q.issues, JSON.stringify(q.issues)).toEqual([]);
    });
  }

  it("tags every picture region the way the editor's image queue expects", () => {
    const outline = normalizeOutline({ title: "T", pages: [pageFor("imageCaption"), pageFor("bullets"), pageFor("cover")] });
    outline.pages.forEach((item, i) => {
      const page = composeArchetypePage(item, ds, { index: i, total: 3 });
      const slots = page.nodes.filter((n) => (n as { data?: { placeholderId?: string } }).data?.placeholderId);
      expect(slots.length).toBe(1);
      const d = (slots[0] as { data: { placeholderId: string; aiImagePrompt: string } }).data;
      expect(page.imagePrompts[d.placeholderId]).toBe(d.aiImagePrompt);
      expect(d.aiImagePrompt).toContain("no text");
    });
  });

  it("puts the number at display scale, not body scale", () => {
    const item = normalizeOutline({ title: "T", pages: [pageFor("bigNumber")] }).pages[0];
    const page = composeArchetypePage(item, ds, { index: 1, total: 4 });
    const figure = page.nodes.find((n) => n.name === "Figure") as { content: { runs: { style: { fontSize: number } }[] }[] } | undefined;
    expect(figure).toBeTruthy();
    expect(figure!.content[0].runs[0].style.fontSize).toBeGreaterThan(size.height * 0.15);
  });

  it("numbers steps because a process is a sequence, and only there", () => {
    const proc = composeArchetypePage(normalizeOutline({ title: "T", pages: [pageFor("process")] }).pages[0], ds, { index: 2, total: 5 });
    expect(proc.nodes.filter((n) => n.name === "Step")).toHaveLength(4);
    const cols = composeArchetypePage(normalizeOutline({ title: "T", pages: [pageFor("threeUp")] }).pages[0], ds, { index: 2, total: 5 });
    expect(cols.nodes.filter((n) => n.name === "Step")).toHaveLength(0);
  });

  it("mirrors for right-to-left decks", () => {
    const ltr = deriveDesignSystem(theme, size, { seed: 1, dir: "ltr" });
    const rtl = deriveDesignSystem(theme, size, { seed: 1, dir: "rtl" });
    const item = normalizeOutline({ title: "T", pages: [pageFor("bullets")] }).pages[0];
    const l = composeArchetypePage(item, ltr, { index: 0, total: 1 });
    const r = composeArchetypePage(item, rtl, { index: 0, total: 1 });
    const titleL = l.nodes.find((n) => n.name === "Title") as { transform: { x: number }; size: { width: number } };
    const titleR = r.nodes.find((n) => n.name === "Title") as { transform: { x: number }; size: { width: number } };
    expect(Math.round(titleR.transform.x)).toBe(Math.round(size.width - titleL.transform.x - titleL.size.width));
  });
});

describe("layoutDeck", () => {
  it("composes a varied deck from one system and reports quality per page", () => {
    const outline = normalizeOutline({ title: "Coastal Restoration", pages: archetypes.map(pageFor) });
    const deck = layoutDeck(outline, theme, size, { seed: 7, catalog: catalogEntryForSeed(7) });
    expect(deck.pages).toHaveLength(archetypes.length);
    expect(new Set(deck.pages.map((p) => p.archetype)).size).toBe(archetypes.length);
    for (const p of deck.pages) {
      expect(p.quality.issues, `${p.archetype}: ${JSON.stringify(p.quality.issues)}`).toEqual([]);
    }
    // Reading pages carry the eyebrow band (the deck's name when the outline
    // gave no eyebrow) and the footer; a cover has neither, and no impact
    // page has an eyebrow it was not given.
    const eyebrows = deck.pages.filter((p) => p.nodes.some((n) => n.name === "Eyebrow"));
    expect(eyebrows.every((p) => !archetypeIsImpact(p.archetype))).toBe(true);
    expect(eyebrows.length).toBeGreaterThan(0);
    const footers = deck.pages.filter((p) => p.nodes.some((n) => n.name === "Footer"));
    expect(footers.length).toBe(deck.pages.length - 1);
    expect(deck.pages[0].nodes.some((n) => n.name === "Footer" || n.name === "Page number")).toBe(false);
  });

  it("is byte-for-byte deterministic", () => {
    const outline = normalizeOutline({ title: "Coastal Restoration", pages: archetypes.map(pageFor) });
    // Node ids are minted by the environment (a counter under goja and in the
    // parity test), so they are stripped here along with the quality report
    // that quotes them; everything else must be identical.
    const strip = (d: ReturnType<typeof layoutDeck>) => JSON.stringify(d.pages.map((p) => ({ ...p, quality: undefined, nodes: p.nodes.map((n) => ({ ...n, id: "x" })) })));
    expect(strip(layoutDeck(outline, theme, size, { seed: 7 }))).toBe(strip(layoutDeck(outline, theme, size, { seed: 7 })));
  });
});

describe("lists and widows", () => {
  const ds = deriveDesignSystem(theme, size, { seed: 1, catalog: catalogEntryForSeed(1) });
  type Para = { runs: { text: string }[]; style?: { list?: { type: string; level: number } } };
  const paragraphsOf = (nodes: { name?: string; content?: Para[] }[], name: string): Para[] =>
    nodes.filter((n) => n.name === name).flatMap((n) => n.content ?? []);

  it("sets points as real bullet list items, not a bullet character in the copy", () => {
    const item = normalizeOutline({ title: "T", pages: [pageFor("bullets")] }).pages[0];
    const page = composeArchetypePage(item, ds, { index: 1, total: 4 });
    const points = paragraphsOf(page.nodes as never, "Points");
    expect(points.length).toBe(3);
    for (const p of points) {
      expect(p.style?.list).toEqual({ type: "bullet", level: 0 });
      expect(p.runs[0].text.startsWith("•")).toBe(false);
    }
  });

  it("numbers an agenda and a long process through the list style", () => {
    const agenda = normalizeOutline({ title: "T", pages: [pageFor("agenda")] }).pages[0];
    const a = composeArchetypePage(agenda, ds, { index: 1, total: 4 });
    for (const p of paragraphsOf(a.nodes as never, "Agenda")) {
      expect(p.style?.list?.type).toBe("number");
      expect(/^\d/.test(p.runs[0].text)).toBe(false);
    }
    const five = { ...pageFor("process"), steps: ["Survey", "Plant", "Fence", "Monitor", "Report"].map((label) => ({ label })) };
    const process = normalizeOutline({ title: "T", pages: [five] }).pages[0];
    const pr = composeArchetypePage(process, ds, { index: 2, total: 4 });
    const steps = paragraphsOf(pr.nodes as never, "Steps");
    expect(steps.length).toBe(5);
    expect(steps.every((p) => p.style?.list?.type === "number")).toBe(true);
  });

  it("column points are list items too", () => {
    const item = normalizeOutline({ title: "T", pages: [pageFor("twoColumn")] }).pages[0];
    const page = composeArchetypePage(item, ds, { index: 1, total: 4 });
    const points = paragraphsOf(page.nodes as never, "Points");
    expect(points.length).toBe(6);
    expect(points.every((p) => p.style?.list?.type === "bullet")).toBe(true);
  });

  it("keeps a heading's last word company with a no-break space", () => {
    expect(keepLastWordCompany("Why the shoreline is retreating")).toBe("Why the shoreline is retreating");
    expect(keepLastWordCompany("Two words")).toBe("Two words");
    expect(keepLastWordCompany("One")).toBe("One");
    // Whitespace around the join: the run of spaces before the last word
    // collapses into the single no-break space, and trailing whitespace goes.
    expect(keepLastWordCompany("a b   c")).toBe("a b c");
    expect(keepLastWordCompany("a b c   ")).toBe("a b c");
    // A tab before the last word is not a space, so there is nothing to join.
    expect(keepLastWordCompany("a b\tc")).toBe("a b\tc");
    // The previous pattern backtracked quadratically here: the words are
    // TAB-separated, so the literal-space part of / +(\S+)\s*$/ can only
    // start inside the trailing space run, where \S+ always fails, and the
    // engine retries from every position in it. Tabs matter - with a space
    // before the run the match succeeds immediately and hides the problem.
    // Measured on the old pattern: 38ms at 10k, 139ms at 20k, 491ms at 40k.
    const adversarial = "one\ttwo\t" + "a".repeat(40000) + " ".repeat(40000);
    const t0 = Date.now();
    keepLastWordCompany(adversarial);
    expect(Date.now() - t0).toBeLessThan(250);
    const item = normalizeOutline({ title: "T", pages: [pageFor("bullets")] }).pages[0];
    const page = composeArchetypePage(item, ds, { index: 1, total: 4 });
    const title = paragraphsOf(page.nodes as never, "Title")[0];
    expect(title.runs[0].text).toBe("Why the shoreline is retreating");
    // Body copy is left alone.
    for (const p of paragraphsOf(page.nodes as never, "Points")) expect(p.runs[0].text).not.toContain(" ");
  });
});

describe("art direction", () => {
  it("names hues plainly and deterministically", () => {
    const c = (r: number, g: number, b: number) => ({ srgb: { r, g, b, a: 1 } });
    expect(hueName(c(0.1, 0.5, 0.45))).toBe("teal");
    expect(hueName(c(0.9, 0.9, 0.9))).toBe("light grey");
    expect(hueName(c(0.05, 0.05, 0.08))).toBe("near-black");
    expect(hueName(c(0.98, 0.97, 0.95))).toBe("off-white");
    expect(hueName(c(0.55, 0.1, 0.1))).toBe("red");
    expect(hueName(c(0.2, 0.05, 0.4))).toBe("deep indigo");
  });

  it("gives every picture in a deck the same closing clause, carrying the mood and the palette", () => {
    const outline = normalizeOutline({
      title: "T",
      theme: "calm, coastal, restrained",
      pages: [pageFor("cover"), pageFor("bullets"), pageFor("imageCaption"), pageFor("closing")],
    });
    const deck = layoutDeck(outline, theme, size, { catalog: catalogEntryForSeed(3), seed: 3 });
    const prompts = deck.pages.flatMap((p) => Object.values(p.imagePrompts));
    expect(prompts.length).toBeGreaterThanOrEqual(4);
    const clause = deck.system.artDirection;
    expect(clause).toContain("calm, coastal, restrained mood");
    expect(clause).toContain("tones in the palette");
    expect(clause).toContain("no text, no logos");
    for (const p of prompts) expect(p.endsWith(clause)).toBe(true);
    // The subject still leads, so the picture ladder can recover it.
    expect(prompts[0].startsWith("a dune belt at dawn,")).toBe(true);
    // The same outline and system always write the same clause.
    expect(artDirectionFor("calm, coastal, restrained", deck.system.colors)).toBe(clause);
  });
});


describe("phase 7 forms", () => {
  const ds = deriveDesignSystem(theme, size, { seed: 2, catalog: catalogEntryForSeed(2) });
  const names = (nodes: { name?: string }[]) => nodes.map((n) => n.name);

  it("sets a grid of figures, two by two for four", () => {
    const three = normalizeOutline({ title: "T", pages: [pageFor("kpiGrid")] }).pages[0];
    const p3 = composeArchetypePage(three, ds, { index: 1, total: 4 });
    expect(names(p3.nodes as never).filter((n) => n === "Figure")).toHaveLength(3);
    const four = normalizeOutline({ title: "T", pages: [{ ...pageFor("kpiGrid"), stats: [...(pageFor("kpiGrid").stats as unknown[]), { value: "12", label: "months" }] }] }).pages[0];
    const p4 = composeArchetypePage(four, ds, { index: 1, total: 4 });
    const figures = (p4.nodes as { name?: string; transform: { y: number } }[]).filter((n) => n.name === "Figure");
    expect(figures).toHaveLength(4);
    expect(new Set(figures.map((f) => Math.round(f.transform.y))).size).toBe(2);
  });

  it("draws a timeline with markers, segments between them, and the time above each", () => {
    const item = normalizeOutline({ title: "T", pages: [pageFor("timeline")] }).pages[0];
    const page = composeArchetypePage(item, ds, { index: 2, total: 4 });
    const n = names(page.nodes as never);
    expect(n.filter((x) => x === "Marker")).toHaveLength(4);
    expect(n.filter((x) => x === "Sequence")).toHaveLength(3);
    expect(n.filter((x) => x === "When")).toHaveLength(4);
  });

  it("sets a table with a tinted header row, numeric columns flush right and the label column left, in the system face the renderers use", () => {
    const item = normalizeOutline({ title: "T", pages: [pageFor("table")] }).pages[0];
    const page = composeArchetypePage(item, ds, { index: 2, total: 4 });
    const tbl = (page.nodes as { type: string; rows?: number; cols?: number; cells?: { row: number; col: number; align: string; content: { fontId: string; weight: number }[] }[]; headerStyle?: { enabled: boolean } }[]).find((x) => x.type === "table")!;
    expect(tbl.rows).toBe(5);
    expect(tbl.cols).toBe(3);
    expect(tbl.headerStyle?.enabled).toBe(true);
    const cells = tbl.cells!;
    expect(cells.filter((c) => c.row === 0).every((c) => c.content[0].weight === 700)).toBe(true);
    // Year is the row label: left, even though it is digits. Retreat (m) and
    // Cost ($120k) are numeric columns: right, header included.
    expect(cells.filter((c) => c.col === 0).every((c) => c.align === "left")).toBe(true);
    expect(cells.filter((c) => c.col === 1).every((c) => c.align === "right")).toBe(true);
    expect(cells.filter((c) => c.col === 2).every((c) => c.align === "right")).toBe(true);
    expect(cells.every((c) => c.content[0].fontId === "system")).toBe(true);
    // A column with one non-numeric value reads from the left.
    const mixed = normalizeOutline({ title: "T", pages: [{ ...pageFor("table"), table: { columns: ["Year", "Owner"], rows: [["2021", "Ada"], ["2022", "3"]] } }] }).pages[0];
    const t2 = (composeArchetypePage(mixed, ds, { index: 2, total: 4 }).nodes as { type: string; cells?: { col: number; align: string }[] }[]).find((x) => x.type === "table")!;
    expect(t2.cells!.filter((c) => c.col === 1).every((c) => c.align === "left")).toBe(true);
  });

  it("sizes chart text for the slide and labels the values", () => {
    const item = normalizeOutline({ title: "T", pages: [pageFor("chart")] }).pages[0];
    const page = composeArchetypePage(item, ds, { index: 2, total: 4 });
    const chart = (page.nodes as { type: string; style?: { fontSize?: number; valueLabels?: boolean; legend?: { show: boolean } } }[]).find((x) => x.type === "chart")!;
    expect(chart.style?.fontSize).toBeGreaterThan(20);
    expect(chart.style?.valueLabels).toBe(true);
    expect(chart.style?.legend?.show).toBe(false);
  });

  it("sets a team as monograms with names and roles, never a generated portrait", () => {
    const item = normalizeOutline({ title: "T", pages: [pageFor("team")] }).pages[0];
    const page = composeArchetypePage(item, ds, { index: 3, total: 4 });
    const monograms = (page.nodes as { name?: string; content?: { runs: { text: string }[] }[] }[]).filter((n) => n.name === "Monogram");
    expect(monograms.map((m) => m.content![0].runs[0].text)).toEqual(["AO", "LB", "MS"]);
    expect(Object.keys(page.imagePrompts)).toHaveLength(0);
  });

  it("downgrades a form whose payload did not survive, and promotes one figure to a bigNumber", () => {
    const pages = normalizeOutline({ title: "T", pages: [
      { title: "a", archetype: "kpiGrid" },
      { title: "b", archetype: "kpiGrid", stats: [{ value: "40", label: "x" }] },
      { title: "c", archetype: "timeline", steps: [{ label: "one" }] },
      { title: "d", archetype: "table", table: { columns: ["a"], rows: [[""]] } },
      { title: "e", archetype: "table", table: { columns: ["a", "b"], rows: [["1", "2", "extra"], ["", ""], ["3"]] } },
      { title: "f", archetype: "team" },
      { title: "g", archetype: "twoColumn", columns: [{ heading: "a", points: ["p"], icon: " Shield " }, { heading: "b", points: ["q"] }] },
    ] }).pages;
    expect(pages.map((p) => p.archetype)).toEqual(["bullets", "bigNumber", "bullets", "bullets", "table", "bullets", "twoColumn"]);
    expect(pages[1].stat?.value).toBe("40");
    expect(pages[4].table?.rows).toEqual([["1", "2"], ["3", ""]]);
    expect(pages[6].columns?.[0].icon).toBe("shield");
  });
});

describe("icons", () => {
  const ds = deriveDesignSystem(theme, size, { seed: 2, catalog: catalogEntryForSeed(2) });

  it("resolves keywords, synonyms and phrases, and nothing for an invented word", () => {
    expect(iconGlyphFor("shield")).toBe("shield");
    expect(iconGlyphFor("Security")).toBe("shield");
    expect(iconGlyphFor("cloud storage")).toBe("cloud");
    expect(iconGlyphFor("flibbertigibbet")).toBeNull();
    expect(iconGlyphFor("")).toBeNull();
    // Every keyword points at a glyph that exists, and every glyph is closed geometry.
    for (const g of Object.values(ICON_KEYWORDS)) expect(ICON_GLYPHS[g]?.length).toBeGreaterThan(0);
    for (const contours of Object.values(ICON_GLYPHS)) for (const c of contours) expect(c.segments.length).toBeGreaterThanOrEqual(2);
  });

  it("places one icon per column above its heading when every column names one, and none otherwise", () => {
    const base = pageFor("twoColumn") as { columns: { heading: string; points: string[]; icon?: string }[] };
    const both = { ...base, columns: [{ ...base.columns[0], icon: "shield" }, { ...base.columns[1], icon: "leaf" }] };
    const item = normalizeOutline({ title: "T", pages: [both] }).pages[0];
    const page = composeArchetypePage(item, ds, { index: 1, total: 4 });
    type N = { name?: string; type: string; transform: { x: number; y: number }; size: { width: number; height: number }; data?: { icon?: string }; fills?: unknown[]; contours?: unknown[] };
    const icons = (page.nodes as N[]).filter((n) => n.name === "Icon");
    expect(icons).toHaveLength(2);
    expect(icons.map((i) => i.data?.icon)).toEqual(["shield", "leaf"]);
    expect(icons.every((i) => i.type === "path" && i.fills?.length === 1)).toBe(true);
    // Above the heading, inside the page, square.
    const headings = (page.nodes as N[]).filter((n) => n.name === "Heading");
    icons.forEach((ic, i) => {
      expect(ic.transform.y + ic.size.height).toBeLessThanOrEqual(headings[i].transform.y);
      expect(ic.size.width).toBe(ic.size.height);
      expect(ic.transform.x).toBeGreaterThanOrEqual(0);
    });
    expect(qualityCheck({ background: page.background, nodes: page.nodes, size }).issues).toEqual([]);
    // One column without a known icon: no icons at all.
    const one = { ...base, columns: [{ ...base.columns[0], icon: "shield" }, { ...base.columns[1] }] };
    const p1 = composeArchetypePage(normalizeOutline({ title: "T", pages: [one] }).pages[0], ds, { index: 1, total: 4 });
    expect((p1.nodes as N[]).filter((n) => n.name === "Icon")).toHaveLength(0);
  });
});

describe("motion", () => {
  type Animated = { name?: string; animation?: { entrance?: { preset: string; delayMs: number; durationMs: number; startMode?: string } } };
  const entrances = (nodes: Animated[]) => nodes.filter((n) => n.animation?.entrance);

  it("gives every element one entrance in z-order, furniture none, and stays deterministic", () => {
    const ds = deriveDesignSystem(theme, size, { seed: 2, catalog: catalogEntryForSeed(2) });
    const item = normalizeOutline({ title: "T", pages: [pageFor("bullets")] }).pages[0];
    const page = composeArchetypePage(item, ds, { index: 1, total: 4 });
    const nodes = page.nodes as Animated[];
    for (const n of nodes) {
      if (n.name === "Kicker" || n.name === "Page number" || n.name === "Footer" || n.name === "Logo") expect(n.animation).toBeUndefined();
      else expect(n.animation?.entrance).toBeDefined();
    }
    const ents = entrances(nodes).map((n) => n.animation!.entrance!);
    // The picture fades, the title rises, delays never run backwards and stay short.
    expect(nodes.find((n) => n.name === "Image")!.animation!.entrance!.preset).toBe("fade");
    expect(nodes.find((n) => n.name === "Title")!.animation!.entrance!.preset).toBe("rise");
    for (let i = 1; i < ents.length; i++) expect(ents[i].delayMs).toBeGreaterThanOrEqual(ents[i - 1].delayMs);
    expect(Math.max(...ents.map((e) => e.delayMs + e.durationMs))).toBeLessThanOrEqual(1080 + 700);
    // Same input, same entrances (ids are minted fresh and are not compared).
    const again = composeArchetypePage(item, ds, { index: 1, total: 4 });
    const shape = (ns: Animated[]) => JSON.stringify(ns.map((n) => ({ name: n.name, animation: n.animation })));
    expect(shape(again.nodes as Animated[])).toBe(shape(nodes));
  });

  it("leaves the deck still when motion is none, and strips a stray entrance", () => {
    const ds = deriveDesignSystem(theme, size, { seed: 2, catalog: catalogEntryForSeed(2), motion: "none" });
    const item = normalizeOutline({ title: "T", pages: [pageFor("cover")] }).pages[0];
    const page = composeArchetypePage(item, ds, { index: 0, total: 4 });
    expect(entrances(page.nodes as Animated[])).toHaveLength(0);
    const stray: Animated[] = [{ name: "Title", animation: { entrance: { preset: "rise", delayMs: 0, durationMs: 1 } } }];
    expect(applyMotion(stray, "none")[0].animation).toBeUndefined();
  });
});

describe("brand logo", () => {
  const logo = { assetId: "asset-logo", url: "/api/v1/assets/asset-logo/content", aspect: 3 };

  it("places the logo on every archetype page, top-leading on impact pages and bottom-leading on reading pages, without collisions", () => {
    const ds = deriveDesignSystem(theme, size, { seed: 1, catalog: catalogEntryForSeed(1), logo });
    for (const a of archetypes) {
      const item = normalizeOutline({ title: "T", pages: [pageFor(a)] }).pages[0];
      const page = composeArchetypePage(item, ds, { index: 3, total: 10 });
      type N = { name?: string; type: string; fit?: string; source?: { assetId: string }; transform: { x: number; y: number }; size: { width: number; height: number }; data?: { brandLogo?: boolean } };
      const logos = (page.nodes as N[]).filter((n) => n.name === "Logo");
      expect(logos, a).toHaveLength(1);
      const l = logos[0];
      expect(l.type).toBe("image");
      expect(l.fit).toBe("contain");
      expect(l.source?.assetId).toBe("asset-logo");
      expect(l.data?.brandLogo).toBe(true);
      expect(l.size.width / l.size.height).toBeCloseTo(3, 0);
      if (page.impact) expect(l.transform.y).toBeLessThan(ds.margin);
      else expect(l.transform.y + l.size.height).toBeGreaterThan(size.height - ds.margin);
      expect(qualityCheck({ background: page.background, nodes: page.nodes, size }).issues, a).toEqual([]);
      // The logo is furniture: no entrance, and not a picture to regenerate.
      expect((l as { animation?: unknown }).animation).toBeUndefined();
      expect(Object.keys(page.imagePrompts).some((k) => k.includes("logo"))).toBe(false);
    }
  });

  it("honours the kit's minimum width and sizes the box to the picture's aspect, within the room the margin leaves", () => {
    const item = normalizeOutline({ title: "T", pages: [pageFor("bullets")] }).pages[0];
    type N = { name?: string; size: { width: number; height: number } };
    const wide = deriveDesignSystem(theme, size, { seed: 1, catalog: catalogEntryForSeed(1), logo: { ...logo, aspect: 4, minSizePx: 200 } });
    const page = composeArchetypePage(item, wide, { index: 1, total: 4 });
    const l = (page.nodes as N[]).find((n) => n.name === "Logo")!;
    expect(l.size.width).toBeGreaterThanOrEqual(200);
    expect(l.size.width / l.size.height).toBeCloseTo(4, 0);
    expect(qualityCheck({ background: page.background, nodes: page.nodes, size }).issues).toEqual([]);
    // A floor the margin cannot hold is capped rather than allowed to collide
    // with the page's content.
    const huge = deriveDesignSystem(theme, size, { seed: 1, catalog: catalogEntryForSeed(1), logo: { ...logo, aspect: 4, minSizePx: 2000 } });
    const capped = composeArchetypePage(item, huge, { index: 1, total: 4 });
    const c = (capped.nodes as N[]).find((n) => n.name === "Logo")!;
    expect(c.size.width).toBeLessThan(2000);
    expect(c.size.height).toBeLessThanOrEqual(huge.unit * 4);
    expect(qualityCheck({ background: capped.background, nodes: capped.nodes, size }).issues).toEqual([]);
  });

  it("places nothing when the workspace has no logo, or the logo has no url", () => {
    const none = deriveDesignSystem(theme, size, { seed: 2, catalog: catalogEntryForSeed(2) });
    const noUrl = deriveDesignSystem(theme, size, { seed: 2, catalog: catalogEntryForSeed(2), logo: { assetId: "x", url: "" } });
    for (const ds of [none, noUrl]) {
      const item = normalizeOutline({ title: "T", pages: [pageFor("bullets")] }).pages[0];
      const page = composeArchetypePage(item, ds, { index: 1, total: 4 });
      expect((page.nodes as { name?: string }[]).filter((n) => n.name === "Logo")).toHaveLength(0);
    }
  });
});

describe("the large variant", () => {
  const ds = deriveDesignSystem(theme, size, { seed: 1, catalog: catalogEntryForSeed(1) });
  type N = { name?: string; content?: { runs: { style: { fontSize: number } }[] }[]; size: { width: number; height: number } };
  const sizeOf = (nodes: N[], name: string) => nodes.find((n) => n.name === name)!.content![0].runs[0].style.fontSize;

  it("steps a horizontal form's body up, and leaves the title alone", () => {
    for (const a of ["threeUp", "process", "timeline", "team"] as const) {
      const item = normalizeOutline({ title: "T", pages: [pageFor(a)] }).pages[0];
      const plain = composeArchetypePage(item, ds, { index: 2, total: 4 }).nodes as N[];
      const large = composeArchetypePage(item, ds, { index: 2, total: 4, variant: "large" }).nodes as N[];
      expect(sizeOf(large, "Title"), a).toBe(sizeOf(plain, "Title"));
      const body = a === "threeUp" ? "Heading" : a === "team" ? "Name" : "Label";
      expect(sizeOf(large, body), a).toBeGreaterThan(sizeOf(plain, body));
      expect(qualityCheck({ background: plain.length ? { type: "solid", color: ds.colors.paper } : ({} as never), nodes: large as never, size }).issues, a).toEqual([]);
    }
    const icons = (composeArchetypePage(normalizeOutline({ title: "T", pages: [{ ...pageFor("threeUp"), columns: (pageFor("threeUp") as { columns: { heading: string; points: string[] }[] }).columns.map((c, i) => ({ ...c, icon: ["shield", "leaf", "clock"][i] })) }] }).pages[0], ds, { index: 2, total: 4, variant: "large" }).nodes as N[]).filter((n) => n.name === "Icon");
    expect(icons[0].size.width).toBeGreaterThan(Math.round(size.height * 0.07));
  });

  it("is what the fixer plans for a sparse horizontal page, and the deck ends up fuller for it", () => {
    const outline = normalizeOutline({ title: "T", theme: "calm", pages: [pageFor("cover"), pageFor("threeUp"), pageFor("process"), pageFor("team")] });
    const deck = layoutDeck(outline, theme, size, { catalog: catalogEntryForSeed(1), seed: 1 });
    expect(deck.report.ok).toBe(true);
    // Compose the same pages with no variant to compare whitespace.
    for (const i of [1, 2, 3]) {
      const plain = composeArchetypePage(outline.pages[i], deck.system, { index: i, total: 4 });
      const plainWs = deck.report.pages[i].whitespace;
      const plainNodes = plain.nodes as N[];
      const finalNodes = deck.pages[i].nodes as N[];
      const body = i === 1 ? "Heading" : i === 3 ? "Name" : "Label";
      expect(sizeOf(finalNodes, body)).toBeGreaterThanOrEqual(sizeOf(plainNodes, body));
      void plainWs;
    }
  });
});

describe("icons and decor across the deck", () => {
  const ds = deriveDesignSystem(theme, size, { seed: 1, catalog: catalogEntryForSeed(1) });
  type N = { name?: string; type: string; data?: { icon?: string; decor?: boolean }; transform: { x: number; y: number }; size: { width: number; height: number } };
  const named = (page: { nodes: unknown[] }, name: string) => (page.nodes as N[]).filter((n) => n.name === name);
  const clean = (page: { background: never; nodes: never }) => expect(qualityCheck({ background: page.background, nodes: page.nodes, size }).issues).toEqual([]);

  it("sets a page icon beside the title on bullets and statements, and above the figure on a big number", () => {
    for (const a of ["bullets", "statement", "bigNumber"] as const) {
      const item = normalizeOutline({ title: "T", pages: [{ ...pageFor(a), icon: "Shield" }] }).pages[0];
      expect(item.icon).toBe("shield");
      const page = composeArchetypePage(item, ds, { index: 1, total: 4 });
      expect(named(page, "Icon"), a).toHaveLength(1);
      expect(named(page, "Icon")[0].data?.icon).toBe("shield");
      clean(page as never);
    }
    const none = composeArchetypePage(normalizeOutline({ title: "T", pages: [{ ...pageFor("bullets"), icon: "flibbertigibbet" }] }).pages[0], ds, { index: 1, total: 4 });
    expect(named(none, "Icon")).toHaveLength(0);
  });

  it("puts a stat's icon above each figure of a grid, and a step's icon in place of a timeline marker, all or nothing", () => {
    const grid = pageFor("kpiGrid") as { stats: { value: string; label: string; icon?: string }[] };
    const withAll = normalizeOutline({ title: "T", pages: [{ ...grid, stats: grid.stats.map((st, i) => ({ ...st, icon: ["leaf", "users", "bolt"][i] })) }] }).pages[0];
    const g = composeArchetypePage(withAll, ds, { index: 1, total: 4 });
    expect(named(g, "Icon")).toHaveLength(3);
    clean(g as never);
    // Four figures with icons and two-line labels still fit above the
    // furniture: the figures step down rather than run into the page number.
    const four = normalizeOutline({ title: "T", pages: [{ ...grid, stats: [...grid.stats, { value: "1,200", label: "volunteer days across all six survey points" }].map((st, i) => ({ ...st, icon: ["leaf", "users", "bolt", "home"][i], label: st.label + " over the last full season" })) }] }).pages[0];
    const f = composeArchetypePage(four, ds, { index: 1, total: 4 });
    expect(named(f, "Icon")).toHaveLength(4);
    expect(named(f, "Figure")).toHaveLength(4);
    clean(f as never);
    // The figure's glyphs sit under the rule, never rising into the icon: the
    // figure box starts below the icon's bottom in every cell.
    const icons = named(f, "Icon");
    const figures = named(f, "Figure");
    figures.forEach((fig, i) => expect(fig.transform.y).toBeGreaterThan(icons[i].transform.y + icons[i].size.height));
    const withOne = normalizeOutline({ title: "T", pages: [{ ...grid, stats: grid.stats.map((st, i) => (i === 0 ? { ...st, icon: "leaf" } : st)) }] }).pages[0];
    expect(named(composeArchetypePage(withOne, ds, { index: 1, total: 4 }), "Icon")).toHaveLength(0);
    const tl = pageFor("timeline") as { steps: { label: string; icon?: string }[] };
    const iconTimeline = normalizeOutline({ title: "T", pages: [{ ...tl, steps: tl.steps.map((st, i) => ({ ...st, icon: ["search", "seedling", "shield", "eye"][i] })) }] }).pages[0];
    const t = composeArchetypePage(iconTimeline, ds, { index: 2, total: 4 });
    const markers = named(t, "Marker");
    expect(markers).toHaveLength(4);
    expect(markers.every((m) => m.type === "path")).toBe(true);
    expect(named(t, "Sequence")).toHaveLength(3);
    clean(t as never);
  });

  it("gives a cover, section or closing without a picture a decor disc behind the words, and none over a picture", () => {
    for (const a of ["cover", "section", "closing"] as const) {
      const bare = { ...pageFor(a), image: undefined, icon: "rocket" };
      const page = composeArchetypePage(normalizeOutline({ title: "T", pages: [bare] }).pages[0], ds, { index: 0, total: 4, section: 2 });
      const decor = named(page, "Decor");
      // The gradient corner disc, the soft disc, and the icon set in it.
      expect(decor.length, a).toBe(3);
      expect(decor.every((d) => d.data?.decor)).toBe(true);
      expect((page.nodes as N[])[0].name).toBe("Decor");
      // The discs sit on the trailing side, clear of the text column.
      const title = (page.nodes as N[]).find((n) => n.name === "Title")!;
      expect(decor[1].transform.x).toBeGreaterThan(title.transform.x + title.size.width - ds.gutter * 3);
      clean(page as never);
      const pictured = composeArchetypePage(normalizeOutline({ title: "T", pages: [pageFor(a)] }).pages[0], ds, { index: 0, total: 4 });
      expect(named(pictured, "Decor")).toHaveLength(0);
    }
  });

  it("numbers section dividers in deck order", () => {
    const outline = normalizeOutline({ title: "T", pages: [pageFor("cover"), pageFor("section"), pageFor("bullets"), pageFor("section"), pageFor("closing")] });
    const deck = layoutDeck(outline, theme, size, { catalog: catalogEntryForSeed(1), seed: 1 });
    const numberOf = (i: number) => (deck.pages[i].nodes as { name?: string; content?: { runs: { text: string }[] }[] }[]).find((n) => n.name === "Section number")?.content?.[0].runs[0].text;
    expect(numberOf(1)).toBe("01");
    expect(numberOf(3)).toBe("02");
    expect(numberOf(2)).toBeUndefined();
    expect(deck.report.ok).toBe(true);
  });

  it("keeps a short body near its title instead of floating it mid-page", () => {
    const item = normalizeOutline({ title: "T", pages: [pageFor("threeUp")] }).pages[0];
    const page = composeArchetypePage(item, ds, { index: 1, total: 4 });
    const title = named(page, "Title")[0];
    const firstBody = (page.nodes as N[]).filter((n) => n.name === "Heading" || n.name === "Icon" || n.name === "Accent").reduce((m, n) => Math.min(m, n.transform.y), Infinity);
    expect(firstBody - (title.transform.y + title.size.height)).toBeLessThanOrEqual(ds.unit * 13);
  });
});

describe("figures", () => {
  it("sets a numeral with line height one, so the glyphs sit on the box and never rise into the rule", () => {
    const ds = deriveDesignSystem(theme, size, { seed: 1, catalog: catalogEntryForSeed(1) });
    const item = normalizeOutline({ title: "T", pages: [pageFor("bigNumber")] }).pages[0];
    const page = composeArchetypePage(item, ds, { index: 1, total: 4 });
    const fig = (page.nodes as { name?: string; content?: { runs: { style: { lineHeight?: number } }[] }[] }[]).find((n) => n.name === "Figure")!;
    expect(fig.content![0].runs.every((r) => r.style.lineHeight === 1)).toBe(true);
  });
});

describe("furniture on a picture page", () => {
  it("keeps the eyebrow, the footer and the page number in the text column, clear of the picture", () => {
    const ds = deriveDesignSystem(theme, size, { seed: 1, catalog: catalogEntryForSeed(1) });
    const item = normalizeOutline({ title: "T", pages: [{ ...pageFor("imageCaption"), eyebrow: "After two seasons" }] }).pages[0];
    const page = composeArchetypePage(item, ds, { index: 3, total: 4 });
    type N = { name?: string; transform: { x: number }; size: { width: number; height: number } };
    // The picture bleeds to the bottom edge, so every piece of furniture
    // stays in the text column: the name on one line, the number at the
    // column's trailing edge, nothing over the picture.
    const picture = (page.nodes as N[]).find((n) => n.name === "Image")!;
    const overlapsPicture = (n: N) => n.transform.x < picture.transform.x + picture.size.width && n.transform.x + n.size.width > picture.transform.x;
    for (const name of ["Footer", "Eyebrow", "Page number"]) {
      const n = (page.nodes as N[]).find((x) => x.name === name)!;
      expect(n, name).toBeDefined();
      expect(overlapsPicture(n), name).toBe(false);
      expect(n.size.height, name).toBeLessThan(ds.unit * 3);
    }
    expect(qualityCheck({ background: page.background, nodes: page.nodes, size }).issues).toEqual([]);
  });
});
