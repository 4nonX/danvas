// Product Launch Plan: one topic deck. See scripts/gen-topic-decks.mjs.
// base: the library look it starts from; look: overrides on that look;
// slides: [layout, content] in order; a raw slide carries a build function.

export default {
  id: "deck-product-launch",
  title: "Product Launch Plan",
  base: "pulse",
  rank: 36,
  tags: [
    "launch",
    "product",
    "marketing",
    "gtm"
  ],
  meta: {
    company: "Loop",
    deck: "Launch plan: Loop Insights",
    kicker: "Launch plan",
    farewell: "Launch day is 12 November",
    art: {
      cover: "la-hero-image-2",
      section: "il-day20-rocket",
      picture: "la-notification-woman",
      closing: "la-free-svg-illustration-rocket"
    }
  },
  look: {},
  slides: [
    [
      "cover",
      {
        title: "Loop Insights\nlaunches in November",
        subtitle: "Payroll analytics for finance leaders, in one sentence: see next month's cost before you run this month's payroll.",
        presenter: "Mei Lin, Product Marketing  ·  1 October 2026",
        year: "Nov"
      }
    ],
    [
      "textPicture",
      {
        eyebrow: "Who it is for",
        title: "The buyer, and the moment of need",
        points: [
          [
            "Finance leaders at 200 to 2,000 people",
            "They present headcount cost to the board quarterly and rebuild the number by hand every time."
          ],
          [
            "The moment: the week before the board pack",
            "Every competitor sells to payroll operators. Nobody sells to the person who has to explain the number."
          ],
          [
            "The insight competitors missed",
            "The data is already in payroll. The product is the question, not the spreadsheet."
          ]
        ]
      }
    ],
    [
      "threeCards",
      {
        eyebrow: "Positioning",
        title: "The category, the promise, the proof",
        cards: [
          [
            "flag",
            "The category we claim",
            "Payroll analytics. Not reporting, not BI: answers to the questions a finance leader is actually asked."
          ],
          [
            "sparkles",
            "The promise we make",
            "See next month's cost before you run this month's payroll."
          ],
          [
            "chart-pie",
            "The proof we bring",
            "Twelve pilot customers cut board-pack preparation from three days to one afternoon."
          ]
        ]
      }
    ],
    [
      "timeline",
      {
        eyebrow: "Launch timeline",
        title: "Teaser, launch day, and the weeks after",
        done: 1,
        steps: [
          [
            "29 Oct",
            "Teaser",
            "Pilot customers post their numbers; the waitlist page goes live."
          ],
          [
            "12 Nov",
            "Launch day",
            "Product live for every customer, press at 07:00, webinar at 16:00."
          ],
          [
            "19 Nov",
            "Follow-through",
            "Case studies from two pilots; every rep runs the demo with live data."
          ],
          [
            "10 Dec",
            "Review",
            "Day-30 metrics, the pricing decision, and what the next release fixes."
          ]
        ]
      }
    ],
    [
      "table",
      {
        eyebrow: "Channels and owners",
        title: "Owned, earned and paid, each with an owner",
        cols: [
          "",
          "Owner",
          "Ready by",
          "Day-one target"
        ],
        rows: [
          [
            "Product and in-app",
            "Priya",
            "5 Nov",
            "Every customer sees it"
          ],
          [
            "Email and blog",
            "Mei",
            "10 Nov",
            "40% open rate"
          ],
          [
            "Press and analysts",
            "Elena",
            "11 Nov",
            "Three pieces"
          ],
          [
            "Paid search and social",
            "Jonah",
            "12 Nov",
            "2,000 visits"
          ],
          [
            "Partners",
            "Marcus",
            "12 Nov",
            "Ten partner posts"
          ]
        ]
      }
    ],
    [
      "figures",
      {
        eyebrow: "Success metrics",
        title: "The numbers we check on day 1, 7 and 30",
        stats: [
          [
            "60%",
            "Customers who open it",
            "Day 1",
            "Of active customers, in the product, on launch day."
          ],
          [
            "25%",
            "Weekly active",
            "Day 7",
            "Customers who come back to it in the first week."
          ],
          [
            "40",
            "Upgrades",
            "Day 30",
            "Accounts on the Insights tier by December."
          ],
          [
            "$80K",
            "New monthly revenue",
            "Day 30",
            "From upgrades and two new logos won on the launch."
          ]
        ]
      }
    ],
    [
      "closing",
      {
        title: "Launch day",
        subtitle: "12 November. Press at 07:00, product live at 09:00, webinar at 16:00, retro on Friday. Screenshot this page.",
        rows: [
          [
            "message",
            "#launch-insights on Slack"
          ],
          [
            "mail",
            "mei@loop.example"
          ],
          [
            "calendar",
            "Retro: 14 November, 15:00"
          ]
        ],
        cta: "Open the launch checklist"
      }
    ]
  ]
};
