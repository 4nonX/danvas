// Design Review: one topic deck. See scripts/gen-topic-decks.mjs.
// base: the library look it starts from; look: overrides on that look;
// slides: [layout, content] in order; a raw slide carries a build function.

export default {
  id: "deck-design-review",
  title: "Design Review",
  base: "slate",
  rank: 60,
  tags: [
    "design",
    "review",
    "critique",
    "ux"
  ],
  meta: {
    company: "Form & Function",
    deck: "Design review: onboarding",
    kicker: "design review, onboarding flow",
    farewell: "Next iteration",
    art: {
      cover: "la-desk-illustration-2",
      section: "il-day94-ui-ux",
      picture: "la-ui-design",
      closing: "la-flat-character-illustrations"
    }
  },
  look: {},
  slides: [
    [
      "cover",
      {
        title: "The problem\nthis design answers",
        subtitle: "New accounts take eleven days to reach first value. This flow aims for three. The room's judgment on three open questions.",
        presenter: "Aisha Bello, Product Design  ·  22 October 2026"
      }
    ],
    [
      "process",
      {
        eyebrow: "The flow",
        title: "The user's path, screen by screen",
        steps: [
          [
            "Connect",
            "One screen, one source. The other integrations wait until the first import has succeeded."
          ],
          [
            "Import",
            "Progress with a real estimate. Large files stream; the user can leave and come back."
          ],
          [
            "Preview",
            "The first report drawn from their data, before any setup. This is the moment we are designing for."
          ],
          [
            "Invite",
            "One teammate, one click, and a link that opens on the preview, not on a blank workspace."
          ]
        ]
      }
    ],
    [
      "threeCards",
      {
        eyebrow: "Key decisions",
        title: "The three choices that shaped it",
        cards: [
          [
            "bolt",
            "Preview before setup",
            "The report comes first; configuration comes after the user has seen the value. Rejected: a setup wizard."
          ],
          [
            "layout-list",
            "One source at a time",
            "Connecting five sources on day one is where users quit. Rejected: the integrations grid."
          ],
          [
            "user",
            "Invite from the preview",
            "The invite link lands on the report. Rejected: an invite step in the wizard."
          ]
        ]
      }
    ],
    [
      "twoColumns",
      {
        eyebrow: "Alternatives",
        title: "What we rejected, and why",
        left: {
          eyebrow: "Rejected",
          head: "The setup wizard",
          lines: [
            "Six steps before any value",
            "Tested at 41% completion",
            "Users could not tell what step three was for"
          ],
          icon: "alert-triangle"
        },
        right: {
          eyebrow: "Chosen",
          head: "Preview first",
          lines: [
            "Value on screen two",
            "Tested at 78% completion",
            "Every participant understood what the product does"
          ],
          icon: "circle-check"
        }
      }
    ],
    [
      "threeCards",
      {
        eyebrow: "Open questions",
        title: "Where we want the room's judgment",
        cards: [
          [
            "message",
            "What if the import fails?",
            "The preview needs data. Do we show a sample report, or hold the user on the import screen with help?"
          ],
          [
            "clock",
            "How long is too long?",
            "Streaming imports can take an hour. Do we let the user leave, and what brings them back?"
          ],
          [
            "user",
            "Invite before value?",
            "Some teams want to invite first. Do we allow it, and does it dilute the preview moment?"
          ]
        ]
      }
    ],
    [
      "closing",
      {
        title: "Next iteration",
        subtitle: "Decisions from this room by Friday; the flow goes to build on Monday. Prototype and research notes are in the design folder.",
        rows: [
          [
            "mail",
            "aisha@formfunction.example"
          ],
          [
            "world",
            "design.formfunction.example/onboarding"
          ],
          [
            "calendar",
            "Build starts: 27 October"
          ]
        ],
        cta: "Open the prototype"
      }
    ]
  ]
};
