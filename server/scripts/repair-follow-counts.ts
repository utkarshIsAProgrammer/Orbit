/**
 * Repair stale follower/following counters (one-shot).
 *
 * The Follow collection is the source of truth (the controllers re-sync from
 * it on every follow/unfollow). Users whose counters were left behind by the
 * data purge show a count with an EMPTY list — this reconciles all users.
 *
 * Run: npx tsx scripts/repair-follow-counts.ts
 */
import mongoose from "mongoose";
import { config } from "dotenv";

async function main() {
  config();
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error("MONGO_URI not set");
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 15000 });
  const db = mongoose.connection.db!;
  const users = db.collection("users");
  const follows = db.collection("follows");

  // Users that have a counter field (or any follow docs), to keep the scan cheap.
  const candidateIds = new Set<string>();
  const withCounters = await users
    .find(
      { $or: [{ followersCount: { $gt: 0 } }, { followingCount: { $gt: 0 } }] },
      { projection: { _id: 1 } },
    )
    .toArray();
  for (const u of withCounters) candidateIds.add(u._id.toString());

  const allFollowDocs = await follows.find({}, { projection: { follower: 1, following: 1 } }).toArray();
  for (const f of allFollowDocs) {
    candidateIds.add(f.follower?.toString());
    candidateIds.add(f.following?.toString());
  }

  let fixed = 0;
  let mismatched = 0;
  const ids = [...candidateIds].filter(Boolean);
  console.log(`Reconciling ${ids.length} users...`);

  for (const id of ids) {
    const oid = new mongoose.Types.ObjectId(id);
    const [realFollowers, realFollowing] = await Promise.all([
      follows.countDocuments({ following: oid }),
      follows.countDocuments({ follower: oid }),
    ]);
    const user = await users.findOne({ _id: oid }, { projection: { followersCount: 1, followingCount: 1, username: 1 } });
    if (!user) continue;
    const cur = { f: user.followersCount || 0, g: user.followingCount || 0 };
    if (cur.f !== realFollowers || cur.g !== realFollowing) {
      mismatched++;
      await users.updateOne(
        { _id: oid },
        { $set: { followersCount: realFollowers, followingCount: realFollowing } },
      );
      fixed++;
      console.log(
        `  @${user.username}: followers ${cur.f}->${realFollowers}, following ${cur.g}->${realFollowing}`,
      );
    }
  }

  console.log(`\nDone. ${mismatched} users had mismatched counters, ${fixed} fixed.`);
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error("Failed:", e.message);
  process.exit(1);
});
