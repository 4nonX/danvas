// Company All-Hands: one topic deck. See scripts/gen-topic-decks.mjs.
// base: the library look it starts from; look: overrides on that look;
// slides: [layout, content] in order; a raw slide carries a build function.

export default {
  id: "deck-all-hands",
  title: "Company All-Hands",
  base: "pulse",
  rank: 38,
  tags: [
    "all hands",
    "company",
    "update",
    "culture"
  ],
  meta: {
    company: "Loop",
    deck: "All-hands, October",
    kicker: "October all-hands",
    farewell: "See you next month",
    art: {
      cover: "la-hero-image-2",
      section: "il-day35-firework",
      picture: "la-conversation-illustration",
      closing: "la-scooter"
    }
  },
  look: {},
  slides: [
    [
      "cover",
      {
        title: "What October\nlooked like",
        subtitle: "Wins worth naming, the numbers against plan, what we are fixing, and the people who made the month.",
        presenter: "Elena Sato, Chief Executive  ·  31 October 2026",
        year: "Oct"
      }
    ],
    [
      "threeCards",
      {
        eyebrow: "Wins to celebrate",
        title: "Three wins worth naming",
        cards: [
          [
            "trophy",
            "Brightline went live",
            "Our largest customer, 4,000 seats, migrated in a weekend. Not one ticket on Monday."
          ],
          [
            "sparkles",
            "Self-serve crossed $100K",
            "Monthly revenue with no sales call, for the first time. Growth is now a real team."
          ],
          [
            "heart",
            "Support hit a 96 satisfaction score",
            "Highest ever, with the queue at its longest. Thank the night shift."
          ]
        ]
      }
    ],
    [
      "figures",
      {
        eyebrow: "The numbers",
        title: "Where we stand against plan",
        stats: [
          [
            "$3.9M",
            "October revenue",
            "104% of plan",
            "Expansion carried it; new business was flat."
          ],
          [
            "1,940",
            "Customers",
            "+86 this month",
            "Churn at 1.3%, back under target."
          ],
          [
            "118",
            "People",
            "+7 this month",
            "Three in engineering, two in support, two in sales."
          ],
          [
            "19",
            "Months of runway",
            "Plan holds",
            "Before the round, at the current burn."
          ]
        ]
      }
    ],
    [
      "twoColumns",
      {
        eyebrow: "What we are fixing",
        title: "The honest view",
        left: {
          eyebrow: "Not working",
          head: "Onboarding takes too long",
          lines: [
            "Median time to first value: 11 days",
            "Half of new accounts need a call",
            "The import tool fails on large files"
          ],
          icon: "alert-triangle"
        },
        right: {
          eyebrow: "What we are doing",
          head: "A two-week onboarding sprint",
          lines: [
            "Import rebuilt for files over 1 GB",
            "Guided setup for the top three use cases",
            "Target: first value in under three days"
          ],
          icon: "circle-check"
        }
      }
    ],
    [
      "timeline",
      {
        eyebrow: "Next month",
        title: "Priorities everyone should know",
        done: 1,
        steps: [
          [
            "Week 1",
            "Onboarding sprint starts",
            "Growth and platform pair for two weeks. Everything else waits."
          ],
          [
            "Week 2",
            "Pricing page relaunch",
            "The new tiers go live; sales gets the talk track on Monday."
          ],
          [
            "Week 3",
            "Brightline case study",
            "Marketing publishes; every rep gets the one-pager."
          ],
          [
            "Week 4",
            "Planning week",
            "Q1 objectives drafted in the open. Comment on anything."
          ]
        ]
      }
    ],
    [
      "team",
      {
        eyebrow: "Shoutouts",
        title: "People who made the difference",
        people: [
          [
            "Aisha Bello",
            "Support",
            "Ran the night shift through the Brightline weekend without a single escalation."
          ],
          [
            "Tomas Reyes",
            "Platform",
            "Found the import bug at 2 a.m. and shipped the fix before standup."
          ],
          [
            "Mei Lin",
            "Growth",
            "Built the upgrade flow that crossed $100K on its own."
          ],
          [
            "Jonah Park",
            "Sales",
            "Closed Brightline after eleven months and a lot of patience."
          ]
        ]
      }
    ],
    [
      "closing",
      {
        title: "Thank you",
        subtitle: "Questions in the channel all week. The recording and the numbers are in the all-hands folder.",
        rows: [
          [
            "message",
            "#all-hands on Slack"
          ],
          [
            "mail",
            "elena@loop.example"
          ],
          [
            "calendar",
            "Next all-hands: 28 November"
          ]
        ],
        cta: "Ask a question"
      }
    ]
  ]
};
