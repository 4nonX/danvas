// Generate the single-slide templates: one layout each from
// scripts/lib/deck-kit.mjs, in a look chosen for the slide, with the copy
// the slide has always carried. A user inserts one of these into a deck of
// their own; a single slide carries no page number.
//
//   node scripts/gen-single-slides.mjs
//   node scripts/build-templates.mjs

import { writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { LOOKS, buildSpec, specNodes } from "./lib/deck-kit.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "scripts", "templates");

const SLIDES = [
  {
    id: "deck-title-modern", title: "Presentation Title", look: "slate", rank: 5,
    tags: ["slide", "title", "minimal", "corporate"], styleTags: ["minimal", "modern", "corporate"],
    meta: { company: "Northwind Labs", deck: "Quarterly review 2026", kicker: "quarterly review", art: { cover: "la-free-svg-illustration-rocket" } },
    slides: [["cover", { title: "Building\nwhat's next", subtitle: "A clear look at progress, priorities, and the road ahead.", presenter: "Northwind Labs  ·  2026" }]],
  },
  {
    id: "deck-agenda", title: "Agenda Slide", look: "atlas", rank: 100,
    tags: ["slide", "agenda", "list"], styleTags: ["professional", "classic"],
    meta: { company: "Northwind Labs", deck: "Quarterly review" },
    slides: [["agenda", { title: "Agenda", items: [["Where we are today", "The quarter's numbers against plan", "15 min"], ["What changed this quarter", "Wins, misses and what we learned", "20 min"], ["Priorities for the next 90 days", "Three bets, owners and dates", "30 min"], ["Questions and discussion", "Open floor", "20 min"], ["Decisions", "What we need from this room", "5 min"]], card: { eyebrow: "Quarterly review", big: "8 Oct", meta: [["Time", "09:30 to 11:00"], ["Room", "Room 4B"], ["Host", "Dana Whitfield"], ["Notes", "Shared after the session"]] } }]],
  },
  {
    id: "deck-section-divider", title: "Section Divider", look: "vanta", rank: 100,
    tags: ["slide", "section", "divider"], styleTags: ["modern", "dark"],
    meta: { company: "Northwind Labs", deck: "Q3 business review", kicker: "// section two" },
    slides: [["section", { n: "02", title: "Our approach", blurb: "How we get from idea to impact." }]],
  },
  {
    id: "deck-stat", title: "Big Stat Slide", look: "terra", rank: 100,
    tags: ["slide", "stat", "data"], styleTags: ["warm", "bold"],
    meta: { company: "Northwind Labs", deck: "Q3 business review" },
    slides: [["bigStat", { eyebrow: "Revenue impact", value: "$1.2M", caption: "Added in net-new annual revenue from the redesigned checkout.", delta: "+38% on Q1" }]],
  },
  {
    id: "deck-quote", title: "Quote Slide", look: "folio", rank: 100,
    tags: ["slide", "quote"], styleTags: ["editorial", "elegant"],
    meta: { company: "Northwind Labs", deck: "Q3 business review" },
    slides: [["quote", { text: "We don't ship features. We ship outcomes.", name: "Priya Nair", role: "VP Product, Northwind Labs" }]],
  },
  {
    id: "deck-closing", title: "Closing Slide", look: "pulse", rank: 20,
    tags: ["slide", "closing", "thanks"], styleTags: ["bold", "modern"],
    meta: { company: "Northwind Labs", deck: "Q3 business review", farewell: "Let's keep talking", art: { closing: "la-conversation-illustration" } },
    slides: [["closing", { title: "Thank you", subtitle: "Let's keep the conversation going. Questions now, or any time this week.", rows: [["mail", "hello@northwindlabs.example"], ["world", "northwindlabs.example"], ["phone", "+1 415 555 0142"]], cta: "Book a follow-up" }]],
  },
  {
    id: "product-roadmap-slide", title: "Now, Next, Later Roadmap", look: "slate", rank: 20,
    tags: ["roadmap", "product", "quarterly", "planning", "kanban"], styleTags: ["minimal", "modern"],
    meta: { company: "Atlas", deck: "Product planning, Q3 2026" },
    slides: [["columns", { eyebrow: "Product roadmap", title: "The road ahead for Atlas" }]],
  },
];

for (const s of SLIDES) {
  const look = LOOKS[s.look];
  const spec = buildSpec(look, {
    id: s.id,
    title: s.title,
    tags: s.tags,
    styleTags: s.styleTags,
    meta: s.meta,
    slides: s.slides,
    version: 2,
    created: "2026-07-04T00:00:00.000Z",
    updated: "2026-09-30T00:00:00.000Z",
    rank: s.rank,
  });
  writeFileSync(join(OUT, `${s.id}.json`), JSON.stringify(spec, null, 1) + "\n");
  console.log(`${s.id}: ${spec.pages.length} slide, ${specNodes(spec)} nodes`);
}
