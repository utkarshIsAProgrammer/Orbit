/**
 * Shared demo-data module for the seed scripts.
 *
 * All the content templates, bios and comments used to populate a realistic
 * local database live here so `seed-comprehensive.ts` and `add-more-users.ts`
 * stay in sync. Every post is first-person, category-tagged, and deliberately
 * written to pass the feed quality gate in `feedService.ts` (no onboarding
 * boilerplate, no shouty caps, no emoji spam) — so a freshly seeded feed looks
 * like real people talking, not "Hello from Alice" filler.
 */

export interface Identity {
  name: string;
  tags: string[];
}

export const IDENTITIES: Identity[] = [
  { name: "Tech & Design", tags: ["tech", "design", "ui", "ux", "coding", "webdev", "ai", "startup", "product"] },
  { name: "Food & Travel", tags: ["food", "travel", "wanderlust", "foodie", "cooking", "photography"] },
  { name: "Music & Art", tags: ["art", "music", "artist", "painting", "photography", "creative", "design"] },
  { name: "Fitness & Wellness", tags: ["fitness", "wellness", "yoga", "gym", "health", "workout"] },
  { name: "Gaming & Entertainment", tags: ["gaming", "entertainment", "anime", "movies", "streaming"] },
  { name: "Finance & Business", tags: ["finance", "business", "entrepreneur", "marketing", "crypto", "stockmarket"] },
  { name: "Science & Nature", tags: ["science", "nature", "environment", "sustainability", "animals", "space"] },
  { name: "Fashion & Lifestyle", tags: ["fashion", "lifestyle", "style", "aesthetic", "minimalist"] },
];

/**
 * Category-tagged post templates. `titles` become the post title + slug;
 * `contents` are the post bodies. Written to feel like real social posts:
 * specific details, opinions, questions, and natural hashtags.
 */
