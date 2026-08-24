/**
 * Message Pinning API Tests
 *
 * Covers:
 * - Personal chat: any participant can pin / unpin a message
 * - Communities: any MEMBER can pin / unpin (regression — used to be
 *   creator-only, which made the client's all-member Pin button 403 for
 *   everyone but the creator)
 * - Security: non-members cannot pin
 */
import request from "supertest";
import express from "express";
import cookieParser from "cookie-parser";

let aCookies: string[] = [];
let aId = "";
let bCookies: string[] = [];
let bId = "";
let cCookies: string[] = [];
let cId = "";

async function signup(
  app: express.Express,
  username: string,
  email: string,
  fullName: string,
): Promise<{ cookies: string[]; id: string }> {
  const res = await request(app)
    .post("/api/auth/signup")
    .send({
      username,
      email,
      password: "Password123!",
      confirmPassword: "Password123!",
      fullName,
      gender: "male",
    })
    .expect(201);
  const cookies = (res.headers["set-cookie"] || [])
    .filter((c: string) => c.startsWith("jwt="))
    .map((c: string) => c.split(";")[0]);
  return { cookies, id: res.body.user?._id || "" };
}

async function setup() {
  const authApp = express();
  authApp.use(express.json());
  authApp.use(cookieParser());
  const { authRoutes } = await import("../routes/auth.routes");
  authApp.use("/api/auth", authRoutes);
  authApp.use(
    (err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      res.status(err.statusCode || 500).json({ success: false, message: err.message });
    },
  );

  const a = await signup(authApp, "pinsuser1", "pins1@orbit.test", "Pins User 1");
  aCookies = a.cookies;
  aId = a.id;
  const b = await signup(authApp, "pinsuser2", "pins2@orbit.test", "Pins User 2");
  bCookies = b.cookies;
  bId = b.id;
  const c = await signup(authApp, "pinsuser3", "pins3@orbit.test", "Pins User 3");
  cCookies = c.cookies;
  cId = c.id;
}

async function createApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  const { chatRoutes } = await import("../routes/chat.routes");
  const { communityRoutes } = await import("../routes/community.routes");
  app.use("/api/chats", chatRoutes);
  app.use("/api/communities", communityRoutes);
  app.use(
    (err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      res.status(err.statusCode || 500).json({ success: false, message: err.message });
    },
  );
  return app;
}

