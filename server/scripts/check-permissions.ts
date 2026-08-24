import mongoose from "mongoose";
import { config } from "dotenv";
config();

async function main() {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error("MONGO_URI not set");
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 20000 });
  const db = mongoose.connection.db!;

  const email = (process.argv[2] || "devutkarshya1@gmail.com").toLowerCase();
  const user = await db.collection("users").findOne(
    { email },
    { projection: { email: 1, username: 1, permissionPrefs: 1, permissionOnboardingCompleted: 1, permissionOnboardingCompletedAt: 1 } },
  );

  if (!user) {
    console.log(`No user found for ${email}`);
    await mongoose.disconnect();
    return;
  }

  console.log("=== USER ===");
  console.log(`email:       ${user.email}`);
  console.log(`username:    ${user.username}`);
  console.log(`permissionPrefs:`);
  console.log(JSON.stringify(user.permissionPrefs || {}, null, 2));
  console.log(`permissionOnboardingCompleted: ${user.permissionOnboardingCompleted}`);
  console.log(`permissionOnboardingCompletedAt: ${user.permissionOnboardingCompletedAt || "-"}`);

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
