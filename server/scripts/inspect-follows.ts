/**
 * Inspect follower/following data consistency (READ-ONLY).
 * Finds users whose counts don't match the Follow collection, and users
 * whose lists would render empty (orphaned/deleted accounts).
 *
 * Run: npx tsx scripts/inspect-follows.ts
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

  // Users with follower/following counts > 0
  const counted = await users
    .find(
      { $or: [{ followersCount: { $gt: 0 } }, { followingCount: { $gt: 0 } }] },
      { projection: { username: 1, fullName: 1, followersCount: 1, followingCount: 1, isPrivate: 1 } },
    )
    .limit(50)
    .toArray();

  console.log(`Users with counts (${counted.length} shown):`);
  for (const u of counted) {
    const [realFollowers, realFollowing] = await Promise.all([
      follows.countDocuments({ following: u._id }),
      follows.countDocuments({ follower: u._id }),
    ]);
    const flag =
      u.followersCount !== realFollowers || u.followingCount !== realFollowing
        ? "  <-- MISMATCH"
        : "";
    console.log(
      `@${u.username} (${u.fullName || ""}) private=${!!u.isPrivate} | user.followers=${u.followersCount} real=${realFollowers} | user.following=${u.followingCount} real=${realFollowing}${flag}`,
    );
  }

  // Orphaned follow docs: follower/following user no longer exists
  const totalFollows = await follows.countDocuments({});
  console.log(`\nTotal follow docs: ${totalFollows}`);
  const sample = await follows.find({}).limit(20).toArray();
  let orphanCount = 0;
  for (const f of sample) {
    const [followerExists, followingExists] = await Promise.all([
      users.countDocuments({ _id: f.follower }),
      users.countDocuments({ _id: f.following }),
    ]);
    if (!followerExists || !followingExists) {
      orphanCount++;
      console.log(
        `ORPHAN follow ${f._id}: follower=${f.follower} exists=${!!followerExists} following=${f.following} exists=${!!followingExists}`,
      );
    }
  }
  console.log(`\nOrphan check on ${sample.length}-doc sample: ${orphanCount} orphaned`);

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error("Failed:", e.message);
  process.exit(1);
});
