/**
 * Glances (Glimpses) API Integration Tests
 *
 * Covers: GET /api/glimpses/user/:userId — the profile-page story strip
 * (active stories within the 12-hour window) with the same privacy rules
 * as the feed (blocked / private / closeFriends).
 */
import request from "supertest";
import express from "express";
import cookieParser from "cookie-parser";
import mongoose from "mongoose";
import Glimpse from "../models/glimpse.model";
import { User } from "../models/user.model";
import Follow from "../models/follow.model";
import Block from "../models/block.model";

// ─── Helpers ─────────────────────────────────────────────────────

let authorId = "";
let authorCookies: string[] = [];
let viewerId = "";
let viewerCookies: string[] = [];
let outsiderId = "";
let outsiderCookies: string[] = [];
let app: express.Express;

const HOUR = 60 * 60 * 1000;

async function buildApp() {
  const a = express();
  a.use(express.json());
  a.use(cookieParser());
  const { authRoutes } = await import("../routes/auth.routes");
  const { glimpseRoutes } = await import("../routes/glimpse.routes");
  a.use("/api/auth", authRoutes);
  a.use("/api/glimpses", glimpseRoutes);
  // Error handler so thrown errors are returned as JSON
  a.use(
    (
      err: any,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      res.status(err.statusCode || 500).json({
        success: false,
        message: err.message,
      });
    },
  );
  return a;
}

async function signup(username: string) {
  const res = await request(app)
    .post("/api/auth/signup")
    .send({
      username,
      email: `${username}@orbit.test`,
      password: "Password123!",
      confirmPassword: "Password123!",
      fullName: username,
      gender: "male",
    });
  const cookies = (res.headers["set-cookie"] || [])
    .filter((c: string) => c.startsWith("jwt="))
    .map((c: string) => c.split(";")[0]);
  return { id: res.body.user?._id || "", cookies };
}

/** Seed a glimpse directly (bypasses the Cloudinary upload path). */
async function seedGlimpse(overrides: Record<string, unknown> = {}) {
  const g = await Glimpse.create({
    author: overrides.author,
    media: {
      url: "https://cloud.example/test/glance.jpg",
      public_id: "glance_test",
    },
    mediaType: "image",
    visibility: overrides.visibility || "public",
    expiresAt:
      (overrides.expiresAt as Date) ||
      new Date(Date.now() + 12 * HOUR),
  });
  return g;
}

beforeAll(async () => {
  app = await buildApp();
  const author = await signup("glimpseauthor1");
  const viewer = await signup("glimpseviewer1");
  const outsider = await signup("glimpseoutsider1");
  authorId = author.id;
  authorCookies = author.cookies;
  viewerId = viewer.id;
  viewerCookies = viewer.cookies;
  outsiderId = outsider.id;
  outsiderCookies = outsider.cookies;
});

const TEST_USERNAMES = ["glimpseauthor1", "glimpseviewer1", "glimpseoutsider1"];
// Note: IDs are only known after beforeAll, so this must be called at runtime.
const testUserIds = () => [authorId, viewerId, outsiderId];

afterAll(async () => {
  // Clean up ONLY our seeded docs — every suite shares the same in-memory
  // mongod, so nothing here may touch other suites' data.
  const ids = testUserIds();
  await Promise.all([
    Glimpse.deleteMany({ author: { $in: ids } }),
    User.deleteMany({ username: { $in: TEST_USERNAMES } }),
    Follow.deleteMany({ follower: { $in: ids }, following: { $in: ids } }),
    Block.deleteMany({ blocker: { $in: ids }, blocked: { $in: ids } }),
  ]);
});

beforeEach(async () => {
  // Reset ONLY our own users' state per test (never a global wipe — other
  // suites run in parallel against the same DB).
  const ids = testUserIds();
  await Promise.all([
    Glimpse.deleteMany({ author: { $in: ids } }),
    User.updateMany(
      { username: { $in: TEST_USERNAMES } },
      { isPrivate: false, closeFriends: [] },
    ),
    Follow.deleteMany({ follower: { $in: ids }, following: { $in: ids } }),
    Block.deleteMany({ blocker: { $in: ids }, blocked: { $in: ids } }),
  ]);
});

const getUserGlimpses = (asCookies: string[], userId = authorId) =>
  request(app)
    .get(`/api/glimpses/user/${userId}`)
    .set("Cookie", asCookies);

// ─── Tests ───────────────────────────────────────────────────────

describe("GET /api/glimpses/user/:userId", () => {
  it("returns active glimpses but excludes expired ones", async () => {
    await seedGlimpse({ author: authorId }); // active public
    await seedGlimpse({
      author: authorId,
      expiresAt: new Date(Date.now() - HOUR), // expired — must be excluded
    });

    const res = await getUserGlimpses(viewerCookies);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.glimpses).toHaveLength(1);
  });

  it("hides closeFriends glimpses from outsiders but shows them to close friends", async () => {
    await seedGlimpse({
      author: authorId,
      visibility: "closeFriends",
    });
    await User.findByIdAndUpdate(authorId, {
      $set: { closeFriends: [new mongoose.Types.ObjectId(viewerId)] },
    });

    const outsiderRes = await getUserGlimpses(outsiderCookies);
    expect(outsiderRes.body.glimpses).toHaveLength(0);

    const viewerRes = await getUserGlimpses(viewerCookies);
    expect(viewerRes.body.glimpses).toHaveLength(1);
  });

  it("gates private accounts behind an approved follow", async () => {
    await seedGlimpse({ author: authorId });
    await User.findByIdAndUpdate(authorId, { $set: { isPrivate: true } });

    const outsiderRes = await getUserGlimpses(outsiderCookies);
    expect(outsiderRes.body.glimpses).toHaveLength(0);

    await Follow.create({ follower: viewerId, following: authorId });
    const followerRes = await getUserGlimpses(viewerCookies);
    expect(followerRes.body.glimpses).toHaveLength(1);
  });

  it("returns nothing to a blocked user", async () => {
    await seedGlimpse({ author: authorId });
    await Block.create({ blocker: viewerId, blocked: authorId });

    const res = await getUserGlimpses(viewerCookies);
    expect(res.status).toBe(200);
    expect(res.body.glimpses).toHaveLength(0);
  });

  it("lets the author see their own strip regardless of visibility", async () => {
    await seedGlimpse({
      author: authorId,
      visibility: "closeFriends",
    });
    await User.findByIdAndUpdate(authorId, { $set: { isPrivate: true } });

    const res = await getUserGlimpses(authorCookies);
    expect(res.body.glimpses).toHaveLength(1);
  });
});
