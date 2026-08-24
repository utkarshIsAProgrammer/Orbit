/**
 * countries.ts — curated country registry for bot identities.
 *
 * Every bot belongs to a country, and everything about it — name, bio,
 * cities it references, food it posts about, hashtags, banner — comes from
 * this registry so identities stay locally authentic. Names are curated
 * per country AND per gender (never mixed). Real human portrait photos come
 * from randomuser.me's free pool (gender-matched; the user reviews them
 * after seeding). Banners fall back to seeded picsum landscapes and can be
 * swapped per country via bannerUrls.
 */

export interface CountryProfile {
  code: string; // "IN"
  name: string; // "India"
  emoji: string; // "🇮🇳"
  maleNames: string[];
  femaleNames: string[];
  bioFlavors: string[]; // short flavor fragments for bios
  foods: string[]; // local food to mention
  cities: string[]; // cities to reference in posts
  hashtags: string[]; // country hashtags appended to posts
  interests: string[]; // country-typical interest topics (mapped to template topics)
  greeting: string; // local greeting flavor (e.g. "Namaste", "Hola")
  bannerUrl: string; // stable banner (seeded picsum; swap for curated URLs anytime)
}

const PICSUM = (seed: string) => `https://picsum.photos/seed/${seed}-banner/1200/400`;

