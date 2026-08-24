/**
 * Seed script: creates 3 realistic demo personas (Alice — product designer,
 * Bob — backend engineer, Charlie — wildlife photographer) with category-
 * tagged posts. This replaces the old "Hello from Alice" onboarding filler so
 * a fresh database looks like real people talking.
 *
 * Usage (from project root):
 *   npx tsx backend/scripts/seed-multiple-users.ts
 *
 * OR (from backend/ directory):
 *   npx tsx scripts/seed-multiple-users.ts
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

// Unsplash image URLs for quick testing
const randomProfilePics = [
  "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=400&h=400&fit=crop&crop=face",
  "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=400&h=400&fit=crop&crop=face",
  "https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=400&h=400&fit=crop&crop=face",
];

const randomBannerImages = [
  "https://images.unsplash.com/photo-1497366216548-37526070297c?w=1200&h=400&fit=crop",
  "https://images.unsplash.com/photo-1441974231531-c6227db76b6e?w=1200&h=400&fit=crop",
  "https://images.unsplash.com/photo-1470071459604-3b5ec3a7fe05?w=1200&h=400&fit=crop",
];

const randomPostImages = [
  "https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=800&h=600&fit=crop",
  "https://images.unsplash.com/photo-1469474968028-56623f02e42e?w=800&h=600&fit=crop",
  "https://images.unsplash.com/photo-1472214103451-9374bd1c798e?w=800&h=600&fit=crop",
];

async function seed() {
  const MONGO_URI = process.env.MONGO_URI;
  if (!MONGO_URI) {
    console.error("MONGO_URI not set — ensure .env exists at project root");
    console.error("CWD:", process.cwd());
    process.exit(1);
  }

  await mongoose.connect(MONGO_URI);
  console.log("Connected to MongoDB");

  const db = mongoose.connection.db!;
  const usersCol = db.collection("users");
  const postsCol = db.collection("posts");

  // Clean up legacy "Hello from Alice" filler posts from previous versions of
  // this script — re-running the seed must actually remove the filler, not
  // just add realistic posts alongside it.
  const legacySlugs = ["hello-from-alice", "another-post", "bobs-first-post"];
  const legacyCleanup = await postsCol.deleteMany({
    $or: [
      { slug: { $in: legacySlugs } },
      { content: /Hello from Alice|first post on Orbit|I'm Bob/i },
    ],
  });
  if (legacyCleanup.deletedCount > 0) {
    console.log(`Removed ${legacyCleanup.deletedCount} legacy filler post(s)`);
  }

  const users = [
    {
      username: "alice",
      fullName: "Alice Smith",
      email: "alice@orbit.app",
      password: await bcrypt.hash("Test1234!", 10),
      gender: "female",
      bio: "Product designer. I break layouts so you don't have to.",
      identity: {
        name: "Tech & Design",
        tags: ["tech", "design", "ui", "ux", "coding", "webdev", "ai", "startup", "product"],
      },
      profilePic: { url: randomProfilePics[0], public_id: "alice_profile" },
      bannerImage: { url: randomBannerImages[0], public_id: "alice_banner" },
      followersCount: 0,
      followingCount: 0,
      sharesCount: 0,
      viewsCount: 0,
      pinnedPosts: [],
      loginAttempts: 0,
      lockUntil: null,
      createdAt: new Date(),
    },
    {
      username: "bob",
      fullName: "Bob Johnson",
      email: "bob@orbit.app",
      password: await bcrypt.hash("Test1234!", 10),
      gender: "male",
      bio: "Backend engineer. Choose boring tech.",
      identity: {
        name: "Tech & Design",
        tags: ["tech", "design", "ui", "ux", "coding", "webdev", "ai", "startup", "product"],
      },
      profilePic: { url: randomProfilePics[1], public_id: "bob_profile" },
      bannerImage: { url: randomBannerImages[1], public_id: "bob_banner" },
      followersCount: 0,
      followingCount: 0,
      sharesCount: 0,
      viewsCount: 0,
      pinnedPosts: [],
      loginAttempts: 0,
      lockUntil: null,
      createdAt: new Date(),
    },
    {
      username: "charlie",
      fullName: "Charlie Brown",
      email: "charlie@orbit.app",
      password: await bcrypt.hash("Test1234!", 10),
      gender: "male",
      bio: "Wildlife photographer. Chasing golden hour.",
      identity: {
        name: "Science & Nature",
        tags: ["science", "nature", "environment", "sustainability", "animals", "space"],
      },
      profilePic: { url: randomProfilePics[2], public_id: "charlie_profile" },
      bannerImage: { url: randomBannerImages[2], public_id: "charlie_banner" },
      followersCount: 0,
      followingCount: 0,
      sharesCount: 0,
      viewsCount: 0,
      pinnedPosts: [],
      loginAttempts: 0,
      lockUntil: null,
      createdAt: new Date(),
    },
  ];

  const createdUsers: any[] = [];

  for (const user of users) {
    // First check if user exists
    const existingUser = await usersCol.findOne({ email: user.email });

    if (existingUser) {
      // Update existing user
      await usersCol.updateOne(
        { email: user.email },
        { $set: { profilePic: user.profilePic, bannerImage: user.bannerImage, bio: user.bio, identity: user.identity } }
      );
      console.log(`Updated existing user: ${user.email}`);
      createdUsers.push(existingUser);
    } else {
      // Insert new user
      const result = await usersCol.insertOne(user);
      console.log(`Created user: ${user.email} / Test1234!`);
      createdUsers.push({ ...user, _id: result.insertedId });
    }
  }

  console.log("Created/Retrieved users:", createdUsers.map(u => u.username));

  // Create realistic category-tagged posts for each persona
  const [alice, bob, charlie] = createdUsers;

  const postAt = (hoursAgo: number) => new Date(Date.now() - hoursAgo * 3600000);

  const posts = [
    // ── Alice — product designer ──────────────────────────────────
    {
      title: "Why our team finally moved to a design system",
      content:
        "Three months ago our app had 40 shades of blue across 12 screens. We shipped a design system last week and the inconsistency is finally gone. The hard part wasn't the tokens — it was getting everyone to use them. #design #designsystem #ui",
      hashtags: ["design", "designsystem", "ui"],
      author: alice._id,
      images: [{ url: randomPostImages[0], public_id: "alice_post1" }],
      image: { url: randomPostImages[0], public_id: "alice_post1" },
      likesCount: 0,
      commentsCount: 0,
      repostsCount: 0,
      savesCount: 0,
      viewsCount: 0,
      sharesCount: 0,
      slug: "why-we-moved-to-a-design-system",
      createdAt: postAt(2),
      updatedAt: postAt(2),
    },
    {
      title: "Dark mode wasn't a suggestion",
      content:
        "We shipped dark mode last month and accessibility complaints dropped to zero. Lesson: contrast ratios are not a suggestion, they're a contract with your users. #a11y #design #ui",
      hashtags: ["a11y", "design", "ui"],
      author: alice._id,
      images: [{ url: randomPostImages[1], public_id: "alice_post2" }],
      image: { url: randomPostImages[1], public_id: "alice_post2" },
      likesCount: 0,
      commentsCount: 0,
      repostsCount: 0,
      savesCount: 0,
      viewsCount: 0,
      sharesCount: 0,
      slug: "dark-mode-wasnt-a-suggestion",
      createdAt: postAt(26),
      updatedAt: postAt(26),
    },
    {
      title: "Client brief: make it pop",
      content:
        "New client brief: 'make it pop'. Here is the part where I explain that popping usually means less, not more. The empty space does the work. #design #webdev #humor",
      hashtags: ["design", "webdev", "humor"],
      author: alice._id,
      images: [{ url: randomPostImages[2], public_id: "alice_post3" }],
      image: { url: randomPostImages[2], public_id: "alice_post3" },
      likesCount: 0,
      commentsCount: 0,
      repostsCount: 0,
      savesCount: 0,
      viewsCount: 0,
      sharesCount: 0,
      slug: "client-brief-make-it-pop",
      createdAt: postAt(50),
      updatedAt: postAt(50),
    },

    // ── Bob — backend engineer ────────────────────────────────────
    {
      title: "The queue that ate our API",
      content:
        "Post-mortem is done: our background job retried 40,000 times without backoff and took the whole API down. The fix is 3 lines of code. The lesson is a lot bigger. #devops #engineering #backend",
      hashtags: ["devops", "engineering", "backend"],
      author: bob._id,
      images: [{ url: randomPostImages[1], public_id: "bob_post1" }],
      image: { url: randomPostImages[1], public_id: "bob_post1" },
      likesCount: 0,
      commentsCount: 0,
      repostsCount: 0,
      savesCount: 0,
      viewsCount: 0,
      sharesCount: 0,
      slug: "the-queue-that-ate-our-api",
      createdAt: postAt(4),
      updatedAt: postAt(4),
    },
    {
      title: "Boring tech wins again",
      content:
        "Evaluated three databases for our new feed service and picked the one we can debug at 2am, not the fastest one on a benchmark. Boring tech wins again. #backend #database #engineering",
      hashtags: ["backend", "database", "engineering"],
      author: bob._id,
      images: [{ url: randomPostImages[0], public_id: "bob_post2" }],
      image: { url: randomPostImages[0], public_id: "bob_post2" },
      likesCount: 0,
      commentsCount: 0,
      repostsCount: 0,
      savesCount: 0,
      viewsCount: 0,
      sharesCount: 0,
      slug: "boring-tech-wins-again",
      createdAt: postAt(30),
      updatedAt: postAt(30),
    },

    // ── Charlie — wildlife photographer ───────────────────────────
    {
      title: "Released a hawk today",
      content:
        "Volunteered at the wildlife rescue center and helped release a hawk back into the wild. Watching it catch its first thermal of a new life is a feeling I can't describe. #wildlife #conservation #photography",
      hashtags: ["wildlife", "conservation", "photography"],
      author: charlie._id,
      images: [{ url: randomPostImages[2], public_id: "charlie_post1" }],
      image: { url: randomPostImages[2], public_id: "charlie_post1" },
      likesCount: 0,
      commentsCount: 0,
      repostsCount: 0,
      savesCount: 0,
      viewsCount: 0,
      sharesCount: 0,
      slug: "released-a-hawk-today",
      createdAt: postAt(8),
      updatedAt: postAt(8),
    },
    {
      title: "Golden hour at the lake",
      content:
        "Three hours waiting at the lake for the light to break through the trees. I got one keeper shot, and it's the best one of the year so far. #photography #goldenhour #nature",
      hashtags: ["photography", "goldenhour", "nature"],
      author: charlie._id,
      images: [{ url: randomPostImages[0], public_id: "charlie_post2" }],
      image: { url: randomPostImages[0], public_id: "charlie_post2" },
      likesCount: 0,
      commentsCount: 0,
      repostsCount: 0,
      savesCount: 0,
      viewsCount: 0,
      sharesCount: 0,
      slug: "golden-hour-at-the-lake",
      createdAt: postAt(54),
      updatedAt: postAt(54),
    },
  ];

  for (const post of posts) {
    const existingPost = await postsCol.findOne({ slug: post.slug });
    if (existingPost) {
      await postsCol.updateOne(
        { slug: post.slug },
        { $set: { content: post.content, hashtags: post.hashtags, images: post.images, image: post.image } }
      );
      console.log(`Updated existing post: ${post.title}`);
    } else {
      await postsCol.insertOne(post);
      console.log(`Created post: ${post.title}`);
    }
  }

  // Update user's post counts
  const alicePostCount = await postsCol.countDocuments({ author: alice._id });
  const bobPostCount = await postsCol.countDocuments({ author: bob._id });
  const charliePostCount = await postsCol.countDocuments({ author: charlie._id });

  await usersCol.updateOne({ _id: alice._id }, { $set: { postsCount: alicePostCount } });
  await usersCol.updateOne({ _id: bob._id }, { $set: { postsCount: bobPostCount } });
  await usersCol.updateOne({ _id: charlie._id }, { $set: { postsCount: charliePostCount } });

  await mongoose.disconnect();
  console.log("Done!");
  console.log("\nUsers created/updated:");
  console.log("  Alice: alice@orbit.app / Test1234!");
  console.log("  Bob: bob@orbit.app / Test1234!");
  console.log("  Charlie: charlie@orbit.app / Test1234!");
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
