/**
 * OAuth exchange API Integration Tests
 *
 * Covers the one-time code exchange endpoint (POST /api/auth/oauth-exchange):
 * the mobile-safe completion path for Google sign-in. The callback mints a
 * single-use code (stored server-side), the client POSTs it back over a
 * normal XHR, and the response sets the JWT cookie — the same channel as
 * /api/auth/login, which works even where redirect-set cookies are dropped.
 */
import request from "supertest";
import express from "express";
import cookieParser from "cookie-parser";
import { oauthRoutes } from "../routes/oauth.routes";
import { authRoutes } from "../routes/auth.routes";
import { User } from "../models/user.model";
import { setCache, getCache, deleteCache } from "../configs/cache";

const createTestApp = () => {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use("/api/auth", authRoutes);
  app.use("/api/auth", oauthRoutes);

  app.use((err: any, req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const statusCode = err.statusCode || 500;
    return res.status(statusCode).json({
      success: false,
      message: err.message || "Internal Server Error",
    });
  });

  return app;
};

const TEST_USER = {
  username: "oauthuser",
  email: "oauth@orbit.test",
  password: "Password123!",
  confirmPassword: "Password123!",
  fullName: "OAuth User",
  gender: "male" as const,
};

describe("OAuth exchange API", () => {
  let app: express.Express;

  beforeAll(() => {
    app = createTestApp();
  });

  it("exchanges a valid one-time code for a session (sets jwt cookie)", async () => {
    const signup = await request(app).post("/api/auth/signup").send(TEST_USER).expect(201);
    const userId = signup.body.user._id;

    // Simulate the callback minting a code (single-use, short-lived)
    await setCache(`oauth:exchange:testcode123`, { userId }, 600);

    const res = await request(app)
      .post("/api/auth/oauth-exchange")
      .send({ code: "testcode123" })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.token).toBeDefined();
    expect(res.body.user._id).toBe(userId);
    // The jwt cookie must be set in the XHR response (like login)
    const setCookie = res.headers["set-cookie"] as unknown as string[];
    expect(setCookie.some((c) => c.startsWith("jwt="))).toBe(true);
  });

  it("consumes the code — a second exchange with the same code fails", async () => {
    const signup = await request(app)
      .post("/api/auth/signup")
      .send({ ...TEST_USER, username: "oauthuser2", email: "oauth2@orbit.test" })
      .expect(201);
    const userId = signup.body.user._id;

    await setCache(`oauth:exchange:oncecode`, { userId }, 600);
    await request(app).post("/api/auth/oauth-exchange").send({ code: "oncecode" }).expect(200);
    // Code was deleted on use → second attempt must 401
    await request(app).post("/api/auth/oauth-exchange").send({ code: "oncecode" }).expect(401);
  });

  it("rejects a missing / unknown code", async () => {
    await request(app).post("/api/auth/oauth-exchange").send({}).expect(400);
    await request(app).post("/api/auth/oauth-exchange").send({ code: "nope" }).expect(401);
  });

  it("falls back to an already-valid jwt cookie when the code store misses", async () => {
    const signup = await request(app)
      .post("/api/auth/signup")
      .send({ ...TEST_USER, username: "oauthuser3", email: "oauth3@orbit.test" })
      .expect(201);
    const token = signup.body.token;

    const res = await request(app)
      .post("/api/auth/oauth-exchange")
      .set("Cookie", [`jwt=${token}`])
      .send({ code: "stale-code-not-in-store" })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.user.email).toBe("oauth3@orbit.test");
  });

  it("does not leak the stored code record after use", async () => {
    const signup = await request(app)
      .post("/api/auth/signup")
      .send({ ...TEST_USER, username: "oauthuser4", email: "oauth4@orbit.test" })
      .expect(201);
    const userId = signup.body.user._id;

    await setCache(`oauth:exchange:leakcheck`, { userId }, 600);
    await request(app).post("/api/auth/oauth-exchange").send({ code: "leakcheck" }).expect(200);

    const remaining = await getCache(`oauth:exchange:leakcheck`);
    expect(remaining).toBeNull();
  });
});
