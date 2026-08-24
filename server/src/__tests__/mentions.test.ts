/**
 * @mention Feature Tests
 *
 * Covers:
 * - extractMentions email-safety: `foo@bar.com` and `@gmail.com` are NOT
 *   mentions; `@username` (token-boundary) IS a mention.
 * - extractMentions member scope: only community members resolve to ids.
 * - Community messages: mentioning a member creates a `mention`
 *   notification (community ref attached) + a distinct push body path;
 *   non-members and emails produce no mention notification.
 * - DM messages: in 1:1 chats a mention never double-notifies (the
 *   recipient is already covered by the message notification).
 */
import request from "supertest";
import express from "express";
import cookieParser from "cookie-parser";
import mongoose from "mongoose";
import Notification from "../models/notification.model";
import { extractMentions } from "../utilities/notification";

let app: express.Express;
let creatorCookies: string[] = [];
let creatorId = "";
let memberCookies: string[] = [];
let memberId = "";
let outsiderCookies: string[] = [];
let outsiderId = "";

async function signup(
  testApp: express.Express,
  username: string,
  email: string,
  fullName: string,
): Promise<{ cookies: string[]; id: string }> {
  const res = await request(testApp)
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

beforeAll(async () => {
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

  const c = await signup(authApp, "mentionc", "mentionc@orbit.test", "Mention Creator");
  creatorCookies = c.cookies;
  creatorId = c.id;
  const m = await signup(authApp, "mentionmem", "mentionmem@orbit.test", "Mention Member");
  memberCookies = m.cookies;
  memberId = m.id;
  const o = await signup(authApp, "mentionout", "mentionout@orbit.test", "Mention Outsider");
  outsiderCookies = o.cookies;
  outsiderId = o.id;

  app = express();
  app.use(express.json());
  app.use(cookieParser());
  const { communityRoutes } = await import("../routes/community.routes");
  const { chatRoutes } = await import("../routes/chat.routes");
  app.use("/api/communities", communityRoutes);
  app.use("/api/chats", chatRoutes);
  app.use(
    (err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      res.status(err.statusCode || 500).json({ success: false, message: err.message });
    },
  );
});

describe("extractMentions — unit", () => {
  test("matches token-boundary @usernames", async () => {
    const ids = await extractMentions("hey @mentionmem check this");
    expect(ids).toContain(memberId);
  });

  test("ignores emails (user@mentionmem.com is not a mention)", async () => {
    const ids = await extractMentions("contact me at user@mentionmem.com please");
    expect(ids.length).toBe(0);
  });

  test("ignores partial tokens like @gmail.com", async () => {
    const ids = await extractMentions("my email is @gmail.com backup");
    expect(ids.length).toBe(0);
  });

  test("ignores emails even when the local part is a real username", async () => {
    const ids = await extractMentions("sent via mentionmem@orbit.test earlier");
    expect(ids.length).toBe(0);
  });

  test("member scope filters out non-members", async () => {
    const ids = await extractMentions("hi @mentionout and @mentionmem", {
      memberUserIds: [memberId], // outsider is NOT a member
    });
    expect(ids).toContain(memberId);
    expect(ids).not.toContain(outsiderId);
  });
});

describe("Community message mentions", () => {
  let communityId = "";

  beforeAll(async () => {
    const res = await request(app)
      .post("/api/communities")
      .set("Cookie", creatorCookies)
      .field("name", "Mention Test Club")
      .field("privacy", "public")
      .expect(201);
    communityId = res.body.community._id;

    // Member joins the community
    await request(app)
      .post(`/api/communities/${communityId}/join`)
      .set("Cookie", memberCookies)
      .expect(200);
  });

  beforeEach(async () => {
    await Notification.deleteMany({});
  });

  test("mentioning a member creates a mention notification with community ref", async () => {
    await request(app)
      .post(`/api/communities/${communityId}/messages`)
      .set("Cookie", creatorCookies)
      .send({ text: "Hey @mentionmem, look at this" })
      .expect(201);

    const notif = await Notification.findOne({
      recipient: memberId,
      type: "mention",
    }).lean();
    expect(notif).toBeTruthy();
    expect(notif!.community?.toString()).toBe(communityId);
    expect(notif!.message).toBeTruthy();
    // Push body differentiates community mentions — verify via the builder
    const { buildPushPayload } = await import("../services/pushService");
    const payload = buildPushPayload(notif! as any, {});
    expect(payload.data?.type).toBe("mention");
    expect(payload.data?.url).toContain("/communities");
  });

  test("mentioning a NON-member produces NO mention notification", async () => {
    await request(app)
      .post(`/api/communities/${communityId}/messages`)
      .set("Cookie", creatorCookies)
      .send({ text: "Hey @mentionout, you are not here" })
      .expect(201);

    const notif = await Notification.findOne({
      recipient: outsiderId,
      type: "mention",
    }).lean();
    expect(notif).toBeNull();
  });

  test("@everyone pings every member with a mention notification", async () => {
    await request(app)
      .post(`/api/communities/${communityId}/messages`)
      .set("Cookie", creatorCookies)
      .send({ text: "Attention @everyone, meeting now!" })
      .expect(201);

    const notif = await Notification.findOne({
      recipient: memberId,
      type: "mention",
    }).lean();
    expect(notif).toBeTruthy();
  });

  test("@everyone inside an email is NOT expanded (token-boundary rule)", async () => {
    await request(app)
      .post(`/api/communities/${communityId}/messages`)
      .set("Cookie", creatorCookies)
      .send({ text: "mail me at someone@everyone.com now" })
      .expect(201);

    const notif = await Notification.findOne({
      recipient: memberId,
      type: "mention",
    }).lean();
    expect(notif).toBeNull();
  });

  test("emails in a community message produce no mention notification", async () => {
    await request(app)
      .post(`/api/communities/${communityId}/messages`)
      .set("Cookie", creatorCookies)
      .send({ text: "email me at user@mentionmem.com soon" })
      .expect(201);

    const notif = await Notification.findOne({
      recipient: memberId,
      type: "mention",
    }).lean();
    expect(notif).toBeNull();
  });

  test("generic community message still notifies members as community_message", async () => {
    await request(app)
      .post(`/api/communities/${communityId}/messages`)
      .set("Cookie", creatorCookies)
      .send({ text: "just a normal hello" })
      .expect(201);

    const notif = await Notification.findOne({
      recipient: memberId,
      type: "community_message",
    }).lean();
    expect(notif).toBeTruthy();
    expect(notif!.community?.toString()).toBe(communityId);
  });
});

describe("DM chat mentions", () => {
  let conversationId = "";

  beforeAll(async () => {
    const res = await request(app)
      .post("/api/chats/conversations")
      .set("Cookie", creatorCookies)
      .send({ recipientId: memberId })
      .expect(201);
    conversationId = res.body.conversation._id;
  });

  beforeEach(async () => {
    await Notification.deleteMany({});
  });

  test("1:1 mention does not create a duplicate mention notification", async () => {
    await request(app)
      .post(`/api/chats/conversations/${conversationId}/messages`)
      .set("Cookie", creatorCookies)
      .send({ text: "Hi @mentionmem, are you there?" })
      .expect(201);

    // The recipient gets the standard message notification, but NOT an extra
    // mention notification (Instagram/X behavior — no double pings in 1:1).
    const mentionNotifs = await Notification.find({
      recipient: memberId,
      type: "mention",
    }).lean();
    expect(mentionNotifs.length).toBe(0);

    const messageNotifs = await Notification.find({
      recipient: memberId,
      type: "message",
    }).lean();
    expect(messageNotifs.length).toBe(1);
  });
});
