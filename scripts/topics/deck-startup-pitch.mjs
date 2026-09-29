// Startup Pitch Deck: one topic deck. See scripts/gen-topic-decks.mjs.
// base: the library look it starts from; look: overrides on that look;
// slides: [layout, content] in order; a raw slide carries a build function.

export default {
  id: "deck-startup-pitch",
  title: "Startup Pitch Deck",
  base: "pulse",
  rank: 30,
  tags: [
    "pitch deck",
    "startup",
    "fundraising",
    "investors"
  ],
  meta: {
    company: "Loop",
    deck: "Seed round",
    kicker: "Seed round",
    farewell: "Let's build it",
    art: {
      cover: "la-free-svg-illustration-rocket",
      section: "il-day20-rocket",
      picture: "la-hero-image-2",
      closing: "la-scooter"
    }
  },
  look: {},
  slides: [
    [
      "cover",
      {
        title: "Payroll that\ncloses itself",
        subtitle: "We make month-end payroll for mid-sized companies a one-click job, ten times faster than the tools built for a different era.",
        presenter: "Sam Whitfield and Priya Raman, founders  ·  October 2026",
        year: "2026"
      }
    ],
    [
      "statement",
      {
        text: "Every finance team we met loses four days a month to a job a computer should finish in an hour.",
        source: "Forty-one customer interviews, spring 2026"
      }
    ],
    [
      "twoColumns",
      {
        eyebrow: "The problem and the solution",
        title: "What month-end looks like, before and after",
        left: {
          eyebrow: "Today",
          head: "Five tools, four days, one exhausted controller",
          lines: [
            "Timesheets exported by hand",
            "Corrections found after the run",
            "Every country a separate spreadsheet"
          ],
          icon: "alert-triangle"
        },
        right: {
          eyebrow: "With Loop",
          head: "One workflow, one afternoon",
          lines: [
            "Every source connected once",
            "Errors caught before the run, not after",
            "Set up in minutes, not months"
          ],
          icon: "circle-check"
        }
      }
    ],
    [
      "figures",
      {
        eyebrow: "Market size",
        title: "A large market, counted bottom up",
        stats: [
          [
            "$14B",
            "Serviceable market",
            "Bottom-up",
            "Companies of 50 to 2,000 people, times realistic seat pricing."
          ],
          [
            "68K",
            "Target companies",
            "In our first three regions",
            "Mid-market payroll is underserved by both ends of the market."
          ],
          [
            "$18K",
            "Average contract",
            "Year one",
            "Grows with headcount; every hire is a seat."
          ],
          [
            "3",
            "Segments pulling us in",
            "Inbound",
            "Logistics, healthcare staffing and franchise retail found us first."
          ]
        ]
      }
    ],
    [
      "chart",
      {
        eyebrow: "Traction",
        title: "Revenue, twelve months",
        takeaway: "Consistent growth every month, retention above the category benchmark, and customers expanding on their own.",
        categories: [
          "Q4 25",
          "Q1 26",
          "Q2 26",
          "Q3 26"
        ],
        series: [
          {
            name: "MRR ($K)",
            values: [
              48,
              96,
              178,
              312
            ]
          }
        ],
        calls: [
          [
            "$312K",
            "Monthly revenue, up 6.5x in a year"
          ],
          [
            "121%",
            "Net revenue retention"
          ],
          [
            "11",
            "Customers expanded without a sales call"
          ]
        ]
      }
    ],
    [
      "team",
      {
        eyebrow: "The team",
        title: "Founders who lived this problem",
        people: [
          [
            "Sam Whitfield",
            "Chief Executive",
            "Ran payroll for a 900-person company for six years. Built Loop to never do it again."
          ],
          [
            "Priya Raman",
            "Chief Technology Officer",
            "Led the payments platform at a category leader; scaled it past a million runs a month."
          ],
          [
            "Marcus Obi",
            "Head of Sales",
            "First sales hire at two mid-market SaaS companies, both to $20M."
          ],
          [
            "Elena Sato",
            "Head of Customers",
            "Onboarded four hundred finance teams. Knows every month-end horror story."
          ]
        ]
      }
    ],
    [
      "closing",
      {
        title: "The ask",
        subtitle: "Raising $6M to accelerate what already works: two more regions, the compliance team, and the partner channel.",
        rows: [
          [
            "mail",
            "sam@loop.example"
          ],
          [
            "world",
            "loop.example/investors"
          ],
          [
            "calendar",
            "Closing the round by December"
          ]
        ],
        cta: "Open the data room"
      }
    ]
  ]
};
