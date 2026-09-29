// Big Stat Slide: one single-slide template. See scripts/gen-single-slides.mjs.

export default {
  id: "deck-stat",
  title: "Big Stat Slide",
  base: "terra",
  rank: 100,
  tags: [
    "slide",
    "stat",
    "data"
  ],
  styleTags: [
    "warm",
    "bold"
  ],
  meta: {
    company: "Northwind Labs",
    deck: "Q3 business review"
  },
  look: {},
  slides: [
    [
      "bigStat",
      {
        eyebrow: "Revenue impact",
        value: "$1.2M",
        caption: "Added in net-new annual revenue from the redesigned checkout.",
        delta: "+38% on Q1"
      }
    ]
  ]
};
