// Agenda Slide: one single-slide template. See scripts/gen-single-slides.mjs.

export default {
  id: "deck-agenda",
  title: "Agenda Slide",
  base: "atlas",
  rank: 100,
  tags: [
    "slide",
    "agenda",
    "list"
  ],
  styleTags: [
    "professional",
    "classic"
  ],
  meta: {
    company: "Northwind Labs",
    deck: "Quarterly review"
  },
  look: {},
  slides: [
    [
      "agenda",
      {
        title: "Agenda",
        items: [
          [
            "Where we are today",
            "The quarter's numbers against plan",
            "15 min"
          ],
          [
            "What changed this quarter",
            "Wins, misses and what we learned",
            "20 min"
          ],
          [
            "Priorities for the next 90 days",
            "Three bets, owners and dates",
            "30 min"
          ],
          [
            "Questions and discussion",
            "Open floor",
            "20 min"
          ],
          [
            "Decisions",
            "What we need from this room",
            "5 min"
          ]
        ],
        card: {
          eyebrow: "Quarterly review",
          big: "8 Oct",
          meta: [
            [
              "Time",
              "09:30 to 11:00"
            ],
            [
              "Room",
              "Room 4B"
            ],
            [
              "Host",
              "Dana Whitfield"
            ],
            [
              "Notes",
              "Shared after the session"
            ]
          ]
        }
      }
    ]
  ]
};
