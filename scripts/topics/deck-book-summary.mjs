// Book Club Summary: one topic deck. See scripts/gen-topic-decks.mjs.
// base: the library look it starts from; look: overrides on that look;
// slides: [layout, content] in order; a raw slide carries a build function.

export default {
  id: "deck-book-summary",
  title: "Book Club Summary",
  base: "folio",
  rank: 78,
  tags: [
    "book",
    "summary",
    "education",
    "discussion"
  ],
  meta: {
    company: "Meridian Studio",
    deck: "Book club, November",
    kicker: "This month's book",
    farewell: "Argue with us",
    art: {
      cover: "la-guy-with-glasses",
      section: "il-day57-reading-room",
      picture: "la-doodle",
      closing: "la-coffee"
    }
  },
  look: {},
  slides: [
    [
      "cover",
      {
        title: "The Slow Company",
        subtitle: "Ines Marlow, 2025. The thesis in one line: the companies that last are the ones that decide slowly and act fast, not the reverse.",
        presenterName: "Aisha Bello",
        when: "19 November 2026",
        where: "Studio kitchen, 18:00"
      }
    ],
    [
      "threeCards",
      {
        eyebrow: "The argument",
        title: "The three claims the book stands on",
        cards: [
          [
            "clock",
            "Deciding is the expensive part",
            "Most companies rush the decision and then spend a year executing the wrong one. Marlow's case studies make it hard to disagree."
          ],
          [
            "compass",
            "Speed belongs after the decision",
            "Once the call is made, the slow company moves faster than anyone, because nobody is relitigating."
          ],
          [
            "user",
            "Slow means few people",
            "A decision made by twelve people is not slow, it is stuck. Slow means two people and a week of real thinking."
          ]
        ]
      }
    ],
    [
      "statement",
      {
        text: "Chapter six is where the book earns its reputation: the story of the firm that waited eleven months to enter a market, and then owned it in two.",
        source: "The best chapter"
      }
    ],
    [
      "twoColumns",
      {
        eyebrow: "The weak spots",
        title: "Where the argument thins",
        left: {
          eyebrow: "Thin",
          head: "Survivorship everywhere",
          lines: [
            "Every example is a company that won",
            "The slow companies that died are absent",
            "Marlow admits it in the afterword, briefly"
          ],
          icon: "alert-triangle"
        },
        right: {
          eyebrow: "Thinner",
          head: "Small companies get one paragraph",
          lines: [
            "The advice assumes a decade of runway",
            "A startup that decides slowly runs out of money",
            "Our own situation is closer to that paragraph"
          ],
          icon: "alert-triangle"
        }
      }
    ],
    [
      "quote",
      {
        text: "Nobody remembers how long the decision took. Everybody remembers whether it was right.",
        name: "Ines Marlow",
        role: "The Slow Company, chapter three"
      }
    ],
    [
      "closing",
      {
        title: "Three questions",
        subtitle: "Which decision are we rushing right now? Which one are we calling slow when it is really stuck? And who are the two people who should make it?",
        rows: [
          [
            "message",
            "#book-club on Slack"
          ],
          [
            "mail",
            "aisha@meridian.example"
          ],
          [
            "calendar",
            "Next book chosen: 26 November"
          ]
        ],
        cta: "Vote for the next book"
      }
    ]
  ]
};
