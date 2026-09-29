// Event Proposal: one topic deck. See scripts/gen-topic-decks.mjs.
// base: the library look it starts from; look: overrides on that look;
// slides: [layout, content] in order; a raw slide carries a build function.

export default {
  id: "deck-event-proposal",
  title: "Event Proposal",
  base: "pulse",
  rank: 72,
  tags: [
    "event",
    "proposal",
    "planning",
    "budget"
  ],
  meta: {
    company: "Loop",
    deck: "Proposal: Loop Live 2027",
    kicker: "Event proposal",
    farewell: "The decision",
    art: {
      cover: "la-notification-woman",
      section: "il-day97-champagne",
      picture: "la-conversation-illustration",
      closing: "la-scooter"
    }
  },
  look: {},
  slides: [
    [
      "cover",
      {
        title: "Loop Live:\none day, four hundred people",
        subtitle: "What it is and who it is for, why now, the arc of the day, the budget and the break-even line, who runs what, and what we need approved today.",
        presenter: "Mei Lin, Marketing  ·  November 2026",
        year: "2027"
      }
    ],
    [
      "statement",
      {
        text: "Our customers have never been in one room. Four hundred finance leaders, one day, and the 2027 plan announced from the stage.",
        source: "Why now: the moment this event captures"
      }
    ],
    [
      "timeline",
      {
        eyebrow: "The experience",
        title: "The arc of the day, doors to encore",
        done: 0,
        steps: [
          [
            "09:00",
            "Doors and coffee",
            "Registration, the product wall, and the first customer conversations of the day."
          ],
          [
            "10:00",
            "The keynote",
            "The 2027 plan, two customer stories on stage, and one launch nobody expects."
          ],
          [
            "13:30",
            "Workshops",
            "Three tracks, forty people each, hands on with their own data."
          ],
          [
            "17:00",
            "The encore",
            "Drinks on the terrace, the band, and the photo everyone posts."
          ]
        ]
      }
    ],
    [
      "figures",
      {
        eyebrow: "Budget",
        title: "Costs, sponsorships, and the break-even line",
        stats: [
          [
            "$380K",
            "Total cost",
            "Venue, production, travel",
            "Fixed once the venue signs; every other line has a cap."
          ],
          [
            "$160K",
            "Sponsorships",
            "Four partners",
            "Two confirmed in principle, two in conversation."
          ],
          [
            "$120K",
            "Ticket revenue",
            "400 at $300",
            "Customers pay; prospects come as guests of their rep."
          ],
          [
            "$100K",
            "Net cost",
            "Break-even at 12 deals",
            "Twelve enterprise deals sourced at the event pays for it."
          ]
        ]
      }
    ],
    [
      "team",
      {
        eyebrow: "The team",
        title: "Who runs what",
        people: [
          [
            "Mei Lin",
            "Event lead",
            "Programme, stage, and the run of show."
          ],
          [
            "Jonah Park",
            "Sponsors and sales",
            "Partners on the floor and every prospect's rep in the room."
          ],
          [
            "Aisha Bello",
            "Experience",
            "Registration, the product wall, workshops and the terrace."
          ],
          [
            "Priya Raman",
            "The keynote",
            "The plan, the launch, and the two customers on stage."
          ]
        ]
      }
    ],
    [
      "closing",
      {
        title: "The decision",
        subtitle: "Approve the venue deposit and the $380K budget today; the venue holds the date until Friday.",
        rows: [
          [
            "mail",
            "mei@loop.example"
          ],
          [
            "file-text",
            "Full budget and venue proposal attached"
          ],
          [
            "calendar",
            "Venue hold expires: Friday"
          ]
        ],
        cta: "Approve the budget"
      }
    ]
  ]
};
