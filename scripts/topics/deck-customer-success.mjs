// Customer Success Review: one topic deck. See scripts/gen-topic-decks.mjs.
// base: the library look it starts from; look: overrides on that look;
// slides: [layout, content] in order; a raw slide carries a build function.

export default {
  id: "deck-customer-success",
  title: "Customer Success Review",
  base: "terra",
  rank: 70,
  tags: [
    "customer success",
    "review",
    "retention",
    "accounts"
  ],
  meta: {
    company: "Fernwood",
    deck: "Customer success review, Q3",
    kicker: "The book of business",
    farewell: "Thanks, team",
    art: {
      cover: "la-conversation-illustration",
      section: "il-day64-followers",
      picture: "la-woman-working-1",
      closing: "od-strolling"
    }
  },
  look: {},
  slides: [
    [
      "cover",
      {
        title: "Accounts, health,\nand momentum",
        subtitle: "Where the book stands, the saves and the wins, what is at risk, and the expansion plays that are landing.",
        presenter: "Dana Whitfield, Head of Customer Success  ·  6 October 2026"
      }
    ],
    [
      "figures",
      {
        eyebrow: "Health overview",
        title: "The book at a glance",
        stats: [
          [
            "312",
            "Accounts",
            "+18 this quarter",
            "Twenty-six new, eight churned, all eight under fifty seats."
          ],
          [
            "81%",
            "Green accounts",
            "+6 pts",
            "Health score above 70; usage and support both trending up."
          ],
          [
            "14%",
            "Yellow accounts",
            "−4 pts",
            "Mostly renewals inside ninety days with a champion change."
          ],
          [
            "5%",
            "Red accounts",
            "−2 pts",
            "Sixteen accounts, $1.1M in annual revenue, each with a named plan."
          ]
        ]
      }
    ],
    [
      "chart",
      {
        eyebrow: "Health overview",
        title: "Movement between tiers",
        takeaway: "Twenty-two accounts moved up a tier this quarter; nine moved down. The saves programme is working.",
        categories: [
          "Red",
          "Yellow",
          "Green"
        ],
        series: [
          {
            name: "Start of quarter",
            values: [
              22,
              56,
              216
            ]
          },
          {
            name: "End of quarter",
            values: [
              16,
              44,
              252
            ]
          }
        ],
        calls: [
          [
            "22",
            "Accounts moved up a tier"
          ],
          [
            "9",
            "Accounts moved down"
          ],
          [
            "$2.4M",
            "Renewals closed, 97% of the quarter's book"
          ]
        ]
      }
    ],
    [
      "threeCards",
      {
        eyebrow: "Saves and wins",
        title: "Accounts we turned around",
        cards: [
          [
            "heart",
            "Brightline Logistics",
            "Red in July after a champion left. New champion onboarded in two weeks; renewed for three years in September."
          ],
          [
            "shield",
            "Meridian Health",
            "Blocked on a security review for four months. A named engineer cleared it in nine days."
          ],
          [
            "sparkles",
            "Cobalt Retail",
            "Usage had halved. A workflow rebuild with their team doubled it back and added two departments."
          ]
        ]
      }
    ],
    [
      "table",
      {
        eyebrow: "At risk",
        title: "Where we need help, and by when",
        cols: [
          "",
          "Revenue",
          "Renewal",
          "Ask"
        ],
        rows: [
          [
            "Harbor & Vale",
            "$240K",
            "November",
            "Exec sponsor call"
          ],
          [
            "Summit Freight",
            "$180K",
            "December",
            "Integration fix"
          ],
          [
            "Atlas Insurance",
            "$160K",
            "January",
            "Pricing exception"
          ],
          [
            "Pinecrest Schools",
            "$120K",
            "November",
            "Training day"
          ],
          [
            "Northwind Systems",
            "$95K",
            "December",
            "Roadmap commitment"
          ]
        ]
      }
    ],
    [
      "process",
      {
        eyebrow: "Expansion plays",
        title: "The four motions that are landing",
        steps: [
          [
            "Department to department",
            "A live customer walks a neighbouring team through their setup. Closed nine expansions this way."
          ],
          [
            "Usage threshold",
            "At 80% of seats, the account manager books the review before the customer asks."
          ],
          [
            "Executive business review",
            "Twice a year for every account over $100K. Every expansion this quarter followed one."
          ],
          [
            "Partner referral",
            "Partners introduce their other customers. Four expansions, all in the first meeting."
          ]
        ]
      }
    ],
    [
      "closing",
      {
        title: "Next quarter",
        subtitle: "Coverage moves to pods of three, the sixteen red accounts each get a named owner, and the focus list is on the wall.",
        rows: [
          [
            "mail",
            "dana@fernwood.example"
          ],
          [
            "world",
            "success.fernwood.example"
          ],
          [
            "calendar",
            "Next review: 12 January"
          ]
        ],
        cta: "See the focus accounts"
      }
    ]
  ]
};