export const CONTENT_TEMPLATES: Record<string, { titles: string[]; contents: string[] }> = {
  "Tech & Design": {
    titles: [
      "We cut our initial bundle from 410KB to 96KB",
      "Dark mode isn't a feature, it's a requirement",
      "Our Figma-to-code pipeline kills handoff",
      "Post-mortem: the queue that ate our API",
      "I open-sourced my component library",
      "The eternal struggle of 'something modern'",
      "Choosing boring tech for our feed service",
      "Why we rebuilt our SaaS pricing",
    ],
    contents: [
      "Spent the weekend migrating our dashboard to server components — the initial bundle dropped from 410KB to 96KB. If you're on the fence about it, the developer experience is finally good enough. Happy to answer questions. #react #webdev #performance",
      "Hot take: dark mode isn't a feature, it's a requirement in 2026. We shipped it last week and accessibility complaints went to zero. Design for contrast, not vibes. #design #a11y #ui",
      "Our design-to-code pipeline just cut handoff time from 3 days to 4 hours. Tokens in, styles out, zero screenshot ping-pong. The designers are now suspicious of the developers. #design #figma #workflow",
      "Writing the post-mortem on last night's outage. The lesson: never let a background job write to the same collection as the API without a backoff strategy. Queue pile-ups are silent killers. #devops #engineering",
      "Just launched my open-source component library: 40 accessible React components, zero dependencies, dark mode built in. Stars are welcome, pull requests are more welcome. #opensource #react #a11y",
      "Client asked for 'something modern'. We shipped glassmorphism and a particle background, and they asked if we could also make the logo bigger. The eternal struggle. #design #webdev #humor",
      "Benchmarked three databases for our new feed service today. The winner isn't the fastest one — it's the one our team can actually debug at 2am. Choose boring tech. #backend #database #engineering",
      "SaaS pricing is broken. I rebuilt ours around one question: does the customer's bill scale with the value they get? Churn dropped 18% in two months. #saas #startup #pricing",
    ],
  },
  "Food & Travel": {
    titles: [
      "First meal in Lisbon",
      "18-hour tonkotsu ramen night",
      "The best street food of 2026 is in Bangalore",
      "Packing for 6 weeks in Southeast Asia",
      "My first focaccia",
      "Floating markets at dawn",
      "The $28 pasta problem",
      "Dinner at a mountain hut in Nepal",
    ],
    contents: [
      "Just landed in Lisbon! First meal: a pastel de nata so good I ordered three more before the coffee arrived. Travel tip — eat where the drivers eat, never where the guidebook suggests. #lisbon #travel #foodie",
      "Homemade ramen night: 18-hour tonkotsu broth, hand-pulled noodles, soft-boiled eggs. Cost me a full Sunday but fed six people for a week. Recipe in the comments. #ramen #cooking #japanesefood",
      "The best street food I've had in 2026 isn't in Bangkok or Mexico City — it's a 2am dosa cart in Bangalore. 40 rupees, and I'm still thinking about it. #streetfood #india #foodie",
      "Packing list for a 6-week Southeast Asia trip: 7kg backpack, one pair of sandals, and the willingness to get lost. You don't need the 'just in case' jacket. #travel #minimalism #backpacking",
      "Made focaccia for the first time today. The 24-hour cold ferment did all the work — I just watched it bloom in the oven. Baking is 90% waiting and 10% magic. #baking #homemade #bread",
      "Visited the floating markets at dawn — the only time you beat both the crowds and the heat. Fresh coconut, mango sticky rice, and the best coffee of the trip. #thailand #travel #food",
      "Review: the new place in town charges $28 for pasta I can make in 15 minutes. Here's my better 20-minute version — pantry pasta, garlic, chili oil. #cooking #recipes #food",
      "Hiked 14km to a mountain hut where the 'restaurant' was one wood stove, a pot of dal, and the best view in the country. Sometimes the best food has no menu at all. #hiking #nepal #travel",
    ],
  },
  "Music & Art": {
    titles: [
      "40 studies of one city street",
      "We recorded our EP for $200",
      "Vinyl hunting in Tokyo",
      "Daily practice, day 214",
      "Why your colors look muddy",
      "A 4-hour focus playlist",
      "Gallery night",
      "Folk cover of a soul classic",
    ],
    contents: [
      "Finished a 3-month painting project today — 40 small studies of the same city street at different times of day. I learned more about light in three months than in three years of tutorials. #art #painting #process",
      "My band recorded our EP in a garage with $200 of gear and one good microphone. The demo is raw, loud, and honest — and honestly I prefer it to the polished version. #music #recording #indie",
      "Vinyl hunting in Tokyo: found a mint pressing of a 1974 jazz record for $6. The owner said it had been sitting unsold for years. Japan's record stores are a time machine. #vinyl #jazz #music",
      "Daily practice, day 214. Twenty minutes of scales before anything else. Progress is invisible until the day it isn't — then you can't remember not being able to play it. #guitar #practice #music",
      "My digital illustration process: rough sketch, value study, then color. Most beginners skip the value study and then wonder why their colors look muddy. #digitalart #illustration #art",
      "Made a playlist for working with the window open at 6am. Four hours of lo-fi, field recordings, and rain — perfect for deep work. Link in bio if you want it. #music #playlist #focus",
      "Gallery night was magical. Three people stopped to tell me my piece made them feel something, and that's the whole point — forgetting the rent and the rejection emails for one evening. #art #exhibition #artistlife",
      "Covered a 60s classic in a completely different genre — turned a soul ballad into a stripped folk version. It's humbling how much the arrangement carries the emotion. #music #cover #arrangement",
    ],
  },
  "Fitness & Wellness": {
    titles: [
      "365 days of movement, done",
      "What your physio actually cares about",
      "Meal prep Sunday",
      "First 5K without stopping",
      "Yoga at sunrise",
      "The scale hasn't moved in 3 weeks",
      "Gym fail of the day",
      "Cold shower experiment, day 30",
    ],
    contents: [
      "365 days of movement, done. No gym membership, no app — just a rule: move for at least 30 minutes every single day. Down 12kg and up a ridiculous amount of energy. #fitness #habits #health",
      "Trainers won't tell you this, but your deadlift PR means nothing if desk posture is wrecking you. My physio gave me three exercises, ten minutes a day, and my back pain is gone in a month. #fitness #mobility #posture",
      "Meal prep Sunday: five lunches, five dinners. Oven full, containers stacked, future me is very grateful. The 90 minutes of effort pays for itself by Wednesday. #mealprep #nutrition #fitness",
      "First 5K without stopping! Started the couch-to-5K program exactly nine weeks ago as a complete non-runner. If my knees can do it, anyone can. #running #c25k #beginner",
      "Yoga at sunrise is my favorite hack — the mats are empty at 6am, the light is gold, and the room is quiet. Best 45 minutes of my day. #yoga #wellness #morningroutine",
      "The scale hasn't moved in three weeks but my jeans fit better and my resting heart rate dropped 6bpm. Stop worshipping the scale — track how you feel, how you sleep, how you climb stairs. #fitness #health",
      "Gym fail of the day: went to grab the 'light' dumbbells, they were 20kg, and my ego is in a sling. Re-racked them with dignity. Form over everything. #gym #fitness #fail",
      "Cold shower experiment, day 30. Not a miracle cure, but my mornings are ten times more awake and I haven't hit snooze once. Small discomfort, outsized discipline dividends. #wellness #habits",
    ],
  },
  "Gaming & Entertainment": {
    titles: [
      "40 hours in the new metroidvania",
      "Anime of the season isn't debatable",
      "I built my first mechanical keyboard",
      "The sequel everyone hated",
      "Streaming tonight with the old crew",
      "Board game night got personal",
      "My retro collection hit 30 systems",
      "The platinum trophy that took 60 hours",
    ],
    contents: [
      "Finished the new indie metroidvania everyone's talking about — 40 hours, zero fast travel, zero hand-holding, and 100% worth it. If you like getting lost in a good map, play it. #gaming #metroidvania #indiegames",
      "Anime of the season isn't debatable for me — the character writing is on another level. Skipped sleep twice this week for new episodes. No regrets. #anime #recommendations",
      "Built my first mechanical keyboard today. Lubed switches, tape-modded the case, and now every keystroke sounds like a tiny applause. My typing speed went up 15 for no real reason. #keyboards #setup #gaming",
      "Hot take: the movie sequel everyone hated is actually a masterpiece if you watch it as a standalone thriller. Saw it twice in theaters. Fight me in the comments. #movies #film #hottake",
      "Streaming tonight at 8pm — playing the co-op game that got our friend group through lockdown, nostalgia run with the original crew. Come hang out. #streaming #gaming #community",
      "Game night organized: six players, one board game about Mediterranean trading, zero phones allowed. The trash talk got personal by round three. Highly recommend. #boardgames #gamenight",
      "My retro console collection just hit 30 systems. The CRT hum is the most nostalgic sound in existence. Bonus: my nephew is convinced the graphics are 'a vibe'. #retrogaming #collection",
      "Completed the platinum trophy — 100% achievements, all collectibles, all difficulty runs. The final 2% took 60 hours. Was it worth it? Ask me after I recover. #gaming #platinum #achievements",
    ],
  },
  "Finance & Business": {
    titles: [
      "Year one of freelancing",
      "My boring 3-bucket budget",
      "The features we deleted",
      "Five years of index funds",
      "I negotiated 12% more",
      "Our shop's first profitable month",
      "The side project crossed $1k MRR",
      "Reading my first annual report",
    ],
    contents: [
      "Year one of freelancing: made 30% less than my old salary and learned 300% more. The real paycheck is skills you can't lose — proposals, pricing, and saying no. #freelancing #business #career",
      "Set up a simple three-bucket budget: bills, future, fun. Automate the transfers on payday and spend the rest guilt-free. It's boring, it works, and I've stuck with it for a year. #personalfinance #budgeting",
      "Our startup's lesson this quarter: we killed two features nobody used and revenue went up. The best roadmap move is often deletion, not addition. #startup #product #business",
      "Five years of index funds taught me one thing: the market's best days cluster around its worst days, and you only miss them if you sell. Stay the course. #investing #finance",
      "Negotiation win: asked for 15% more and got 12%. The counter was awkward and my stomach was in knots, but the extra $600 a month compounds into a very comfortable retirement. #salary #negotiation #career",
      "Small business check-in: our shop just had its first profitable month! Eleven months of reinvesting every rupee, two failed product lines, and finally the numbers work. Tomorrow we raise prices. #smallbusiness #entrepreneur",
      "My side project just crossed $1k MRR. It's a tiny niche tool I built in a weekend and improved every month. The lesson: revenue follows solving one boring problem really well. #sidehustle #saas #buildinpublic",
      "Read my first annual report cover to cover this weekend. The red flags were everywhere, all hiding in the footnotes. Financial literacy is the best investment you'll ever make. #investing #learning #finance",
    ],
  },
  "Science & Nature": {
    titles: [
      "Full moon over the ridge",
      "A parking-space-sized harvest",
      "A habitable planet 40 light years away",
      "The birds came back to my street",
      "Released a hawk today",
      "My telescope arrived",
      "Coral cover is up 12%",
      "Two years of composting",
    ],
    contents: [
      "Full moon over the ridge tonight — I stayed out with the camera and a flask of tea, waiting for the light to hit the valley. Some nights the universe is just showing off. #astrophotography #nature #moon",
      "Our community garden harvested 40kg of vegetables this season from a plot the size of a parking space. Soil is the original open source. #gardening #sustainability #urbanfarming",
      "Read about the newest exoplanet discovery — a rocky world in the habitable zone of a red dwarf, 40 light years away. We're closer to answering 'are we alone' than any generation before us. #space #astronomy #science",
      "The birdsong in my city at dawn has genuinely changed since we planted native species along the boulevard. Three years in, the biodiversity is measurable. Small actions, real results. #environment #biodiversity",
      "Volunteered at the wildlife rescue center today and released a hawk that had been in rehab for months. Watching it catch its first thermal of a new life is a feeling I can't describe. #wildlife #animals #conservation",
      "My telescope arrived! First target: Jupiter. Even the blurry phone photo through the eyepiece made me feel five years old again. Clear skies, everyone. #astronomy #telescope #science",
      "The reef survey data from our weekend dive is in — coral cover is up 12% on the protected sites versus the unprotected ones. Marine protected areas aren't a debate, they're data. #ocean #conservation #diving",
      "Two years of composting has cut our household waste by 60% and turned it into the best soil in the neighborhood. The tomatoes disagree with nothing I say. #sustainability #composting #zerowaste",
    ],
  },
  "Fashion & Lifestyle": {
    titles: [
      "Month 6 of my capsule wardrobe",
      "The $12 thrifted coat",
      "One smug shelf of things I use",
      "Home office glow-up",
      "OOTD: the same white tee, three years on",
      "Fabric shavers are the $10 secret",
      "My 5am routine",
      "I sewed my first pair of trousers",
    ],
    contents: [
      "Capsule wardrobe, month 6: 25 items, 3 colors, infinite combinations. The real flex isn't the clothes — it's the 20 minutes saved every morning and the calm in my closet. #capsulewardrobe #minimalism #style",
      "Thrifted this wool coat for $12 and got three compliments in one day. Slow fashion isn't about being poor, it's about being smart. #thrifting #vintage #fashion",
      "Decluttered my apartment this weekend — four bags to charity, two to the recycling center, and one very smug shelf of things I actually use. Space is a luxury you can't buy. #declutter #lifestyle #minimalist",
      "Home office glow-up: one plant, one lamp with warm bulbs, one painting above the desk. My focus improved more than any productivity app ever managed. #homeoffice #interiordesign #lifestyle",
      "OOTD: oversized blazer, straight-leg jeans, and the same plain white tee I've worn for three years. Style is confidence, and confidence is knowing what you like. #ootd #style #fashion",
      "Just discovered fabric shavers are the $10 secret to making every sweater look brand new. My winter wardrobe has a second life. Small tools, big glow-ups. #fashiontips #style",
      "My 5am routine: coffee, journal, 30 minutes of reading, then the day can try me. The quiet hours are my favorite hours. #morningroutine #lifestyle #selfcare",
      "Sewed my first pair of trousers from a pattern — wonky seams, proud heart. Making clothes teaches you to value them. #sewing #slowfashion #diy",
    ],
  },
};