describe("Message Pinning API", () => {
  let app: express.Express;

  beforeAll(async () => {
    await setup();
    app = await createApp();
  });

  describe("Personal chat pins", () => {
    let convId = "";
    let msgId = "";

    beforeAll(async () => {
      const convRes = await request(app)
        .post("/api/chats/conversations")
        .set("Cookie", aCookies)
        .send({ recipientId: bId })
        .expect(201);
      convId = convRes.body.conversation._id;

      const msgRes = await request(app)
        .post(`/api/chats/conversations/${convId}/messages`)
        .set("Cookie", aCookies)
        .field("text", "hello pin me")
        .expect(201);
      msgId = msgRes.body.sentMessage._id;
    });

    it("participant A can pin a message", async () => {
      const res = await request(app)
        .post(`/api/chats/messages/${msgId}/pin`)
        .set("Cookie", aCookies)
        .expect(200);
      expect(res.body.success).toBe(true);
      expect(res.body.pinnedMessages.some((m: any) => m._id === msgId)).toBe(true);
    });

    it("the pinned message shows in the conversation pinned list", async () => {
      const res = await request(app)
        .get(`/api/chats/conversations/${convId}/pinned-messages`)
        .set("Cookie", aCookies)
        .expect(200);
      expect(res.body.pinnedMessages.some((m: any) => m._id === msgId)).toBe(true);
    });

    it("participant B (not the sender) can unpin", async () => {
      const res = await request(app)
        .post(`/api/chats/messages/${msgId}/unpin`)
        .set("Cookie", bCookies)
        .expect(200);
      expect(res.body.success).toBe(true);
      expect(res.body.pinnedMessages.some((m: any) => m._id === msgId)).toBe(false);
    });
  });

  describe("Pinned-list privacy (regression)", () => {
    let convId = "";
    let msgId = "";
    let communityId = "";
    let communityMsgId = "";

    beforeAll(async () => {
      // A ⇄ B conversation with a pinned message (may already exist from the
      // earlier describe — getOrCreate returns 201 new / 200 existing)
      const convRes = await request(app)
        .post("/api/chats/conversations")
        .set("Cookie", aCookies)
        .send({ recipientId: bId })
        .expect((res: any) => {
          expect([200, 201]).toContain(res.status);
        });
      convId = convRes.body.conversation._id;
      const msgRes = await request(app)
        .post(`/api/chats/conversations/${convId}/messages`)
        .set("Cookie", aCookies)
        .field("text", "private pin")
        .expect(201);
      msgId = msgRes.body.sentMessage._id;
      await request(app)
        .post(`/api/chats/messages/${msgId}/pin`)
        .set("Cookie", aCookies)
        .expect(200);

      // A-created community with a pinned message; B joins as a member, C stays outside
      const comRes = await request(app)
        .post("/api/communities")
        .set("Cookie", aCookies)
        .field("name", "Pinned Privacy Community")
        .expect(201);
      communityId = comRes.body.community._id;
      await request(app)
        .post(`/api/communities/${communityId}/join`)
        .set("Cookie", bCookies)
        .expect(200);
      const cMsgRes = await request(app)
        .post(`/api/communities/${communityId}/messages`)
        .set("Cookie", aCookies)
        .field("text", "community private pin")
        .expect(201);
      communityMsgId = cMsgRes.body.sentMessage._id;
      await request(app)
        .post(`/api/communities/messages/${communityMsgId}/pin`)
        .set("Cookie", aCookies)
        .expect(200);
    });

    it("non-participant cannot read a conversation's pinned messages (403)", async () => {
      await request(app)
        .get(`/api/chats/conversations/${convId}/pinned-messages`)
        .set("Cookie", cCookies)
        .expect(403);
    });

    it("a participant CAN read the conversation's pinned messages (200)", async () => {
      const res = await request(app)
        .get(`/api/chats/conversations/${convId}/pinned-messages`)
        .set("Cookie", bCookies)
        .expect(200);
      expect(res.body.pinnedMessages.some((m: any) => m._id === msgId)).toBe(true);
    });

    it("non-member cannot read a community's pinned messages (403)", async () => {
      await request(app)
        .get(`/api/communities/${communityId}/pinned-messages`)
        .set("Cookie", cCookies)
        .expect(403);
    });

    it("a member CAN read the community's pinned messages (200)", async () => {
      const res = await request(app)
        .get(`/api/communities/${communityId}/pinned-messages`)
        .set("Cookie", bCookies)
        .expect(200);
      expect(
        res.body.pinnedMessages.some((m: any) => m._id === communityMsgId),
      ).toBe(true);
    });
  });

  describe("Community pins", () => {
    let communityId = "";
    let msgId = "";

    beforeAll(async () => {
      // A creates the community
      const comRes = await request(app)
        .post("/api/communities")
        .set("Cookie", aCookies)
        .field("name", "Pin Test Community")
        .expect(201);
      communityId = comRes.body.community._id;

      // B (member) and C (non-member) join/remain outside
      await request(app)
        .post(`/api/communities/${communityId}/join`)
        .set("Cookie", bCookies)
        .expect(200);

      // B sends a message
      const msgRes = await request(app)
        .post(`/api/communities/${communityId}/messages`)
        .set("Cookie", bCookies)
        .field("text", "pin me")
        .expect(201);
      msgId = msgRes.body.sentMessage._id;
    });

    it("non-member cannot pin (403)", async () => {
      await request(app)
        .post(`/api/communities/messages/${msgId}/pin`)
        .set("Cookie", cCookies)
        .expect(403);
    });

    it("member (not creator) can pin — regression: was creator-only", async () => {
      const res = await request(app)
        .post(`/api/communities/messages/${msgId}/pin`)
        .set("Cookie", bCookies)
        .expect(200);
      expect(res.body.success).toBe(true);
      expect(res.body.pinnedMessages.some((m: any) => m._id === msgId)).toBe(true);
    });

    it("member can unpin a pinned message", async () => {
      const res = await request(app)
        .post(`/api/communities/messages/${msgId}/unpin`)
        .set("Cookie", bCookies)
        .expect(200);
      expect(res.body.success).toBe(true);
      expect(res.body.pinnedMessages.some((m: any) => m._id === msgId)).toBe(false);
    });
  });

  describe("Room-scoped community pins", () => {
    // Regression: pins were stored per-community and returned WITHOUT a room
    // filter, so a pin made in #gaming leaked into every other room's banner.
    let communityId = "";
    let roomId = "";
    let roomMsgId = "";

    beforeAll(async () => {
      const comRes = await request(app)
        .post("/api/communities")
        .set("Cookie", aCookies)
        .field("name", "Pin Room Community")
        .expect(201);
      communityId = comRes.body.community._id;

      await request(app)
        .post(`/api/communities/${communityId}/join`)
        .set("Cookie", bCookies)
        .expect(200);

      // Admin (A) creates a channel; B sends a message inside it.
      const roomRes = await request(app)
        .post(`/api/communities/${communityId}/rooms`)
        .set("Cookie", aCookies)
        .send({ name: "gaming" })
        .expect(201);
      roomId =
        roomRes.body.community?.rooms?.at(-1)?._id ||
        roomRes.body.room?._id ||
        "";

      const msgRes = await request(app)
        .post(`/api/communities/${communityId}/messages`)
        .set("Cookie", bCookies)
        .field("text", "pin in gaming room")
        .field("room", roomId)
        .expect(201);
      roomMsgId = msgRes.body.sentMessage._id;
    });

    it("pin returns a room-scoped list containing the pinned message", async () => {
      const res = await request(app)
        .post(`/api/communities/messages/${roomMsgId}/pin`)
        .set("Cookie", bCookies)
        .expect(200);
      expect(res.body.success).toBe(true);
      expect(res.body.room).toBe(roomId);
      expect(res.body.pinnedMessages.some((m: any) => m._id === roomMsgId)).toBe(true);
    });

    it("general room does NOT see the gaming room's pin (the leak fix)", async () => {
      const res = await request(app)
        .get(`/api/communities/${communityId}/pinned-messages`)
        .set("Cookie", bCookies)
        .expect(200);
      expect(res.body.pinnedMessages.some((m: any) => m._id === roomMsgId)).toBe(false);
    });

    it("gaming room DOES see its own pin via ?room=<id>", async () => {
      const res = await request(app)
        .get(`/api/communities/${communityId}/pinned-messages?room=${roomId}`)
        .set("Cookie", bCookies)
        .expect(200);
      expect(res.body.pinnedMessages.some((m: any) => m._id === roomMsgId)).toBe(true);
    });
  });
});
