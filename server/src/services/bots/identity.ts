/**
 * identity.ts — gender-consistent identity generation.
 *
 * Names, profile photos and bios are ALWAYS matched to the bot's gender:
 * a female bot gets a feminine name, a feminine portrait and feminine-flavored
 * bio; a male bot gets the male equivalents. Never mixed.
 */

import { getCountry } from "./countries";
import type { CountryProfile } from "./countries";

export type Gender = "male" | "female";

// Curated gender-matched first names (never cross-used)
export const MALE_NAMES = [
  "Arjun", "Rahul", "Vikram", "Aditya", "Karan", "Rohan", "Aarav", "Ishaan",
  "Dev", "Kabir", "Nikhil", "Siddharth", "Aryan", "Yash", "Harsh", "Manav",
  "Tarun", "Vivek", "Gaurav", "Rajat", "Amit", "Sahil", "Nitin", "Akash",
  "James", "Liam", "Noah", "Ethan", "Lucas", "Mason", "Oliver", "Daniel",
  "Leo", "Henry", "Jack", "Samuel", "Owen", "Caleb", "Ryan", "Tyler",
  "Mateo", "Diego", "Luis", "Carlos", "Miguel", "Hugo", "Marco", "Enzo",
];

export const FEMALE_NAMES = [
  "Priya", "Ananya", "Sneha", "Divya", "Kavya", "Riya", "Isha", "Meera",
  "Aisha", "Neha", "Pooja", "Shreya", "Tara", "Anjali", "Nisha", "Zara",
  "Arya", "Saanvi", "Diya", "Avni", "Kiara", "Myra", "Sara", "Lena",
  "Emma", "Olivia", "Sophia", "Amelia", "Mia", "Isabella", "Ava", "Lily",
  "Chloe", "Grace", "Zoe", "Nora", "Ruby", "Ivy", "Lucy", "Ella",
  "Valentina", "Camila", "Lucia", "Elena", "Sofia", "Marta", "Clara", "Alba",
];

// randomuser.me free portrait API — gender-indexed (women/xx.jpg vs men/xx.jpg)
export function avatarUrl(gender: Gender, seed: number): string {
  const idx = ((seed % 100) + 100) % 100;
  const folder = gender === "female" ? "women" : "men";
  return `https://randomuser.me/api/portraits/${folder}/${idx}.jpg`;
}

// Deterministic PRNG so identities are reproducible per seed
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pick<T>(rand: () => number, arr: T[]): T {
  return arr[Math.floor(rand() * arr.length)] as T;
}

export function randInt(rand: () => number, min: number, max: number): number {
  return Math.floor(rand() * (max - min + 1)) + min;
}

const FEMALE_BIOS = [
  "coffee addict | bookworm | sunset chaser 🌅",
  "slow mornings, good music, even better people ✨",
  "photography, pasta and long walks 🍝📷",
  "just a girl with big dreams and a tiny camera 🎀",
  "dancer first, coder second — both badly 💃",
  "plant mom 🌱 | overthinker | proud introvert",
  "making my little corner of the internet cozy 🏡",
  "kindness is my love language 💌",
  "art, cats, and 3am thoughts 🎨🐱",
  "always laughing at my own jokes 😌",
];

const MALE_BIOS = [
  "gym, code, repeat 💪 | building things that matter",
  "friday night football and saturday morning pancakes 🏈",
  "music producer in training 🎧",
  "just a guy who loves good coffee and better conversations ☕",
  "hiking, gaming and questionable life choices 🎮⛰️",
  "fitness first, everything else later 🏋️",
  "night owl | tech nerd | food enthusiast",
  "living one adventure at a time ✈️",
  "basketball, beats and bad puns 🏀",
  "chasing sunrises and side projects 🌄",
];

const FEMALE_STATUS = ["Busy thriving 🌸", "Chasing dreams", "Good vibes only", "On my coffee era", "Mind full of music"];
const MALE_STATUS = ["Grinding", "In my gym era 💪", "Locked in", "Focus mode", "On my coffee era"];

export function genderBio(gender: Gender, rand: () => number): string {
  return gender === "female" ? pick(rand, FEMALE_BIOS) : pick(rand, MALE_BIOS);
}

export function genderStatus(gender: Gender, rand: () => number): string {
  return gender === "female" ? pick(rand, FEMALE_STATUS) : pick(rand, MALE_STATUS);
}

// ── Country-flavored identity (curated registry) ──────────────────────────

/** Gender-matched name from the country's curated pools. */
export function countryName(country: CountryProfile, gender: Gender, rand: () => number): string {
  return gender === "female" ? pick(rand, country.femaleNames) : pick(rand, country.maleNames);
}

/** Bio that sounds locally authentic (mentions local life, no clichés). */
export function countryBio(country: CountryProfile, rand: () => number): string {
  return pick(rand, country.bioFlavors);
}

/** Status text with a touch of the bot's home country. */
export function countryStatus(country: CountryProfile, gender: Gender, rand: () => number): string {
  const local = pick(rand, [
    `${country.emoji} ${country.greeting}`, 
    `${country.cities[Math.floor(rand() * country.cities.length)]} mode`,
    `Missing home food 🍜`, 
    `${country.emoji} living my best life`,
  ]);
  return gender === "female" ? `${local} ✨` : local;
}

/**
 * Build a username from a name + random digits. Uniqueness is enforced by the
 * caller (checks the User collection + Bot collection and retries).
 */
export function usernameFromName(name: string, rand: () => number): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]/g, "");
  const suffix = randInt(rand, 1000, 99999);
  return `${base}${suffix}`;
}

export interface GeneratedIdentity {
  name: string;
  gender: Gender;
  age: number;
  bio: string;
  avatarUrl: string;
  statusText: string;
}
