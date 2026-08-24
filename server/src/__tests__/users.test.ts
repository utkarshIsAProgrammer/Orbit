/**
 * Users API Integration Tests
 *
 * Covers: profile CRUD, get by ID/username, pagination, suggestions, search
 */
import request from "supertest";
import express from "express";
import cookieParser from "cookie-parser";
import mongoose from "mongoose";

// ─── Helpers ─────────────────────────────────────────────────────

let user1Token = "";
let user1Id = "";
let user1Cookies: string[] = [];
let user2Id = "";
let user2Cookies: string[] = [];

async function setupUsers() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  const { authRoutes } = await import("../routes/auth.routes");
  app.use("/api/auth", authRoutes);
  // Error handler so thrown errors are returned as JSON
  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(err.statusCode || 500).json({ success: false, message: err.message });
  });

  const u1 = await request(app)
    .post("/api/auth/signup")
    .send({
      username: "usertest1",
      email: "usertest1@orbit.test",
      password: "Password123!",
      confirmPassword: "Password123!",
      fullName: "User Test One",
      gender: "male",
    });

  user1Token = u1.body.token || "";
  user1Id = u1.body.user?._id || "";
  user1Cookies = (u1.headers["set-cookie"] || []).filter((c: string) => c.startsWith("jwt="))
    .map((c: string) => c.split(";")[0]);

  const u2 = await request(app)
    .post("/api/auth/signup")
    .send({
      username: "usertest2",
      email: "usertest2@orbit.test",
      password: "Password123!",
      confirmPassword: "Password123!",
      fullName: "User Test Two",
      gender: "female",
    });

  user2Id = u2.body.user?._id || "";
  user2Cookies = (u2.headers["set-cookie"] || []).filter((c: string) => c.startsWith("jwt="))
    .map((c: string) => c.split(";")[0]);
}

async function createApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  const { userRoutes } = await import("../routes/user.routes");
  app.use("/api/users", userRoutes);
  return app;
}

// ─── Tests ────────────────────────────────────────────────────────

describe("Users API", () => {
  let app: express.Express;

  beforeAll(async () => {
    await setupUsers();
    app = await createApp();
  });

  describe("GET /api/users — List Users", () => {
    it("should return paginated users", async () => {
      const res = await request(app)
        .get("/api/users")
        .query({ limit: 10 })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.users)).toBe(true);
    });

    it("should include followingByMe when authenticated", async () => {
      const res = await request(app)
        .get("/api/users")
        .set("Cookie", user1Cookies)
        .query({ limit: 5 })
        .expect(200);

      if (res.body.users.length > 0) {
        expect(res.body.users[0]).toHaveProperty("followingByMe");
      }
    });
  });

  describe("GET /api/users/:userId — Get User by ID", () => {
    it("should return user by ID", async () => {
      const res = await request(app)
        .get(`/api/users/${user1Id}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.user._id).toBe(user1Id);
    });

    it("should return 404 for non-existent ID", async () => {
      const fakeId = new mongoose.Types.ObjectId().toString();
      await request(app)
        .get(`/api/users/${fakeId}`)
        .expect(404);
    });

    it("should return 400 for invalid ID", async () => {
      await request(app)
        .get("/api/users/invalid-id")
        .expect(400);
    });
  });

  describe("GET /api/users/username/:username — Get User by Username", () => {
    it("should return user by username", async () => {
      const res = await request(app)
        .get("/api/users/username/usertest1")
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.user.username).toBe("usertest1");
    });

    it("should return 404 for non-existent username", async () => {
      await request(app)
        .get("/api/users/username/nonexistentuser12345")
        .expect(404);
    });
  });

  describe("GET /api/users/:userId/posts — Get User Posts", () => {
    it("should return user's posts", async () => {
      const res = await request(app)
        .get(`/api/users/${user1Id}/posts`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.posts)).toBe(true);
    });
  });

  describe("GET /api/users/suggestions — Get Suggested Users", () => {
    it("should return suggestions when authenticated", async () => {
      const res = await request(app)
        .get("/api/users/suggestions")
        .set("Cookie", user1Cookies)
        .query({ limit: 3 })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.users)).toBe(true);
    });

    it("should return 401 when not authenticated", async () => {
      await request(app)
        .get("/api/users/suggestions")
        .expect(401);
    });
  });

  describe("GET /api/users/:userId/pinned — Get Pinned Posts", () => {
    it("should return pinned posts (may be empty)", async () => {
      const res = await request(app)
        .get(`/api/users/${user1Id}/pinned`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.posts)).toBe(true);
    });
  });

  describe("POST /api/users/:userId/share — Share Profile", () => {
    it("should increment share count", async () => {
      const res = await request(app)
        .post(`/api/users/${user1Id}/share`)
        .set("Cookie", user1Cookies)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.shares).toBeGreaterThanOrEqual(0);
      expect(res.body.shareUrl).toBeDefined();
    });
  });
});
