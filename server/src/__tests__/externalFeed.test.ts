/**
 * External open-web feed + cross-posting integration tests.
 *
 * The external feed endpoint is fully offline-testable (we seed the
 * ExternalPost collection directly — the sync services hit live APIs and are
 * verified separately). Cross-posting endpoints that would touch live
 * networks are only tested for the paths that never leave the server
 * (validation, auth, "not connected").
 */
import request from "supertest";
import express from "express";
import cookieParser from "cookie-parser";
import mongoose from "mongoose";
import ExternalPost from "../models/externalPost.model";
import Repost from "../models/repost.model";
import Comment from "../models/comment.model";
import { User } from "../models/user.model";

let authorCookies: string[] = [];
let authorId = "";
let app: express.Express;

const TEST_USERNAMES = ["extfeedauthor"];

async function buildApp() {
  const a = express();
  a.use(express.json());
  a.use(cookieParser());
  const { authRoutes } = await import("../routes/auth.routes");
  const { externalFeedRoutes } = await import("../routes/externalFeed.routes");
  a.use("/api/auth", authRoutes);
  a.use("/api/external", externalFeedRoutes);
  a.use(
    (err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      res.status(err.statusCode || 500).json({ success: false, message: err.message });
    }
  );
  return a;
}

async function seedExternalPost(overrides: Record<string, unknown> = {}) {
  const source = (overrides.source as string) || "bluesky";
  const sourceId = String(overrides.sourceId || `${source}-${Date.now()}-${Math.random()}`);
  return ExternalPost.create({
    source,
    sourceId,
    dedupKey: `${source}:${sourceId}`,
    url: overrides.url || `https://example.com/post/${sourceId}`,
    content: overrides.content || "Hello from the open web!",
    author: {
      handle: overrides.handle || "someone@example.com",
      displayName: overrides.displayName || "Someone",
      avatar: "",
      profileUrl: "",
    },
    media: [],
    stats: { likes: 5, reposts: 2, replies: 1 },
    originalCreatedAt: overrides.originalCreatedAt || new Date(),
  });
}

beforeAll(async () => {
  app = await buildApp();
  const res = await request(app).post("/api/auth/signup").send({
    username: "extfeedauthor",
    email: "extfeedauthor@orbit.test",
    password: "Password123!",
    confirmPassword: "Password123!",
    fullName: "Ext Feed Author",
    gender: "male",
  });
  authorId = res.body.user?._id || "";
  authorCookies = (res.headers["set-cookie"] || [])
    .filter((c: string) => c.startsWith("jwt="))
    .map((c: string) => c.split(";")[0]);
});

afterAll(async () => {
  await Promise.all([
    ExternalPost.deleteMany({}),
    User.deleteMany({ username: { $in: TEST_USERNAMES } }),
  ]);
});

beforeEach(async () => {
  await ExternalPost.deleteMany({});
  await Repost.deleteMany({});
  await Comment.deleteMany({});
});

describe("GET /api/external/feed", () => {
  it("returns seeded posts newest-first", async () => {
    await seedExternalPost({ sourceId: "old", originalCreatedAt: new Date(Date.now() - 10000) });
    await seedExternalPost({ sourceId: "new", originalCreatedAt: new Date() });

    const res = await request(app).get("/api/external/feed");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.posts).toHaveLength(2);
    expect(res.body.posts[0].sourceId).toBe("new");
    expect(res.body.posts[0].author.handle).toBe("someone@example.com");
    expect(res.body.posts[0].stats.likes).toBe(5);
  });

  it("filters by source", async () => {
    await seedExternalPost({ source: "mastodon", sourceId: "m1" });
    await seedExternalPost({ source: "lemmy", sourceId: "l1" });

    const res = await request(app).get("/api/external/feed?source=mastodon");
    expect(res.body.posts).toHaveLength(1);
    expect(res.body.posts[0].source).toBe("mastodon");
  });

  it("rejects an invalid cursor with 400", async () => {
    const res = await request(app).get("/api/external/feed?cursor=not-a-date");
    expect(res.status).toBe(400);
  });
});

describe("POST /api/external/posts/:postId/repost", () => {
  it("toggles the repost on and off with counts", async () => {
    const post = await seedExternalPost({ sourceId: "repost-1" });

    const on = await request(app)
      .post(`/api/external/posts/${post._id}/repost`)
      .set("Cookie", authorCookies);
    expect(on.status).toBe(201);
    expect(on.body.success).toBe(true);
    expect(on.body.reposted).toBe(true);
    expect(on.body.repostedByMe).toBe(true);
    expect(on.body.orbitRepostsCount).toBe(1);

    const off = await request(app)
      .post(`/api/external/posts/${post._id}/repost`)
      .set("Cookie", authorCookies);
    expect(off.status).toBe(200);
    expect(off.body.reposted).toBe(false);
    expect(off.body.orbitRepostsCount).toBe(0);
  });

  it("requires authentication", async () => {
    const post = await seedExternalPost({ sourceId: "repost-auth" });
    const res = await request(app).post(`/api/external/posts/${post._id}/repost`);
    expect(res.status).toBe(401);
  });
});

describe("POST /api/external/posts/:postId/comments", () => {
  it("adds a comment and increments the post count", async () => {
    const post = await seedExternalPost({ sourceId: "comment-1" });

    const res = await request(app)
      .post(`/api/external/posts/${post._id}/comments`)
      .set("Cookie", authorCookies)
      .send({ content: "Love this from the fediverse!" });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.comment.content).toBe("Love this from the fediverse!");
    expect(res.body.comment.externalPost?.toString()).toBe(post._id.toString());
    expect(res.body.comment.post).toBeNull();

    const updated = await ExternalPost.findById(post._id).lean();
    expect(updated?.orbitCommentsCount).toBe(1);
  });

  it("lists top-level comments newest-first with author info", async () => {
    const post = await seedExternalPost({ sourceId: "comment-2" });
    await request(app)
      .post(`/api/external/posts/${post._id}/comments`)
      .set("Cookie", authorCookies)
      .send({ content: "First!" });
    await request(app)
      .post(`/api/external/posts/${post._id}/comments`)
      .set("Cookie", authorCookies)
      .send({ content: "Second!" });

    const res = await request(app)
      .get(`/api/external/posts/${post._id}/comments`)
      .set("Cookie", authorCookies);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.comments).toHaveLength(2);
    expect(res.body.comments[0].content).toBe("Second!");
    expect(res.body.comments[0].author.username).toBe("extfeedauthor");
    expect(res.body.comments[0].likedByMe).toBe(false);
  });

  it("rejects a reply whose parent belongs to another post", async () => {
    const postA = await seedExternalPost({ sourceId: "comment-parent-a" });
    const postB = await seedExternalPost({ sourceId: "comment-parent-b" });
    const parent = await request(app)
      .post(`/api/external/posts/${postA._id}/comments`)
      .set("Cookie", authorCookies)
      .send({ content: "Parent comment" });
    const parentId = parent.body.comment._id;

    const res = await request(app)
      .post(`/api/external/posts/${postB._id}/comments`)
      .set("Cookie", authorCookies)
      .send({ content: "Wrong post reply", parent: parentId });
    expect(res.status).toBe(400);
  });
});
