/**
 * reset-content.ts — WIPE the ORBIT database down to just accounts.
 *
 * Keeps:
 *   - `users`      (REAL registered accounts only — bot accounts with
 *                   `bot.*@orbitbot.app` emails are deleted)
 *   - `waitlists`  (all waitlist entries, for launch gating)
 *
 * Deletes ALL documents from every OTHER collection: posts, comments,
 * likes, reposts, saves, follows, blocks, notifications, interactions,
 * conversations, messages, communities, communityMessages, glimpses,
 * bots, botfarms, xp, streaks, reports, moderation, audits, collections,
 * deviceSubscriptions, featureFlags, broadcasts, apiKeys, webhooks, etc.
 * Collection structure + indexes are KEPT (only documents are removed),
 * and the Upstash cache is flushed so deleted data can never resurface
 * from a stale cache entry.
 *
 * SAFETY: defaults to DRY-RUN (prints exactly what would happen and
 * deletes nothing). Pass `--confirm` to actually execute.
 *
 * Run:
 *   npx tsx scripts/reset-content.ts            # dry-run
 *   npx tsx scripts/reset-content.ts --confirm  # actually wipe
 */
import mongoose from "mongoose";
import { config } from "dotenv";
import { resolve } from "path";

for (const p of [
  resolve(process.cwd(), "backend/.env"),
  resolve(process.cwd(), ".env"),
  resolve(__dirname, "../.env"),
]) {
  config({ path: p });
}

const CONFIRM = process.argv.includes("--confirm");

async function main() {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error("MONGO_URI not set");
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 15000 });
  const db = mongoose.connection.db!;

  // ── Collections to preserve wholesale ────────────────────────────────
  const KEEP_COLLECTIONS = new Set(["users", "waitlists"]);

  // ── Bot accounts live INSIDE `users` (created by the bot farm with
  //    `bot.*@orbitbot.app` emails — the canonical marker used by
  //    scripts/inspect-bots.ts). Real users stay untouched. ─────────────
  const usersCol = db.collection("users");
  const totalUsers = await usersCol.countDocuments();
  const botUsers = await usersCol.countDocuments({ email: /@orbitbot\.app$/ });
  const realUsers = totalUsers - botUsers;

  const waitlistsCol = db.collection("waitlists");
  const waitlistCount = await waitlistsCol.countDocuments();

  console.log("=== RESET CONTENT — " + (CONFIRM ? "LIVE (--confirm)" : "DRY-RUN (no changes)") + " ===\n");

  console.log("=== WHAT WILL BE KEPT ===");
  console.log(`  users     : ${realUsers} real accounts kept (${botUsers} bot accounts will be DELETED, of ${totalUsers} total)`);
  console.log(`  waitlists : ${waitlistCount} entries kept\n`);

  console.log("=== COLLECTIONS TO WIPE ===");
  const cols = await db.listCollections().toArray();
  let totalToDelete = 0;
  for (const c of cols.sort((a, b) => a.name.localeCompare(b.name))) {
    const name = c.name;
    if (KEEP_COLLECTIONS.has(name)) continue;
    const n = await db.collection(name).countDocuments();
    if (n > 0) {
      console.log(`  deleteMany  ${name}: ${n} docs`);
      totalToDelete += n;
    }
  }
  console.log(`\n  TOTAL non-user/waitlist documents to delete: ${totalToDelete}`);

  if (!CONFIRM) {
    console.log("\nDry-run complete — nothing was deleted. Re-run with `--confirm` to execute.");
    await mongoose.disconnect();
    return;
  }

  // ── EXECUTE ──────────────────────────────────────────────────────────
  console.log("\n=== EXECUTING ===");

  // 1. Delete bot accounts from users (keep real users)
  const botRes = await usersCol.deleteMany({ email: /@orbitbot\.app$/ });
  console.log(`  users: deleted ${botRes.deletedCount} bot accounts`);

  // 2. Wipe every other collection (keep structure + indexes)
  for (const c of cols.sort((a, b) => a.name.localeCompare(b.name))) {
    const name = c.name;
    if (KEEP_COLLECTIONS.has(name)) continue;
    const n = await db.collection(name).countDocuments();
    if (n > 0) {
      const r = await db.collection(name).deleteMany({});
      console.log(`  ${name}: deleted ${r.deletedCount} docs`);
    }
  }

  // 3. Flush the Upstash cache — stale cached feeds/posts/conversations
  //    referencing deleted data must never resurface. No-op if Redis
  //    isn't configured (dev/test).
  try {
    const { redis } = await import("../src/configs/redis");
    await redis.flushdb();
    console.log("  cache: Upstash Redis flushed");
  } catch (err: any) {
    console.log(`  cache: flush skipped (${err?.message || "no redis"})`);
  }

  // ── Final verification ───────────────────────────────────────────────
  const remainingUsers = await usersCol.countDocuments();
  const remainingReal = await usersCol.countDocuments({ email: { $not: /@orbitbot\.app$/ } });
  const remainingBots = await usersCol.countDocuments({ email: /@orbitbot\.app$/ });
  const remainingWaitlist = await waitlistsCol.countDocuments();
  console.log("\n=== AFTER ===");
  console.log(`  users     : ${remainingUsers} (${remainingReal} real, ${remainingBots} bots)`);
  console.log(`  waitlists : ${remainingWaitlist}`);

  let leftovers = 0;
  for (const c of cols) {
    const name = c.name;
    if (KEEP_COLLECTIONS.has(name)) continue;
    const n = await db.collection(name).countDocuments();
    if (n > 0) {
      console.log(`  LEFTOVER  ${name}: ${n} docs`);
      leftovers += n;
    }
  }
  if (leftovers === 0) console.log("  all other collections: empty ✔");

  await mongoose.disconnect();
  console.log("\nDONE");
}

main().catch((err) => {
  console.error("RESET FAILED:", err.message);
  process.exit(1);
});