export const COUNTRIES: CountryProfile[] = [
  {
    code: "IN",
    name: "India",
    emoji: "🇮🇳",
    maleNames: ["Arjun", "Rohan", "Vikram", "Aditya", "Karan", "Rahul", "Ishaan", "Dev"],
    femaleNames: ["Priya", "Ananya", "Sneha", "Divya", "Kavya", "Riya", "Meera", "Isha"],
    bioFlavors: ["chai, cricket and long commutes 🏏", "biryani enthusiast | weekend wanderer", "cricket on Sundays, movies on Fridays"],
    foods: ["biryani", "chai", "paneer", "golgappa", "dosa", "samosa"],
    cities: ["Mumbai", "Bengaluru", "Delhi", "Pune", "Hyderabad", "Jaipur"],
    hashtags: ["desi", "mumbai", "indianfood", "cricket", "bengaluru"],
    interests: ["cricket", "bollywood", "tech", "startups"],
    greeting: "Namaste",
    bannerUrl: PICSUM("IN"),
  },
  {
    code: "US",
    name: "United States",
    emoji: "🇺🇸",
    maleNames: ["James", "Liam", "Noah", "Ethan", "Lucas", "Mason", "Oliver", "Ryan"],
    femaleNames: ["Emma", "Olivia", "Sophia", "Amelia", "Mia", "Isabella", "Ava", "Lily"],
    bioFlavors: ["brunch, hiking and iced coffee ☕", "coffee first, then everything else", "weekend road trips and farmers markets"],
    foods: ["avocado toast", "pancakes", "burger", "pumpkin spice", "tacos", "mac and cheese"],
    cities: ["Austin", "Seattle", "Denver", "Chicago", "Brooklyn", "Portland"],
    hashtags: ["american", "usa", "weekendvibes", "roadtrip"],
    interests: ["fitness", "startups", "tech", "sports"],
    greeting: "Hey",
    bannerUrl: PICSUM("US"),
  },
  {
    code: "GB",
    name: "United Kingdom",
    emoji: "🇬🇧",
    maleNames: ["Oliver", "Jack", "Harry", "George", "Charlie", "Oscar", "Henry", "Arthur"],
    femaleNames: ["Olivia", "Amelia", "Isla", "Poppy", "Freya", "Grace", "Evie", "Florence"],
    bioFlavors: ["tea first, talk later 🫖", "gym, brews and the football", "drizzly walks and good pints"],
    foods: ["fish and chips", "sunday roast", "yorkshire pudding", "biscuits", "crisps", "scones"],
    cities: ["London", "Manchester", "Leeds", "Bristol", "Glasgow", "Birmingham"],
    hashtags: ["uk", "london", "british", "premierleague"],
    interests: ["football", "music", "movies", "tech"],
    greeting: "Alright",
    bannerUrl: PICSUM("GB"),
  },
  {
    code: "NG",
    name: "Nigeria",
    emoji: "🇳🇬",
    maleNames: ["Chinedu", "Emeka", "Tobi", "Ibrahim", "Segun", "Adewale", "Kelechi", "Yusuf"],
    femaleNames: ["Amara", "Chioma", "Ngozi", "Adaeze", "Zainab", "Temiloluwa", "Ifeoma", "Bisi"],
    bioFlavors: ["jollof debates welcome here 🍛", "afrobeats on full volume", "lagos energy, eko on top"],
    foods: ["jollof rice", "suya", "egusi", "puff puff", "moi moi", "chin chin"],
    cities: ["Lagos", "Abuja", "Ibadan", "Port Harcourt", "Kano", "Enugu"],
    hashtags: ["lagos", "naija", "afrobeats", "jollof", "naijaenergy"],
    interests: ["music", "football", "tech", "startups"],
    greeting: "How far",
    bannerUrl: PICSUM("NG"),
  },
  {
    code: "BR",
    name: "Brazil",
    emoji: "🇧🇷",
    maleNames: ["Lucas", "Matheus", "Gabriel", "Rafael", "Thiago", "Pedro", "Caio", "Bruno"],
    femaleNames: ["Larissa", "Beatriz", "Camila", "Fernanda", "Juliana", "Mariana", "Letícia", "Ana"],
    bioFlavors: ["futebol, feijoada e sol ☀️", "samba no domingo", "praia life and caipirinhas"],
    foods: ["feijoada", "pão de queijo", "brigadeiro", "açaí", "coxinha", "churrasco"],
    cities: ["São Paulo", "Rio de Janeiro", "Salvador", "Belo Horizonte", "Recife", "Curitiba"],
    hashtags: ["brasil", "rio", "samba", "futebol", "brasilidade"],
    interests: ["football", "music", "nature", "food"],
    greeting: "Opa",
    bannerUrl: PICSUM("BR"),
  },
  {
    code: "JP",
    name: "Japan",
    emoji: "🇯🇵",
    maleNames: ["Haruto", "Sota", "Yuto", "Kaito", "Ren", "Daiki", "Riku", "Shota"],
    femaleNames: ["Yui", "Hina", "Sakura", "Aoi", "Rin", "Mio", "Akari", "Mei"],
    bioFlavors: ["ramen, anime e noite ☕", "komorebi chaser 🌿", "quiet mornings, loud arcades"],
    foods: ["ramen", "sushi", "takoyaki", "mochi", "curry", "matcha"],
    cities: ["Tokyo", "Osaka", "Kyoto", "Fukuoka", "Sapporo", "Nagoya"],
    hashtags: ["tokyo", "japan", "ramen", "anime", "japanlife"],
    interests: ["anime", "gaming", "tech", "nature"],
    greeting: "Yoroshiku",
    bannerUrl: PICSUM("JP"),
  },
  {
    code: "PH",
    name: "Philippines",
    emoji: "🇵🇭",
    maleNames: ["Juan", "Miguel", "Rafael", "Jose", "Marco", "Paolo", "Andrei", "Nico"],
    femaleNames: ["Maria", "Angela", "Sofia", "Bianca", "Kaye", "Alyssa", "Camille", "Andrea"],
    bioFlavors: ["adobo is life 🍛", "beach weekends and karaoke nights", "jollibee runs after class"],
    foods: ["adobo", "sinigang", "lechon", "halo-halo", "lumpia", "sisig"],
    cities: ["Manila", "Cebu", "Davao", "Quezon City", "Baguio", "Iloilo"],
    hashtags: ["philippines", "manila", "pinoy", "adobo", "beachlife"],
    interests: ["music", "food", "nature", "gaming"],
    greeting: "Kamusta",
    bannerUrl: PICSUM("PH"),
  },
  {
    code: "DE",
    name: "Germany",
    emoji: "🇩🇪",
    maleNames: ["Lukas", "Felix", "Jonas", "Leon", "Maximilian", "Finn", "Paul", "Niklas"],
    femaleNames: ["Anna", "Lena", "Mia", "Leonie", "Hannah", "Emilia", "Clara", "Johanna"],
    bioFlavors: ["brot, bier und berge 🍺", "pünktlich zum brunch", "wanderlust in the alps"],
    foods: ["currywurst", "schnitzel", "pretzel", "bratwurst", "döner", "spätzle"],
    cities: ["Berlin", "Munich", "Hamburg", "Cologne", "Frankfurt", "Leipzig"],
    hashtags: ["germany", "berlin", "deutschland", "bavaria"],
    interests: ["fitness", "tech", "nature", "coding"],
    greeting: "Hallo",
    bannerUrl: PICSUM("DE"),
  },
  {
    code: "MX",
    name: "Mexico",
    emoji: "🇲🇽",
    maleNames: ["Diego", "Luis", "Carlos", "Miguel", "Javier", "Alejandro", "Fernando", "Jorge"],
    femaleNames: ["Sofia", "Valentina", "Ximena", "Camila", "Mariana", "Daniela", "Lucía", "Regina"],
    bioFlavors: ["tacos y tequila 🌮", "salsa on everything", "futbol, familia y fiesta"],
    foods: ["tacos", "pozole", "chilaquiles", "elote", "mole", "churros"],
    cities: ["Mexico City", "Guadalajara", "Monterrey", "Puebla", "Oaxaca", "Cancún"],
    hashtags: ["mexico", "tacos", "cdmx", "mexicanfood"],
    interests: ["food", "football", "music", "travel"],
    greeting: "Qué onda",
    bannerUrl: PICSUM("MX"),
  },
  {
    code: "ID",
    name: "Indonesia",
    emoji: "🇮🇩",
    maleNames: ["Budi", "Agus", "Dedi", "Rizky", "Andi", "Fajar", "Dimas", "Bayu"],
    femaleNames: ["Siti", "Dewi", "Putri", "Ratna", "Intan", "Ayu", "Nadia", "Lestari"],
    bioFlavors: ["nasi goreng di pagi hari 🍛", "gunung, pantai, kopi ☕", "bali weekends"],
    foods: ["nasi goreng", "sate", "rendang", "gudeg", "bakso", "mie ayam"],
    cities: ["Jakarta", "Bandung", "Surabaya", "Yogyakarta", "Bali", "Medan"],
    hashtags: ["indonesia", "jakarta", "bali", "nusantara"],
    interests: ["nature", "food", "travel", "gaming"],
    greeting: "Halo",
    bannerUrl: PICSUM("ID"),
  },
  {
    code: "FR",
    name: "France",
    emoji: "🇫🇷",
    maleNames: ["Louis", "Hugo", "Lucas", "Gabriel", "Raphaël", "Jules", "Arthur", "Adam"],
    femaleNames: ["Emma", "Jade", "Louise", "Chloé", "Léa", "Manon", "Camille", "Sarah"],
    bioFlavors: ["croissants et café ☕", "flâner dans paris", "fromage à volonté 🧀"],
    foods: ["croissant", "crêpes", "ratatouille", "baguette", "macarons", "fromage"],
    cities: ["Paris", "Lyon", "Marseille", "Toulouse", "Bordeaux", "Nice"],
    hashtags: ["france", "paris", "français", "croissant"],
    interests: ["art", "food", "movies", "design"],
    greeting: "Salut",
    bannerUrl: PICSUM("FR"),
  },
  {
    code: "KR",
    name: "South Korea",
    emoji: "🇰🇷",
    maleNames: ["Min-jun", "Seo-jun", "Ji-ho", "Hyun-woo", "Joon", "Ye-jun", "Tae-yang", "Ji-min"],
    femaleNames: ["Seo-yeon", "Ji-woo", "Ha-eun", "Yu-na", "Min-seo", "Chae-won", "Eun-ji", "Su-ah"],
    bioFlavors: ["kimchi, k-pop e noite 🎧", "ramyeon at 2am", "skincare first 🧴"],
    foods: ["kimchi", "bibimbap", "tteokbokki", "bulgogi", "ramyeon", "bingsu"],
    cities: ["Seoul", "Busan", "Incheon", "Daegu", "Gwangju", "Jeju"],
    hashtags: ["korea", "seoul", "kpop", "koreanfood"],
    interests: ["music", "gaming", "fashion", "art"],
    greeting: "Annyeong",
    bannerUrl: PICSUM("KR"),
  },
];

