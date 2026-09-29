// Roadmap Review: one topic deck. See scripts/gen-topic-decks.mjs.
// base: the library look it starts from; look: overrides on that look;
// slides: [layout, content] in order; a raw slide carries a build function.

export default {
  id: "deck-roadmap-review",
  title: "Roadmap Review",
  base: "vanta",
  rank: 50,
  tags: [
    "roadmap",
    "product",
    "planning",
    "review"
  ],
  meta: {
    company: "Nova Systems",
    deck: "Roadmap review, Q4 2026",
    kicker: "// where we are",
    farewell: "// decision recorded",
    art: {
      cover: "la-woman-working-2",
      section: "il-day93-programing",
      picture: "la-coding-people",
      closing: "la-ai-robot-3"
    }
  },
  look: {},
  slides: [
    [
      "cover",
      {
        title: "The quarter's themes\nat a glance",
        subtitle: "What shipped and the early signals, what is moving and what is blocked, and the one trade-off we cannot fund both sides of.",
        presenter: "Priya Raman, Head of Product  ·  9 October 2026",
        chips: [
          [
            "4",
            "shipped"
          ],
          [
            "6",
            "in flight"
          ],
          [
            "2",
            "blocked"
          ]
        ]
      }
    ],
    [
      "threeCards",
      {
        eyebrow: "Shipped",
        title: "What landed, and the early signals",
        cards: [
          [
            "circle-check",
            "The unified timeline",
            "Live for every customer since August. Half of incident reviews now start from it."
          ],
          [
            "bolt",
            "Query cache",
            "P95 latency down 41%. The most-cited improvement in September customer calls."
          ],
          [
            "lock",
            "SSO and SCIM",
            "Four enterprise customers live in week one. The bundle is now a sales asset."
          ]
        ]
      }
    ],
    [
      "table",
      {
        eyebrow: "In flight",
        title: "What is moving, and what is blocked",
        cols: [
          "",
          "Owner",
          "Status",
          "Date"
        ],
        rows: [
          [
            "Incident narrative, beta",
            "Tomas",
            "On track",
            "November"
          ],
          [
            "APAC data residency",
            "Aisha",
            "Blocked: vendor contract",
            "December"
          ],
          [
            "Mobile alerts",
            "Mei",
            "On track",
            "November"
          ],
          [
            "Usage-based billing",
            "Jonah",
            "At risk: scope",
            "January"
          ],
          [
            "Public API v2",
            "Priya",
            "On track",
            "December"
          ]
        ]
      }
    ],
    [
      "twoColumns",
      {
        eyebrow: "The trade-off",
        title: "Two bets we cannot both fund",
        left: {
          eyebrow: "Bet A",
          head: "Incident narrative, generally available",
          lines: [
            "Four engineers for a quarter",
            "Every customer benefits on day one",
            "The differentiator in every competitive deal"
          ],
          icon: "sparkles"
        },
        right: {
          eyebrow: "Bet B",
          head: "APAC region and residency",
          lines: [
            "Three engineers and a vendor contract",
            "Unblocks two enterprise deals worth $600K",
            "A door that stays shut until it is built"
          ],
          icon: "world"
        }
      }
    ],
    [
      "statement",
      {
        text: "Fund the narrative. Hold APAC to a date in Q1 and tell the two customers the truth about when.",
        source: "The recommendation"
      }
    ],
    [
      "closing",
      {
        title: "The decision",
        subtitle: "Narrative to general availability in Q4; APAC residency committed for 28 February. Revisit on 15 January with the deal status.",
        rows: [
          [
            "mail",
            "priya@novasystems.example"
          ],
          [
            "world",
            "roadmap.novasystems.example"
          ],
          [
            "calendar",
            "Revisit: 15 January"
          ]
        ],
        cta: "Open the roadmap"
      }
    ]
  ]
};
