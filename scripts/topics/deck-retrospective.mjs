// Team Retrospective: one topic deck. See scripts/gen-topic-decks.mjs.
// base: the library look it starts from; look: overrides on that look;
// slides: [layout, content] in order; a raw slide carries a build function.

export default {
  id: "deck-retrospective",
  title: "Team Retrospective",
  base: "terra",
  rank: 48,
  tags: [
    "retro",
    "retrospective",
    "team",
    "agile"
  ],
  meta: {
    company: "Fernwood",
    deck: "Retro, sprint 18",
    kicker: "Candid, blameless",
    farewell: "Two changes, two owners",
    art: {
      cover: "od-chilling",
      section: "il-day26-rainbow",
      picture: "la-conversation-illustration",
      closing: "od-strolling"
    }
  },
  look: {},
  slides: [
    [
      "cover",
      {
        title: "The work, the wins,\nthe weather",
        subtitle: "What went well and is worth repeating, what was hard and should be named, the data without judgment, and two changes we commit to.",
        presenter: "Facilitated by Dana Whitfield  ·  18 October 2026"
      }
    ],
    [
      "threeCards",
      {
        eyebrow: "What went well",
        title: "Things worth repeating",
        cards: [
          [
            "heart",
            "Pairing on the hard ticket",
            "Two people, one afternoon, a bug that had been open for three sprints. Keep doing this on purpose."
          ],
          [
            "circle-check",
            "The demo on Wednesday",
            "Showing the customer mid-sprint changed the last three days of work for the better."
          ],
          [
            "sparkles",
            "Nobody worked the weekend",
            "First sprint since July. The scope was right-sized and it showed."
          ]
        ]
      }
    ],
    [
      "twoColumns",
      {
        eyebrow: "What was hard",
        title: "Friction we should name",
        left: {
          eyebrow: "The friction",
          head: "Reviews waited two days",
          lines: [
            "Four pull requests sat untouched",
            "Two people carried all the reviews",
            "One feature missed the sprint because of it"
          ],
          icon: "alert-triangle"
        },
        right: {
          eyebrow: "The other friction",
          head: "The spec changed on Thursday",
          lines: [
            "Sales promised a field we had not built",
            "Half a day lost to the rework",
            "Nobody knew who could say no"
          ],
          icon: "alert-triangle"
        }
      }
    ],
    [
      "figures",
      {
        eyebrow: "The data",
        title: "Cycle time and scope, without judgment",
        stats: [
          [
            "4.2 days",
            "Median cycle time",
            "−0.8 days",
            "Faster than the last three sprints; the small tickets moved quickly."
          ],
          [
            "2.1 days",
            "Review wait",
            "+1.2 days",
            "The one number that got worse. It is the review problem, not the code."
          ],
          [
            "18%",
            "Scope change",
            "+11 pts",
            "Two stories added mid-sprint, one removed."
          ],
          [
            "11 of 12",
            "Stories done",
            "Same as last sprint",
            "The one carried is waiting on the review."
          ]
        ]
      }
    ],
    [
      "twoColumns",
      {
        eyebrow: "Actions",
        title: "Two changes we commit to",
        left: {
          eyebrow: "Change one",
          head: "Reviews first, every morning",
          lines: [
            "Owner: Tomas",
            "Nobody starts new work with a review waiting",
            "Measured: review wait under one day"
          ],
          icon: "circle-check"
        },
        right: {
          eyebrow: "Change two",
          head: "Scope changes go through one person",
          lines: [
            "Owner: Priya",
            "Sales asks Priya, Priya asks the team",
            "Measured: scope change under 10%"
          ],
          icon: "circle-check"
        }
      }
    ],
    [
      "closing",
      {
        title: "Thank you",
        subtitle: "Two changes, two owners, checked at the next retro. Everything said in this room stays about the work.",
        rows: [
          [
            "message",
            "#team-fernwood on Slack"
          ],
          [
            "mail",
            "dana@fernwood.example"
          ],
          [
            "calendar",
            "Next retro: 1 November"
          ]
        ],
        cta: "See the actions"
      }
    ]
  ]
};
