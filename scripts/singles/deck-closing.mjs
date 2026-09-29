// Closing Slide: one single-slide template. See scripts/gen-single-slides.mjs.

export default {
  id: "deck-closing",
  title: "Closing Slide",
  base: "pulse",
  rank: 20,
  tags: [
    "slide",
    "closing",
    "thanks"
  ],
  styleTags: [
    "bold",
    "modern"
  ],
  meta: {
    company: "Northwind Labs",
    deck: "Q3 business review",
    farewell: "Let's keep talking",
    art: {
      closing: "la-conversation-illustration"
    }
  },
  look: {},
  slides: [
    [
      "closing",
      {
        title: "Thank you",
        subtitle: "Let's keep the conversation going. Questions now, or any time this week.",
        rows: [
          [
            "mail",
            "hello@northwindlabs.example"
          ],
          [
            "world",
            "northwindlabs.example"
          ],
          [
            "phone",
            "+1 415 555 0142"
          ]
        ],
        cta: "Book a follow-up"
      }
    ]
  ]
};
