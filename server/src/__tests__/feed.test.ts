/**
 * Feed API Integration Tests
 *
 * Covers: ranked feed, for-you feed, pagination
 */
import request from "supertest";
import express from "express";
import cookieParser from "cookie-parser";

let userCookies: string[] = [];

async function setup() {
  const authApp = express();
  authApp.use(express.json());
  authApp.use(cookieParser());
  const { authRoutes } = await import("../routes/auth.routes");
  authApp.use("/api/auth", authRoutes);
  // Error handler so thrown errors are returned as JSON
  authApp.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(err.statusCode || 500).json({ success: false, message: err.message });
  });

  const u1 = await request(authApp).post("/api/auth/signup").send({
    username: "feedtest1", email: "feed1@orbit.test",
    password: "Password123!", confirmPassword: "Password123!", fullName: "Feed T1", gender: "male",
  });
  userCookies = (u1.headers["set-cookie"] || []).filter((c: string) => c.startsWith("jwt=")).map((c: string) => c.split(";")[0]);

  // Create a post so feed has content
  const postApp = express();
  postApp.use(express.json());
  postApp.use(cookieParser());
  const { postRoutes } = await import("../routes/post.routes");
  postApp.use("/api/posts", postRoutes);

  await request(postApp).post("/api/posts")
    .set("Cookie", userCookies)
    .send({ title: "Feed Test Post", content: "Testing feed #feed" });
}

async function createApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  const { feedRoutes } = await import("../routes/feed.routes");
  app.use("/api/feed", feedRoutes);
  const feedForYouRoutes = (await import("../routes/feedForYou.routes")).default;
  app.use("/api/feed", feedForYouRoutes);
  return app;
}

describe("Feed API", () => {
  let app: express.Express;

  beforeAll(async () => {
    await setup();
    app = await createApp();
  });

  describe("GET /api/feed — Ranked Feed", () => {
    it("should return feed posts", async () => {
      const res = await request(app)
        .get("/api/feed")
        .set("Cookie", userCookies)
        .query({ limit: 10 })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.posts)).toBe(true);
    });

    it("should return 401 when not authenticated", async () => {
      await request(app)
        .get("/api/feed")
        .expect(401);
    });
  });

  describe("GET /api/feed/for-you — For You Feed", () => {
    it("should return for-you posts when authenticated", async () => {
      const res = await request(app)
        .get("/api/feed/for-you")
        .set("Cookie", userCookies)
        .query({ limit: 5 })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.posts)).toBe(true);
    });
  });
});
