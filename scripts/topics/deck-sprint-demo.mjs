// Sprint Demo: one topic deck. See scripts/gen-topic-decks.mjs.
// base: the library look it starts from; look: overrides on that look;
// slides: [layout, content] in order; a raw slide carries a build function.

export default {
  id: "deck-sprint-demo",
  title: "Sprint Demo",
  base: "vanta",
  rank: 62,
  tags: [
    "demo",
    "sprint",
    "engineering",
    "agile"
  ],
  meta: {
    company: "Nova Systems",
    deck: "Sprint 42 demo",
    kicker: "// show, then tell",
    farewell: "// next sprint",
    art: {
      cover: "la-coding-people",
      section: "il-day93-programing",
      picture: "la-woman-working-2",
      closing: "la-ai-robot-3"
    }
  },
  look: {},
  slides: [
    [
      "cover",
      {
        title: "Sprint 42:\nthe goal we committed to",
        subtitle: "Two demos, the numbers under the hood, and what we pull into sprint 43 and what we park.",
        presenter: "Tomas Reyes, Engineering Lead  ·  17 October 2026",
        chips: [
          [
            "14",
            "stories done"
          ],
          [
            "2",
            "carried"
          ],
          [
            "0",
            "bugs opened"
          ]
        ]
      }
    ],
    [
      "textPicture",
      {
        eyebrow: "Demo one",
        title: "Incident narrative, first draft",
        points: [
          [
            "The feature",
            "Open an incident and the timeline writes the first paragraph: what changed, when, and the first symptom."
          ],
          [
            "The flow",
            "Deploy at 14:02, latency alert at 14:09, narrative drafted at 14:09:30. The on-call reads instead of digging."
          ],
          [
            "Edge cases handled",
            "Overlapping deploys, missing traces, and a timeline with nothing in it all produce an honest sentence."
          ]
        ]
      }
    ],
    [
      "textPicture",
      {
        eyebrow: "Demo two",
        title: "The trace store, rebuilt",
        points: [
          [
            "What changed under the hood",
            "Traces now land in a columnar store partitioned by hour. The old row store is read-only until December."
          ],
          [
            "Why it matters",
            "The narrative needs ten thousand traces in under a second. The old store took eleven."
          ],
          [
            "What it cost",
            "Two engineers, three weeks, one migration script that ran twice in staging before production."
          ]
        ]
      }
    ],
    [
      "figures",
      {
        eyebrow: "The numbers",
        title: "Velocity, bugs and the trend",
        stats: [
          [
            "38",
            "Points completed",
            "+4 on sprint 41",
            "Third sprint in a row above the rolling average."
          ],
          [
            "0",
            "Bugs opened",
            "−3",
            "First clean sprint since June; the trace store tests paid off."
          ],
          [
            "0.9 s",
            "Narrative draft time",
            "Target 1.0 s",
            "Down from eleven seconds on the old store."
          ],
          [
            "2",
            "Stories carried",
            "Same as last sprint",
            "Both waiting on the vendor contract for APAC."
          ]
        ]
      }
    ],
    [
      "twoColumns",
      {
        eyebrow: "Next sprint",
        title: "What we pull, what we park",
        left: {
          eyebrow: "Pull",
          head: "Narrative to ten beta customers",
          lines: [
            "Feedback form inside the incident view",
            "Two more edge cases from the demo",
            "Trace store cutover for the last region"
          ],
          icon: "circle-check"
        },
        right: {
          eyebrow: "Park",
          head: "Everything APAC until the contract signs",
          lines: [
            "Residency work stays in the backlog",
            "Mobile alerts moves to sprint 44",
            "No new services until the cutover is done"
          ],
          icon: "clock"
        }
      }
    ],
    [
      "closing",
      {
        title: "Questions",
        subtitle: "Demo recordings and the sprint report are in the channel. Retro on Monday at ten.",
        rows: [
          [
            "message",
            "#platform on Slack"
          ],
          [
            "mail",
            "tomas@novasystems.example"
          ],
          [
            "calendar",
            "Retro: 20 October, 10:00"
          ]
        ],
        cta: "Open the sprint board"
      }
    ]
  ]
};
