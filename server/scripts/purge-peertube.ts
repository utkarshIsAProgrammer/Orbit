/**
 * One-shot purge: remove every PeerTube post from the external feed.
 *
 * PeerTube was removed from the Web feed (sync stopped, source filtered out).
 * This deletes the rows that were synced before the removal, plus the
 * Orbit-native interactions (likes/saves/reposts/comments) that reference
 * them, so nothing orphaned points at deleted posts.
 *
 * Run: npx tsx scripts/purge-peertube.ts
 */
import mongoose from "mongoose";
import { config } from "dotenv";

async function main() {
  config();
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error("MONGO_URI not set");
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 15000 });

  const db = mongoose.connection.db!;
  const postsCol = db.collection("externalposts");

  const peertubeIds = await postsCol
    .find({ source: "peertube" }, { projection: { _id: 1 } })
    .toArray();
  const ids = peertubeIds.map((d) => d._id);
  const idCount = ids.length;

  if (idCount === 0) {
    console.log("No PeerTube posts found — nothing to purge.");
    await mongoose.disconnect();
    return;
  }
  console.log(`Found ${idCount} PeerTube posts.`);

  const postsDeleted = (await postsCol.deleteMany({ _id: { $in: ids } })).deletedCount;

  // Remove Orbit-native interactions referencing the deleted posts.
  const interactions: { collection: string; deleted: number }[] = [];
  for (const name of ["likes", "saves", "reposts", "comments"]) {
    const col = db.collection(name);
    const res = await col.deleteMany({ externalPost: { $in: ids } });
    interactions.push({ collection: name, deleted: res.deletedCount });
  }

  console.log(
    `Deleted ${postsDeleted} PeerTube posts` +
      interactions
        .filter((i) => i.deleted > 0)
        .map((i) => `\n  ${i.collection}: ${i.deleted}`)
        .join(""),
  );
  console.log("Done.");
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
