const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
import { config } from "dotenv";
import { resolve } from "path";
import { IDENTITIES, CONTENT_TEMPLATES, COMMENT_TEMPLATES, BIO_LINES, extractHashtags } from "./seed-data";

const possiblePaths = [
  resolve(process.cwd(), "backend/.env"),
  resolve(process.cwd(), ".env"),
  resolve(__dirname, "../.env"),
];
for (const p of possiblePaths) {
  config({ path: p });
}

const random = (arr: any[]) => arr[Math.floor(Math.random() * arr.length)];
const randomInt = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;

const INDIAN_NAMES = [
  { fullName: "Aarav Sharma", gender: "male" },
  { fullName: "Vihaan Patel", gender: "male" },
  { fullName: "Ananya Singh", gender: "female" },
  { fullName: "Diya Gupta", gender: "female" },
  { fullName: "Ishaan Mehta", gender: "male" },
  { fullName: "Aisha Khan", gender: "female" },
  { fullName: "Kabir Joshi", gender: "male" },
  { fullName: "Mira Nair", gender: "female" },
  { fullName: "Arjun Iyer", gender: "male" },
  { fullName: "Naina Reddy", gender: "female" },
  { fullName: "Pranav Desai", gender: "male" },
  { fullName: "Riya Kapoor", gender: "female" },
  { fullName: "Atharv Kulkarni", gender: "male" },
  { fullName: "Sana Malhotra", gender: "female" },
  { fullName: "Dev Shah", gender: "male" },
  { fullName: "Anika Verma", gender: "female" },
  { fullName: "Aditya Saxena", gender: "male" },
  { fullName: "Myra Trivedi", gender: "female" },
  { fullName: "Kunal Jain", gender: "male" },
  { fullName: "Zara Ahmed", gender: "female" },
  { fullName: "Rohan Sinha", gender: "male" },
  { fullName: "Anvi Bhatia", gender: "female" },
  { fullName: "Manan Bhatt", gender: "male" },
  { fullName: "Navya Bansal", gender: "female" },
  { fullName: "Yash Arora", gender: "male" },
  { fullName: "Kiara Kaur", gender: "female" },
  { fullName: "Hrithik Chandra", gender: "male" },
  { fullName: "Aarohi Soni", gender: "female" },
  { fullName: "Vivaan Malviya", gender: "male" },
  { fullName: "Samaira Goenka", gender: "female" },
  { fullName: "Arnav Saxena", gender: "male" },
  { fullName: "Anushka Negi", gender: "female" },
  { fullName: "Kabir Talwar", gender: "male" },
  { fullName: "Sneha Sabharwal", gender: "female" },
  { fullName: "Ayaan Sethi", gender: "male" },
  { fullName: "Ishita Sahni", gender: "female" },
];

const FOREIGN_NAMES = [
  { fullName: "Liam Anderson", gender: "male" },
  { fullName: "Olivia Williams", gender: "female" },
  { fullName: "Noah Johnson", gender: "male" },
  { fullName: "Emma Brown", gender: "female" },
  { fullName: "Oliver Jones", gender: "male" },
  { fullName: "Ava Garcia", gender: "female" },
  { fullName: "Elijah Miller", gender: "male" },
  { fullName: "Charlotte Davis", gender: "female" },
  { fullName: "James Wilson", gender: "male" },
  { fullName: "Amelia Martinez", gender: "female" },
  { fullName: "Benjamin Rodriguez", gender: "male" },
  { fullName: "Sophia Hernandez", gender: "female" },
  { fullName: "Lucas Lopez", gender: "male" },
  { fullName: "Mia Gonzalez", gender: "female" },
  { fullName: "Mason Wright", gender: "male" },
  { fullName: "Isabella Thompson", gender: "female" },
  { fullName: "Logan White", gender: "male" },
  { fullName: "Aria Jackson", gender: "female" },
  { fullName: "Alexander Harris", gender: "male" },
  { fullName: "Scarlett Martin", gender: "female" },
  { fullName: "Sebastian Lee", gender: "male" },
  { fullName: "Harper Thompson", gender: "female" },
  { fullName: "Mateo Lewis", gender: "male" },
  { fullName: "Evelyn Walker", gender: "female" },
  { fullName: "Jack Hall", gender: "male" },
  { fullName: "Luna Allen", gender: "female" },
  { fullName: "Owen Young", gender: "male" },
  { fullName: "Camila King", gender: "female" },
  { fullName: "Wyatt Scott", gender: "male" },
  { fullName: "Layla Green", gender: "female" },
  { fullName: "Carter Adams", gender: "male" },
  { fullName: "Zoe Nelson", gender: "female" },
  { fullName: "Julian Baker", gender: "male" },
  { fullName: "Nora Hill", gender: "female" },
  { fullName: "Levi Ramirez", gender: "male" },
  { fullName: "Hannah Carter", gender: "female" },
];

