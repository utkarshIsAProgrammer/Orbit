/**
 * Waitlist API Integration Tests
 *
 * Covers: public join (201), idempotent re-join (200 alreadyJoined),
 * validation (400), public count, and admin-only listing (401 unauth).
 */
import request from "supertest";
import express from "express";
import cookieParser from "cookie-parser";
import { Waitlist } from "../models/waitlist.model";

async function createApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  const { waitlistRoutes } = await import("../routes/waitlist.routes");
  app.use("/api/waitlist", waitlistRoutes);
  // Error handler so thrown errors are returned as JSON
  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(err.statusCode || 500).json({ success: false, message: err.message });
  });
  return app;
}

describe("Waitlist API", () => {
  let app: express.Express;

  beforeAll(async () => {
    // start from a clean slate — other test files may share the memory DB
    await Waitlist.deleteMany({});
    app = await createApp();
  });

  describe("POST /api/waitlist/join", () => {
    it("should add a new email to the waitlist with a seat position", async () => {
      const res = await request(app)
        .post("/api/waitlist/join")
        .send({ email: "first@orbit.test", source: "landing-page" })
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.alreadyJoined).toBe(false);
      expect(res.body.position).toBe(1);
    });

    it("should be idempotent — re-joining returns alreadyJoined", async () => {
      const res = await request(app)
        .post("/api/waitlist/join")
        .send({ email: "first@orbit.test" })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.alreadyJoined).toBe(true);
      expect(res.body.position).toBe(1);
    });

    it("should reject an invalid email with 400", async () => {
      const res = await request(app)
        .post("/api/waitlist/join")
        .send({ email: "not-an-email" })
        .expect(400);

      expect(res.body.success).toBe(false);
      expect(res.body.message).toBeDefined();
    });

    it("should lowercase and trim emails", async () => {
      const res = await request(app)
        .post("/api/waitlist/join")
        .send({ email: "  Mixed@Orbit.TEST  " })
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.position).toBe(2);

      // Joining with the normalized form hits the same record
      const dup = await request(app)
        .post("/api/waitlist/join")
        .send({ email: "mixed@orbit.test" })
        .expect(200);

      expect(dup.body.alreadyJoined).toBe(true);
    });
  });

  describe("GET /api/waitlist/count", () => {
    it("should return the total number of waitlist entries", async () => {
      const res = await request(app)
        .get("/api/waitlist/count")
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.count).toBe(2);
    });
  });

  describe("GET /api/waitlist (admin)", () => {
    it("should return 401 when not authenticated", async () => {
      await request(app).get("/api/waitlist").expect(401);
    });
  });

  describe("anti-spam layers (always on)", () => {
    it("honeypot: filled hidden field gets fake success and stores nothing", async () => {
      const before = await Waitlist.countDocuments();

      const res = await request(app)
        .post("/api/waitlist/join")
        .send({
          email: "bot@orbit.test",
          website: "http://spam-bot.example",
        })
        .expect(201);

      // Identical shape to a real join — the bot can't tell it was rejected.
      expect(res.body.success).toBe(true);
      expect(res.body.alreadyJoined).toBe(false);

      // ...but nothing was stored, and no confirmation email was sent.
      const after = await Waitlist.countDocuments();
      expect(after).toBe(before);
      const record = await Waitlist.findOne({ email: "bot@orbit.test" }).lean();
      expect(record).toBeNull();
    });

    it("rejects disposable-email domains (mailinator) with 400", async () => {
      const res = await request(app)
        .post("/api/waitlist/join")
        .send({ email: "junk@mailinator.com" })
        .expect(400);

      expect(res.body.message).toMatch(/permanent email/i);
      const record = await Waitlist.findOne({
        emailKey: "junk@mailinator.com",
      }).lean();
      expect(record).toBeNull();
    });

    it("rejects temp-mail domains from the comprehensive blocklist and stores nothing", async () => {
      // gmeenramy.com has valid MX records, so only the domain blocklist
      // stops it — this is the exact domain that slipped through live.
      for (const email of [
        "user@gmeenramy.com",
        "user@getnada.com",
        "user@tempr.email",
      ]) {
        const res = await request(app)
          .post("/api/waitlist/join")
          .send({ email })
          .expect(400);
        expect(res.body.message).toMatch(/permanent email/i);
        const record = await Waitlist.findOne({ emailKey: email }).lean();
        expect(record).toBeNull();
      }
    });

    it("accepts a normal permanent email in dev/test mode (201)", async () => {
      await request(app)
        .post("/api/waitlist/join")
        .send({ email: "realperson@orbit.test" })
        .expect(201);
    });
  });
});