/** Human-sounding comments (generic enough to work on any post). */
export const COMMENT_TEMPLATES: string[] = [
  "Okay this actually made me stop scrolling — bookmarking this.",
  "Saving this for later, thanks for sharing the process!",
  "Legit question: how long did the setup take you?",
  "This is the kind of content I signed up for.",
  "The last point is so underrated, wish more people talked about it.",
  "Tried this last week after seeing your earlier post — worked a charm.",
  "Noted for my next project, appreciate you documenting it.",
  "Strong disagree on this one, but respect the take.",
  "Your photos keep getting better — what did you change?",
  "Adding this to my weekend list immediately.",
  "The details here are excellent, more of this please.",
  "Shared this with my group chat, they loved it too.",
  "What gear do you use for this? Setup pics please!",
  "This deserves way more attention than it's getting.",
  "Finally someone says it. Thank you.",
  "Went down a rabbit hole reading about this after your post — fascinating.",
  "Would love a part two with the actual numbers.",
  "Beautifully written, as always.",
  "Exactly what I needed to read today.",
  "Bold take, but you're right and you should say it.",
];

/** Realistic one-line bios per identity (instead of "X enthusiast!"). */
export const BIO_LINES: Record<string, string[]> = {
  "Tech & Design": [
    "Building things on the web. Strong opinions about dark mode included.",
    "Design engineer. I break layouts so you don't have to.",
    "Shipping products and writing about it. #buildinpublic",
  ],
  "Food & Travel": [
    "Eating my way around the map. Currently: somewhere with good bread.",
    "Home cook, travel junkie. I take food photos before I take bites.",
    "Off to the next city — my luggage is 50% spices.",
  ],
  "Music & Art": [
    "Painter, guitar player, chronic doodler. Making art until it pays rent.",
    "Making music and mistakes in equal measure.",
    "Vinyl collector with too many records and no regrets.",
  ],
  "Fitness & Wellness": [
    "Movement over motivation. 30 minutes a day, every day.",
    "Lifting, stretching, eating well — the boring stuff that works.",
    "Yoga at dawn, strength at noon, recovery always.",
  ],
  "Gaming & Entertainment": [
    "RPGs, retro consoles, and very strong opinions about game soundtracks.",
    "Gamer parent. The kids think the CRT is a vintage vibe.",
    "Achievement hunter. Currently recovering from a platinum.",
  ],
  "Finance & Business": [
    "Freelancer turned founder. Sharing the numbers nobody shows you.",
    "Personal finance for people who hate budgets.",
    "Building in public — revenue, mistakes, and everything between.",
  ],
  "Science & Nature": [
    "Astronomy nerd. Telescope included, patience sold separately.",
    "Biologist by training, hiker by habit. The outdoors is my lab.",
    "Reading science papers so you don't have to.",
  ],
  "Fashion & Lifestyle": [
    "Capsule wardrobes, thrift finds, and the case for owning less.",
    "Slow fashion enthusiast. My closet has a personality.",
    "Designing a calmer life, one decluttered shelf at a time.",
  ],
};

/** Pull the hashtags out of a post body (used to tag posts consistently). */
export function extractHashtags(text: string): string[] {
  const matches = text.match(/#([A-Za-z0-9_]+)/g) || [];
  return matches.map((m) => m.slice(1));
}
