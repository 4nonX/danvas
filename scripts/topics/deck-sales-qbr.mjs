// Sales QBR: one topic deck. See scripts/gen-topic-decks.mjs.
// base: the library look it starts from; look: overrides on that look;
// slides: [layout, content] in order; a raw slide carries a build function.

export default {
  id: "deck-sales-qbr",
  title: "Sales QBR",
  base: "atlas",
  rank: 32,
  tags: [
    "qbr",
    "sales",
    "review",
    "quarterly"
  ],
  meta: {
    company: "Northwind Systems",
    deck: "Sales QBR, Q3 2026",
    kicker: "Quarter in review",
    farewell: "On to Q4",
    art: {
      cover: "la-success-illustration",
      section: "il-day5-vault",
      picture: "la-conversation-illustration",
      closing: "la-scooter"
    }
  },
  look: {},
  slides: [
    [
      "cover",
      {
        title: "Pipeline, wins,\nand what changed",
        subtitle: "Bookings against plan, the plays that closed, and the three bets that carry us into Q4.",
        presenter: "Marcus Obi, VP Sales  ·  8 October 2026"
      }
    ],
    [
      "agenda",
      {
        title: "Sixty minutes, five questions",
        items: [
          [
            "Headline numbers",
            "Bookings, coverage and win rate against plan",
            "10 min"
          ],
          [
            "What worked",
            "The plays and segments that outperformed",
            "10 min"
          ],
          [
            "What did not",
            "Stalled deals and the losses we should have won",
            "15 min"
          ],
          [
            "Competitive picture",
            "Who we met and how we positioned",
            "10 min"
          ],
          [
            "The Q4 plan",
            "Three bets, owners and dates",
            "15 min"
          ]
        ],
        card: {
          eyebrow: "This session",
          big: "Q3",
          meta: [
            [
              "When",
              "8 October, 14:00"
            ],
            [
              "Room",
              "Summit, level 6"
            ],
            [
              "Host",
              "Marcus Obi"
            ],
            [
              "Deck",
              "Shared after the call"
            ]
          ]
        }
      }
    ],
    [
      "figures",
      {
        eyebrow: "Headline numbers",
        title: "The quarter against plan",
        stats: [
          [
            "$12.4M",
            "Bookings",
            "103% of plan",
            "Closed-won ACV; enterprise carried the last two weeks."
          ],
          [
            "3.4x",
            "Pipeline coverage",
            "+0.6x entering Q4",
            "Qualified pipeline against the Q4 number, before marketing's October push."
          ],
          [
            "31%",
            "Win rate",
            "+4 pts",
            "Up in mid-market, flat in enterprise; the security review is the swing factor."
          ],
          [
            "41 days",
            "Sales cycle",
            "−9 days",
            "Faster where the pilot offer was used; slower everywhere else."
          ]
        ]
      }
    ],
    [
      "chart",
      {
        eyebrow: "Headline numbers",
        title: "Bookings by month",
        takeaway: "September closed 44% of the quarter; the pilot offer pulled two enterprise deals forward.",
        categories: [
          "Jul",
          "Aug",
          "Sep"
        ],
        series: [
          {
            name: "Plan",
            values: [
              3.6,
              4,
              4.4
            ]
          },
          {
            name: "Actual",
            values: [
              3.1,
              3.8,
              5.5
            ]
          }
        ],
        calls: [
          [
            "$5.5M",
            "September bookings, a record month"
          ],
          [
            "7",
            "Deals over $250K, four with the pilot offer"
          ],
          [
            "2",
            "Deals slipped into October"
          ]
        ]
      }
    ],
    [
      "twoColumns",
      {
        eyebrow: "What worked, what did not",
        title: "The honest split",
        left: {
          eyebrow: "Worked",
          head: "The pilot offer and the mid-market play",
          lines: [
            "Two-week pilots closed at 2x the rate",
            "Mid-market reps hit 118% of quota",
            "Partner-sourced deals churned least"
          ],
          icon: "circle-check"
        },
        right: {
          eyebrow: "Did not",
          head: "Enterprise security reviews",
          lines: [
            "Six deals stalled at the review stage",
            "Three losses to the incumbent on price",
            "Discounting crept back above policy"
          ],
          icon: "alert-triangle"
        }
      }
    ],
    [
      "table",
      {
        eyebrow: "Competitive picture",
        title: "Who we met, and how it went",
        cols: [
          "",
          "Us",
          "Incumbent",
          "Upstart"
        ],
        rows: [
          [
            "Met in deals this quarter",
            "",
            "38",
            "17"
          ],
          [
            "Won when we led with pilots",
            "yes",
            "no",
            "no"
          ],
          [
            "Security certification",
            "yes",
            "yes",
            "no"
          ],
          [
            "Sub-30-day implementation",
            "yes",
            "no",
            "yes"
          ],
          [
            "Price under $40 per seat",
            "no",
            "no",
            "yes"
          ]
        ]
      }
    ],
    [
      "threeCards",
      {
        eyebrow: "The Q4 plan",
        title: "Three bets, with owners",
        cards: [
          [
            "flag",
            "Pilots for every enterprise deal",
            "Make the two-week pilot the default. Owner: Priya. Target: 60% of enterprise pipeline."
          ],
          [
            "shield",
            "Security review in under ten days",
            "A pre-answered questionnaire and a named engineer. Owner: Sam. Target: no deal stalls past day ten."
          ],
          [
            "coin",
            "Hold the line on discounting",
            "Approval above 15% moves to the VP. Owner: Marcus. Target: average discount under 12%."
          ]
        ]
      }
    ],
    [
      "closing",
      {
        title: "Questions",
        subtitle: "The full pipeline review and the rep-by-rep numbers are in the shared folder.",
        rows: [
          [
            "mail",
            "marcus@northwind.example"
          ],
          [
            "world",
            "northwind.example/sales"
          ],
          [
            "calendar",
            "Next QBR: 14 January"
          ]
        ],
        cta: "Book a follow-up"
      }
    ]
  ]
};
