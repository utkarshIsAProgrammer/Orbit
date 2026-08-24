/**
 * Reposts API Integration Tests
 *
 * Covers: toggle repost, get reposts list, permissions
 */
import request from "supertest";
import express from "express";
import cookieParser from "cookie-parser";

let userCookies: string[] = [];
let user2Cookies: string[] = [];
let postId = "";

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
    username: "repoststest1",
    email: "reposts1@orbit.test",
    password: "Password123!",
    confirmPassword: "Password123!",
    fullName: "Reposts T1",
    gender: "male",
  });
  userCookies = (u1.headers["set-cookie"] || [])
    .filter((c: string) => c.startsWith("jwt="))
    .map((c: string) => c.split(";")[0]);

  const u2 = await request(authApp).post("/api/auth/signup").send({
    username: "repoststest2",
    email: "reposts2@orbit.test",
    password: "Password123!",
    confirmPassword: "Password123!",
    fullName: "Reposts T2",
    gender: "female",
  });
  user2Cookies = (u2.headers["set-cookie"] || [])
    .filter((c: string) => c.startsWith("jwt="))
    .map((c: string) => c.split(";")[0]);

  const postApp = express();
  postApp.use(express.json());
  postApp.use(cookieParser());
  const { postRoutes } = await import("../routes/post.routes");
  postApp.use("/api/posts", postRoutes);

  const post = await request(postApp)
    .post("/api/posts")
    .set("Cookie", userCookies)
    .send({ title: "Repost Test Post", content: "Testing reposts #test" });
  postId = post.body.post?._id || "";
}

async function createApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  const { repostRoutes } = await import("../routes/repost.routes");
  app.use("/api/reposts", repostRoutes);
  return app;
}

describe("Reposts API", () => {
  let app: express.Express;

  beforeAll(async () => {
    await setup();
    app = await createApp();
  });

  describe("POST /api/reposts/:postId — Toggle Repost", () => {
    it("should reject reposting your own post", async () => {
      await request(app)
        .post(`/api/reposts/${postId}`)
        .set("Cookie", userCookies)
        .expect(400);
    });

    it("should reject unauthenticated requests", async () => {
      await request(app)
        .post(`/api/reposts/${postId}`)
        .expect(401);
    });

    it("should repost a post from another user", async () => {
      const res = await request(app)
        .post(`/api/reposts/${postId}`)
        .set("Cookie", user2Cookies)
        .expect(201);
      expect(res.body.success).toBe(true);
    });

    it("should toggle off repost", async () => {
      const res = await request(app)
        .post(`/api/reposts/${postId}`)
        .set("Cookie", user2Cookies)
        .expect(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe("GET /api/reposts — Get Reposts", () => {
    it("should return reposts list for authenticated user", async () => {
      const res = await request(app)
        .get("/api/reposts")
        .set("Cookie", userCookies)
        .expect(200);
      expect(res.body.success).toBe(true);
    });

    it("should reject unauthenticated list", async () => {
      await request(app).get("/api/reposts").expect(401);
    });
  });
});