const DOMAINS = ["gmail.com", "yahoo.com", "outlook.com", "icloud.com", "protonmail.com"];
const PASSWORDS = ["Password123!", "SecurePass456@", "MyPass789#", "Secret101$", "StrongPass202%", "Secure2025^", "MySecret303&", "Secret404*"];

const MALE_PROFILE_PICS = [
  "https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&q=80&w=400",
  "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&q=80&w=400",
  "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&q=80&w=400",
  "https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?auto=format&fit=crop&q=80&w=400",
  "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&q=80&w=400",
  "https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&q=80&w=400",
];

const FEMALE_PROFILE_PICS = [
  "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=400",
  "https://images.unsplash.com/photo-1488426862026-3ee34a7d66df?auto=format&fit=crop&q=80&w=400",
  "https://images.unsplash.com/photo-1438761681033-6461ffad8d80?auto=format&fit=crop&q=80&w=400",
  "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=400",
  "https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?auto=format&fit=crop&q=80&w=400",
  "https://images.unsplash.com/photo-1531746020798-e6953c6e8e04?auto=format&fit=crop&q=80&w=400",
];

const BANNERS = [
  "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&q=80&w=1200",
  "https://images.unsplash.com/photo-1579783900882-c0d3dad7b119?auto=format&fit=crop&q=80&w=1200",
  "https://images.unsplash.com/photo-1634017839464-5c339ebe3cb4?auto=format&fit=crop&q=80&w=1200",
  "https://images.unsplash.com/photo-1451187580459-43490279c0fa?auto=format&fit=crop&q=80&w=1200",
  "https://images.unsplash.com/photo-1506905925346-21bda4d32df4?auto=format&fit=crop&q=80&w=1200",
  "https://images.unsplash.com/photo-1493246507139-91e8fad9978e?auto=format&fit=crop&q=80&w=1200",
  "https://images.unsplash.com/photo-1441974231536-cf4a89f5ebd38?auto=format&fit=crop&q=80&w=1200",
  "https://images.unsplash.com/photo-1469474968028-56623f02e42e?auto=format&fit=crop&q=80&w=1200",
];