export function getCountry(code: string): CountryProfile {
  return COUNTRIES.find((c) => c.code === code) || COUNTRIES[0]!;
}

/**
 * UTC offset in hours (can be fractional, e.g. India +5.5) per country code.
 * Lets a bot's sleep/wake cycle and "good morning" posts follow its LOCAL
 * time instead of the server's (Render runs UTC, which made an Indian bot
 * say good morning at 12:30pm local time).
 */
const COUNTRY_UTC_OFFSETS: Record<string, number> = {
  IN: 5.5, // India
  US: -5, // US (Eastern)
  GB: 0, // United Kingdom
  NG: 1, // Nigeria
  BR: -3, // Brazil
  JP: 9, // Japan
  PH: 8, // Philippines
  DE: 1, // Germany
  MX: -6, // Mexico (Central)
  ID: 7, // Indonesia (Western)
  FR: 1, // France
  KR: 9, // South Korea
};

/** The bot's local wall-clock hour (0-23) for a given timestamp. */
export function localHourFor(countryCode: string, now: number): number {
  const offset = COUNTRY_UTC_OFFSETS[countryCode] ?? 0;
  return new Date(now + offset * 3600000).getUTCHours();
}

/** The bot's local weekday (0 = Sunday, 6 = Saturday) for a timestamp. */
export function localDayFor(countryCode: string, now: number): number {
  const offset = COUNTRY_UTC_OFFSETS[countryCode] ?? 0;
  return new Date(now + offset * 3600000).getUTCDay();
}

/** True when it's a weekend (Sat/Sun) in the bot's local timezone. */
export function isWeekendFor(countryCode: string, now: number): boolean {
  const day = localDayFor(countryCode, now);
  return day === 0 || day === 6;
}

/** Country-weighted random pick (bigger countries more common). */
export function randomCountry(): CountryProfile {
  const weights = [22, 18, 10, 10, 8, 6, 5, 5, 5, 4, 4, 3]; // IN, US, GB, NG, BR, JP, PH, DE, MX, ID, FR, KR
  const total = weights.reduce((s, w) => s + w, 0);
  let roll = Math.random() * total;
  for (let i = 0; i < COUNTRIES.length; i++) {
    roll -= weights[i] ?? 1;
    if (roll <= 0) return COUNTRIES[i]!;
  }
  return COUNTRIES[0]!;
}
