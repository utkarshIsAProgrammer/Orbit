/**
 * STOP the bot farm (one-shot, mirrors the admin "Stop bots" endpoint).
 *
 * Sets BotFarm.enabled=false + clears startedAt/leader lease. The running
 * scheduler reads the flag fresh every tick and no-ops within one interval
 * (~45s). Re-enable anytime from the Admin Dashboard → Bots.
 *
 * Run: npx tsx scripts/stop-bot-farm.ts
 */
import mongoose from "mongoose";
import { config } from "dotenv";
import { BotFarm } from "../src/models/bot.model";

async function main() {
  config();
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error("MONGO_URI not set");
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 15000 });

  const before = await BotFarm.findById("farm").lean();
  const res = await BotFarm.updateOne(
    { _id: "farm" },
    {
      $set: {
        enabled: false,
        startedAt: null,
        leaderToken: null,
        leaderUntil: null,
      },
    },
    { upsert: true },
  );

  console.log("Bot farm STOPPED.");
  console.log("  matched:", res.matchedCount, "modified:", res.modifiedCount);
  console.log("  was enabled:", before?.enabled, "| now: false");
  console.log("  bots in DB:", await mongoose.connection.db!.collection("bots").countDocuments());

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error("Failed:", e.message);
  process.exit(1);
});
