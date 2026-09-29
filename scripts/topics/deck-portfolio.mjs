// Personal Portfolio: one topic deck. See scripts/gen-topic-decks.mjs.
// base: the library look it starts from; look: overrides on that look;
// slides: [layout, content] in order; a raw slide carries a build function.

export default {
  id: "deck-portfolio",
  title: "Personal Portfolio",
  base: "slate",
  rank: 76,
  tags: [
    "portfolio",
    "personal",
    "showcase",
    "work"
  ],
  meta: {
    company: "Aisha Bello",
    deck: "Product design portfolio",
    kicker: "product designer, 2026",
    farewell: "Let's talk",
    art: {
      cover: "la-desk-illustration-2",
      section: "il-day4-polariod",
      picture: "la-ui-design",
      closing: "la-flat-character-illustrations"
    }
  },
  look: {},
  slides: [
    [
      "cover",
      {
        title: "Hello, I am Aisha.\nI design the first week.",
        subtitle: "Product designer, eight years, three companies. I work on the part of a product where a stranger decides whether to stay.",
        presenter: "Selected work, 2023 to 2026"
      }
    ],
    [
      "textPicture",
      {
        eyebrow: "Selected work one",
        title: "Onboarding at Form & Function",
        points: [
          [
            "The problem",
            "Half of new accounts needed a support call before their first report. Eleven days to first value."
          ],
          [
            "My role",
            "Research lead and sole designer. Fourteen sessions, one prototype, one very opinionated flow."
          ],
          [
            "The outcome",
            "Preview-first onboarding. Completion from 41% to 78% in testing; three days to first value after launch."
          ]
        ]
      }
    ],
    [
      "textPicture",
      {
        eyebrow: "Selected work two",
        title: "Billing at Cobalt Health",
        points: [
          [
            "The constraint",
            "An invoice that finance, the customer and a regulator all had to read, in one layout, with no second version."
          ],
          [
            "What shaped the solution",
            "I designed for the regulator first. If the strictest reader could follow it, the others could."
          ],
          [
            "The outcome",
            "Disputes fell by two thirds. Finance stopped sending the explanatory email."
          ]
        ]
      }
    ],
    [
      "figures",
      {
        eyebrow: "Selected work three",
        title: "The mobile app at Beacon, in numbers",
        stats: [
          [
            "4.8",
            "App store rating",
            "Was 3.6",
            "Twelve months after the redesign shipped."
          ],
          [
            "62%",
            "Weekly active",
            "Was 38%",
            "Drivers who open the app every week."
          ],
          [
            "−54%",
            "Support contacts",
            "Per active user",
            "The map and the shift screen did most of it."
          ],
          [
            "3",
            "People",
            "One designer",
            "A small team, a long list, and a lot of saying no."
          ]
        ]
      }
    ],
    [
      "process",
      {
        eyebrow: "How I work",
        title: "Process, tools, and collaboration",
        steps: [
          [
            "Watch first",
            "Sessions with real users on their own data before a single screen is drawn."
          ],
          [
            "One flow, argued",
            "A prototype with an opinion, tested against the alternative I rejected."
          ],
          [
            "Build alongside",
            "I sit with the engineers through the build. The design is done when it ships, not when it is handed over."
          ],
          [
            "Measure",
            "One number, agreed before launch, checked at thirty days."
          ]
        ]
      }
    ],
    [
      "closing",
      {
        title: "Let's talk",
        subtitle: "I am looking for a team that cares about the first week as much as the tenth feature. Case studies in full at the link.",
        rows: [
          [
            "mail",
            "aisha@bello.example"
          ],
          [
            "world",
            "bello.example/work"
          ],
          [
            "message",
            "@aishadesigns"
          ]
        ],
        cta: "See the case studies"
      }
    ]
  ]
};
