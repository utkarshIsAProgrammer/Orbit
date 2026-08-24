/**
 * Likes & Saves API Integration Tests
 */
import request from "supertest";
import express from "express";
import cookieParser from "cookie-parser";

let userCookies: string[] = [];
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
    username: "likestest1", email: "likes1@orbit.test",
    password: "Password123!", confirmPassword: "Password123!", fullName: "Likes T1", gender: "male",
  });
  userCookies = (u1.headers["set-cookie"] || []).filter((c: string) => c.startsWith("jwt="))
    .map((c: string) => c.split(";")[0]);

  const postApp = express();
  postApp.use(express.json());
  postApp.use(cookieParser());
  const { postRoutes } = await import("../routes/post.routes");
  postApp.use("/api/posts", postRoutes);

  const post = await request(postApp).post("/api/posts")
    .set("Cookie", userCookies)
    .send({ title: "Like Test Post", content: "Testing likes #test" });
  postId = post.body.post?._id || "";
}

async function createApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  const { likeRoutes } = await import("../routes/like.routes");
  app.use("/api/likes", likeRoutes);
  return app;
}

describe("Likes API", () => {
  let app: express.Express;

  beforeAll(async () => {
    await setup();
    app = await createApp();
  });

  describe("POST /api/likes/post/:postId — Toggle Like", () => {
    it("should like a post", async () => {
      const res = await request(app)
        .post(`/api/likes/post/${postId}`)
        .set("Cookie", userCookies)
        .expect(201);
      expect(res.body.success).toBe(true);
    });

    it("should reject unauthenticated requests", async () => {
      await request(app)
        .post(`/api/likes/post/${postId}`)
        .expect(401);
    });
  });
});
