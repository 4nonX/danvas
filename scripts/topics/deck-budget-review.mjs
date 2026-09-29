// Budget Review: one topic deck. See scripts/gen-topic-decks.mjs.
// base: the library look it starts from; look: overrides on that look;
// slides: [layout, content] in order; a raw slide carries a build function.

export default {
  id: "deck-budget-review",
  title: "Budget Review",
  base: "atlas",
  rank: 88,
  tags: [
    "budget",
    "finance",
    "review",
    "planning"
  ],
  meta: {
    company: "Cobalt Health",
    deck: "Budget review, H1 2026",
    kicker: "Spend against plan",
    farewell: "Decision today",
    art: {
      cover: "la-woman-working-2",
      section: "il-day37-calculator",
      picture: "la-desk-illustration-2",
      closing: "la-working-2"
    }
  },
  look: {},
  slides: [
    [
      "cover",
      {
        title: "Where the\nmoney went",
        subtitle: "Actuals against plan for the first half, the variances that matter, and one reallocation to approve.",
        presenter: "Dana Whitfield, Finance Director  ·  15 July 2026"
      }
    ],
    [
      "figures",
      {
        eyebrow: "The picture",
        title: "First half against plan",
        stats: [
          [
            "$18.6M",
            "Total spend",
            "97% of plan",
            "Under plan in headcount, over in cloud and travel."
          ],
          [
            "$1.2M",
            "Headcount underspend",
            "14 roles open",
            "Hiring ran two months behind; the gap closes by October."
          ],
          [
            "$640K",
            "Cloud overspend",
            "+22% vs plan",
            "Usage grew faster than forecast; reserved capacity was bought late."
          ],
          [
            "$310K",
            "Travel overspend",
            "+31% vs plan",
            "Two conferences and the Lisbon office opening."
          ]
        ]
      }
    ],
    [
      "chart",
      {
        eyebrow: "Where the money went",
        title: "Actuals by department",
        takeaway: "Engineering and sales are under plan on people; platform is over on infrastructure.",
        categories: [
          "Eng",
          "Sales",
          "Platform",
          "Marketing",
          "G&A"
        ],
        series: [
          {
            name: "Plan",
            values: [
              6.2,
              4.8,
              3.1,
              2.9,
              2.2
            ]
          },
          {
            name: "Actual",
            values: [
              5.6,
              4.4,
              3.7,
              3,
              1.9
            ]
          }
        ],
        calls: [
          [
            "−$1.0M",
            "Under plan across engineering and sales"
          ],
          [
            "+$600K",
            "Over plan in platform, all cloud"
          ],
          [
            "$18.6M",
            "Total, 97% of plan"
          ]
        ]
      }
    ],
    [
      "table",
      {
        eyebrow: "Variances",
        title: "The overs, the unders, and the why",
        cols: [
          "",
          "Plan",
          "Actual",
          "Variance"
        ],
        rows: [
          [
            "Engineering headcount",
            "$6.2M",
            "$5.6M",
            "−$0.6M"
          ],
          [
            "Sales headcount",
            "$4.8M",
            "$4.4M",
            "−$0.4M"
          ],
          [
            "Cloud and infrastructure",
            "$2.9M",
            "$3.5M",
            "+$0.6M"
          ],
          [
            "Travel and events",
            "$1.0M",
            "$1.3M",
            "+$0.3M"
          ],
          [
            "Software and tooling",
            "$0.9M",
            "$0.8M",
            "−$0.1M"
          ]
        ]
      }
    ],
    [
      "threeCards",
      {
        eyebrow: "Reallocation proposal",
        title: "What we move, and what it buys",
        cards: [
          [
            "database",
            "Reserve cloud capacity now",
            "Move $400K of the headcount underspend to reserved instances. Saves $180K in H2 against on-demand pricing."
          ],
          [
            "user",
            "Fund two of the open roles as contractors",
            "Bridge the platform gap for six months while the hires land. $260K, fully within the underspend."
          ],
          [
            "plane",
            "Cap travel for H2",
            "Conference attendance by approval only. Brings the line back to plan by December."
          ]
        ]
      }
    ],
    [
      "closing",
      {
        title: "The decision",
        subtitle: "Approve the reallocation as proposed, adjust the amounts, or defer to the September review.",
        rows: [
          [
            "mail",
            "dana@cobalthealth.example"
          ],
          [
            "file-text",
            "Full variance workbook attached"
          ],
          [
            "calendar",
            "Next review: 16 September"
          ]
        ],
        cta: "Approve the proposal"
      }
    ]
  ]
};
