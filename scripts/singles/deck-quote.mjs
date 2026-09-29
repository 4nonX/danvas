// Quote Slide: one single-slide template. See scripts/gen-single-slides.mjs.

export default {
  id: "deck-quote",
  title: "Quote Slide",
  base: "folio",
  rank: 100,
  tags: [
    "slide",
    "quote"
  ],
  styleTags: [
    "editorial",
    "elegant"
  ],
  meta: {
    company: "Northwind Labs",
    deck: "Q3 business review"
  },
  look: {},
  slides: [
    [
      "quote",
      {
        text: "We don't ship features. We ship outcomes.",
        name: "Priya Nair",
        role: "VP Product, Northwind Labs"
      }
    ]
  ]
};
