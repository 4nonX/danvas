// Investor Update: one topic deck. See scripts/gen-topic-decks.mjs.
// base: the library look it starts from; look: overrides on that look;
// slides: [layout, content] in order; a raw slide carries a build function.

export default {
  id: "deck-investor-update",
  title: "Investor Update",
  base: "slate",
  rank: 54,
  tags: [
    "investors",
    "update",
    "metrics",
    "startup"
  ],
  meta: {
    company: "Beacon",
    deck: "Investor update, September",
    kicker: "monthly update, no spin",
    farewell: "Thank you for reading",
    art: {
      cover: "la-working-1",
      section: "il-day37-calculator",
      picture: "la-woman-working-1",
      closing: "la-scooter"
    }
  },
  look: {},
  slides: [
    [
      "cover",
      {
        title: "September\nin one page",
        subtitle: "Revenue, burn and runway, what went right, what went wrong, and the three things we need from you.",
        presenter: "Sam Whitfield, Chief Executive  ·  4 October 2026"
      }
    ],
    [
      "figures",
      {
        eyebrow: "Metrics",
        title: "The four numbers",
        stats: [
          [
            "$412K",
            "Monthly recurring revenue",
            "+9% month over month",
            "Fourth straight month above 8%; expansion was a third of it."
          ],
          [
            "$310K",
            "Net burn",
            "Flat",
            "Two hires offset by the office move; contractors down to one."
          ],
          [
            "21",
            "Months of runway",
            "Plan holds",
            "At current burn, before any of the pipeline closes."
          ],
          [
            "112%",
            "Net revenue retention",
            "+2 pts",
            "Churn fell to 1.1%; two accounts doubled seats."
          ]
        ]
      }
    ],
    [
      "chart",
      {
        eyebrow: "Metrics",
        title: "Revenue and burn, six months",
        takeaway: "Revenue has grown every month since April; burn has not moved. The gap is closing on schedule.",
        categories: [
          "Apr",
          "May",
          "Jun",
          "Jul",
          "Aug",
          "Sep"
        ],
        series: [
          {
            name: "MRR",
            values: [
              268,
              292,
              318,
              346,
              378,
              412
            ]
          },
          {
            name: "Net burn",
            values: [
              305,
              312,
              298,
              315,
              308,
              310
            ]
          }
        ],
        calls: [
          [
            "$412K",
            "MRR at month end"
          ],
          [
            "1.1%",
            "Logo churn, the lowest yet"
          ],
          [
            "Q2 2027",
            "Default-alive at this trajectory"
          ]
        ]
      }
    ],
    [
      "twoColumns",
      {
        eyebrow: "Highlights and lowlights",
        title: "What went right, what went wrong",
        left: {
          eyebrow: "Right",
          head: "The self-serve tier started paying",
          lines: [
            "Thirty-one upgrades without a sales call",
            "Payback under four months on that cohort",
            "Support tickets per account down 40%"
          ],
          icon: "circle-check"
        },
        right: {
          eyebrow: "Wrong",
          head: "We lost the platform lead we wanted",
          lines: [
            "Counter-offer we could not match",
            "Search restarted with a new firm",
            "Roadmap slips by three weeks"
          ],
          icon: "alert-triangle"
        }
      }
    ],
    [
      "threeCards",
      {
        eyebrow: "Asks",
        title: "Three things we need",
        cards: [
          [
            "user",
            "One introduction",
            "A head of platform engineering, ideally someone who has scaled a data pipeline past a billion events a day."
          ],
          [
            "briefcase",
            "Two customer intros",
            "Logistics or fleet operators with more than 500 vehicles. Two names would change Q4."
          ],
          [
            "message",
            "Thirty minutes of advice",
            "Pricing for the self-serve tier. We think we are underpriced by half and want a second opinion."
          ]
        ]
      }
    ],
    [
      "closing",
      {
        title: "Thank you",
        subtitle: "Reply to this deck with anything; we read every note. The data room is updated with the September actuals.",
        rows: [
          [
            "mail",
            "sam@beacon.example"
          ],
          [
            "world",
            "beacon.example/investors"
          ],
          [
            "calendar",
            "Next update: 4 November"
          ]
        ],
        cta: "Open the data room"
      }
    ]
  ]
};
