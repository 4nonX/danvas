// Research Readout: one topic deck. See scripts/gen-topic-decks.mjs.
// base: the library look it starts from; look: overrides on that look;
// slides: [layout, content] in order; a raw slide carries a build function.

export default {
  id: "deck-research-readout",
  title: "Research Readout",
  base: "folio",
  rank: 40,
  tags: [
    "research",
    "ux",
    "findings",
    "readout"
  ],
  meta: {
    company: "Meridian Studio",
    deck: "Research readout: onboarding",
    kicker: "Evidence first",
    farewell: "Recommendations",
    art: {
      cover: "la-guy-with-glasses",
      section: "il-day47-chemistry-lab",
      picture: "la-ui-design",
      closing: "la-coffee"
    }
  },
  look: {},
  slides: [
    [
      "cover",
      {
        title: "What we studied,\nand what we found",
        subtitle: "Fourteen new customers, watched through their first week. Three findings, the numbers behind them, and three changes ranked by confidence.",
        presenterName: "Aisha Bello",
        when: "24 October 2026",
        where: "Studio, level 2"
      }
    ],
    [
      "threeCards",
      {
        eyebrow: "The study",
        title: "The question, the method, the participants",
        cards: [
          [
            "search",
            "The question",
            "Why do half of new accounts need a support call before their first report?"
          ],
          [
            "eye",
            "The method",
            "Fourteen moderated sessions, forty-five minutes each, on the participant's own data. Recorded and coded."
          ],
          [
            "user",
            "The participants",
            "Operations leads at companies of 60 to 900 people, six weeks or less into the product."
          ]
        ]
      }
    ],
    [
      "textPicture",
      {
        eyebrow: "Finding one",
        title: "Nobody knew what the first step was",
        points: [
          [
            "What we observed",
            "Eleven of fourteen opened the integrations page, scrolled, and closed it. The grid of forty logos read as a decision, not a step."
          ],
          [
            "What it means for the product",
            "One source, chosen for them, with the others hidden until the first import succeeds."
          ],
          [
            "Confidence",
            "High. It happened in every session where the participant had not read the welcome email."
          ]
        ]
      }
    ],
    [
      "textPicture",
      {
        eyebrow: "Finding two",
        title: "The surprise: they wanted the report before the setup",
        points: [
          [
            "The surprise in the data",
            "Nine participants asked some version of 'can I just see what it looks like?' before connecting anything."
          ],
          [
            "Where it contradicts our assumption",
            "We built for careful configuration. They wanted proof first and were willing to configure after."
          ],
          [
            "Confidence",
            "High. It also matches the support transcripts from the last quarter."
          ]
        ]
      }
    ],
    [
      "textPicture",
      {
        eyebrow: "Finding three",
        title: "The pattern across segments",
        points: [
          [
            "Small teams",
            "Wanted a sample report immediately and forgave rough edges."
          ],
          [
            "Large teams",
            "Wanted a colleague in the room before committing; the invite step mattered more than the import."
          ],
          [
            "Confidence",
            "Medium. Six of the fourteen were large teams, which is a thin base for the second half."
          ]
        ]
      }
    ],
    [
      "figures",
      {
        eyebrow: "What the numbers say",
        title: "The quantitative backdrop",
        stats: [
          [
            "11 days",
            "Median time to first report",
            "All new accounts",
            "From the product analytics, last quarter."
          ],
          [
            "52%",
            "Accounts needing a call",
            "Before the first report",
            "Support tickets tagged onboarding, last quarter."
          ],
          [
            "41%",
            "Wizard completion",
            "Current flow",
            "Of accounts that started the setup wizard."
          ],
          [
            "78%",
            "Preview-first completion",
            "Prototype test",
            "Of the fourteen participants, on the preview-first prototype."
          ]
        ]
      }
    ],
    [
      "process",
      {
        eyebrow: "Recommendations",
        title: "Three changes, ranked by confidence and effort",
        steps: [
          [
            "Preview first",
            "Show the first report before any setup. High confidence, medium effort. Ship first."
          ],
          [
            "One source at a time",
            "Hide the integrations grid until the first import works. High confidence, low effort."
          ],
          [
            "Invite from the preview",
            "Let large teams bring a colleague onto the report itself. Medium confidence, low effort."
          ],
          [
            "Re-test",
            "Fourteen more sessions on the new flow in December, same method, before the general release."
          ]
        ]
      }
    ],
    [
      "closing",
      {
        title: "Questions",
        subtitle: "Session recordings, the coded notes and the prototype are in the research folder. Ask for any clip.",
        rows: [
          [
            "mail",
            "aisha@meridian.example"
          ],
          [
            "world",
            "research.meridian.example/onboarding"
          ],
          [
            "calendar",
            "Re-test: December"
          ]
        ],
        cta: "Open the findings"
      }
    ]
  ]
};
