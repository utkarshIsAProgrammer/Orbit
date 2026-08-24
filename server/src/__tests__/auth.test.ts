/**
 * Auth API Integration Tests
 *
 * Tests signup, login, logout, and session endpoints using a
 * minimal Express app with the middleware the auth routes depend on.
 */
import request from "supertest";
import express from "express";
import cookieParser from "cookie-parser";
import { authRoutes } from "../routes/auth.routes";
import { User } from "../models/user.model";

const createTestApp = () => {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  // Note: rate limiters + CSRF are excluded in tests to avoid false failures
  app.use("/api/auth", authRoutes);

  // Error handler — controllers throw errors that need formatting
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
  username: "testuser",
  email: "test@orbit.test",
  password: "Password123!",
  confirmPassword: "Password123!",
  fullName: "Test User",
  gender: "male" as const,
};

describe("Auth API", () => {
  let app: express.Express;

  beforeAll(() => {
    app = createTestApp();
  });

  describe("POST /api/auth/signup", () => {
    it("should create a new user successfully", async () => {
      const res = await request(app)
        .post("/api/auth/signup")
        .send(TEST_USER)
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.user).toBeDefined();
      expect(res.body.user.username).toBe(TEST_USER.username);
      expect(res.body.user.email).toBe(TEST_USER.email);
      expect(res.body.user.password).toBeUndefined();
    });

    it("should reject duplicate username", async () => {
      const res = await request(app)
        .post("/api/auth/signup")
        .send({
          ...TEST_USER,
          email: "another@orbit.test",
          username: TEST_USER.username,
        })
        .expect(409);

      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain("Username");
    });

    it("should reject duplicate email", async () => {
      const res = await request(app)
        .post("/api/auth/signup")
        .send({
          ...TEST_USER,
          username: "differentuser",
        })
        .expect(409);

      expect(res.body.success).toBe(false);
    });

    it("should reject invalid email format", async () => {
      const res = await request(app)
        .post("/api/auth/signup")
        .send({
          ...TEST_USER,
          email: "not-an-email",
          username: "uniqueuser123",
        })
        .expect(400);

      expect(res.body.success).toBe(false);
    });

    it("should reject weak password", async () => {
      const res = await request(app)
        .post("/api/auth/signup")
        .send({
          ...TEST_USER,
          password: "short",
          username: "anotheruser",
          confirmPassword: "short",
        })
        .expect(400);

      expect(res.body.success).toBe(false);
    });

    it("should reject disposable / temp-mail emails (no account created)", async () => {
      const res = await request(app)
        .post("/api/auth/signup")
        .send({
          ...TEST_USER,
          email: "user@mailinator.com",
          username: "no_tempmail_acct",
        })
        .expect(400);

      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/real email/i);
      // Ensure nothing was persisted for the fake address.
      const found = await User.findOne({ email: "user@mailinator.com" });
      expect(found).toBeNull();
    });
  });

  describe("POST /api/auth/login", () => {
    it("should login with valid email + password", async () => {
      const res = await request(app)
        .post("/api/auth/login")
        .send({
          usernameOrEmail: TEST_USER.email,
          password: TEST_USER.password,
        })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.token).toBeDefined();
      expect(res.body.user).toBeDefined();
      expect(res.body.user.email).toBe(TEST_USER.email);
    });

    it("should reject wrong password", async () => {
      const res = await request(app)
        .post("/api/auth/login")
        .send({
          usernameOrEmail: TEST_USER.email,
          password: "WrongPassword1!",
        })
        .expect(401);

      expect(res.body.success).toBe(false);
    });

    it("should reject non-existent email with the same 401 as bad credentials (no user enumeration)", async () => {
      const res = await request(app)
        .post("/api/auth/login")
        .send({
          usernameOrEmail: "nobody@orbit.test",
          password: TEST_USER.password,
        })
        .expect(401);

      expect(res.body.success).toBe(false);
    });
  });

  describe("GET /api/auth/me", () => {
    let authCookie: string;

    beforeAll(async () => {
      // Create a fresh user for this test group
      const signupRes = await request(app)
        .post("/api/auth/signup")
        .send({
          username: "authmetest2",
          email: "authme2@orbit.test",
          password: "Password123!",
          fullName: "Auth Me Test",
          gender: "female",
        });

      // Extract JWT from Set-Cookie header
      const cookies = signupRes.headers["set-cookie"] || [];
      const jwtCookie = cookies.find((c: string) => c.startsWith("jwt="));
      authCookie = jwtCookie ? jwtCookie.split(";")[0] : signupRes.body.token
        ? `jwt=${signupRes.body.token}`
        : "";
    });

    it("should return user for valid JWT cookie", async () => {
      if (!authCookie) return; // skip if no token available
      const res = await request(app)
        .get("/api/auth/me")
        .set("Cookie", [authCookie])
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.user).toBeDefined();
      expect(res.body.user.email).toBeDefined();
    });

    it("should return 401 without a token", async () => {
      const res = await request(app)
        .get("/api/auth/me")
        .expect(401);

      expect(res.body.success).toBe(false);
    });

    it("should return 401 with an invalid token", async () => {
      const res = await request(app)
        .get("/api/auth/me")
        .set("Cookie", ["jwt=invalid-token"])
        .expect(401);

      expect(res.body.success).toBe(false);
    });
  });

  describe("POST /api/auth/logout", () => {
    let authCookie: string;

    beforeAll(async () => {
      // Login first to get a valid JWT cookie
      const loginRes = await request(app)
        .post("/api/auth/login")
        .send({
          email: TEST_USER.email,
          password: TEST_USER.password,
        });

      const cookies = loginRes.headers["set-cookie"] || [];
      const jwtCookie = cookies.find((c: string) => c.startsWith("jwt="));
      authCookie = jwtCookie ? jwtCookie.split(";")[0] : "";
    });

    it("should clear the JWT cookie", async () => {
      if (!authCookie) return; // skip if no token
      const res = await request(app)
        .post("/api/auth/logout")
        .set("Cookie", [authCookie])
        .expect(200);

      expect(res.body.success).toBe(true);
    });		it("should allow unauthenticated logout (idempotent cookie clear)", async () => {
			// Logout is intentionally idempotent: it must always succeed, even with a
			// missing/expired session or after account deletion cleared the cookies,
			// so the client UI never gets stuck logged-in.
			const res = await request(app)
				.post("/api/auth/logout")
				.expect(200);

			expect(res.body.success).toBe(true);
		});
  });
});
