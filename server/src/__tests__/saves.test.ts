/**
 * Saves API Integration Tests
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
    username: "savestest1", email: "saves1@orbit.test",
    password: "Password123!", confirmPassword: "Password123!", fullName: "Saves T1", gender: "male",
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
    .send({ title: "Save Test Post", content: "Testing saves #test" });
  postId = post.body.post?._id || "";
}

async function createApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  const { saveRoutes } = await import("../routes/saves.routes");
  app.use("/api/saves", saveRoutes);
  return app;
}

describe("Saves API", () => {
  let app: express.Express;

  beforeAll(async () => {
    await setup();
    app = await createApp();
  });

  describe("POST /api/saves/:postId — Toggle Save", () => {
    it("should save a post", async () => {
      const res = await request(app)
        .post(`/api/saves/${postId}`)
        .set("Cookie", userCookies)
        .expect(201);
      expect(res.body.success).toBe(true);
    });

    it("should reject unauthenticated requests", async () => {
      await request(app)
        .post(`/api/saves/${postId}`)
        .expect(401);
    });
  });

  describe("GET /api/saves — Get Saved Posts", () => {
    it("should return saved posts", async () => {
      const res = await request(app)
        .get("/api/saves")
        .set("Cookie", userCookies)
        .expect(200);
      expect(res.body.success).toBe(true);
    });

    it("should reject unauthenticated list", async () => {
      await request(app)
        .get("/api/saves")
        .expect(401);
    });
  });
});
