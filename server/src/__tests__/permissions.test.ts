/**
 * Device Permission Preferences API Tests
 *
 * Covers:
 * - GET /api/permissions returns defaults for a fresh user
 * - PUT /api/permissions persists per-permission states
 * - PUT marks onboarding completed permanently
 * - Auth gate: unauthenticated requests are rejected
 */
import request from "supertest";
import express from "express";
import cookieParser from "cookie-parser";

let aCookies: string[] = [];

async function signup(
  app: express.Express,
  username: string,
  email: string,
): Promise<string[]> {
  const res = await request(app)
    .post("/api/auth/signup")
    .send({
      username,
      email,
      password: "Password123!",
      confirmPassword: "Password123!",
      fullName: "Perm User",
      gender: "male",
    })
    .expect(201);
  return (res.headers["set-cookie"] || [])
    .filter((c: string) => c.startsWith("jwt="))
    .map((c: string) => c.split(";")[0]);
}

async function createApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  const { authRoutes } = await import("../routes/auth.routes");
  const permissionRoutes = (await import("../routes/permission.routes")).default;
  app.use("/api/auth", authRoutes);
  app.use("/api/permissions", permissionRoutes);
  app.use(
    (err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      res.status(err.statusCode || 500).json({ success: false, message: err.message });
    },
  );
  return app;
}

describe("Permission Preferences API", () => {
  let app: express.Express;

  beforeAll(async () => {
    app = await createApp();
    aCookies = await signup(app, "permuser1", "perm1@orbit.test");
  });

  it("returns default permission prefs for a fresh user", async () => {
    const res = await request(app)
      .get("/api/permissions")
      .set("Cookie", aCookies)
      .expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.permissions.notifications).toBe("default");
    expect(res.body.permissions.camera).toBe("default");
    expect(res.body.permissions.microphone).toBe("default");
    expect(res.body.onboardingCompleted).toBe(false);
  });

  it("persists individual permission states", async () => {
    await request(app)
      .put("/api/permissions")
      .set("Cookie", aCookies)
      .send({ permissions: { notifications: "granted", camera: "denied" } })
      .expect(200);

    const res = await request(app)
      .get("/api/permissions")
      .set("Cookie", aCookies)
      .expect(200);
    expect(res.body.permissions.notifications).toBe("granted");
    expect(res.body.permissions.camera).toBe("denied");
    // Untouched field stays default (partial updates never clobber).
    expect(res.body.permissions.microphone).toBe("default");
  });

  it("marks onboarding completed permanently", async () => {
    await request(app)
      .put("/api/permissions")
      .set("Cookie", aCookies)
      .send({ onboardingCompleted: true })
      .expect(200);

    const res = await request(app)
      .get("/api/permissions")
      .set("Cookie", aCookies)
      .expect(200);
    expect(res.body.onboardingCompleted).toBe(true);
  });

  it("rejects unauthenticated requests (401)", async () => {
    await request(app).get("/api/permissions").expect(401);
    await request(app)
      .put("/api/permissions")
      .send({ permissions: { camera: "granted" } })
      .expect(401);
  });

  it("sanitizes invalid permission values back to default", async () => {
    await request(app)
      .put("/api/permissions")
      .set("Cookie", aCookies)
      .send({ permissions: { microphone: "evil-value" } })
      .expect(200);

    const res = await request(app)
      .get("/api/permissions")
      .set("Cookie", aCookies)
      .expect(200);
    expect(res.body.permissions.microphone).toBe("default");
  });
});
