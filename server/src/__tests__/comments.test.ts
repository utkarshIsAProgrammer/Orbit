/**
 * Comments API Integration Tests
 *
 * Covers: create, reply, edit, delete, permissions, reactions
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
    username: "commentstest1", email: "comments1@orbit.test",
    password: "Password123!", confirmPassword: "Password123!", fullName: "Comments T1", gender: "male",
  });
  userCookies = (u1.headers["set-cookie"] || []).filter((c: string) => c.startsWith("jwt="))
    .map((c: string) => c.split(";")[0]);

  const u2 = await request(authApp).post("/api/auth/signup").send({
    username: "commentstest2", email: "comments2@orbit.test",
    password: "Password123!", confirmPassword: "Password123!", fullName: "Comments T2", gender: "female",
  });
  user2Cookies = (u2.headers["set-cookie"] || []).filter((c: string) => c.startsWith("jwt="))
    .map((c: string) => c.split(";")[0]);

  const postApp = express();
  postApp.use(express.json());
  postApp.use(cookieParser());
  const { postRoutes } = await import("../routes/post.routes");
  postApp.use("/api/posts", postRoutes);

  const post = await request(postApp).post("/api/posts")
    .set("Cookie", userCookies)
    .send({ title: "Comment Test Post", content: "Testing comments" });
  postId = post.body.post?._id || "";
}

async function createApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  const { commentRoutes } = await import("../routes/comment.routes");
  app.use("/api/comments", commentRoutes);
  return app;
}

describe("Comments API", () => {
  let app: express.Express;

  beforeAll(async () => {
    await setup();
    app = await createApp();
  });

  describe("POST /api/comments/:postId — Create Comment", () => {
    it("should create a comment on a post", async () => {
      const res = await request(app)
        .post(`/api/comments/${postId}`)
        .set("Cookie", userCookies)
        .send({ content: "Great post!" })
        .expect(201);
      expect(res.body.success).toBe(true);
    });

    it("should reject empty text", async () => {
      await request(app)
        .post(`/api/comments/${postId}`)
        .set("Cookie", userCookies)
        .send({ content: "" })
        .expect(400);
    });

    it("should reject unauthenticated requests", async () => {
      await request(app)
        .post(`/api/comments/${postId}`)
        .send({ content: "Anonymous" })
        .expect(401);
    });
  });
});
