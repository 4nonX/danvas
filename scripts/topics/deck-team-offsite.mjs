// Team Offsite: one topic deck. See scripts/gen-topic-decks.mjs.
// base: the library look it starts from; look: overrides on that look;
// slides: [layout, content] in order; a raw slide carries a build function.

export default {
  id: "deck-team-offsite",
  title: "Team Offsite",
  base: "terra",
  rank: 66,
  tags: [
    "offsite",
    "team",
    "planning",
    "culture"
  ],
  meta: {
    company: "Fernwood",
    deck: "Team offsite, Q4",
    kicker: "Relaxed, but on purpose",
    farewell: "What we take home",
    art: {
      cover: "il-day96-camping",
      section: "il-day21-lantern",
      picture: "od-chilling",
      closing: "od-strolling"
    }
  },
  look: {},
  slides: [
    [
      "cover",
      {
        title: "Why we are here\nin person",
        subtitle: "Two days, four sessions and one dinner: the state of the team, the conversation we keep avoiding, and next quarter drafted together.",
        presenter: "Hosted by Dana Whitfield  ·  Lakeside Lodge, 5 and 6 November"
      }
    ],
    [
      "agenda",
      {
        eyebrow: "The agenda",
        title: "Two days, four sessions, one dinner",
        items: [
          [
            "State of the team",
            "What the survey said, and what we make of it",
            "60 min"
          ],
          [
            "The big conversation",
            "The one topic we keep avoiding",
            "90 min"
          ],
          [
            "Dinner",
            "No agenda, long table, everyone",
            "Evening"
          ],
          [
            "Planning session",
            "Next quarter, drafted together",
            "3 hours"
          ],
          [
            "Commitments",
            "What each of us takes home",
            "45 min"
          ]
        ],
        card: {
          eyebrow: "The offsite",
          big: "5 Nov",
          meta: [
            [
              "Where",
              "Lakeside Lodge, main hall"
            ],
            [
              "Start",
              "10:00, coffee from 09:30"
            ],
            [
              "Host",
              "Dana Whitfield"
            ],
            [
              "Bring",
              "A hoodie and an opinion"
            ]
          ]
        }
      }
    ],
    [
      "figures",
      {
        eyebrow: "State of the team",
        title: "What the team said in the survey",
        stats: [
          [
            "8.1",
            "Would recommend the team",
            "+0.6 on spring",
            "Highest since the survey started."
          ],
          [
            "6.2",
            "Clarity on priorities",
            "−0.9",
            "The one score that fell. This is the big conversation."
          ],
          [
            "7.8",
            "Manager support",
            "Flat",
            "Consistent across every sub-team."
          ],
          [
            "91%",
            "Response rate",
            "24 of 26",
            "Enough to trust the numbers."
          ]
        ]
      }
    ],
    [
      "statement",
      {
        text: "The topic we keep avoiding: we say yes to everything, and then we quietly drop half of it.",
        source: "The big conversation, session two"
      }
    ],
    [
      "process",
      {
        eyebrow: "Planning session",
        title: "Next quarter, drafted together",
        steps: [
          [
            "Diverge",
            "Everyone writes the three things the quarter must deliver. Twenty minutes, alone, on cards."
          ],
          [
            "Cluster",
            "Cards on the wall, grouped by theme, duplicates merged. No debate yet."
          ],
          [
            "Decide",
            "Dot-vote to five themes. Argue for the sixth if you must; it needs a sponsor."
          ],
          [
            "Own",
            "Each theme gets an owner and a first milestone before we leave the room."
          ]
        ]
      }
    ],
    [
      "closing",
      {
        title: "What we take home",
        subtitle: "One commitment each, written on a card, read aloud, and checked at the December retro.",
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
            "Check-in: December retro"
          ]
        ],
        cta: "See the commitments"
      }
    ]
  ]
};
