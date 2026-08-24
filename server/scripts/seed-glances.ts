/**
 * Seed script: creates 12 glance demo users (each with a profile picture)
 * and one public 9:16 portrait glance per user so the glance feed row
 * in the app is populated from 12 different users.
 *
 * Usage (from server/):
 *   npx tsx scripts/seed-glances.ts
 */

const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
import { config } from "dotenv";
import { resolve } from "path";

const possiblePaths = [
  resolve(process.cwd(), "backend/.env"),
  resolve(process.cwd(), ".env"),
  resolve(__dirname, "../.env"),
];
for (const p of possiblePaths) {
  config({ path: p });
}

// Portrait (9:16-ish) Unsplash images for the glance media — story style.
const GLANCE_MEDIA = [
  "https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=600&h=1066&fit=crop",
  "https://images.unsplash.com/photo-1469474968028-56623f02e42e?w=600&h=1066&fit=crop",
  "https://images.unsplash.com/photo-1472214103451-9374bd1c798e?w=600&h=1066&fit=crop",
  "https://images.unsplash.com/photo-1519681393784-d120267933ba?w=600&h=1066&fit=crop",
  "https://images.unsplash.com/photo-1470071459604-3b5ec3a7fe05?w=600&h=1066&fit=crop",
  "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=600&h=1066&fit=crop",
  "https://images.unsplash.com/photo-1441974231531-c6227db76b6e?w=600&h=1066&fit=crop",
  "https://images.unsplash.com/photo-1470770841072-f978cf4d019e?w=600&h=1066&fit=crop",
  "https://images.unsplash.com/photo-1447752875215-b2761acb3c5d?w=600&h=1066&fit=crop",
  "https://images.unsplash.com/photo-1476514525535-07fb3b4ae5f1?w=600&h=1066&fit=crop",
  "https://images.unsplash.com/photo-1501854140801-50d01698950b?w=600&h=1066&fit=crop",
  "https://images.unsplash.com/photo-1501785888041-af3ef285b470?w=600&h=1066&fit=crop",
];

// Profile pictures for the 12 users.
const PROFILE_PICS = [
  "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=200&h=200&fit=crop&crop=face",
  "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=200&h=200&fit=crop&crop=face",
  "https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=200&h=200&fit=crop&crop=face",
  "https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=200&h=200&fit=crop&crop=face",
  "https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=200&h=200&fit=crop&crop=face",
  "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200&h=200&fit=crop&crop=face",
  "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=200&h=200&fit=crop&crop=face",
  "https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=200&h=200&fit=crop&crop=face",
  "https://images.unsplash.com/photo-1527980965255-d3b416303d12?w=200&h=200&fit=crop&crop=face",
  "https://images.unsplash.com/photo-1529626455594-4ff0802cfb7e?w=200&h=200&fit=crop&crop=face",
  "https://images.unsplash.com/photo-1509967419530-da38b4704bc6?w=200&h=200&fit=crop&crop=face",
  "https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?w=200&h=200&fit=crop&crop=face",
];

const GLANCE_USERS = [
  { username: "glance_arav", fullName: "Arav Travels", tagline: "Himalaya calling" },
  { username: "glance_meera", fullName: "Meera Visuals", tagline: "Golden hour hunter" },
  { username: "glance_kabir", fullName: "Kabir Lens", tagline: "Chasing light" },
  { username: "glance_noor", fullName: "Noor Diaries", tagline: "Everyday magic" },
  { username: "glance_rhea", fullName: "Rhea Frames", tagline: "Frame by frame" },
  { username: "glance_dev", fullName: "Dev Cam", tagline: "Wander more" },
  { username: "glance_sara", fullName: "Sara Strokes", tagline: "Nature lover" },
  { username: "glance_om", fullName: "Om Outdoors", tagline: "Trail & tale" },
  { username: "glance_tara", fullName: "Tara Pixels", tagline: "Shutter thoughts" },
  { username: "glance_ivan", fullName: "Ivan Aperture", tagline: "Wide open" },
  { username: "glance_liya", fullName: "Liya Shades", tagline: "Soft light" },
  { username: "glance_rohan", fullName: "Rohan Routes", tagline: "Off the map" },
];

const now = Date.now();

async function seed() {
  const MONGO_URI = process.env.MONGO_URI;
  if (!MONGO_URI) {
    console.error("MONGO_URI not set — ensure .env exists");
    process.exit(1);
  }

  await mongoose.connect(MONGO_URI);
  console.log("Connected to MongoDB");

  const db = mongoose.connection.db!;
  const usersCol = db.collection("users");
  const glancesCol = db.collection("glances");

  const password = await bcrypt.hash("Test1234!", 10);
  let created = 0;
  let skipped = 0;

  for (let i = 0; i < GLANCE_USERS.length; i++) {
    const g = GLANCE_USERS[i];
    const exists = await usersCol.findOne({ username: g.username });
    let userId = exists?._id;

    if (!exists) {
      const res = await usersCol.insertOne({
        username: g.username,
        fullName: g.fullName,
        email: `${g.username}@orbit.app`,
        password,
        gender: i % 2 === 0 ? "female" : "male",
        bio: g.tagline,
        profilePic: { url: PROFILE_PICS[i], public_id: `${g.username}_profile` },
        bannerImage: { url: GLANCE_MEDIA[i], public_id: `${g.username}_banner` },
        followersCount: 0,
        followingCount: 0,
        sharesCount: 0,
        viewsCount: 0,
        pinnedPosts: [],
        loginAttempts: 0,
        lockUntil: null,
        createdAt: new Date(now - (11 - i) * 60 * 60 * 1000), // stagger creation
      });
      userId = res.insertedId;
      created++;
    } else {
      skipped++;
    }

    // One public portrait glance per user, staggered timestamps so the row
    // order is stable (newest first).
    const existingGlance = await glancesCol.findOne({ author: userId });
    if (!existingGlance) {
      await glancesCol.insertOne({
        author: userId,
        media: { url: GLANCE_MEDIA[i], public_id: `${g.username}_glance` },
        mediaType: "image",
        viewers: [],
        reactions: [],
        visibility: "public",
        highlighted: false,
        highlightLabel: "",
        highlightOrder: 0,
        expiresAt: new Date(now + 24 * 60 * 60 * 1000), // 24h so they persist
        createdAt: new Date(now - i * 5 * 60 * 1000),
        updatedAt: new Date(),
      });
      console.log(`  + glance for @${g.username} (${g.fullName})`);
    } else {
      console.log(`  = glance already exists for @${g.username}`);
    }
  }

  const totalGlances = await glancesCol.countDocuments({});
  console.log(`\nDone: ${created} users created, ${skipped} existing, ${totalGlances} total glances in DB.`);
  await mongoose.disconnect();
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
