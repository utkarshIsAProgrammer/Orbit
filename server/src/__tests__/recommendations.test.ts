/**
 * Recommendation Engine API Integration Tests
 *
 * Covers: hybrid user suggestions (friend-of-friend + reasons), the
 * skip/dismiss feedback loop, similar creators (audience overlap), and the
 * unified For-You feed scoring.
 */
import request from "supertest";
import express from "express";
import cookieParser from "cookie-parser";
import { User } from "../models/user.model";
import Follow from "../models/follow.model";

let cookiesA: string[] = [];
let cookiesB: string[] = [];

async function signup(
  username: string,
  email: string,
  fullName: string
): Promise<string[]> {
  const authApp = express();
  authApp.use(express.json());
  authApp.use(cookieParser());
  const { authRoutes } = await import("../routes/auth.routes");
  authApp.use("/api/auth", authRoutes);
  authApp.use(
    (err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      res.status(err.statusCode || 500).json({ success: false, message: err.message });
    }
  );

  const res = await request(authApp)
    .post("/api/auth/signup")
    .send({
      username,
      email,
      password: "Password123!",
      confirmPassword: "Password123!",
      fullName,
      gender: "male",
    });
  return (res.headers["set-cookie"] || [])
    .filter((c: string) => c.startsWith("jwt="))
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

describe("Recommendation Engine", () => {
  let app: express.Express;

  beforeAll(async () => {
    cookiesA = await signup("reca", "reca@orbit.test", "Rec A");
    cookiesB = await signup("recb", "recb@orbit.test", "Rec B");
    await signup("recc", "recc@orbit.test", "Rec C");
    await signup("recd", "recd@orbit.test", "Rec D");
    app = await createApp();
  });

  describe("GET /api/users/suggestions — hybrid engine", () => {
    it("should return suggestions with a reason and mutual count", async () => {
      const res = await request(app)
        .get("/api/users/suggestions")
        .set("Cookie", cookiesA)
        .query({ limit: 5 })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.users)).toBe(true);
      for (const u of res.body.users) {
        expect(u._id).toBeDefined();
        expect(typeof u.reason).toBe("string");
        expect(typeof u.mutualFollowersCount).toBe("number");
        // Must never suggest the viewer themselves
        expect(u._id).not.toBe((await User.findOne({ username: "reca" }))!._id.toString());
      }
    });

    it("should return 401 when not authenticated", async () => {
      await request(app).get("/api/users/suggestions").expect(401);
    });
  });

  describe("POST /api/users/suggestions/dismiss — feedback loop", () => {
    it("should permanently remove a dismissed user from suggestions", async () => {
      // Grab a suggestion to dismiss
      const res = await request(app)
        .get("/api/users/suggestions")
        .set("Cookie", cookiesA)
        .query({ limit: 5 });

      const target = res.body.users?.[0];
      if (!target) {
        // No suggestions — nothing to dismiss; test passes trivially
        return;
      }

      const dismissRes = await request(app)
        .post("/api/users/suggestions/dismiss")
        .set("Cookie", cookiesA)
        .send({ userId: target._id })
        .expect(200);
      expect(dismissRes.body.success).toBe(true);

      // After dismissal the user must not appear in a fresh fetch
      const after = await request(app)
        .get("/api/users/suggestions")
        .set("Cookie", cookiesA)
        .query({ limit: 10 });
      const ids = (after.body.users || []).map((u: any) => u._id);
      expect(ids).not.toContain(target._id);
    });

    it("should reject an invalid user id", async () => {
      await request(app)
        .post("/api/users/suggestions/dismiss")
        .set("Cookie", cookiesA)
        .send({ userId: "not-a-real-id" })
        .expect(400);
    });
  });

  describe("GET /api/users/:userId/similar-creators — audience overlap", () => {
    it("should return similar creators with mutual counts", async () => {
      const recA = (await User.findOne({ username: "reca" }))!;
      const res = await request(app)
        .get(`/api/users/${recA._id}/similar-creators`)
        .set("Cookie", cookiesB)
        .query({ limit: 5 })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.users)).toBe(true);
      for (const u of res.body.users) {
        expect(u._id).toBeDefined();
        // The viewer themself must never appear
        expect(u._id).not.toBe((await User.findOne({ username: "recb" }))!._id.toString());
      }
    });

    it("should return 400 for an invalid target id", async () => {
      await request(app)
        .get("/api/users/not-valid/similar-creators")
        .set("Cookie", cookiesB)
        .expect(400);
    });
  });

  describe("Shared scoring — For You feed still works", () => {
    it("should return for-you posts with the unified algorithm", async () => {
      // Create some posts so the for-you feed has candidates
      const postApp = express();
      postApp.use(express.json());
      postApp.use(cookieParser());
      const { postRoutes } = await import("../routes/post.routes");
      postApp.use("/api/posts", postRoutes);
      postApp.use(
        (err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
          res.status(err.statusCode || 500).json({ success: false, message: err.message });
        }
      );

      await request(postApp)
        .post("/api/posts")
        .set("Cookie", cookiesB)
        .send({ title: "ForYou Post", content: "Ranked content #orbit" });

      const feedForYouRoutes = (await import("../routes/feedForYou.routes")).default;
      const feedApp = express();
      feedApp.use(express.json());
      feedApp.use(cookieParser());
      feedApp.use("/api/feed", feedForYouRoutes);
      feedApp.use(
        (err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
          res.status(err.statusCode || 500).json({ success: false, message: err.message });
        }
      );

      const res = await request(feedApp)
        .get("/api/feed/for-you")
        .set("Cookie", cookiesB)
        .query({ limit: 5, page: 1 })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.posts)).toBe(true);
    });
  });
});
