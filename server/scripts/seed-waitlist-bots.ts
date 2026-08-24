/**
 * seed-waitlist-bots.ts — refresh the production farm AND populate the waitlist.
 *
 * Usage:
 *   MONGO_URI="..." npx tsx scripts/seed-waitlist-bots.ts [count]
 *
 * What it does, in order:
 *   1. Stops the farm (bots go offline, scheduler pauses).
 *   2. Deletes EVERY existing bot (accounts + posts + comments + likes +
 *      follows + glances + messages + simulated communities) so the farm is
 *      rebuilt clean with the latest code (new avatar variety etc.).
 *   3. Seeds `count` fresh bots (default 20) — country-authentic identities,
 *      friend circles with pre-existing bonds, starter posts, circle follows
 *      and one themed community per circle.
 *   4. Adds each new bot to the WAITLIST (name + realistic email) so the
 *      landing page's "X people inside orbit" counter shows real numbers.
 *      No confirmation emails are sent for these entries (direct insert,
 *      status "pending").
 *   5. Re-enables the farm so the deployed scheduler starts driving them.
 */
import mongoose from "mongoose";
import crypto from "crypto";
import { seedBots, stopFarm, startFarm } from "../src/services/bots";
import { Bot } from "../src/models/bot.model";
import { Waitlist } from "../src/models/waitlist.model";
import { canonicalEmail } from "../src/utilities/waitlistGate";
import { logger } from "../src/utilities/logger";

const uri = process.env.MONGO_URI || "";
const count = Math.min(50, Math.max(1, parseInt(process.argv[2] || "20", 10)));

async function main() {
  if (!uri) {
    console.error("Set MONGO_URI first, e.g. MONGO_URI=... npx tsx scripts/seed-waitlist-bots.ts 20");
    process.exit(1);
  }
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 20000 });
  console.log("Connected.");

  // 1. Pause the farm
  await stopFarm();
  console.log("Farm stopped.");

  // 2. Wipe the existing farm
  const existing = await Bot.find({}).select("botId").lean();
  console.log(`Deleting ${existing.length} existing bots…`);
  for (const b of existing) {
    // Direct cleanup (mirrors deleteBot) — simple and fast for small farms.
    await mongoose.model("User").deleteOne({ _id: b.userId });
    await mongoose.model("Post").deleteMany({ author: b.userId });
    await mongoose.model("Comment").deleteMany({ author: b.userId });
    await mongoose.model("Like").deleteMany({ author: b.userId });
    await mongoose.model("Follow").deleteMany({ $or: [{ follower: b.userId }, { following: b.userId }] });
    await mongoose.model("Glimpse").deleteMany({ author: b.userId });
    await mongoose.model("Message").deleteMany({ $or: [{ sender: b.userId }, { recipient: b.userId }] });
    await mongoose.model("Conversation").deleteMany({ participants: b.userId });
    const sims = await mongoose.model("Community").find({ creator: b.userId, isSimulated: true }).select("_id").lean();
    if (sims.length) {
      await mongoose.model("CommunityMessage").deleteMany({ community: { $in: sims.map((s: any) => s._id) } });
      await mongoose.model("Community").deleteMany({ _id: { $in: sims.map((s: any) => s._id) } });
    }
    await mongoose.model("Bot").deleteOne({ botId: b.botId });
  }
  console.log("Old farm cleared.");

  // 3. Seed fresh bots (latest identity/avatar code)
  const result = await seedBots(count);
  console.log(`Seeded ${result.created.length} bots.`);

  // 4. Put the new bots on the waitlist (no emails sent — direct insert)
  const bots = await Bot.find({}).select("username name countryEmoji").lean();
  const emails = new Set<string>();
  for (const b of bots) {
    let email = "";
    do {
      email = `${b.username}@gmail.com`;
    } while (emails.has(email));
    emails.add(email);
    await Waitlist.updateOne(
      { emailKey: canonicalEmail(email) },
      {
        $set: {
          email,
          emailKey: canonicalEmail(email),
          name: b.name,
          source: "landing-page",
          status: "pending",
          unsubToken: crypto.randomBytes(24).toString("hex"),
        },
      },
      { upsert: true },
    );
  }
  const waitlistTotal = await Waitlist.countDocuments();
  console.log(`Added ${bots.length} bots to the waitlist — total waitlist: ${waitlistTotal}`);

  // 5. Turn the farm back on
  const status = await startFarm(5);
  console.log(`Farm ENABLED — intensity ${status.intensity}, ${status.botCount} bots.`);

  await mongoose.disconnect();
  console.log("Done.");
}

main().catch((err) => {
  logger.error("seed-waitlist-bots failed", { error: err.message });
  console.error("Failed:", err.message);
  process.exit(1);
});
