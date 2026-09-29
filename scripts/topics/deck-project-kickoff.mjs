// Project Kickoff: one topic deck. See scripts/gen-topic-decks.mjs.
// base: the library look it starts from; look: overrides on that look;
// slides: [layout, content] in order; a raw slide carries a build function.

export default {
  id: "deck-project-kickoff",
  title: "Project Kickoff",
  base: "slate",
  rank: 34,
  tags: [
    "kickoff",
    "project",
    "planning",
    "team"
  ],
  meta: {
    company: "Form & Function",
    deck: "Kickoff: the billing rebuild",
    kicker: "kickoff, billing rebuild",
    farewell: "Working agreements",
    art: {
      cover: "la-working-1",
      section: "il-day10-canvas-stand",
      picture: "la-desk-illustration-2",
      closing: "la-flat-character-illustrations"
    }
  },
  look: {},
  slides: [
    [
      "cover",
      {
        title: "The outcome we\nare hired to deliver",
        subtitle: "Why this project, what done looks like and what we are not doing, the phases, who does what, and the risks we already see.",
        presenter: "Marcus Obi, Project Lead  ·  3 November 2026"
      }
    ],
    [
      "twoColumns",
      {
        eyebrow: "Goals and non-goals",
        title: "What done looks like",
        left: {
          eyebrow: "Goals",
          head: "Invoices that are right the first time",
          lines: [
            "Usage-based billing for every plan",
            "Invoice errors under 0.5%",
            "Finance closes the month in two days"
          ],
          icon: "circle-check"
        },
        right: {
          eyebrow: "Non-goals",
          head: "What we are explicitly not doing",
          lines: [
            "No new pricing tiers this project",
            "No migration of historical invoices",
            "No changes to the customer portal"
          ],
          icon: "circle"
        }
      }
    ],
    [
      "timeline",
      {
        eyebrow: "Scope and milestones",
        title: "Three phases to launch",
        done: 0,
        steps: [
          [
            "Phase one",
            "Foundations",
            "Usage metering, the ledger, and the first end-to-end invoice in staging. Six weeks."
          ],
          [
            "Phase two",
            "The visible wins",
            "Finance dashboard, the new invoice, and ten pilot customers on the new engine. Six weeks."
          ],
          [
            "Phase three",
            "Polish and launch",
            "Every customer migrated, the old engine retired, the runbook signed off. Four weeks."
          ],
          [
            "Review",
            "The retro",
            "What we would do differently, written down before the next project starts."
          ]
        ]
      }
    ],
    [
      "table",
      {
        eyebrow: "Who does what",
        title: "Roles, owners and decision rights",
        cols: [
          "",
          "Owner",
          "Decides",
          "Consulted"
        ],
        rows: [
          [
            "Scope and priorities",
            "Marcus",
            "yes",
            "Finance, Sales"
          ],
          [
            "Architecture",
            "Tomas",
            "yes",
            "Platform"
          ],
          [
            "Invoice design",
            "Aisha",
            "yes",
            "Finance, Support"
          ],
          [
            "Customer migration",
            "Elena",
            "yes",
            "Sales"
          ],
          [
            "Launch go or no-go",
            "Marcus",
            "yes",
            "Everyone above"
          ]
        ]
      }
    ],
    [
      "threeCards",
      {
        eyebrow: "Risks we already see",
        title: "Three risks, with mitigations",
        cards: [
          [
            "alert-triangle",
            "Usage data is wrong at the source",
            "Metering bugs become invoice errors. Mitigation: shadow-bill every customer for a month before cutover."
          ],
          [
            "clock",
            "Finance is busiest at month end",
            "Our launch week collides with their close. Mitigation: launch in the second week of the month, never the first."
          ],
          [
            "user",
            "One person knows the old engine",
            "If Priya is out, nobody can read it. Mitigation: two weeks of pairing in phase one, documented."
          ]
        ]
      }
    ],
    [
      "closing",
      {
        title: "Working agreements",
        subtitle: "Standup at 09:15, demo every other Friday, decisions in the channel within a day, and the plan lives in one place.",
        rows: [
          [
            "message",
            "#billing-rebuild on Slack"
          ],
          [
            "mail",
            "marcus@formfunction.example"
          ],
          [
            "calendar",
            "First demo: 14 November"
          ]
        ],
        cta: "Open the project plan"
      }
    ]
  ]
};
