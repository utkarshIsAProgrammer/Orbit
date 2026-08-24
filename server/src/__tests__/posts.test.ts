/**
 * Posts API Integration Tests
 *
 * Covers: CRUD, permissions, visibility (closeFriends), pagination, caching, pin/unpin
 */
import request from "supertest";
import express from "express";
import cookieParser from "cookie-parser";
import mongoose from "mongoose";
import { postRoutes } from "../routes/post.routes";
import Post from "../models/post.model";
import { User } from "../models/user.model";
// The trending-hashtags endpoint serves from cache; these tests write posts
// DIRECTLY to Mongo (bypassing the API's deleteCache("trending:hashtags") on
// create), so they must invalidate the cache themselves — exactly what the
// create route does in production — or the fresh rankings never show.
import { deleteCache } from "../configs/cache";

// ─── Helpers ─────────────────────────────────────────────────────

function createApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use("/api/posts", postRoutes);
  return app;
}

async function createUser(app: express.Express, suffix: string) {
  const authApp = express();
  authApp.use(express.json());
  authApp.use(cookieParser());
  const { authRoutes } = await import("../routes/auth.routes");
  authApp.use("/api/auth", authRoutes);
  // Error handler so thrown errors are returned as JSON
  authApp.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(err.statusCode || 500).json({ success: false, message: err.message });
  });

  const res = await request(authApp)
    .post("/api/auth/signup")
    .send({
      username: `poststest${suffix}`,
      email: `poststest${suffix}@orbit.test`,
      password: "Password123!",
      confirmPassword: "Password123!",
      fullName: `Posts Test ${suffix}`,
      gender: "male",
    });

  return {
    token: res.body.token || "",
    userId: res.body.user?._id || "",
    cookies: res.headers["set-cookie"] || [],
  };
}

function getAuthCookies(cookies: string[]): string[] {
  return cookies.filter((c) => c.startsWith("jwt=")).map((c) => c.split(";")[0]);
}

const TEST_POST = {
  title: "Test Post for Integration Testing",
  content: "This is a test post using #testing #integration",
};

// ─── Tests ────────────────────────────────────────────────────────

