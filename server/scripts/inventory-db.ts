/**
 * READ-ONLY inventory of the ORBIT database.
 * Reports: collection counts, waitlist status, and user breakdown
 * (seed vs waitlist vs other). Never modifies anything.
 *
 * Run: npx tsx scripts/inventory-db.ts
 */
import mongoose from "mongoose";
import { config } from "dotenv";
config();

async function main() {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error("MONGO_URI not set");
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 15000 });
  const db = mongoose.connection.db!;

  const cols = await db.listCollections().toArray();
  console.log("=== COLLECTION COUNTS ===");
  for (const c of cols.sort((a, b) => a.name.localeCompare(b.name))) {
    const n = await db.collection(c.name).countDocuments();
    console.log(`${n.toString().padStart(6)}  ${c.name}`);
  }

  console.log("\n=== USERS ===");
  const users = await db
    .collection("users")
    .find(
      {},
      {
        projection: {
          username: 1,
          fullName: 1,
          email: 1,
          createdAt: 1,
          isAdmin: 1,
          waitlistPerk: 1,
        },
      },
    )
    .sort({ createdAt: 1 })
    .limit(200)
    .toArray();
  const totalUsers = await db.collection("users").countDocuments();
  console.log(`total users: ${totalUsers}`);
  for (const u of users) {
    const flags = [
      u.isAdmin ? "ADMIN" : null,
      u.waitlistPerk ? "WAITLIST_PERK" : null,
    ]
      .filter(Boolean)
      .join(",");
    console.log(
      `${u.createdAt?.toISOString?.() || "?"}  @${u.username}  ${u.fullName || ""}  ${u.email || ""}  ${flags}`.trim(),
    );
  }

  console.log("\n=== WAITLIST ===");
  const wl = await db
    .collection("waitlists")
    .find({})
    .project({ email: 1, status: 1, createdAt: 1, launchEmailedAt: 1 })
    .sort({ createdAt: 1 })
    .limit(50)
    .toArray();
  const wlTotal = await db.collection("waitlists").countDocuments();
  const wlByStatus = await db
    .collection("waitlists")
    .aggregate([{ $group: { _id: "$status", n: { $sum: 1 } } }])
    .toArray();
  console.log(`total waitlist: ${wlTotal}`);
  console.log("by status:", JSON.stringify(wlByStatus));
  for (const w of wl) {
    console.log(
      `${w.createdAt?.toISOString?.() || "?"}  ${w.status}  ${w.email}${w.launchEmailedAt ? "  LAUNCH-EMAILED" : ""}`,
    );
  }

  // Which users match a waitlist email? (canonical-ish compare)
  console.log("\n=== USERS ON WAITLIST (email match) ===");
  const wlEmails = await db
    .collection("waitlists")
    .find({})
    .project({ email: 1, status: 1 })
    .toArray();
  const wlSet = new Set(
    wlEmails.map((w: any) => String(w.email || "").toLowerCase().trim()),
  );
  const allUsers = await db
    .collection("users")
    .find({})
    .project({ username: 1, email: 1 })
    .toArray();
  let matched = 0;
  for (const u of allUsers as any[]) {
    const e = String(u.email || "").toLowerCase().trim();
    if (wlSet.has(e)) {
      matched++;
      console.log(`MATCH  @${u.username}  ${u.email}`);
    }
  }
  console.log(`matched: ${matched} of ${allUsers.length} users`);

  await mongoose.disconnect();
  console.log("\nDONE (read-only — nothing was deleted)");
}

main().catch((err) => {
  console.error("INVENTORY FAILED:", err.message);
  process.exit(1);
});