const POST_IMAGES = [
  "https://images.unsplash.com/photo-1542751371-adc38448a05e?auto=format&fit=crop&q=80&w=800",
  "https://images.unsplash.com/photo-1511512578047-dfb367046420?auto=format&fit=crop&q=80&w=800",
  "https://images.unsplash.com/photo-1485846234645-a62644f84728?auto=format&fit=crop&q=80&w=800",
  "https://images.unsplash.com/photo-1493246507139-91e8fad9978e?auto=format&fit=crop&q=80&w=800",
  "https://images.unsplash.com/photo-1470071459604-3b5ec3a7fe05?auto=format&fit=crop&q=80&w=800",
  "https://images.unsplash.com/photo-148071437859-2810bbdac877?auto=format&fit=crop&q=80&w=800",
  "https://images.unsplash.com/photo-1451187580459-43490279c0fa?auto=format&fit=crop&q=80&w=800",
  "https://images.unsplash.com/photo-1506905925346-21bda4d32df4?auto=format&fit=crop&q=80&w=800",
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

  console.log("Deleting existing data...");
  await db.collection("users").deleteMany({});
  await db.collection("posts").deleteMany({});
  await db.collection("comments").deleteMany({});
  await db.collection("follows").deleteMany({});
  await db.collection("likes").deleteMany({});
  await db.collection("saves").deleteMany({});
  await db.collection("reposts").deleteMany({});
  await db.collection("notifications").deleteMany({});
  console.log("Data deleted successfully!");

  console.log("Creating users...");
  const users: any[] = [];
  const numUsers = 75;

  for (let i = 0; i < numUsers; i++) {
    const nameObj = random([...INDIAN_NAMES, ...FOREIGN_NAMES]);
    const identity = random(IDENTITIES);
    const usernameBase = nameObj.fullName.toLowerCase().replace(/[^a-z]/g, "");
    const username = `${usernameBase}${randomInt(10, 999)}`;
    const email = `${username}@${random(DOMAINS)}`;
    const password = random(PASSWORDS);
    const profilePic = nameObj.gender === "male" ? random(MALE_PROFILE_PICS) : random(FEMALE_PROFILE_PICS);
    const createdAt = new Date(Date.now() - randomInt(1, 365) * 24 * 60 * 60 * 1000);

    users.push({
      username,
      fullName: nameObj.fullName,
      email,
      password: await bcrypt.hash(password, 10),
      gender: nameObj.gender,
      bio: random(BIO_LINES[identity.name] || ["Building in public, learning in private."]),
      identity,
      profilePic: { url: profilePic, public_id: "" },
      bannerImage: { url: random(BANNERS), public_id: "" },
      followersCount: 0,
      followingCount: 0,
      sharesCount: randomInt(0, 50),
      viewsCount: randomInt(50, 1000),
      isEmailVerified: true,
      createdAt,
    });
  }

  const userResult = await db.collection("users").insertMany(users);
  const userDocs = Object.values(userResult.insertedIds).map((_id, index) => ({
    _id,
    ...users[index],
  }));
  console.log(`Created ${userDocs.length} users!`);

  console.log("Creating posts...");
  const posts: any[] = [];
  const usedSlugs = new Set();

  for (let i = 0; i < userDocs.length; i++) {
    const user = userDocs[i];
    const numPosts = randomInt(0, 8);

    for (let j = 0; j < numPosts; j++) {
      const identity = user.identity;
      const contentTemplate = CONTENT_TEMPLATES[identity.name]!;
      const title = random(contentTemplate.titles);
      const content = random(contentTemplate.contents);
      const numImages = randomInt(0, 2);
      const images = Array.from({ length: numImages }, () => ({
        url: random(POST_IMAGES),
        public_id: "",
        alt: "",
      }));

      const baseSlug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
      let slug = baseSlug;
      let counter = 1;
      while (usedSlugs.has(slug)) {
        slug = `${baseSlug}-${counter++}`;
      }
      usedSlugs.add(slug);

      const createdAt = new Date(user.createdAt.getTime() + randomInt(1, 30) * 24 * 60 * 60 * 1000);

      posts.push({
        title,
        slug,
        content,
        hashtags: [...new Set([...identity.tags.slice(0, 5), ...extractHashtags(content)])],
        images,
        author: user._id,
        repostsCount: randomInt(0, 15),
        savesCount: randomInt(0, 40),
        likesCount: randomInt(0, 80),
        commentsCount: randomInt(0, 20),
        sharesCount: randomInt(0, 25),
        viewsCount: randomInt(100, 800),
        createdAt,
      });
    }
  }

  const postResult = await db.collection("posts").insertMany(posts);
  const postDocs = Object.values(postResult.insertedIds).map((_id, index) => ({
    _id,
    ...posts[index],
  }));
  console.log(`Created ${postDocs.length} posts!`);

  console.log("Creating comments...");
  const comments: any[] = [];
  for (const post of postDocs) {
    const numComments = randomInt(0, 18);
    for (let i = 0; i < numComments; i++) {
      const author = random(userDocs);
      const createdAt = new Date(post.createdAt.getTime() + randomInt(1, 7) * 24 * 60 * 60 * 1000);
      comments.push({
        content: random(COMMENT_TEMPLATES),
        author: author._id,
        post: post._id,
        parent: null,
        likesCount: randomInt(0, 10),
        repliesCount: 0,
        createdAt,
      });
    }
  }

  const commentResult = await db.collection("comments").insertMany(comments);
  const commentDocs = Object.values(commentResult.insertedIds).map((_id, index) => ({
    _id,
    ...comments[index],
  }));
  console.log(`Created ${commentDocs.length} comments!`);

  console.log("Creating follows...");
  const follows: any[] = [];
  for (let i = 0; i < userDocs.length; i++) {
    const follower = userDocs[i];
    const numFollowing = randomInt(3, 25);
    const followingUsers = userDocs
      .filter(u => u._id.toString() !== follower._id.toString())
      .sort(() => 0.5 - Math.random())
      .slice(0, numFollowing);
    for (const following of followingUsers) {
      const createdAt = new Date(Math.max(follower.createdAt.getTime(), following.createdAt.getTime()) + randomInt(1, 30) * 24 * 60 * 60 * 1000);
      follows.push({ follower: follower._id, following: following._id, createdAt });
    }
  }
  await db.collection("follows").insertMany(follows);
  console.log(`Created ${follows.length} follows!`);

  console.log("Updating user follow counts...");
  const followAgg = await db.collection("follows").aggregate([
    { $group: { _id: "$follower", count: { $sum: 1 } } }
  ]).toArray();
  for (const agg of followAgg) {
    await db.collection("users").updateOne({ _id: agg._id }, { $set: { followingCount: agg.count } });
  }
  const followerAgg = await db.collection("follows").aggregate([
    { $group: { _id: "$following", count: { $sum: 1 } } }
  ]).toArray();
  for (const agg of followerAgg) {
    await db.collection("users").updateOne({ _id: agg._id }, { $set: { followersCount: agg.count } });
  }

  console.log("Updating post comment counts...");
  const commentAgg = await db.collection("comments").aggregate([
    { $group: { _id: "$post", count: { $sum: 1 } } }
  ]).toArray();
  for (const agg of commentAgg) {
    await db.collection("posts").updateOne({ _id: agg._id }, { $set: { commentsCount: agg.count } });
  }

  console.log("Creating likes...");
  const likes: any[] = [];
  for (const user of userDocs) {
    const numLikes = randomInt(3, 50);
    const likedPosts = postDocs.sort(() => 0.5 - Math.random()).slice(0, numLikes);
    for (const post of likedPosts) {
      const createdAt = new Date(Math.max(user.createdAt.getTime(), post.createdAt.getTime()) + randomInt(1, 7) * 24 * 60 * 60 * 1000);
      likes.push({ author: user._id, post: post._id, createdAt });
    }
  }
  await db.collection("likes").insertMany(likes);
  console.log(`Created ${likes.length} likes!`);

  console.log("Updating post like counts...");
  const likeAgg = await db.collection("likes").aggregate([
    { $match: { post: { $ne: null } } },
    { $group: { _id: "$post", count: { $sum: 1 } } }
  ]).toArray();
  for (const agg of likeAgg) {
    await db.collection("posts").updateOne({ _id: agg._id }, { $set: { likesCount: agg.count } });
  }

  console.log("Creating saves...");
  const saves: any[] = [];
  for (const user of userDocs) {
    const numSaves = randomInt(2, 30);
    const savedPosts = postDocs.sort(() => 0.5 - Math.random()).slice(0, numSaves);
    for (const post of savedPosts) {
      const createdAt = new Date(Math.max(user.createdAt.getTime(), post.createdAt.getTime()) + randomInt(1, 10) * 24 * 60 * 60 * 1000);
      saves.push({ user: user._id, post: post._id, folder: "General", createdAt });
    }
  }
  await db.collection("saves").insertMany(saves);
  console.log(`Created ${saves.length} saves!`);

  console.log("Updating post save counts...");
  const saveAgg = await db.collection("saves").aggregate([
    { $group: { _id: "$post", count: { $sum: 1 } } }
  ]).toArray();
  for (const agg of saveAgg) {
    await db.collection("posts").updateOne({ _id: agg._id }, { $set: { savesCount: agg.count } });
  }

  console.log("Creating reposts...");
  const reposts: any[] = [];
  for (const user of userDocs) {
    const numReposts = randomInt(0, 12);
    const repostedPosts = postDocs.sort(() => 0.5 - Math.random()).slice(0, numReposts);
    for (const post of repostedPosts) {
      const createdAt = new Date(Math.max(user.createdAt.getTime(), post.createdAt.getTime()) + randomInt(1, 5) * 24 * 60 * 60 * 1000);
      reposts.push({ user: user._id, post: post._id, createdAt });
    }
  }
  await db.collection("reposts").insertMany(reposts);
  console.log(`Created ${reposts.length} reposts!`);

  console.log("Updating post repost counts...");
  const repostAgg = await db.collection("reposts").aggregate([
    { $group: { _id: "$post", count: { $sum: 1 } } }
  ]).toArray();
  for (const agg of repostAgg) {
    await db.collection("posts").updateOne({ _id: agg._id }, { $set: { repostsCount: agg.count } });
  }

  console.log("Updating user post counts...");
  const postUserAgg = await db.collection("posts").aggregate([
    { $group: { _id: "$author", count: { $sum: 1 } } }
  ]).toArray();
  for (const agg of postUserAgg) {
    await db.collection("users").updateOne({ _id: agg._id }, { $set: { postsCount: agg.count } });
  }

  await mongoose.disconnect();
  console.log("Done!");
  console.log("Seed complete!");
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
