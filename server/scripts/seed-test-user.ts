/**
 * Seed script: creates a test user for end-to-end tests.
 *
 * Usage (from project root):
 *   npx tsx backend/scripts/seed-test-user.ts
 *
 * OR (from backend/ directory):
 *   npx tsx scripts/seed-test-user.ts
 */


const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
import { config } from "dotenv";
import { resolve } from "path";

// Try loading .env — script can be run from project root or backend/
const possiblePaths = [
  resolve(process.cwd(), "backend/.env"),
  resolve(process.cwd(), ".env"),
  resolve(__dirname, "../.env"),
];
for (const p of possiblePaths) {
  config({ path: p });
}

async function seed() {
  const MONGO_URI = process.env.MONGO_URI;
  if (!MONGO_URI) {
    console.error("MONGO_URI not set — ensure .env exists at project root");
    console.error("CWD:", process.cwd());
    process.exit(1);
  }

  await mongoose.connect(MONGO_URI);
  console.log("Connected to MongoDB");

  const testUser = {
    username: "testuser",
    fullName: "Test User",
    email: "test@orbit.app",
    password: await bcrypt.hash("Test1234!", 10),
    gender: "male",
    bio: "E2E test user",
    profilePic: { url: "", public_id: "" },
    bannerImage: { url: "", public_id: "" },
    followersCount: 0,
    followingCount: 0,
    sharesCount: 0,
    viewsCount: 0,
    pinnedPosts: [],
    loginAttempts: 0,
    lockUntil: null,
  };

  const db = mongoose.connection.db!;
  const users = db.collection("users");

  // Upsert — avoid duplicates on re-run
  const result = await users.updateOne(
    { email: testUser.email },
    { $setOnInsert: testUser },
    { upsert: true },
  );

  if (result.upsertedCount === 1) {
    console.log(`Created test user: ${testUser.email} / Test1234!`);
  } else {
    console.log(`Test user already exists: ${testUser.email}`);
  }

  await mongoose.disconnect();
  console.log("Done");
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
