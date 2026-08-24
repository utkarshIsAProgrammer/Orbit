/**
 * seed-live.ts — one-time production seed: create bots + start the farm.
 *
 * Usage:
 *   MONGO_URI="..." npx tsx scripts/seed-live.ts [count]
 *
 * Creates `count` bots (default 20) with country-authentic identities,
 * starter posts/follows/communities, then flips the farm to enabled so the
 * deployed scheduler starts driving them (presence, typing, posts, DMs,
 * community chat). Idempotent-safe: unique usernames are checked first.
 */
import mongoose from "mongoose";
import { seedBots } from "../src/services/bots";
import { BotFarm } from "../src/models/bot.model";
import { logger } from "../src/utilities/logger";

const uri = process.env.MONGO_URI || "";
const count = Math.min(50, Math.max(1, parseInt(process.argv[2] || "20", 10)));

async function main() {
  if (!uri) {
    console.error("Set MONGO_URI first, e.g. MONGO_URI=... npx tsx scripts/seed-live.ts 20");
    process.exit(1);
  }
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 20000 });
  console.log(`Connected. Seeding ${count} bots…`);

  const result = await seedBots(count);
  console.log(`Created ${result.created.length} bots: ${result.usernames.join(", ")}`);

  await BotFarm.updateOne(
    { _id: "farm" },
    { $set: { enabled: true, startedAt: Date.now() } },
    { upsert: true },
  );
  console.log("Farm ENABLED — the deployed scheduler will pick it up within a minute.");

  await mongoose.disconnect();
  console.log("Done.");
}

main().catch((err) => {
  logger.error("Live seed failed", { error: err.message });
  console.error("Seed failed:", err.message);
  process.exit(1);
});
