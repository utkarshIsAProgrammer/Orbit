/**
 * inspect-bots.ts — READ-ONLY production inspection for the bot farm.
 *
 * Usage:
 *   MONGO_URI="mongodb+srv://..." npx tsx scripts/inspect-bots.ts
 *
 * Only performs queries — never writes, never deletes. Prints a compact
 * report of the bot farm state: count, per-bot stats, recent activity,
 * simulated communities, farm config and relationship density.
 */
import mongoose from "mongoose";
import { Bot, BotFarm } from "../src/models/bot.model";
import { User } from "../src/models/user.model";
import Post from "../src/models/post.model";
import { Community } from "../src/models/community.model";
import { CommunityMessage } from "../src/models/communityMessage.model";
import { Message } from "../src/models/message.model";

const uri = process.env.MONGO_URI || "";
if (!uri) {
  console.error("Set MONGO_URI first, e.g. MONGO_URI=... npx tsx scripts/inspect-bots.ts");
  process.exit(1);
}

async function main() {
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 20000 });
  console.log("Connected.\n");

  const [botCount, farm, simCommunities] = await Promise.all([
    Bot.countDocuments({}),
    BotFarm.findById("farm").lean(),
    Community.countDocuments({ isSimulated: true }),
  ]);

  console.log("── FARM ──────────────────────────────────────────────");
  console.log(`botCount       : ${botCount}`);
  console.log(`farm enabled   : ${farm?.enabled ?? false}`);
  console.log(`intensity      : ${farm?.intensity ?? "-"}`);
  console.log(`startedAt      : ${farm?.startedAt ? new Date(farm.startedAt).toISOString() : "never"}`);
  console.log(`aiEnabled      : ${!!process.env.GEMINI_API_KEY} (env)`);
  console.log(`recentActions  : ${(farm?.recentActions || []).length}`);
  for (const a of (farm?.recentActions || []).slice(0, 8) as any[]) {
    console.log(`   · ${new Date(a.at).toISOString()} ${a.name} → ${a.action}: ${a.detail}`);
  }

  console.log("\n── SIMULATED COMMUNITIES ─────────────────────────────");
  console.log(`count          : ${simCommunities}`);
  if (simCommunities > 0) {
    const comms = await Community.find({ isSimulated: true })
      .sort({ createdAt: -1 })
      .limit(10)
      .lean();
    for (const c of comms as any[]) {
      console.log(`   · "${c.name}" — ${c.members?.length ?? 0} members, ${(await CommunityMessage.countDocuments({ community: c._id }))} messages`);
    }
  }

  console.log("\n── PER-BOT SUMMARY ───────────────────────────────────");
  const bots = await Bot.find({}).sort({ createdAt: 1 }).lean();
  if (bots.length === 0) {
    console.log("No bots — nothing has been seeded.");
  }
  for (const b of bots as any[]) {
    const country = b.countryEmoji ? `${b.countryEmoji}${b.countryName || b.country}` : b.country || "";
    const migrated = b.migratedTo ? ` (migrated→${b.countryEmoji}${b.countryName})` : "";
    console.log(
      `   @${b.username} (${b.gender}, ${b.age}) [${country}]${migrated} [${b.circleName || "-"}] ` +
        `mood=${(b.mood ?? 0).toFixed(2)} energy=${Math.round((b.energy ?? 0) * 100)}% ` +
        `posts=${b.stats?.posts ?? 0} comments=${b.stats?.comments ?? 0} likes=${b.stats?.likes ?? 0} ` +
        `msgs=${b.stats?.messagesSent ?? 0} glances=${b.stats?.glances ?? 0} follows=${b.stats?.follows ?? 0} ` +
        `bonds=${(b.relationships || []).length} mem=${(b.memory || []).length}`,
    );
  }

  // Activity: bots only exist if their linked User is present
  const botUserIds = (bots as any[])
    .map((b) => b.userId?.toString())
    .filter(Boolean);

  if (botUserIds.length > 0) {
    console.log("\n── RECENT BOT ACTIVITY (last 24h) ────────────────────");
    const since = new Date(Date.now() - 24 * 3600000);
    const [posts24, dms24, commMsgs24] = await Promise.all([
      Post.countDocuments({ author: { $in: botUserIds }, createdAt: { $gt: since } }),
      Message.countDocuments({ sender: { $in: botUserIds }, createdAt: { $gt: since } }),
      CommunityMessage.countDocuments({ sender: { $in: botUserIds }, createdAt: { $gt: since } }),
    ]);
    console.log(`posts in 24h       : ${posts24}`);
    console.log(`DMs sent in 24h    : ${dms24}`);
    console.log(`community msgs 24h : ${commMsgs24}`);

    const sample = await Post.find({ author: { $in: botUserIds } })
      .sort({ createdAt: -1 })
      .limit(3)
      .select("content createdAt")
      .lean();
    for (const p of sample as any[]) {
      console.log(`   · [${new Date(p.createdAt).toISOString()}] ${String(p.content || "").slice(0, 80)}`);
    }
  }

  console.log("\n── REAL USERS ─────────────────────────────────────────");
  console.log(`total users       : ${await User.countDocuments({})}`);
  console.log(`non-bot users     : ${await User.countDocuments({ email: { $not: /@orbitbot\.app$/ } })}`);

  await mongoose.disconnect();
  console.log("\nDone (read-only — nothing was modified).");
}

main().catch((err) => {
  console.error("Inspection failed:", err.message);
  process.exit(1);
});
