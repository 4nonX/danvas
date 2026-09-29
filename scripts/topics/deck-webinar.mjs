// Webinar Deck: one topic deck. See scripts/gen-topic-decks.mjs.
// base: the library look it starts from; look: overrides on that look;
// slides: [layout, content] in order; a raw slide carries a build function.

export default {
  id: "deck-webinar",
  title: "Webinar Deck",
  base: "vanta",
  rank: 86,
  tags: [
    "webinar",
    "online",
    "presentation",
    "marketing"
  ],
  meta: {
    company: "Nova Systems",
    deck: "Webinar: incidents without the scramble",
    kicker: "// live, forty minutes",
    farewell: "// go deeper",
    art: {
      cover: "la-video-call",
      section: "il-day17-walkie-talkie",
      picture: "la-coding-people",
      closing: "la-free-svg-illustrations-robots"
    }
  },
  look: {},
  slides: [
    [
      "cover",
      {
        title: "Incidents without\nthe scramble",
        subtitle: "What changed in the last year, a method you can use on Monday, one real case walked through live, and where to go deeper after today.",
        presenter: "Tomas Reyes and Priya Raman  ·  Live, 28 October, 16:00",
        chips: [
          [
            "40",
            "minutes"
          ],
          [
            "1",
            "live case"
          ],
          [
            "Q&A",
            "at the end"
          ]
        ]
      }
    ],
    [
      "agenda",
      {
        eyebrow: "Agenda",
        title: "Four sections, forty minutes",
        items: [
          [
            "The landscape",
            "What changed in the last year, and why the old runbook broke",
            "8 min"
          ],
          [
            "The method",
            "Correlate, explain, decide: the framework in plain words",
            "10 min"
          ],
          [
            "Live example",
            "One real incident from our own platform, start to finish",
            "15 min"
          ],
          [
            "Q&A",
            "Your questions, and the offer for attendees",
            "7 min"
          ],
          [
            "Recording",
            "In your inbox within the hour",
            "After"
          ]
        ],
        card: {
          eyebrow: "Live",
          big: "28 Oct",
          meta: [
            [
              "Time",
              "16:00, forty minutes"
            ],
            [
              "Hosts",
              "Tomas and Priya"
            ],
            [
              "Questions",
              "In the chat, any time"
            ],
            [
              "Recording",
              "Sent to every registrant"
            ]
          ]
        }
      }
    ],
    [
      "threeCards",
      {
        eyebrow: "The landscape",
        title: "What changed in the last year",
        cards: [
          [
            "database",
            "More systems, fewer people",
            "The median platform team runs three times the services it did in 2023 with the same headcount."
          ],
          [
            "bolt",
            "Deploys every hour",
            "Continuous delivery means the cause of an incident is usually something that changed in the last sixty minutes."
          ],
          [
            "alert-triangle",
            "Alerts nobody reads",
            "Teams told us they mute a third of their alerts. The signal is there; the reading is not."
          ]
        ]
      }
    ],
    [
      "process",
      {
        eyebrow: "The method",
        title: "Correlate, explain, decide",
        steps: [
          [
            "Correlate",
            "Every deploy, config change and alert on one timeline. If it is not on the timeline, it did not happen."
          ],
          [
            "Explain",
            "Read the timeline backwards from the first symptom. The cause is almost always the last change before it."
          ],
          [
            "Decide",
            "Roll back or roll forward, in under five minutes, with the evidence in the channel."
          ],
          [
            "Write it down",
            "The narrative, drafted from the timeline, becomes the review. No blank page on Monday."
          ]
        ]
      }
    ],
    [
      "textPicture",
      {
        eyebrow: "Live example",
        title: "One real incident, walked through",
        points: [
          [
            "14:02",
            "A deploy changes the cache key format. Nothing alerts; the cache simply starts missing."
          ],
          [
            "14:09",
            "P95 latency doubles. The alert fires. The timeline shows one change in the last hour."
          ],
          [
            "14:11",
            "Rollback decided from the timeline alone. Latency recovers by 14:14. The narrative is drafted before the channel calms down."
          ]
        ]
      }
    ],
    [
      "closing",
      {
        title: "Go deeper",
        subtitle: "Every attendee gets the incident playbook and thirty days of the platform with the narrative feature on. Questions now.",
        rows: [
          [
            "world",
            "novasystems.example/webinar"
          ],
          [
            "mail",
            "webinar@novasystems.example"
          ],
          [
            "calendar",
            "Next session: 25 November"
          ]
        ],
        cta: "Claim the thirty days"
      }
    ]
  ]
};
