/**
 * Cap oversized community-message seenBy arrays (one-shot repair).
 *
 * Before the server-side rotation shipped, `seenBy` grew by one entry per
 * member read on every message — a viral message on a big community could
 * carry thousands of ids. The write path now rotates to SEENBY_CAP (200),
 * but arrays that already exceeded the cap stay fat until trimmed. This
 * script slices every oversized array down to the newest SEENBY_CAP ids.
 *
 * Run: npx tsx scripts/cap-seenby.ts
 */
import mongoose from "mongoose";
import { config } from "dotenv";
import { SEENBY_CAP } from "../src/models/communityMessage.model";

async function main() {
  config();
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error("MONGO_URI not set");
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 15000 });

  const db = mongoose.connection.db!;
  const col = db.collection("communitymessages");

  // Find every message whose seenBy exceeds the cap. $expr can't use an
  // index, but this is a one-shot repair on a bounded collection — the
  // projection keeps the scan cheap.
  const oversized = await col
    .find(
      { $expr: { $gt: [{ $size: { $ifNull: ["$seenBy", []] } }, SEENBY_CAP] } },
      { projection: { _id: 1, seenBy: 1 } },
    )
    .toArray();

  console.log(`Found ${oversized.length} messages with seenBy > ${SEENBY_CAP}`);

  let trimmed = 0;
  for (const doc of oversized) {
    const size = (doc.seenBy || []).length;
    // Slice keeps the NEWEST readers — same rotation the write path applies.
    // The raw native driver accepts pipeline updates directly (no
    // updatePipeline flag — that's a Mongoose-model requirement only).
    await col.updateOne(
      { _id: doc._id },
      [{ $set: { seenBy: { $slice: ["$seenBy", -SEENBY_CAP] } } }],
    );
    trimmed++;
    if (trimmed % 100 === 0) {
      console.log(`  trimmed ${trimmed}/${oversized.length} (last: ${size} -> ${SEENBY_CAP})`);
    }
  }

  console.log(`Done. Trimmed ${trimmed} messages.`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
