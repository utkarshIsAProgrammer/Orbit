/**
 * Chat API Integration Tests
 *
 * Covers: conversations, messages, presence, typing indicators
 */
import request from "supertest";
import express from "express";
import cookieParser from "cookie-parser";

let user1Cookies: string[] = [];
let user1Id = "";
let user2Cookies: string[] = [];
let user2Id = "";

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
    username: "chattest1", email: "chat1@orbit.test",
    password: "Password123!", confirmPassword: "Password123!", fullName: "Chat T1", gender: "male",
  });
  user1Cookies = (u1.headers["set-cookie"] || []).filter((c: string) => c.startsWith("jwt=")).map((c: string) => c.split(";")[0]);
  user1Id = u1.body.user?._id || "";

  const u2 = await request(authApp).post("/api/auth/signup").send({
    username: "chattest2", email: "chat2@orbit.test",
    password: "Password123!", confirmPassword: "Password123!", fullName: "Chat T2", gender: "female",
  });
  user2Cookies = (u2.headers["set-cookie"] || []).filter((c: string) => c.startsWith("jwt=")).map((c: string) => c.split(";")[0]);
  user2Id = u2.body.user?._id || "";
}

async function createApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  const { chatRoutes } = await import("../routes/chat.routes");
  app.use("/api/chats", chatRoutes);
  return app;
}

describe("Chat API", () => {
  let app: express.Express;

  beforeAll(async () => {
    await setup();
    app = await createApp();
  });

  describe("POST /api/chats/conversations — Create Conversation", () => {
    it("should create a conversation between two users", async () => {
      const res = await request(app)
        .post("/api/chats/conversations")
        .set("Cookie", user1Cookies)
        .send({ recipientId: user2Id })
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.conversation).toBeDefined();
    });

    // WhatsApp-style "Message yourself" chat — a conversation with yourself
    // (participants [me, me]) is now ALLOWED and flagged isSelfChat so the
    // client renders "Message yourself" instead of a stranger name.
    it("should create a conversation with self (Message yourself)", async () => {
      // 201 on first creation, 200 if the self-conversation already exists
      // from an earlier test in the run — both are valid success paths.
      const res = await request(app)
        .post("/api/chats/conversations")
        .set("Cookie", user1Cookies)
        .send({ recipientId: user1Id });

      expect([200, 201]).toContain(res.status);
      expect(res.body.success).toBe(true);
      expect(res.body.conversation).toBeDefined();
      expect(res.body.conversation.isSelfChat).toBe(true);
      // Both participants are the same user — the schema's 2-participant
      // validator is satisfied by [me, me].
      expect(res.body.conversation.participants).toHaveLength(2);
      const ids = res.body.conversation.participants.map((p: any) => p._id);
      expect(ids[0]).toBe(ids[1]);
    });
  });

  describe("GET /api/chats/conversations — List Conversations", () => {
    it("should return user conversations", async () => {
      const res = await request(app)
        .get("/api/chats/conversations")
        .set("Cookie", user1Cookies)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.conversations)).toBe(true);
    });
  });
});
