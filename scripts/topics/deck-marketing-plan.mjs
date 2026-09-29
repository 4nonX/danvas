// Marketing Plan: one topic deck. See scripts/gen-topic-decks.mjs.
// base: the library look it starts from; look: overrides on that look;
// slides: [layout, content] in order; a raw slide carries a build function.

export default {
  id: "deck-marketing-plan",
  title: "Marketing Plan",
  base: "folio",
  rank: 80,
  tags: [
    "marketing",
    "plan",
    "campaign",
    "strategy"
  ],
  meta: {
    company: "Meridian Studio",
    deck: "Marketing plan 2027",
    kicker: "Creative, with a spine",
    farewell: "How we will know",
    art: {
      cover: "la-doodle",
      section: "il-day64-followers",
      picture: "la-youtube-illustration",
      closing: "la-coffee"
    }
  },
  look: {},
  slides: [
    [
      "cover",
      {
        title: "What marketing\nowes the business",
        subtitle: "The objective, the audience, the big idea, the calendar, the budget, and the dashboard we will check every week.",
        presenterName: "Mei Lin",
        when: "12 December 2026",
        where: "Studio, level 2"
      }
    ],
    [
      "figures",
      {
        eyebrow: "The objective",
        title: "What we owe the business in 2027",
        stats: [
          [
            "$9M",
            "Sourced pipeline",
            "+50% on 2026",
            "Marketing-sourced, first touch, measured in the CRM."
          ],
          [
            "2,400",
            "Qualified leads",
            "200 a month",
            "Up from 140; the free tier is the largest new source."
          ],
          [
            "38%",
            "Share of voice",
            "+10 pts",
            "In our category, measured quarterly by the analyst survey."
          ],
          [
            "$1.9M",
            "Budget",
            "Flat",
            "Same money, reweighted toward the channels that worked."
          ]
        ]
      }
    ],
    [
      "table",
      {
        eyebrow: "The audience",
        title: "Segments, moments and messages",
        cols: [
          "",
          "Moment",
          "Message",
          "Channel"
        ],
        rows: [
          [
            "Founders, 10 to 50 people",
            "First hire in ops",
            "Set up in an afternoon",
            "Product and community"
          ],
          [
            "Ops leads, 50 to 500",
            "The spreadsheet broke",
            "One place for the whole team",
            "Search and content"
          ],
          [
            "Directors, 500 plus",
            "Board asks for the number",
            "Answers, not reports",
            "Events and partners"
          ],
          [
            "Partners",
            "Their client asks",
            "Refer and earn",
            "Partner programme"
          ]
        ]
      }
    ],
    [
      "statement",
      {
        text: "The big idea: show the afternoon a team gets back. Not the features, the Friday.",
        source: "Campaign concept, 2027"
      }
    ],
    [
      "timeline",
      {
        eyebrow: "The calendar",
        title: "Campaigns across the year",
        done: 0,
        steps: [
          [
            "Q1",
            "The Friday campaign",
            "Launch film, twelve customer stories, the free tier front and centre."
          ],
          [
            "Q2",
            "The report",
            "The annual state-of-operations report, our largest earned-media moment."
          ],
          [
            "Q3",
            "Partner season",
            "Co-marketing with the top twenty partners; one story a week."
          ],
          [
            "Q4",
            "The conference",
            "Our own event, four hundred people, the 2028 plan announced from the stage."
          ]
        ]
      }
    ],
    [
      "chart",
      {
        eyebrow: "The budget",
        title: "Spend by channel, with expected return",
        takeaway: "Content and partners carry the plan; events are the bet; paid stays capped.",
        categories: [
          "Content",
          "Partners",
          "Events",
          "Paid",
          "Brand"
        ],
        series: [
          {
            name: "Spend ($K)",
            values: [
              520,
              380,
              460,
              300,
              240
            ]
          },
          {
            name: "Expected pipeline ($K)",
            values: [
              3100,
              2600,
              1800,
              900,
              600
            ]
          }
        ],
        calls: [
          [
            "6x",
            "Content pipeline against spend"
          ],
          [
            "4x",
            "Events, the bet of the year"
          ],
          [
            "3x",
            "Paid, capped at $300K"
          ]
        ]
      }
    ],
    [
      "closing",
      {
        title: "How we will know",
        subtitle: "One dashboard, five numbers, checked every Monday at nine. If a channel misses two months, we move its money.",
        rows: [
          [
            "mail",
            "mei@meridian.example"
          ],
          [
            "world",
            "meridian.example/marketing"
          ],
          [
            "calendar",
            "Weekly review: Mondays, 09:00"
          ]
        ],
        cta: "Open the dashboard"
      }
    ]
  ]
};
