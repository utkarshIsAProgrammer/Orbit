/**
 * Sharing & dual-sided rewards API Tests
 *
 * Covers the audit-completion work:
 * - Invite REDEEMER reward (XP bundle + founder badge) — the redeemer used
 *   to get nothing; now both ends of the viral loop get something.
 * - Collection sharing: DM forward (collection_share notification), community
 *   forward (community message), read-only shared view, and the ownership +
 *   membership guards.
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

  const a = await signup(authApp, "shareuser1", "share1@orbit.test", "Share User 1");
  aCookies = a.cookies;
  aId = a.id;
  const b = await signup(authApp, "shareuser2", "share2@orbit.test", "Share User 2");
  bCookies = b.cookies;
  bId = b.id;
  const c = await signup(authApp, "shareuser3", "share3@orbit.test", "Share User 3");
  cCookies = c.cookies;
  cId = c.id;
}

async function createApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  const { inviteRoutes } = await import("../routes/invite.routes");
  const { collectionRoutes } = await import("../routes/collection.routes");
  const { postRoutes } = await import("../routes/post.routes");
  const { communityRoutes } = await import("../routes/community.routes");
  app.use("/api/invites", inviteRoutes);
  app.use("/api/collections", collectionRoutes);
  app.use("/api/posts", postRoutes);
  app.use("/api/communities", communityRoutes);
  app.use(
    (err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      res.status(err.statusCode || 500).json({ success: false, message: err.message });
    },
  );
  return app;
}

describe("Invite redeemer rewards", () => {
  let app: express.Express;

  beforeAll(async () => {
    await setup();
    app = await createApp();
  });

  it("redeeming a code grants the REDEEMER XP + founder badge", async () => {
    // A generates an invite code (201 when freshly created, 200 when reused)
    const codeRes = await request(app)
      .get("/api/invites/code")
      .set("Cookie", aCookies)
      .expect((res: any) => {
        expect([200, 201]).toContain(res.status);
      });
    const code = codeRes.body.inviteCode;

    // B redeems it
    const redeemRes = await request(app)
      .post(`/api/invites/redeem/${encodeURIComponent(code)}`)
      .set("Cookie", bCookies)
      .expect(200);
    expect(redeemRes.body.success).toBe(true);
    // The dual-sided reward: the redeemer gets an XP bundle
    expect(redeemRes.body.rewards.redeemerXp).toBeGreaterThan(0);
    // And the founder badge is newly awarded the first time
    expect(redeemRes.body.rewards.redeemerBadgeAwarded).toBe(true);
    // The inviter still gets their reach boost
    expect(redeemRes.body.rewards.inviterReachBoostUntil).toBeTruthy();
  });

  it("redeeming the same code twice does not double-pay (code consumed)", async () => {
    // A generates a fresh code and B redeems it once
    const codeRes = await request(app)
      .get("/api/invites/code")
      .set("Cookie", aCookies)
      .expect((res: any) => {
        expect([200, 201]).toContain(res.status);
      });
    const code = codeRes.body.inviteCode;

    await request(app)
      .post(`/api/invites/redeem/${encodeURIComponent(code)}`)
      .set("Cookie", cCookies)
      .expect(200);

    // Second redeem of the same code → 404 (already accepted)
    await request(app)
      .post(`/api/invites/redeem/${encodeURIComponent(code)}`)
      .set("Cookie", bCookies)
      .expect(404);
  });
});

describe("Collection sharing", () => {
  let app: express.Express;

  beforeAll(async () => {
    app = await createApp();
  });

  it("owner can share a collection to a DM (collection_share notification)", async () => {
    // A creates a collection
    const collRes = await request(app)
      .post("/api/collections")
      .set("Cookie", aCookies)
      .send({ name: "My Picks" })
      .expect(201);
    const collId = collRes.body.collection._id;

    // A forwards it to B
    const fwdRes = await request(app)
      .post(`/api/collections/${collId}/forward`)
      .set("Cookie", aCookies)
      .send({ recipientId: bId })
      .expect(200);
    expect(fwdRes.body.success).toBe(true);
    expect(fwdRes.body.shareUrl).toContain("/collection/");
  });

  it("non-owner cannot share someone else's collection (403)", async () => {
    const collRes = await request(app)
      .post("/api/collections")
      .set("Cookie", aCookies)
      .send({ name: "Private Picks" })
      .expect(201);
    const collId = collRes.body.collection._id;

    await request(app)
      .post(`/api/collections/${collId}/forward`)
      .set("Cookie", bCookies)
      .send({ recipientId: cId })
      .expect(403);
  });

  it("cannot share a collection to yourself (400)", async () => {
    const collRes = await request(app)
      .post("/api/collections")
      .set("Cookie", aCookies)
      .send({ name: "Self Picks" })
      .expect(201);
    const collId = collRes.body.collection._id;

    await request(app)
      .post(`/api/collections/${collId}/forward`)
      .set("Cookie", aCookies)
      .send({ recipientId: aId })
      .expect(400);
  });

  it("the shared read-only view is openable by any authenticated user", async () => {
    const collRes = await request(app)
      .post("/api/collections")
      .set("Cookie", aCookies)
      .send({ name: "Viewable Picks" })
      .expect(201);
    const collId = collRes.body.collection._id;

    const res = await request(app)
      .get(`/api/collections/shared/${collId}`)
      .set("Cookie", cCookies)
      .expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.collection.name).toBe("Viewable Picks");
  });

  it("member can share a collection into a community chat (message created)", async () => {
    // A creates the community
    const comRes = await request(app)
      .post("/api/communities")
      .set("Cookie", aCookies)
      .field("name", "Share Community")
      .expect(201);
    const communityId = comRes.body.community._id;
    await request(app)
      .post(`/api/communities/${communityId}/join`)
      .set("Cookie", bCookies)
      .expect(200);

    const collRes = await request(app)
      .post("/api/collections")
      .set("Cookie", bCookies)
      .send({ name: "Community Picks" })
      .expect(201);
    const collId = collRes.body.collection._id;

    const fwdRes = await request(app)
      .post(`/api/collections/${collId}/forward-community`)
      .set("Cookie", bCookies)
      .send({ communityId })
      .expect(201);
    expect(fwdRes.body.success).toBe(true);
    expect(fwdRes.body.sentMessage.text).toContain("Community Picks");
  });

  it("non-member cannot share into a community (403)", async () => {
    const comRes = await request(app)
      .post("/api/communities")
      .set("Cookie", aCookies)
      .field("name", "Closed Share Community")
      .expect(201);
    const communityId = comRes.body.community._id;

    const collRes = await request(app)
      .post("/api/collections")
      .set("Cookie", cCookies)
      .send({ name: "Outsider Picks" })
      .expect(201);
    const collId = collRes.body.collection._id;

    await request(app)
      .post(`/api/collections/${collId}/forward-community`)
      .set("Cookie", cCookies)
      .send({ communityId })
      .expect(403);
  });
});

describe("Forward → real chat message (WhatsApp/Instagram behavior)", () => {
  let app: express.Express;

  beforeAll(async () => {
    app = await createApp();
  });

  it("forwarding a post to a user creates a 1:1 conversation + chat message", async () => {
    const { Conversation } = await import("../models/conversation.model");
    const { Message } = await import("../models/message.model");

    const postRes = await request(app)
      .post("/api/posts")
      .set("Cookie", aCookies)
      .field("title", "Forwarded post title")
      .field("content", "Forward me to a chat")
      .expect(201);
    const postId = postRes.body.post._id;

    await request(app)
      .post(`/api/posts/${postId}/forward`)
      .set("Cookie", aCookies)
      .send({ recipientId: bId })
      .expect(200);

    // The conversation must exist between A and B
    const conversation = await Conversation.findOne({
      participants: { $all: [aId, bId] },
    });
    expect(conversation).toBeTruthy();

    // And the chat message with the post preview + link must exist
    const message = await Message.findOne({
      conversation: conversation!._id,
      sender: aId,
      recipient: bId,
      text: { $regex: "Forwarded post title" },
    });
    expect(message).toBeTruthy();
    expect(message!.text).toContain("http");

    // Conversation preview points at the forward message
    const convWithPreview = await Conversation.findById(conversation!._id);
    expect(convWithPreview!.lastMessage?.toString()).toBe(
      message!._id.toString(),
    );
  });

  it("forwarding a collection to a user also lands as a chat message", async () => {
    const { Conversation } = await import("../models/conversation.model");
    const { Message } = await import("../models/message.model");

    const collRes = await request(app)
      .post("/api/collections")
      .set("Cookie", aCookies)
      .send({ name: "Chat Picks" })
      .expect(201);
    const collId = collRes.body.collection._id;

    await request(app)
      .post(`/api/collections/${collId}/forward`)
      .set("Cookie", aCookies)
      .send({ recipientId: cId })
      .expect(200);

    const conversation = await Conversation.findOne({
      participants: { $all: [aId, cId] },
    });
    expect(conversation).toBeTruthy();

    const message = await Message.findOne({
      conversation: conversation!._id,
      sender: aId,
      recipient: cId,
      text: { $regex: "Chat Picks" },
    });
    expect(message).toBeTruthy();
    expect(message!.text).toContain("/collection/");
  });
});
