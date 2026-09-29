// Nonprofit Impact Report: one topic deck. See scripts/gen-topic-decks.mjs.
// base: the library look it starts from; look: overrides on that look;
// slides: [layout, content] in order; a raw slide carries a build function.

export default {
  id: "deck-nonprofit-impact",
  title: "Nonprofit Impact Report",
  base: "terra",
  rank: 74,
  tags: [
    "nonprofit",
    "impact",
    "report",
    "donors"
  ],
  meta: {
    company: "Fernwood Collective",
    deck: "Impact report 2026",
    kicker: "Our year together",
    farewell: "Join us",
    art: {
      cover: "od-loving",
      section: "il-day53-farm",
      picture: "la-house-illustrations",
      closing: "od-strolling"
    }
  },
  look: {},
  slides: [
    [
      "cover",
      {
        title: "Why this\nwork matters",
        subtitle: "The people we reached this year, one story the numbers cannot hold, where every donated dollar went, and the gap we close next.",
        presenter: "Fernwood Collective  ·  Annual report 2026"
      }
    ],
    [
      "figures",
      {
        eyebrow: "The year's impact",
        title: "People reached, outcomes achieved",
        stats: [
          [
            "12,400",
            "People served",
            "+22%",
            "Across food, housing support and the after-school programme."
          ],
          [
            "2,150",
            "Families housed",
            "+18%",
            "Through the rental support fund, all still housed at year end."
          ],
          [
            "840",
            "Young people in the programme",
            "Every weekday",
            "Four sites, two of them new this year."
          ],
          [
            "96%",
            "Programme completion",
            "+3 pts",
            "Of young people who joined in September and stayed to June."
          ]
        ]
      }
    ],
    [
      "quote",
      {
        text: "They did not give us a leaflet. They gave us a week to breathe, and then a plan we could actually follow.",
        name: "Amara, a parent in the housing programme",
        role: "Housed since March 2026, still housed"
      }
    ],
    [
      "chart",
      {
        eyebrow: "Where the money went",
        title: "Programmes, operations and fundraising",
        takeaway: "Eighty-four cents of every dollar reached a programme. Operations stayed under ten.",
        categories: [
          "Food",
          "Housing",
          "Youth",
          "Operations",
          "Fundraising"
        ],
        series: [
          {
            name: "Spend ($K)",
            values: [
              1240,
              1810,
              960,
              430,
              290
            ]
          }
        ],
        calls: [
          [
            "84%",
            "Of every dollar to programmes"
          ],
          [
            "$4.7M",
            "Total spent this year"
          ],
          [
            "9%",
            "Operations, under the target of ten"
          ]
        ]
      }
    ],
    [
      "threeCards",
      {
        eyebrow: "What is next",
        title: "The gap we close next year",
        cards: [
          [
            "home",
            "A fifth youth site",
            "Two hundred more young people on the east side, where the waiting list is longest."
          ],
          [
            "heart",
            "Housing support for 400 more families",
            "The fund runs out in October every year. Next year it runs to December."
          ],
          [
            "user",
            "A second caseworker per site",
            "Caseloads of sixty are too many. Forty is the number every study points to."
          ]
        ]
      }
    ],
    [
      "closing",
      {
        title: "Join us",
        subtitle: "A monthly gift, a volunteer shift, or an introduction to someone who should know about this work. Every one of them counts.",
        rows: [
          [
            "world",
            "fernwood.example/give"
          ],
          [
            "mail",
            "hello@fernwood.example"
          ],
          [
            "phone",
            "+1 415 555 0198"
          ]
        ],
        cta: "Give monthly"
      }
    ]
  ]
};
