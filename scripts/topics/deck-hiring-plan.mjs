// Hiring Plan: one topic deck. See scripts/gen-topic-decks.mjs.
// base: the library look it starts from; look: overrides on that look;
// slides: [layout, content] in order; a raw slide carries a build function.

export default {
  id: "deck-hiring-plan",
  title: "Hiring Plan",
  base: "atlas",
  rank: 68,
  tags: [
    "hiring",
    "recruiting",
    "plan",
    "team"
  ],
  meta: {
    company: "Harbor & Vale",
    deck: "Hiring plan, H1 2027",
    kicker: "Headcount against the roadmap",
    farewell: "The asks",
    art: {
      cover: "la-conversation-illustration",
      section: "il-day62-office-bag",
      picture: "la-woman-working-1",
      closing: "la-working-2"
    }
  },
  look: {},
  slides: [
    [
      "cover",
      {
        title: "Twenty-two roles,\ntwo quarters",
        subtitle: "Each role, its quarter and its why, the funnel math from sourcing to signed, the process with time targets, the risks, and what we need from you.",
        presenter: "Dana Whitfield, Head of People  ·  1 December 2026"
      }
    ],
    [
      "table",
      {
        eyebrow: "The roles",
        title: "Each role, its quarter, and its why",
        cols: [
          "",
          "Q1",
          "Q2",
          "Why"
        ],
        rows: [
          [
            "Engineering",
            "6",
            "4",
            "The platform rebuild and the APAC region"
          ],
          [
            "Sales",
            "3",
            "3",
            "Two new territories, one enterprise pod"
          ],
          [
            "Customer success",
            "2",
            "1",
            "Pods of three for accounts over $100K"
          ],
          [
            "Product and design",
            "1",
            "1",
            "Insights and the mobile app"
          ],
          [
            "Operations",
            "1",
            "0",
            "Finance systems for the billing rebuild"
          ]
        ]
      }
    ],
    [
      "figures",
      {
        eyebrow: "The funnel",
        title: "Pipeline math from sourcing to signed",
        stats: [
          [
            "1,100",
            "Candidates sourced",
            "50 per role",
            "Half from referrals and inbound, half from outreach."
          ],
          [
            "220",
            "First interviews",
            "20%",
            "The screen holds at one in five; recruiters run it in the first week."
          ],
          [
            "44",
            "Final rounds",
            "20%",
            "Two finalists per role, on average, is the healthy number."
          ],
          [
            "22",
            "Offers accepted",
            "85% accept rate",
            "Assumes comp bands hold and two counter-offers lost."
          ]
        ]
      }
    ],
    [
      "process",
      {
        eyebrow: "The process",
        title: "Stages, owners and time targets",
        steps: [
          [
            "Screen",
            "Recruiter, 30 minutes, within five days of applying. Owner: Talent."
          ],
          [
            "Panel",
            "Two hours in one day, never across a week. Owner: hiring manager."
          ],
          [
            "Decision",
            "Debrief within 24 hours, offer or no within 48. Owner: hiring manager."
          ],
          [
            "Close",
            "Offer to signature in seven days; a call from the exec sponsor for every senior role. Owner: People."
          ]
        ]
      }
    ],
    [
      "threeCards",
      {
        eyebrow: "Risks",
        title: "Comp bands, competing offers, and timing",
        cards: [
          [
            "coin",
            "Bands are behind the market",
            "Engineering bands are 8% under the latest survey. Ask: adjust in January, not after the first lost offer."
          ],
          [
            "alert-triangle",
            "Two competing offers per senior role",
            "Every platform candidate is talking to two others. Mitigation: seven-day close, and the sponsor call."
          ],
          [
            "clock",
            "Q1 starts in the quiet weeks",
            "Nobody changes jobs in early January. Sourcing starts in December or Q1 slips."
          ]
        ]
      }
    ],
    [
      "closing",
      {
        title: "The asks",
        subtitle: "Referrals for the six platform roles, four hours a week of interviewer time from every team lead, and the band adjustment approved in January.",
        rows: [
          [
            "mail",
            "dana@harborvale.example"
          ],
          [
            "world",
            "harborvale.example/careers"
          ],
          [
            "calendar",
            "Sourcing starts: 8 December"
          ]
        ],
        cta: "Refer someone"
      }
    ]
  ]
};
