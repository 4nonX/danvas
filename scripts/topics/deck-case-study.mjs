// Customer Case Study: one topic deck. See scripts/gen-topic-decks.mjs.
// base: the library look it starts from; look: overrides on that look;
// slides: [layout, content] in order; a raw slide carries a build function.

export default {
  id: "deck-case-study",
  title: "Customer Case Study",
  base: "atlas",
  rank: 42,
  tags: [
    "case study",
    "customer",
    "proof",
    "sales"
  ],
  meta: {
    company: "Northwind Systems",
    deck: "Case study: Brightline Logistics",
    kicker: "A customer story",
    farewell: "The pattern repeats",
    art: {
      cover: "la-building",
      section: "il-day14-forklift",
      picture: "la-conversation-illustration",
      closing: "la-success-illustration"
    }
  },
  look: {},
  slides: [
    [
      "cover",
      {
        title: "Brightline Logistics:\nfrom four days to one",
        subtitle: "Who they are, the situation before and what it cost, what we deployed and how fast, the numbers after, and the pattern that repeats across customers.",
        presenter: "Elena Sato, Customer Success  ·  October 2026"
      }
    ],
    [
      "figures",
      {
        eyebrow: "The customer",
        title: "Who they are, and what they do",
        stats: [
          [
            "4,200",
            "Vehicles",
            "Twelve countries",
            "Regional freight across Europe, with a growing last-mile fleet."
          ],
          [
            "3,800",
            "Drivers",
            "Payroll every two weeks",
            "Hourly, salaried and contractor, in nine currencies."
          ],
          [
            "$1.2B",
            "Annual revenue",
            "Family owned",
            "Third generation, run from Rotterdam."
          ],
          [
            "6",
            "Finance team",
            "Payroll across all of it",
            "Four days a fortnight lost to the run, before."
          ]
        ]
      }
    ],
    [
      "twoColumns",
      {
        eyebrow: "The challenge",
        title: "The situation before, and what it cost",
        left: {
          eyebrow: "Before",
          head: "Five systems and a spreadsheet",
          lines: [
            "Timesheets from three telematics vendors",
            "Every country a separate export",
            "Errors found by drivers, after payday"
          ],
          icon: "alert-triangle"
        },
        right: {
          eyebrow: "The cost",
          head: "Four days a fortnight, and trust",
          lines: [
            "$380K a year in finance time",
            "Two payroll disputes a week",
            "A union complaint in March"
          ],
          icon: "coin"
        }
      }
    ],
    [
      "timeline",
      {
        eyebrow: "The solution",
        title: "What we deployed, and how fast",
        done: 4,
        steps: [
          [
            "Week 1",
            "Connected",
            "Three telematics feeds and the HR system, read-only, mirrored against the old process."
          ],
          [
            "Weeks 2 to 3",
            "Shadow runs",
            "Two full payroll cycles run in parallel. Every difference explained before go-live."
          ],
          [
            "Week 4",
            "Live in two countries",
            "The Netherlands and Germany, with the finance team watching every line."
          ],
          [
            "Week 8",
            "Live everywhere",
            "All twelve countries, nine currencies, one run."
          ]
        ]
      }
    ],
    [
      "figures",
      {
        eyebrow: "The results",
        title: "Before and after",
        stats: [
          [
            "1 day",
            "Payroll run",
            "Was 4",
            "The finance team closes payroll on a Tuesday afternoon."
          ],
          [
            "0.2%",
            "Error rate",
            "Was 3.1%",
            "Errors caught before the run, not after payday."
          ],
          [
            "0",
            "Disputes per week",
            "Was 2",
            "Drivers see their hours before they are paid."
          ],
          [
            "$310K",
            "Saved in year one",
            "Finance time alone",
            "Before counting the disputes that no longer happen."
          ]
        ]
      }
    ],
    [
      "quote",
      {
        text: "We did not buy software. We bought back four days a fortnight, and the drivers' trust that their pay would be right.",
        name: "Rowan Achebe",
        role: "Chief Financial Officer, Brightline Logistics"
      }
    ],
    [
      "closing",
      {
        title: "What this means for you",
        subtitle: "Every fleet operator we have deployed follows the same pattern: connect, shadow, go live, one run. Eight weeks, start to finish.",
        rows: [
          [
            "mail",
            "elena@northwind.example"
          ],
          [
            "world",
            "northwind.example/brightline"
          ],
          [
            "calendar",
            "Book a thirty-minute walkthrough"
          ]
        ],
        cta: "Talk to us"
      }
    ]
  ]
};
