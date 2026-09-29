// Competitive Analysis: one topic deck. See scripts/gen-topic-decks.mjs.
// base: the library look it starts from; look: overrides on that look;
// slides: [layout, content] in order; a raw slide carries a build function.

export default {
  id: "deck-competitive-analysis",
  title: "Competitive Analysis",
  base: "slate",
  rank: 56,
  tags: [
    "competitive",
    "analysis",
    "strategy",
    "market"
  ],
  meta: {
    company: "Form & Function",
    deck: "Competitive landscape, 2026",
    kicker: "the landscape, unsentimentally",
    farewell: "Decide, then move",
    art: {
      cover: "la-desk-illustration-2",
      section: "il-day65-city-road",
      picture: "la-working-1",
      closing: "la-flat-character-illustrations"
    }
  },
  look: {},
  slides: [
    [
      "cover",
      {
        title: "Who plays, and\nwhere the lines are",
        subtitle: "The primary rival head to head, their momentum, our edge when buyers compare, the threat that would hurt most, and our response.",
        presenter: "Marcus Obi, Strategy  ·  20 October 2026"
      }
    ],
    [
      "table",
      {
        eyebrow: "Head to head",
        title: "Us against the primary rival",
        cols: [
          "",
          "Us",
          "Rival",
          "Buyer weight"
        ],
        rows: [
          [
            "Time to first value",
            "3 days",
            "3 weeks",
            "High"
          ],
          [
            "Enterprise security",
            "yes",
            "yes",
            "High"
          ],
          [
            "Open file format",
            "yes",
            "no",
            "Medium"
          ],
          [
            "Self-hosting",
            "yes",
            "no",
            "Medium"
          ],
          [
            "Marketplace breadth",
            "no",
            "yes",
            "Medium"
          ]
        ]
      }
    ],
    [
      "timeline",
      {
        eyebrow: "Their momentum",
        title: "What they shipped this year",
        done: 3,
        steps: [
          [
            "Q1",
            "The marketplace",
            "Two hundred integrations in a quarter, most of them thin. Buyers count them anyway."
          ],
          [
            "Q2",
            "Usage-based pricing",
            "Cheaper to start, expensive at scale. Wins the pilot, loses the renewal."
          ],
          [
            "Q3",
            "The AI assistant",
            "Fast, shallow, and demoed everywhere. Sets the expectation we now have to meet."
          ],
          [
            "Q4",
            "Expected: enterprise bundle",
            "Their partner channel says SSO and audit logs ship by December."
          ]
        ]
      }
    ],
    [
      "threeCards",
      {
        eyebrow: "Our edge",
        title: "Where we win when buyers compare",
        cards: [
          [
            "bolt",
            "Three days to value, not three weeks",
            "Every won deal this year cited it. Lead with the pilot, measure it, put the number on the proposal."
          ],
          [
            "lock",
            "The customer owns the data",
            "Open format and self-hosting close regulated buyers before price is discussed."
          ],
          [
            "user",
            "One named engineer per account",
            "Their support is a queue. Ours has a face. Renewals mention it unprompted."
          ]
        ]
      }
    ],
    [
      "statement",
      {
        text: "The move that hurts us most is not their next feature. It is a price cut we answer too late.",
        source: "Strategy review, October 2026"
      }
    ],
    [
      "process",
      {
        eyebrow: "Response plan",
        title: "Three moves, sequenced",
        steps: [
          [
            "Now",
            "Publish the pilot outcomes page. Every proposal links to it by November."
          ],
          [
            "Q4",
            "Ship a real assistant, not a demo. Grounded in the customer's own files, measured on adoption."
          ],
          [
            "Q1",
            "Announce the enterprise bundle before theirs lands. Same features, our security story."
          ],
          [
            "Ongoing",
            "Watch pricing weekly. A cut below $30 per seat triggers the prepared response within a week."
          ]
        ]
      }
    ],
    [
      "closing",
      {
        title: "Decide, then move",
        subtitle: "The full comparison, win-loss notes and the pricing response are in the strategy folder.",
        rows: [
          [
            "mail",
            "marcus@formfunction.example"
          ],
          [
            "world",
            "formfunction.example/strategy"
          ],
          [
            "calendar",
            "Next review: January"
          ]
        ],
        cta: "Open the win-loss notes"
      }
    ]
  ]
};
