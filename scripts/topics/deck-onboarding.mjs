// Employee Onboarding: one topic deck. See scripts/gen-topic-decks.mjs.
// base: the library look it starts from; look: overrides on that look;
// slides: [layout, content] in order; a raw slide carries a build function.

export default {
  id: "deck-onboarding",
  title: "Employee Onboarding",
  base: "terra",
  rank: 82,
  tags: [
    "onboarding",
    "hr",
    "new hire",
    "welcome"
  ],
  meta: {
    company: "Fernwood",
    deck: "Welcome aboard",
    kicker: "We are glad you are here",
    farewell: "Ask anything",
    art: {
      cover: "od-jumping",
      section: "il-day31-sweet-home",
      picture: "la-house-illustrations",
      closing: "od-strolling"
    }
  },
  look: {},
  slides: [
    [
      "cover",
      {
        title: "Welcome to\nFernwood",
        subtitle: "Who we are and how we make money, how we work, your first thirty days, the people to meet, and where to ask anything at all.",
        presenter: "Your first week, with the People team  ·  November 2026"
      }
    ],
    [
      "threeCards",
      {
        eyebrow: "Who we are",
        title: "The mission, and how we make money",
        cards: [
          [
            "heart",
            "The mission",
            "Every community organisation should run on tools as good as any company's. We build them, and we keep them affordable."
          ],
          [
            "coin",
            "How we make money",
            "Subscriptions from organisations over fifty people. Everything under that is free, and always will be."
          ],
          [
            "world",
            "Where we are",
            "One hundred and twelve people in three offices and eleven countries. Most of us work from home two days a week."
          ]
        ]
      }
    ],
    [
      "threeCards",
      {
        eyebrow: "How we work",
        title: "Rituals, tools, and unwritten rules",
        cards: [
          [
            "calendar",
            "Rituals",
            "Monday plan, Wednesday demo, Friday retro. All-hands on the last Friday. Nobody schedules over lunch."
          ],
          [
            "device-desktop",
            "Tools",
            "Slack for talk, the wiki for decisions, the tracker for work. If it is not in one of those, it did not happen."
          ],
          [
            "message",
            "Unwritten rules",
            "Ask in public channels, not DMs. Disagree in the doc, decide in the meeting. Say thank you by name."
          ]
        ]
      }
    ],
    [
      "timeline",
      {
        eyebrow: "Your first 30 days",
        title: "Week by week, what good looks like",
        done: 0,
        steps: [
          [
            "Week 1",
            "Meet and read",
            "Your buddy, your team, your manager. The wiki's welcome page, end to end. No deliverables."
          ],
          [
            "Week 2",
            "Shadow",
            "Sit with support for a day and with a customer call. Ship one small change, with help."
          ],
          [
            "Week 3",
            "Own something small",
            "A ticket, a doc, a customer question. Yours start to finish."
          ],
          [
            "Week 4",
            "Reflect",
            "A thirty-minute chat with your manager: what surprised you, what is unclear, what you want next."
          ]
        ]
      }
    ],
    [
      "team",
      {
        eyebrow: "The people to meet",
        title: "Your map of the org",
        people: [
          [
            "Elena Sato",
            "Chief Executive",
            "Books a coffee with every new hire in the first month. Take her up on it."
          ],
          [
            "Dana Whitfield",
            "People",
            "Your first stop for anything about pay, leave, equipment or how things work."
          ],
          [
            "Tomas Reyes",
            "Engineering",
            "Runs the Wednesday demo. Ask him for the architecture tour."
          ],
          [
            "Aisha Bello",
            "Support",
            "Knows what customers actually ask. Shadow her team in week two."
          ]
        ]
      }
    ],
    [
      "closing",
      {
        title: "Ask anything",
        subtitle: "There are no silly questions in your first month, and very few after that. Your buddy, the People channel, or anyone you pass in the kitchen.",
        rows: [
          [
            "message",
            "#welcome on Slack"
          ],
          [
            "mail",
            "people@fernwood.example"
          ],
          [
            "calendar",
            "Your week-four chat is already booked"
          ]
        ],
        cta: "Open the welcome page"
      }
    ]
  ]
};
