import mongoose from "mongoose";
import { config } from "dotenv";
config();

async function main() {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error("MONGO_URI not set");
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 20000 });
  const db = mongoose.connection.db!;

  const total = await db.collection("waitlists").countDocuments();
  console.log(`=== WAITLIST — ${total} total entries ===`);

  const docs = await db
    .collection("waitlists")
    .find({}, { projection: { email: 1, emailKey: 1, name: 1, source: 1, status: 1, createdAt: 1, joinedAt: 1, launchEmailedAt: 1 } })
    .sort({ createdAt: 1 })
    .toArray();

  for (const d of docs) {
    console.log(
      [
        (d.status || "pending").padEnd(8),
        (d.email || "").padEnd(42),
        `key=${(d.emailKey || "-")}`,
        `src=${(d.source || "-")}`,
        `created=${d.createdAt ? new Date(d.createdAt).toISOString().slice(0, 16) : "-"}`,
        d.joinedAt ? `joined=${new Date(d.joinedAt).toISOString().slice(0, 16)}` : "",
        d.launchEmailedAt ? "LAUNCH-EMAILED" : "",
      ].join("  "),
    );
  }

  console.log("\n=== STATUS BREAKDOWN ===");
  const byStatus = await db
    .collection("waitlists")
    .aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }, { $sort: { _id: 1 } }])
    .toArray();
  for (const s of byStatus) console.log(`${(s._id || "unset").padEnd(10)} ${s.count}`);

  const usersOnList = await db
    .collection("users")
    .countDocuments({ waitlistPerk: true });
  console.log(`\nUsers in app with waitlistPerk=true: ${usersOnList}`);

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