describe("Posts API", () => {
  let app: express.Express;
  let user1: { token: string; userId: string; cookies: string[] };
  let user2: { token: string; userId: string; cookies: string[] };

  beforeAll(async () => {
    app = createApp();
    user1 = await createUser(app, "1");
    user2 = await createUser(app, "2");
  });

  describe("POST /api/posts — Create Post", () => {
    it("should create a post when authenticated", async () => {
      const res = await request(app)
        .post("/api/posts")
        .set("Cookie", getAuthCookies(user1.cookies))
        .send(TEST_POST)
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.post).toBeDefined();
      expect(res.body.post.title).toBe(TEST_POST.title);
      expect(res.body.post.hashtags).toContain("testing");
      expect(res.body.post.author).toBeDefined();
    });

    it("should reject unauthenticated requests", async () => {
      await request(app)
        .post("/api/posts")
        .send(TEST_POST)
        .expect(401);
    });

    it("should reject content-only posts (title is required)", async () => {
      await request(app)
        .post("/api/posts")
        .set("Cookie", getAuthCookies(user1.cookies))
        .send({ content: "No title here" })
        .expect(400);
    });

    it("should reject empty posts (no title or description)", async () => {
      await request(app)
        .post("/api/posts")
        .set("Cookie", getAuthCookies(user1.cookies))
        .send({ title: "", content: "" })
        .expect(400);
    });

    it("should reject title-only posts (description is required)", async () => {
      await request(app)
        .post("/api/posts")
        .set("Cookie", getAuthCookies(user1.cookies))
        .send({ title: "Only a title" })
        .expect(400);
    });

    it("should reject image-only posts (title and description are required)", async () => {
      await request(app)
        .post("/api/posts")
        .set("Cookie", getAuthCookies(user1.cookies))
        .send({ image: "https://example.com/image.jpg" })
        .expect(400);
    });

    it("should reject whitespace-only title and content", async () => {
      await request(app)
        .post("/api/posts")
        .set("Cookie", getAuthCookies(user1.cookies))
        .send({ title: "   ", content: "   " })
        .expect(400);
    });

    it("should reject excessively long content", async () => {
      await request(app)
        .post("/api/posts")
        .set("Cookie", getAuthCookies(user1.cookies))
        .send({
          title: "Valid Title",
          content: "x".repeat(10001),
        })
        .expect(400);
    });
  });

  describe("GET /api/posts — List Posts", () => {
    it("should return paginated posts", async () => {
      const res = await request(app)
        .get("/api/posts")
        .query({ limit: 5 })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.posts)).toBe(true);
      expect(res.body.posts.length).toBeLessThanOrEqual(5);
    });

    it("should support cursor-based pagination", async () => {
      const first = await request(app)
        .get("/api/posts")
        .query({ limit: 1 });

      expect(first.body.hasMore).toBeDefined();
      if (first.body.nextCursor) {
        const second = await request(app)
          .get("/api/posts")
          .query({ limit: 1, cursor: first.body.nextCursor });

        expect(second.body.success).toBe(true);
        expect(second.body.posts.length).toBeGreaterThanOrEqual(0);
      }
    });

    it("should filter by author", async () => {
      const res = await request(app)
        .get("/api/posts")
        .query({ author: user1.userId })
        .expect(200);

      expect(res.body.success).toBe(true);
    });

    it("should sort by likesCount", async () => {
      const res = await request(app)
        .get("/api/posts")
        .query({ sort: "likesCount", limit: 10 })
        .expect(200);

      expect(res.body.success).toBe(true);
    });
  });

  describe("GET /api/posts/:postId — Get Single Post", () => {
    let postId: string;

    beforeAll(async () => {
      const res = await request(app)
        .post("/api/posts")
        .set("Cookie", getAuthCookies(user1.cookies))
        .send(TEST_POST);
      postId = res.body.post?._id || "";
    });

    it("should return a post by ID", async () => {
      const res = await request(app)
        .get(`/api/posts/${postId}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.post._id).toBe(postId);
      expect(res.body.post.title).toBe(TEST_POST.title);
    });

    it("should return 404 for non-existent post", async () => {
      const fakeId = new mongoose.Types.ObjectId().toString();
      await request(app)
        .get(`/api/posts/${fakeId}`)
        .expect(404);
    });

    it("should return 400 for invalid ID format", async () => {
      await request(app)
        .get("/api/posts/invalid-id-format")
        .expect(400);
    });
  });

  describe("GET /api/posts/slug/:slug — Get Post by Slug", () => {
    let slug: string;

    beforeAll(async () => {
      const res = await request(app)
        .post("/api/posts")
        .set("Cookie", getAuthCookies(user1.cookies))
        .send({ title: "Unique Slug Test Post", content: "Testing slug" });
      slug = res.body.post?.slug || "";
    });

    it("should return a post by slug", async () => {
      const res = await request(app)
        .get(`/api/posts/slug/${slug}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.post.slug).toBe(slug);
    });

    it("should return 404 for non-existent slug", async () => {
      await request(app)
        .get("/api/posts/slug/nonexistent-slug-xyz")
        .expect(404);
    });
  });

  describe("GET /api/posts/hashtag/:hashtag — Posts by Hashtag", () => {
    beforeAll(async () => {
      // Create a post with #testing hashtag
      await request(app)
        .post("/api/posts")
        .set("Cookie", getAuthCookies(user1.cookies))
        .send({ title: "Hashtag Test", content: "Finding via #testing" });
    });

    it("should return posts matching the hashtag", async () => {
      const res = await request(app)
        .get("/api/posts/hashtag/testing")
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.posts.length).toBeGreaterThan(0);
    });

    it("should return empty for unused hashtag", async () => {
      const res = await request(app)
        .get("/api/posts/hashtag/xyznonexistent")
        .expect(200);

      expect(res.body.posts.length).toBe(0);
    });
  });

  describe("PUT /api/posts/:postId — Update Post", () => {
    let postId: string;

    beforeAll(async () => {
      const res = await request(app)
        .post("/api/posts")
        .set("Cookie", getAuthCookies(user1.cookies))
        .send({ title: "Update Test", content: "Will be updated" });
      postId = res.body.post?._id || "";
    });

    it("should update own post", async () => {
      const res = await request(app)
        .put(`/api/posts/${postId}`)
        .set("Cookie", getAuthCookies(user1.cookies))
        .send({ title: "Updated Title", content: "Updated content here" })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.post.title).toBe("Updated Title");
      expect(res.body.post.isEdited).toBe(true);
    });

    it("should reject update from another user", async () => {
      await request(app)
        .put(`/api/posts/${postId}`)
        .set("Cookie", getAuthCookies(user2.cookies))
        .send({ title: "Hacked Title" })
        .expect(403);
    });

    it("should reject unauthenticated update", async () => {
      await request(app)
        .put(`/api/posts/${postId}`)
        .send({ title: "Anonymous Edit" })
        .expect(401);
    });
  });

  describe("DELETE /api/posts/:postId — Delete Post", () => {
    it("should delete own post", async () => {
      const res = await request(app)
        .post("/api/posts")
        .set("Cookie", getAuthCookies(user1.cookies))
        .send({ title: "Delete Me", content: "Will be deleted" });

      const postId = res.body.post?._id;
      await request(app)
        .delete(`/api/posts/${postId}`)
        .set("Cookie", getAuthCookies(user1.cookies))
        .expect(200);
    });

    it("should reject delete from another user", async () => {
      const res = await request(app)
        .post("/api/posts")
        .set("Cookie", getAuthCookies(user1.cookies))
        .send({ title: "Not Yours", content: "You cant delete this" });

      const postId = res.body.post?._id;
      await request(app)
        .delete(`/api/posts/${postId}`)
        .set("Cookie", getAuthCookies(user2.cookies))
        .expect(403);
    });
  });

  describe("POST /api/posts/:postId/pin — Pin/Unpin Post", () => {
    it("should pin own post to profile", async () => {
      const res = await request(app)
        .post("/api/posts")
        .set("Cookie", getAuthCookies(user1.cookies))
        .send({ title: "Pin Me", content: "Will be pinned" });

      const postId = res.body.post?._id;
      const pinRes = await request(app)
        .post(`/api/posts/${postId}/pin`)
        .set("Cookie", getAuthCookies(user1.cookies))
        .expect(200);

      expect(pinRes.body.success).toBe(true);
    });

    it("should reject pin from another user", async () => {
      const res = await request(app)
        .post("/api/posts")
        .set("Cookie", getAuthCookies(user1.cookies))
        .send({ title: "Not Yours to Pin", content: "Nope" });

      const postId = res.body.post?._id;
      await request(app)
        .post(`/api/posts/${postId}/pin`)
        .set("Cookie", getAuthCookies(user2.cookies))
        .expect(403);
    });
  });

  describe("GET /api/posts/trending/hashtags", () => {
    it("should return trending hashtags", async () => {
      const res = await request(app)
        .get("/api/posts/trending/hashtags")
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.hashtags)).toBe(true);
    });

    it("ranks recency-weighted — a tag used heavily right now beats older volume", async () => {
      const author = new mongoose.Types.ObjectId();
      const now = Date.now();
      const hour = 60 * 60 * 1000;

      // "hotnow": 10 posts within the last hour → weight 1.0 each → score 10.
      for (let i = 0; i < 10; i++) {
        await Post.create({
          author,
          title: `Hot post ${i}`,
          content: `hot content ${i}`,
          hashtags: ["hotnow"],
          visibility: "public",
          status: "published",
          createdAt: new Date(now - i * 5 * 60 * 1000),
        });
      }
      // "oldbulk": 40 posts spread over 4-6 days → weight 0.1 each → score 4.
      // 4× the raw volume, but ranked BELOW the tag that's hot right now.
      // (Day 7 is avoided — millisecond drift at the window edge would drop
      // some posts out of the 7-day match.)
      for (let i = 0; i < 40; i++) {
        await Post.create({
          author,
          title: `Old post ${i}`,
          content: `old content ${i}`,
          hashtags: ["oldbulk"],
          visibility: "public",
          status: "published",
          createdAt: new Date(now - ((i % 3) + 4) * 24 * hour),
        });
      }

      try {
        // Mirror production: creating posts invalidates the trending cache
        // (post.controllers createPost → deleteCache("trending:hashtags")).
        await deleteCache("trending:hashtags");

        const res = await request(app)
          .get("/api/posts/trending/hashtags")
          .expect(200);

        expect(res.body.success).toBe(true);
        // The tag that's hot RIGHT NOW must rank above the older bulk volume,
        // even though oldbulk has 4× the posts.
        expect(res.body.hashtags.indexOf("hotnow")).toBeLessThan(
          res.body.hashtags.indexOf("oldbulk"),
        );
        expect(res.body.counts?.hotnow).toBe(10);
        expect(res.body.counts?.oldbulk).toBe(40);
      } finally {
        await Post.deleteMany({ author });
      }
    });
  });
});
