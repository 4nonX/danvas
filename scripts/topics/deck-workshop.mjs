// Workshop Facilitation: one topic deck. See scripts/gen-topic-decks.mjs.
// base: the library look it starts from; look: overrides on that look;
// slides: [layout, content] in order; a raw slide carries a build function.

export default {
  id: "deck-workshop",
  title: "Workshop Facilitation",
  base: "pulse",
  rank: 46,
  tags: [
    "workshop",
    "facilitation",
    "exercise",
    "team"
  ],
  meta: {
    company: "Loop",
    deck: "Workshop: the next bet",
    kicker: "Hands on",
    farewell: "Commitments",
    art: {
      cover: "la-notification-woman",
      section: "il-day15-color-tool",
      picture: "la-conversation-illustration",
      closing: "la-scooter"
    }
  },
  look: {},
  slides: [
    [
      "cover",
      {
        title: "What we will\nmake together",
        subtitle: "Three hours, twelve people, one wall of ideas, and a shortlist we all own by the end of the afternoon.",
        presenter: "Facilitated by Mei Lin  ·  15 October 2026",
        year: "Oct"
      }
    ],
    [
      "process",
      {
        eyebrow: "How today works",
        title: "Diverge, discuss, decide",
        steps: [
          [
            "Diverge",
            "Everyone generates alone first. Quantity over quality; judgment comes later."
          ],
          [
            "Discuss",
            "Each group shares back in one minute. Questions only, no rebuttals."
          ],
          [
            "Decide",
            "Dot-vote, cluster, and pick. The room decides; nobody vetoes after."
          ],
          [
            "Commit",
            "Every chosen idea leaves with an owner and a first step."
          ]
        ]
      }
    ],
    [
      "threeCards",
      {
        eyebrow: "Ground rules",
        title: "What keeps it safe and fast",
        cards: [
          [
            "clock",
            "Time boxes are real",
            "When the timer ends, pens down. Unfinished is fine; late is not."
          ],
          [
            "message",
            "Questions before opinions",
            "Ask what someone meant before saying what you think. Most disagreement is misunderstanding."
          ],
          [
            "heart",
            "Every idea gets read aloud",
            "Nothing is skipped because it looks odd on the card. The odd ones are usually the ones we keep."
          ]
        ]
      }
    ],
    [
      "textPicture",
      {
        eyebrow: "Exercise one",
        title: "Twenty ideas in twenty minutes",
        points: [
          [
            "Instructions",
            "One idea per card, a headline and one sentence. Draw if it helps. Write until the timer says stop."
          ],
          [
            "The time box",
            "Twenty minutes alone, then five to pick your best three for the wall."
          ],
          [
            "What good looks like",
            "Specific enough that a stranger could build the first version. 'Better onboarding' is not an idea; 'preview before setup' is."
          ]
        ]
      }
    ],
    [
      "twoColumns",
      {
        eyebrow: "Share back and converge",
        title: "From forty cards to five",
        left: {
          eyebrow: "Share back",
          head: "One minute per group",
          lines: [
            "Headline, sentence, why it matters",
            "Clarifying questions only",
            "The facilitator holds the clock"
          ],
          icon: "microphone"
        },
        right: {
          eyebrow: "Converge",
          head: "Dot-vote and cluster",
          lines: [
            "Three dots each, no more than two on one idea",
            "Cluster the winners by theme",
            "The top five leave with an owner"
          ],
          icon: "circle-check"
        }
      }
    ],
    [
      "closing",
      {
        title: "Commitments",
        subtitle: "Five ideas, five owners, five first steps by next Friday. The wall gets photographed and posted before anyone leaves.",
        rows: [
          [
            "message",
            "#workshop-next-bet on Slack"
          ],
          [
            "mail",
            "mei@loop.example"
          ],
          [
            "calendar",
            "First steps due: 22 October"
          ]
        ],
        cta: "See the shortlist"
      }
    ]
  ]
};
