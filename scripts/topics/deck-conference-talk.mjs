// Conference Talk: one topic deck. See scripts/gen-topic-decks.mjs.
// base: the library look it starts from; look: overrides on that look;
// slides: [layout, content] in order; a raw slide carries a build function.

export default {
  id: "deck-conference-talk",
  title: "Conference Talk",
  base: "vanta",
  rank: 84,
  tags: [
    "conference",
    "talk",
    "keynote",
    "tech"
  ],
  meta: {
    company: "Nova Systems",
    deck: "Talk: the boring platform",
    kicker: "// one idea, defended",
    farewell: "// what to do monday",
    art: {
      cover: "la-ai-robot-3",
      section: "il-day39-pc",
      picture: "la-coding-people",
      closing: "la-free-svg-illustrations-robots"
    }
  },
  look: {},
  slides: [
    [
      "cover",
      {
        title: "Make the platform\nboring",
        subtitle: "One idea this talk defends: the best platform team is the one nobody talks about, and how we got there in eighteen months.",
        presenter: "Tomas Reyes, Engineering Lead  ·  PlatformConf 2026",
        chips: [
          [
            "18",
            "months"
          ],
          [
            "3",
            "failures"
          ],
          [
            "1",
            "idea"
          ]
        ]
      }
    ],
    [
      "statement",
      {
        text: "Every platform team we know is proud of the incident it handled well. We wanted to be proud of the one that never happened.",
        source: "The problem everyone in this room has"
      }
    ],
    [
      "threeCards",
      {
        eyebrow: "What we tried",
        title: "The failures that taught us",
        cards: [
          [
            "alert-triangle",
            "More dashboards",
            "We built forty. Nobody looked at thirty-eight of them. A dashboard is a question somebody asked once."
          ],
          [
            "alert-triangle",
            "More alerts",
            "We doubled them. On-call muted half within a month. Volume is not signal."
          ],
          [
            "alert-triangle",
            "A war room",
            "We staffed one for a quarter. It made incidents feel handled and did nothing to make them rarer."
          ]
        ]
      }
    ],
    [
      "process",
      {
        eyebrow: "What worked",
        title: "The approach, step by step",
        steps: [
          [
            "One timeline",
            "Every change and every alert in one place. The first week, three incidents explained themselves."
          ],
          [
            "Ten alerts",
            "We kept the ten that had ever paged for a real cause and deleted the rest. Pages fell by 70%."
          ],
          [
            "Change budgets",
            "Any service over its error budget stops deploying until it is back. Nobody argued after the second month."
          ],
          [
            "Narratives, not reviews",
            "The timeline writes the first paragraph. The review became a conversation instead of a blank page."
          ]
        ]
      }
    ],
    [
      "figures",
      {
        eyebrow: "The evidence",
        title: "The numbers from production",
        stats: [
          [
            "−70%",
            "Pages per week",
            "18 months",
            "From 41 to 12, with three times the services."
          ],
          [
            "9 min",
            "Median time to cause",
            "Was 52",
            "Measured from the first alert to the change named in the channel."
          ],
          [
            "99.97%",
            "Uptime",
            "Was 99.6%",
            "Twelve months, every customer-facing service."
          ],
          [
            "0",
            "Weekend deploys",
            "Was 14 a month",
            "Nobody misses them."
          ]
        ]
      }
    ],
    [
      "threeCards",
      {
        eyebrow: "What you should do Monday",
        title: "Three things to try this week",
        cards: [
          [
            "clock",
            "Build the timeline",
            "Even a shared channel where every deploy and every alert is posted. Read it backwards at the next incident."
          ],
          [
            "bolt",
            "Delete an alert",
            "Find one that has never paged for a real cause. Delete it. Tell the team why. Repeat on Tuesday."
          ],
          [
            "message",
            "Write the narrative first",
            "At the next incident, write what happened in three sentences before the review meeting. Watch the meeting get shorter."
          ]
        ]
      }
    ],
    [
      "closing",
      {
        title: "Thank you",
        subtitle: "Slides, the alert audit template and the timeline setup guide are at the link. Find me at the platform track table.",
        rows: [
          [
            "world",
            "novasystems.example/boring"
          ],
          [
            "mail",
            "tomas@novasystems.example"
          ],
          [
            "message",
            "@tomasreyes"
          ]
        ],
        cta: "Get the slides"
      }
    ]
  ]
};
