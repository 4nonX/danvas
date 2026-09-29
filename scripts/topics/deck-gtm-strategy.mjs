// Go-to-Market Strategy: one topic deck. See scripts/gen-topic-decks.mjs.
// base: the library look it starts from; look: overrides on that look;
// slides: [layout, content] in order; a raw slide carries a build function.

export default {
  id: "deck-gtm-strategy",
  title: "Go-to-Market Strategy",
  base: "atlas",
  rank: 58,
  tags: [
    "gtm",
    "strategy",
    "sales",
    "marketing"
  ],
  meta: {
    company: "Northwind Systems",
    deck: "Go-to-market: Fleet Edition",
    kicker: "The motion",
    farewell: "What we will watch",
    art: {
      cover: "la-building",
      section: "il-day14-forklift",
      picture: "la-conversation-illustration",
      closing: "la-scooter"
    }
  },
  look: {},
  slides: [
    [
      "cover",
      {
        title: "How Fleet Edition\nreaches its buyer",
        subtitle: "The buyer, the message per persona, the channels and what each costs, and the first ninety days from soft launch to scale.",
        presenter: "Marcus Obi, VP Sales  ·  November 2026"
      }
    ],
    [
      "threeCards",
      {
        eyebrow: "The buyer",
        title: "Who signs, who uses, who blocks",
        cards: [
          [
            "briefcase",
            "Signs: the operations director",
            "Owns the fleet budget and the uptime number. Buys when a peer has already bought."
          ],
          [
            "truck",
            "Uses: the dispatch lead",
            "Lives in the tool nine hours a day. If the first week is hard, the deal dies at renewal."
          ],
          [
            "shield",
            "Blocks: IT and security",
            "Asks about data residency and SSO in the first call. Answer before they ask."
          ]
        ]
      }
    ],
    [
      "table",
      {
        eyebrow: "The message",
        title: "The promise and the proof, per persona",
        cols: [
          "",
          "Promise",
          "Proof",
          "Format"
        ],
        rows: [
          [
            "Operations director",
            "Two points of uptime",
            "Brightline case study",
            "Executive brief"
          ],
          [
            "Dispatch lead",
            "Nothing to learn on Monday",
            "Ninety-second demo",
            "Video and pilot"
          ],
          [
            "IT and security",
            "Your data stays yours",
            "Certifications page",
            "Pre-answered questionnaire"
          ],
          [
            "Finance",
            "Pays back in one quarter",
            "ROI model with their numbers",
            "Spreadsheet"
          ]
        ]
      }
    ],
    [
      "chart",
      {
        eyebrow: "The channels",
        title: "Where the motion runs, and what each costs",
        takeaway: "Partners bring the cheapest pipeline; paid search the most expensive. The plan weights accordingly.",
        categories: [
          "Partners",
          "Outbound",
          "Events",
          "Inbound",
          "Paid"
        ],
        series: [
          {
            name: "Cost per opportunity ($K)",
            values: [
              1.8,
              3.4,
              4.1,
              2.2,
              6.5
            ]
          }
        ],
        calls: [
          [
            "$1.8K",
            "Cost per opportunity through partners"
          ],
          [
            "45%",
            "Of pipeline expected from partners and inbound"
          ],
          [
            "$6.5K",
            "Paid search, capped at 10% of budget"
          ]
        ]
      }
    ],
    [
      "timeline",
      {
        eyebrow: "The first 90 days",
        title: "From soft launch to scale",
        done: 0,
        steps: [
          [
            "Weeks 1 to 2",
            "Soft launch",
            "Ten design partners live; every call recorded and reviewed on Friday."
          ],
          [
            "Weeks 3 to 6",
            "Partner enablement",
            "Forty partners trained; the referral offer goes live."
          ],
          [
            "Weeks 7 to 10",
            "Outbound at volume",
            "Two reps on the top 300 accounts with the case study in hand."
          ],
          [
            "Weeks 11 to 13",
            "Scale or stop",
            "Review by channel. Double the two that work; cut the one that does not."
          ]
        ]
      }
    ],
    [
      "threeCards",
      {
        eyebrow: "What kills us",
        title: "The failure modes we will watch",
        cards: [
          [
            "alert-triangle",
            "The first week is hard",
            "If dispatch leads need a call to get started, renewals fail in twelve months. Watch: setup completion without support."
          ],
          [
            "coin",
            "We price like the incumbent",
            "Fleet buyers expect per-vehicle pricing. Per-seat confuses them. Watch: quote-to-close time."
          ],
          [
            "clock",
            "Partners sell our roadmap",
            "Partners promise features that are not built. Watch: escalations mentioning a promise we did not make."
          ]
        ]
      }
    ],
    [
      "closing",
      {
        title: "Questions",
        subtitle: "The full plan, the persona research and the channel model are in the go-to-market folder.",
        rows: [
          [
            "mail",
            "marcus@northwind.example"
          ],
          [
            "world",
            "northwind.example/gtm"
          ],
          [
            "calendar",
            "Channel review: week 13"
          ]
        ],
        cta: "Open the plan"
      }
    ]
  ]
};
