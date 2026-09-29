// Annual Report: one topic deck. See scripts/gen-topic-decks.mjs.
// base: the library look it starts from; look: overrides on that look;
// slides: [layout, content] in order; a raw slide carries a build function.

export default {
  id: "deck-annual-report",
  title: "Annual Report",
  base: "atlas",
  rank: 64,
  tags: [
    "annual",
    "report",
    "year",
    "review"
  ],
  meta: {
    company: "Harbor & Vale",
    deck: "Annual report 2026",
    kicker: "Twelve months, one story",
    farewell: "With thanks",
    art: {
      cover: "la-building",
      section: "il-day54-building",
      picture: "la-conversation-illustration",
      closing: "la-success-illustration"
    }
  },
  look: {},
  slides: [
    [
      "cover",
      {
        title: "The year we\ngrew up",
        subtitle: "Growth, customers and the team, and the moments that tested us along the way.",
        presenter: "Elena Sato, Chief Executive  ·  February 2027"
      }
    ],
    [
      "figures",
      {
        eyebrow: "By the numbers",
        title: "The year in four figures",
        stats: [
          [
            "$64M",
            "Revenue",
            "+28% year over year",
            "Second consecutive year above plan, with services now a fifth of the mix."
          ],
          [
            "2,900",
            "Customers",
            "+610 net new",
            "Three of the ten largest arrived through partners."
          ],
          [
            "186",
            "People",
            "+52 this year",
            "Two new offices, one of them our first outside the country."
          ],
          [
            "94%",
            "Customer retention",
            "+3 pts",
            "Highest on record; the support rebuild paid for itself by August."
          ]
        ]
      }
    ],
    [
      "section",
      {
        n: "01",
        title: "The big moments",
        blurb: "Four quarters, four things that changed the company."
      }
    ],
    [
      "timeline",
      {
        eyebrow: "The big moments",
        title: "Quarter by quarter",
        done: 4,
        steps: [
          [
            "Q1",
            "The platform relaunch",
            "Six months of rebuild shipped in one week, with no customer downtime."
          ],
          [
            "Q2",
            "The Lisbon office",
            "Our first team outside the country, twenty-two people by year end."
          ],
          [
            "Q3",
            "The partner programme",
            "Forty partners signed; a third of new customers now arrive through them."
          ],
          [
            "Q4",
            "The thousandth enterprise seat",
            "Signed in December, on a call that started as a support ticket."
          ]
        ]
      }
    ],
    [
      "twoColumns",
      {
        eyebrow: "The hard parts",
        title: "What tested us",
        left: {
          eyebrow: "What went wrong",
          head: "The outage in May",
          lines: [
            "Nine hours, four hundred customers affected",
            "Root cause in a vendor we had not audited",
            "Two customers left over it"
          ],
          icon: "alert-triangle"
        },
        right: {
          eyebrow: "What we changed",
          head: "Reliability became a team",
          lines: [
            "Every vendor audited by September",
            "A named on-call owner for each service",
            "Uptime above 99.95% since June"
          ],
          icon: "circle-check"
        }
      }
    ],
    [
      "quote",
      {
        text: "They told us what broke, what they were doing about it, and when it would be fixed. That is why we stayed.",
        name: "Rowan Achebe",
        role: "Chief Information Officer, Brightline Logistics"
      }
    ],
    [
      "team",
      {
        eyebrow: "Thank you",
        title: "The people who made it",
        people: [
          [
            "Elena Sato",
            "Chief Executive",
            "Set the plan and kept every promise in it."
          ],
          [
            "Marcus Obi",
            "Chief Operating Officer",
            "Opened Lisbon and built the partner programme."
          ],
          [
            "Priya Raman",
            "Head of Product",
            "Led the relaunch and the platform team."
          ],
          [
            "Dana Whitfield",
            "Head of Customers",
            "Rebuilt support and won back the trust."
          ]
        ]
      }
    ],
    [
      "closing",
      {
        title: "The year ahead",
        subtitle: "Three markets, one new product line, and the same promise: tell the truth early.",
        rows: [
          [
            "mail",
            "elena@harborvale.example"
          ],
          [
            "world",
            "harborvale.example/2026"
          ],
          [
            "file-text",
            "Full report and accounts attached"
          ]
        ],
        cta: "Read the full report"
      }
    ]
  ]
};
