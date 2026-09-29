// Product Vision: one topic deck. See scripts/gen-topic-decks.mjs.
// base: the library look it starts from; look: overrides on that look;
// slides: [layout, content] in order; a raw slide carries a build function.

export default {
  id: "deck-product-vision",
  title: "Product Vision",
  base: "vanta",
  rank: 90,
  tags: [
    "vision",
    "product",
    "strategy",
    "future"
  ],
  meta: {
    company: "Nova Systems",
    deck: "Product vision, 2029",
    kicker: "// the future we see",
    farewell: "// what we build next",
    art: {
      cover: "la-ai-robot-3",
      section: "il-day27-my-robot",
      picture: "la-coding-people",
      closing: "la-free-svg-illustrations-robots"
    }
  },
  look: {},
  slides: [
    [
      "cover",
      {
        title: "The world when\nthis product wins",
        subtitle: "Where we are going, why us and why now, what the product does in three years, and the bets underneath it.",
        presenter: "Priya Raman, Head of Product  ·  November 2026",
        chips: [
          [
            "2029",
            "horizon"
          ],
          [
            "3",
            "bets"
          ],
          [
            "1",
            "product"
          ]
        ]
      }
    ],
    [
      "statement",
      {
        text: "In three years, nobody on a platform team will write a dashboard by hand. The system will tell them what changed and why.",
        source: "The vision in one sentence"
      }
    ],
    [
      "threeCards",
      {
        eyebrow: "Why us, why now",
        title: "Three shifts that make it possible",
        cards: [
          [
            "database",
            "Every system now emits structured events",
            "Ten years ago you had to build the pipe. Today the pipe exists; the product is what listens to it."
          ],
          [
            "sparkles",
            "Models can read a trace",
            "A model that explains an incident from raw telemetry was science fiction in 2023. It is a demo today."
          ],
          [
            "user",
            "Platform teams are shrinking",
            "Fewer people run more systems. The tool that removes the reading wins."
          ]
        ]
      }
    ],
    [
      "twoColumns",
      {
        eyebrow: "The product in three years",
        title: "What it does that nothing does today",
        left: {
          eyebrow: "Today",
          head: "You ask the dashboard a question",
          lines: [
            "Someone built the panel last year",
            "It shows the metric, not the cause",
            "The incident channel does the reasoning"
          ],
          icon: "alert-triangle"
        },
        right: {
          eyebrow: "2029",
          head: "The system tells you before you ask",
          lines: [
            "Every change correlated to every symptom",
            "The cause named, with the evidence",
            "The fix drafted, waiting for a yes"
          ],
          icon: "circle-check"
        }
      }
    ],
    [
      "timeline",
      {
        eyebrow: "The path",
        title: "The stepping stones from here to there",
        done: 1,
        steps: [
          [
            "2026",
            "Correlate",
            "Every deploy, config change and alert on one timeline. Shipped; adoption is the work."
          ],
          [
            "2027",
            "Explain",
            "The incident narrative written by the system, from the timeline it already has."
          ],
          [
            "2028",
            "Suggest",
            "The likely fix, drafted as a change request, with the blast radius shown."
          ],
          [
            "2029",
            "Act",
            "Reversible fixes applied on approval; the human owns the decision, not the typing."
          ]
        ]
      }
    ],
    [
      "threeCards",
      {
        eyebrow: "What we must believe",
        title: "The bets under the vision",
        cards: [
          [
            "shield",
            "Customers will trust a system that shows its evidence",
            "Every claim links to the trace. If we cannot show it, we do not say it."
          ],
          [
            "bolt",
            "Explanation beats prediction",
            "Teams do not want a forecast of incidents. They want to understand the one they have."
          ],
          [
            "world",
            "Open data wins the platform",
            "Customers keep their telemetry. We sell the reading, never the lock-in."
          ]
        ]
      }
    ],
    [
      "closing",
      {
        title: "The invitation",
        subtitle: "This is the product we build together next. Argue with the bets before the roadmap locks in December.",
        rows: [
          [
            "mail",
            "priya@novasystems.example"
          ],
          [
            "world",
            "vision.novasystems.example"
          ],
          [
            "calendar",
            "Roadmap lock: 15 December"
          ]
        ],
        cta: "Comment on the vision"
      }
    ]
  ]
};
