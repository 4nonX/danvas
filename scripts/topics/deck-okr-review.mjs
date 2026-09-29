// OKR Review: one topic deck. See scripts/gen-topic-decks.mjs.
// base: the library look it starts from; look: overrides on that look;
// slides: [layout, content] in order; a raw slide carries a build function.

export default {
  id: "deck-okr-review",
  title: "OKR Review",
  base: "vanta",
  rank: 52,
  tags: [
    "okr",
    "goals",
    "review",
    "metrics"
  ],
  meta: {
    company: "Nova Systems",
    deck: "OKR review, Q3 2026",
    kicker: "// scored, honestly",
    farewell: "// next quarter",
    art: {
      cover: "la-ai-robot-3",
      section: "il-111-coding",
      picture: "la-woman-working-2",
      closing: "la-free-svg-illustrations-robots"
    }
  },
  look: {},
  slides: [
    [
      "cover",
      {
        title: "Three objectives,\nscored",
        subtitle: "What we set out to do in Q3, how far we got, and which targets were wrong versus which execution was.",
        presenter: "Priya Raman, Head of Product  ·  2 October 2026",
        chips: [
          [
            "0.7",
            "avg score"
          ],
          [
            "9",
            "key results"
          ],
          [
            "2",
            "missed"
          ]
        ]
      }
    ],
    [
      "figures",
      {
        eyebrow: "Objective one",
        title: "Make the platform boring to run",
        stats: [
          [
            "99.97%",
            "Uptime",
            "Target 99.95%",
            "Scored 1.0. Two incidents, both under fifteen minutes."
          ],
          [
            "−41%",
            "P95 latency",
            "Target −30%",
            "Scored 1.0. The cache layer landed in August."
          ],
          [
            "14",
            "Pages on call per week",
            "Target 10",
            "Scored 0.6. Alert noise from the new region."
          ],
          [
            "0.87",
            "Objective score",
            "Strong",
            "Reliability is no longer the conversation in customer calls."
          ]
        ]
      }
    ],
    [
      "figures",
      {
        eyebrow: "Objective two",
        title: "Win the self-serve upgrade",
        stats: [
          [
            "4.8%",
            "Free to paid conversion",
            "Target 6%",
            "Scored 0.5. Improved from 3.1%; the checkout redesign shipped late."
          ],
          [
            "$92K",
            "Self-serve MRR",
            "Target $120K",
            "Scored 0.6. Growing 11% a month since the redesign."
          ],
          [
            "31",
            "Upgrades per week",
            "Target 40",
            "Scored 0.7. Weekend upgrades appeared for the first time."
          ],
          [
            "0.6",
            "Objective score",
            "Behind",
            "Right target, late execution. Carries into Q4 unchanged."
          ]
        ]
      }
    ],
    [
      "figures",
      {
        eyebrow: "Objective three",
        title: "Ship the enterprise bundle",
        stats: [
          [
            "Yes",
            "SSO and SCIM shipped",
            "On time",
            "Scored 1.0. Four customers live in the first week."
          ],
          [
            "3",
            "Enterprise pilots",
            "Target 5",
            "Scored 0.5. Two pilots slipped on the customer side."
          ],
          [
            "EU",
            "Data residency",
            "Target EU and APAC",
            "Scored 0.5. APAC region deferred to Q1."
          ],
          [
            "0.67",
            "Objective score",
            "Mixed",
            "Product shipped; the pipeline did not follow as fast as planned."
          ]
        ]
      }
    ],
    [
      "twoColumns",
      {
        eyebrow: "Lessons",
        title: "Wrong targets, or wrong execution?",
        left: {
          eyebrow: "Targets we set wrong",
          head: "Conversion at 6% assumed the redesign in July",
          lines: [
            "It shipped in September",
            "The number was right, the date was not",
            "Q4 keeps the target, moves the date"
          ],
          icon: "alert-triangle"
        },
        right: {
          eyebrow: "Execution we got wrong",
          head: "APAC residency waited on one person",
          lines: [
            "No backup owner for the region work",
            "Two weeks lost to a vacation",
            "Every key result now has a second owner"
          ],
          icon: "circle-check"
        }
      }
    ],
    [
      "threeCards",
      {
        eyebrow: "Next quarter",
        title: "Draft objectives for debate",
        cards: [
          [
            "gauge",
            "Cut on-call pages in half",
            "Alert tuning first, then the noisy region. Owner: platform."
          ],
          [
            "sparkles",
            "Self-serve at 6% conversion",
            "Same target, the redesign is now live. Owner: growth."
          ],
          [
            "world",
            "APAC residency live by December",
            "Two owners, one date, weekly check. Owner: enterprise."
          ]
        ]
      }
    ],
    [
      "closing",
      {
        title: "Questions",
        subtitle: "Scores and the evidence behind each are in the tracker. Push back on the drafts before Friday.",
        rows: [
          [
            "mail",
            "priya@novasystems.example"
          ],
          [
            "world",
            "okr.novasystems.example"
          ],
          [
            "calendar",
            "Q4 objectives lock: 10 October"
          ]
        ],
        cta: "Open the tracker"
      }
    ]
  ]
};
