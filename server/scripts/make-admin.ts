/**
 * Make a user an admin (and optionally demote).
 *
 * Usage (from server/):
 *   npm run make-admin -- --email you@example.com
 *   npm run make-admin -- --email you@example.com --remove
 *
 * There is deliberately NO self-service "become admin" path in the app —
 * the isAdmin flag is only settable here (or via MongoDB Atlas Data
 * Explorer). After running this, sign out and back in (or reload) so the
 * client picks up the flag and the Admin tab appears in the sidebar.
 */
import { config } from "dotenv";
import { resolve } from "path";
import mongoose from "mongoose";

// Same env-loading pattern as the other scripts.
for (const p of [
  resolve(process.cwd(), "backend/.env"),
  resolve(process.cwd(), ".env"),
  resolve(__dirname, "../.env"),
]) {
  config({ path: p });
}

const args = process.argv.slice(2);
const emailArg = args.find((a) => a.startsWith("--email="))?.split("=")[1];
const remove = args.includes("--remove");
const email = emailArg ?? process.argv[process.argv.indexOf("--email") + 1];

if (!email) {
  console.error(
    "Usage: npm run make-admin -- --email you@example.com [--remove]",
  );
  process.exit(1);
}

async function main() {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error("MONGO_URI not found in .env");
    process.exit(1);
  }

  await mongoose.connect(uri);
  const users = mongoose.connection.db.collection("users");
  const normalized = email.trim().toLowerCase();

  const result = await users.updateOne(
    { email: normalized },
    { $set: { isAdmin: !remove } },
  );

  if (result.matchedCount === 0) {
    console.error(`No user found with email: ${normalized}`);
    process.exit(1);
  }

  const user = await users.findOne(
    { email: normalized },
    { projection: { username: 1, email: 1, isAdmin: 1 } },
  );

  console.log(
    `✅ ${remove ? "Removed admin from" : "Made admin:"} ${user?.username} <${normalized}>`,
  );
  console.log(`   isAdmin is now: ${user?.isAdmin}`);
  console.log("   Reload the app (or sign out/in) — the Admin tab will appear.");

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error("Failed:", err.message);
  process.exit(1);
});
