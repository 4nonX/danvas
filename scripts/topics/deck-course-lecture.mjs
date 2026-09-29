// Course Lecture: one topic deck. See scripts/gen-topic-decks.mjs.
// base: the library look it starts from; look: overrides on that look;
// slides: [layout, content] in order; a raw slide carries a build function.

export default {
  id: "deck-course-lecture",
  title: "Course Lecture",
  base: "folio",
  rank: 44,
  tags: [
    "education",
    "lecture",
    "course",
    "teaching"
  ],
  meta: {
    company: "Meridian Institute",
    deck: "Design systems, lecture 4",
    kicker: "Lecture four",
    farewell: "Before next session",
    art: {
      cover: "la-doodle",
      section: "il-day11-blackboard",
      picture: "la-ui-design",
      closing: "la-coffee"
    }
  },
  look: {},
  slides: [
    [
      "cover",
      {
        title: "Tokens: the smallest\nunit of a design system",
        subtitle: "By the end you will be able to name a token, decide what deserves one, and read a system's tokens to predict how it will age.",
        presenterName: "Dr. Priya Raman",
        when: "Thursday, 10:00",
        where: "Room 204"
      }
    ],
    [
      "agenda",
      {
        eyebrow: "Where we left off",
        title: "The three ideas from last time",
        items: [
          [
            "Components are promises",
            "A component is a contract about behaviour, not a picture",
            "Recap"
          ],
          [
            "Variants multiply",
            "Every variant doubles the surface you must test",
            "Recap"
          ],
          [
            "Systems age",
            "The parts nobody owns are the parts that rot",
            "Recap"
          ],
          [
            "Today: tokens",
            "The unit underneath components",
            "New"
          ],
          [
            "Next: theming",
            "How tokens make a second brand cheap",
            "Preview"
          ]
        ],
        card: {
          eyebrow: "Today",
          big: "Wk 4",
          meta: [
            [
              "Reading",
              "Chapter 5, pages 88 to 112"
            ],
            [
              "Exercise",
              "Due Tuesday, in the portal"
            ],
            [
              "Office hours",
              "Wednesday, 14:00"
            ],
            [
              "Recording",
              "Posted by Friday"
            ]
          ]
        }
      }
    ],
    [
      "textPicture",
      {
        eyebrow: "The core concept",
        title: "A token is a named decision",
        points: [
          [
            "The definition, in plain words",
            "A token is a name for a value the system has decided on: the spacing unit, the accent colour, the body size. Components use the name, never the value."
          ],
          [
            "The intuition behind it",
            "When the value changes, every use changes with it. When the name is missing, every use is a separate decision waiting to drift."
          ],
          [
            "The test",
            "If two designers would pick a different value, it deserves a token. If everyone would pick the same one, it does not."
          ]
        ]
      }
    ],
    [
      "process",
      {
        eyebrow: "Worked example",
        title: "One real case, stepped through",
        steps: [
          [
            "The brief",
            "A product with a light and a dark theme, and one accent that must read on both."
          ],
          [
            "Name the decisions",
            "Ground, surface, ink, muted ink, accent, line. Six names, twelve values."
          ],
          [
            "Bind the components",
            "The button uses accent and ink-on-accent. It never mentions a hex."
          ],
          [
            "Flip the theme",
            "Twelve values change, zero components change. That is the whole point."
          ]
        ]
      }
    ],
    [
      "threeCards",
      {
        eyebrow: "Common mistakes",
        title: "Where students usually stumble",
        cards: [
          [
            "alert-triangle",
            "Naming the value, not the decision",
            "'blue-500' is a value with a name. 'accent' is a decision. The first breaks the moment the brand turns green."
          ],
          [
            "alert-triangle",
            "Tokens for everything",
            "Forty spacing tokens is a ruler, not a system. Six is a decision."
          ],
          [
            "alert-triangle",
            "Skipping the on-colours",
            "Every ground needs an ink that reads on it. The dark theme is where this is discovered, expensively."
          ]
        ]
      }
    ],
    [
      "closing",
      {
        title: "Before next session",
        subtitle: "Take any product you use daily and write its six tokens from observation alone. Bring the one you could not name.",
        rows: [
          [
            "world",
            "institute.example/design-systems"
          ],
          [
            "mail",
            "praman@institute.example"
          ],
          [
            "calendar",
            "Office hours: Wednesday, 14:00"
          ]
        ],
        cta: "Open the exercise"
      }
    ]
  ]
};
