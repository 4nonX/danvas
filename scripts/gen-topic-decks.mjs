// Generate the topic decks: thirty-one presentation templates, each a look
// from scripts/lib/deck-kit.mjs over a chosen sequence of its layouts, with
// the topic's own copy from scripts/topics/*.mjs.
//
//   node scripts/gen-topic-decks.mjs          # write the topic specs
//   node scripts/build-templates.mjs          # then compile the seed
//
// A topic deck is what a user picks when they know what they are presenting
// (a sales review, a kickoff, a case study) and want a deck that already
// says the right kind of things in the right order. The look gives it the
// finish of the kits; the plan gives it a narrative arc that follows the
// reader's questions; the copy is specific, so the layout never reads as
// empty. Replace the words, keep the shape.

import { writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { LOOKS, buildSpec, specNodes } from "./lib/deck-kit.mjs";
import business from "./topics/business.mjs";
import product from "./topics/product.mjs";
import people from "./topics/people.mjs";
import stories from "./topics/stories.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "scripts", "templates");

const TOPICS = [...business, ...product, ...people, ...stories];

for (const t of TOPICS) {
  const look = LOOKS[t.look];
  if (!look) throw new Error(`${t.id}: unknown look ${t.look}`);
  const spec = buildSpec(look, {
    id: t.id,
    title: t.title,
    categories: t.categories ?? ["presentations", "business"],
    tags: t.tags,
    styleTags: t.styleTags ?? look.styleTags,
    meta: t.meta,
    slides: t.slides,
    version: 2,
    created: "2026-08-28T00:00:00.000Z",
    updated: "2026-09-30T00:00:00.000Z",
    rank: t.rank,
  });
  writeFileSync(join(OUT, `${t.id}.json`), JSON.stringify(spec, null, 1) + "\n");
  console.log(`${t.id}: ${spec.pages.length} slides, ${specNodes(spec)} nodes`);
}
console.log(`${TOPICS.length} topic decks`);
