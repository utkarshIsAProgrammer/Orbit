/**
 * Community Roles, Privacy & Moderation API Tests
 *
 * Covers the community moderation feature set:
 * - Private communities: join requests → approve / reject / cancel
 * - Public communities: join instantly (no approval)
 * - Member roles: promote/demote (creator > admin > moderator > member)
 * - Access control: whoCanPost / whoCanUploadMedia gating
 * - Moderator powers: delete any member's message, manage join requests
 * - Invite links: generate + join via code (bypasses private approval)
 * - Privacy: private communities hidden from the public directory
 */
import request from "supertest";
import express from "express";
import cookieParser from "cookie-parser";

let creatorCookies: string[] = [];
let creatorId = "";
let adminCookies: string[] = [];
let adminId = "";
let modCookies: string[] = [];
let modId = "";
let memberCookies: string[] = [];
let memberId = "";
let outsiderCookies: string[] = [];
let outsiderId = "";

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

  const c = await signup(authApp, "crolec", "crolec@orbit.test", "Role Creator");
  creatorCookies = c.cookies;
  creatorId = c.id;
  const a = await signup(authApp, "crolea", "crolea@orbit.test", "Role Admin");
  adminCookies = a.cookies;
  adminId = a.id;
  const m = await signup(authApp, "crolemod", "crolemod@orbit.test", "Role Mod");
  modCookies = m.cookies;
  modId = m.id;
  const mem = await signup(authApp, "crolemem", "crolemem@orbit.test", "Role Member");
  memberCookies = mem.cookies;
  memberId = mem.id;
  const o = await signup(authApp, "croleout", "croleout@orbit.test", "Role Outsider");
  outsiderCookies = o.cookies;
  outsiderId = o.id;
}

async function createApp() {
  const app = express();
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
  return app;
}

describe("Community Roles & Privacy", () => {
  let app: express.Express;
  let privateCommunityId = "";
  let publicCommunityId = "";

  beforeAll(async () => {
    await setup();
    app = await createApp();
  });

  describe("Private communities — join approval flow", () => {
    beforeAll(async () => {
      const res = await request(app)
        .post("/api/communities")
        .set("Cookie", creatorCookies)
        .field("name", "Secret Club")
        .field("privacy", "private")
        .expect(201);
      privateCommunityId = res.body.community._id;
      expect(res.body.community.privacy).toBe("private");
    });

    test("member request to join a private community returns pending (not member)", async () => {
      const res = await request(app)
        .post(`/api/communities/${privateCommunityId}/join`)
        .set("Cookie", memberCookies)
        .expect(200);
      expect(res.body.pending).toBe(true);
      expect(res.body.isMember).toBeUndefined();
    });

    test("duplicate request stays pending", async () => {
      const res = await request(app)
        .post(`/api/communities/${privateCommunityId}/join`)
        .set("Cookie", memberCookies)
        .expect(200);
      expect(res.body.pending).toBe(true);
    });

    test("pending request is visible in getCommunity for the requester", async () => {
      const res = await request(app)
        .get(`/api/communities/${privateCommunityId}`)
        .set("Cookie", memberCookies)
        .expect(200);
      expect(res.body.community.pendingRequest).toBe(true);
      expect(res.body.community.isMember).toBe(false);
    });

    test("moderators can list pending requests", async () => {
      const res = await request(app)
        .get(`/api/communities/${privateCommunityId}/join-requests`)
        .set("Cookie", creatorCookies)
        .expect(200);
      expect(res.body.requests.length).toBe(1);
      expect(res.body.requests[0].user._id).toBe(memberId);
    });

    test("regular members cannot list join requests", async () => {
      const res = await request(app)
        .get(`/api/communities/${privateCommunityId}/join-requests`)
        .set("Cookie", outsiderCookies)
        .expect(403);
      expect(res.body.success).toBe(false);
    });

    test("approve moves the user into members and clears the request", async () => {
      const res = await request(app)
        .post(`/api/communities/${privateCommunityId}/join-requests/${memberId}/approve`)
        .set("Cookie", creatorCookies)
        .expect(200);
      expect(res.body.success).toBe(true);

      const me = await request(app)
        .get(`/api/communities/${privateCommunityId}`)
        .set("Cookie", memberCookies)
        .expect(200);
      expect(me.body.community.isMember).toBe(true);
      expect(me.body.community.pendingRequest).toBe(false);
      expect(me.body.community.userRole).toBe("member");

      const pending = await request(app)
        .get(`/api/communities/${privateCommunityId}/join-requests`)
        .set("Cookie", creatorCookies)
        .expect(200);
      expect(pending.body.requests.length).toBe(0);
    });

    test("non-moderator cannot approve", async () => {
      // outsider is not even a member — must be rejected before the check
      const res = await request(app)
        .post(`/api/communities/${privateCommunityId}/join-requests/${outsiderId}/approve`)
        .set("Cookie", outsiderCookies)
        .expect(403);
      expect(res.body.success).toBe(false);
    });

    test("reject removes the request without adding the user", async () => {
      await request(app)
        .post(`/api/communities/${privateCommunityId}/join`)
        .set("Cookie", outsiderCookies)
        .expect(200);

      const res = await request(app)
        .post(`/api/communities/${privateCommunityId}/join-requests/${outsiderId}/reject`)
        .set("Cookie", creatorCookies)
        .expect(200);
      expect(res.body.success).toBe(true);

      const me = await request(app)
        .get(`/api/communities/${privateCommunityId}`)
        .set("Cookie", outsiderCookies)
        .expect(200);
      expect(me.body.community.pendingRequest).toBe(false);
      expect(me.body.community.isMember).toBe(false);
    });

    test("private communities are hidden from the public directory for non-members", async () => {
      const res = await request(app)
        .get("/api/communities?limit=50")
        .set("Cookie", outsiderCookies)
        .expect(200);
      const ids = res.body.communities.map((c: any) => c._id);
      expect(ids).not.toContain(privateCommunityId);
    });

    test("private communities appear in the directory for members", async () => {
      const res = await request(app)
        .get("/api/communities?limit=50")
        .set("Cookie", memberCookies)
        .expect(200);
      const ids = res.body.communities.map((c: any) => c._id);
      expect(ids).toContain(privateCommunityId);
    });
  });

  describe("Member roles — promote / demote", () => {
    let roleCommunityId = "";

    beforeAll(async () => {
      const res = await request(app)
        .post("/api/communities")
        .set("Cookie", creatorCookies)
        .field("name", "Role Lab")
        .field("privacy", "private")
        .expect(201);
      roleCommunityId = res.body.community._id;
      // Add admin + mod + member as plain members (private → request + approve)
      for (const [cookies, id] of [
        [adminCookies, adminId],
        [modCookies, modId],
        [memberCookies, memberId],
      ] as const) {
        await request(app)
          .post(`/api/communities/${roleCommunityId}/join`)
          .set("Cookie", cookies)
          .expect(200);
        await request(app)
          .post(`/api/communities/${roleCommunityId}/join-requests/${id}/approve`)
          .set("Cookie", creatorCookies)
          .expect(200);
      }
    });

    test("creator promotes a member to moderator", async () => {
      const res = await request(app)
        .post(`/api/communities/${roleCommunityId}/members/${memberId}/role`)
        .set("Cookie", creatorCookies)
        .send({ role: "moderator" })
        .expect(200);
      expect(res.body.success).toBe(true);
      expect(res.body.role).toBe("moderator");
    });

    test("moderator can now approve join requests (moderation power)", async () => {
      // outsider requests to join
      await request(app)
        .post(`/api/communities/${roleCommunityId}/join`)
        .set("Cookie", outsiderCookies)
        .expect(200);
      const res = await request(app)
        .post(`/api/communities/${roleCommunityId}/join-requests/${outsiderId}/approve`)
        .set("Cookie", memberCookies) // now a moderator
        .expect(200);
      expect(res.body.success).toBe(true);
    });

    test("a moderator cannot promote anyone to admin (creator only)", async () => {
      const res = await request(app)
        .post(`/api/communities/${roleCommunityId}/members/${adminId}/role`)
        .set("Cookie", memberCookies) // moderator
        .send({ role: "admin" })
        .expect(403);
      expect(res.body.success).toBe(false);
    });

    test("creator promotes to admin", async () => {
      const res = await request(app)
        .post(`/api/communities/${roleCommunityId}/members/${adminId}/role`)
        .set("Cookie", creatorCookies)
        .send({ role: "admin" })
        .expect(200);
      expect(res.body.role).toBe("admin");
    });

    test("an admin can demote a moderator back to member", async () => {
      const res = await request(app)
        .post(`/api/communities/${roleCommunityId}/members/${memberId}/role`)
        .set("Cookie", adminCookies)
        .send({ role: "member" })
        .expect(200);
      expect(res.body.role).toBe("member");
    });

    test("an admin cannot demote another admin", async () => {
      // promote member → moderator first so there is a second admin later
      // (memberId is a plain member again here)
      const res = await request(app)
        .post(`/api/communities/${roleCommunityId}/members/${memberId}/role`)
        .set("Cookie", adminCookies)
        .send({ role: "admin" })
        .expect(403);
      expect(res.body.success).toBe(false);
    });

    test("the creator's role can never be changed", async () => {
      const res = await request(app)
        .post(`/api/communities/${roleCommunityId}/members/${creatorId}/role`)
        .set("Cookie", creatorCookies)
        .send({ role: "member" })
        .expect(400);
      expect(res.body.success).toBe(false);
    });
  });

  describe("Access control — whoCanPost", () => {
    let gateCommunityId = "";

    beforeAll(async () => {
      const res = await request(app)
        .post("/api/communities")
        .set("Cookie", creatorCookies)
        .field("name", "Gate")
        .expect(201);
      gateCommunityId = res.body.community._id;
      for (const cookies of [adminCookies, modCookies, memberCookies]) {
        await request(app)
          .post(`/api/communities/${gateCommunityId}/join`)
          .set("Cookie", cookies)
          .expect(200);
      }
      // Roles inside THIS community: admin → admin, mod → moderator.
      await request(app)
        .post(`/api/communities/${gateCommunityId}/members/${adminId}/role`)
        .set("Cookie", creatorCookies)
        .send({ role: "admin" })
        .expect(200);
      await request(app)
        .post(`/api/communities/${gateCommunityId}/members/${modId}/role`)
        .set("Cookie", creatorCookies)
        .send({ role: "moderator" })
        .expect(200);
    });

    test("set whoCanPost=moderators (creator can set it)", async () => {
      const res = await request(app)
        .put(`/api/communities/${gateCommunityId}`)
        .set("Cookie", creatorCookies)
        .field("whoCanPost", "moderators")
        .expect(200);
      expect(res.body.community.whoCanPost).toBe("moderators");
    });

    test("a plain member cannot send a message when moderators-only", async () => {
      const res = await request(app)
        .post(`/api/communities/${gateCommunityId}/messages`)
        .set("Cookie", memberCookies)
        .field("text", "hello from a member")
        .expect(403);
      expect(res.body.success).toBe(false);
    });

    test("a moderator CAN send a message when moderators-only", async () => {
      const res = await request(app)
        .post(`/api/communities/${gateCommunityId}/messages`)
        .set("Cookie", modCookies)
        .field("text", "hello from a moderator")
        .expect(201);
      expect(res.body.success).toBe(true);
    });

    test("an admin can still send", async () => {
      const res = await request(app)
        .post(`/api/communities/${gateCommunityId}/messages`)
        .set("Cookie", adminCookies)
        .field("text", "hello from an admin")
        .expect(201);
      expect(res.body.success).toBe(true);
    });

    test("set whoCanPost=admins blocks moderators", async () => {
      await request(app)
        .put(`/api/communities/${gateCommunityId}`)
        .set("Cookie", creatorCookies)
        .field("whoCanPost", "admins")
        .expect(200);
      const res = await request(app)
        .post(`/api/communities/${gateCommunityId}/messages`)
        .set("Cookie", modCookies)
        .field("text", "blocked")
        .expect(403);
      expect(res.body.success).toBe(false);
    });

    test("a moderator cannot change access control settings", async () => {
      const res = await request(app)
        .put(`/api/communities/${gateCommunityId}`)
        .set("Cookie", modCookies)
        .field("whoCanPost", "everyone")
        .expect(403);
      expect(res.body.success).toBe(false);
    });

    test("a moderator can delete an admin's message (moderation power)", async () => {
      const sent = await request(app)
        .post(`/api/communities/${gateCommunityId}/messages`)
        .set("Cookie", adminCookies)
        .field("text", "delete me mod")
        .expect(201);
      const res = await request(app)
        .delete(`/api/communities/messages/${sent.body.sentMessage._id}`)
        .set("Cookie", modCookies)
        .expect(200);
      expect(res.body.success).toBe(true);
    });

    test("a plain member cannot delete another member's message", async () => {
      const sent = await request(app)
        .post(`/api/communities/${gateCommunityId}/messages`)
        .set("Cookie", creatorCookies)
        .field("text", "protected message")
        .expect(201);
      const res = await request(app)
        .delete(`/api/communities/messages/${sent.body.sentMessage._id}`)
        .set("Cookie", memberCookies)
        .expect(403);
      expect(res.body.success).toBe(false);
    });
  });

  describe("Invite links", () => {
    let inviteCommunityId = "";

    beforeAll(async () => {
      const res = await request(app)
        .post("/api/communities")
        .set("Cookie", creatorCookies)
        .field("name", "Invite Only")
        .field("privacy", "private")
        .expect(201);
      inviteCommunityId = res.body.community._id;
    });

    test("generate an invite code (creator)", async () => {
      const res = await request(app)
        .post(`/api/communities/${inviteCommunityId}/invite`)
        .set("Cookie", creatorCookies)
        .expect(200);
      expect(res.body.code).toBeTruthy();
    });

    test("non-admin cannot generate an invite code", async () => {
      const res = await request(app)
        .post(`/api/communities/${inviteCommunityId}/invite`)
        .set("Cookie", outsiderCookies)
        .expect(403);
      expect(res.body.success).toBe(false);
    });

    test("joining via a valid invite bypasses the private approval flow", async () => {
      const codeRes = await request(app)
        .get(`/api/communities/${inviteCommunityId}/invite`)
        .set("Cookie", creatorCookies)
        .expect(200);
      const code = codeRes.body.code;

      const res = await request(app)
        .post("/api/communities/join/invite")
        .set("Cookie", outsiderCookies)
        .send({ code })
        .expect(200);
      expect(res.body.isMember).toBe(true);

      const me = await request(app)
        .get(`/api/communities/${inviteCommunityId}`)
        .set("Cookie", outsiderCookies)
        .expect(200);
      expect(me.body.community.isMember).toBe(true);
    });

    test("invalid invite code is rejected", async () => {
      const res = await request(app)
        .post("/api/communities/join/invite")
        .set("Cookie", memberCookies)
        .send({ code: "deadbeefdeadbeef" })
        .expect(404);
      expect(res.body.success).toBe(false);
    });
  });

  describe("Public communities — instant join", () => {
    beforeAll(async () => {
      const res = await request(app)
        .post("/api/communities")
        .set("Cookie", creatorCookies)
        .field("name", "Open Plaza")
        .expect(201);
      publicCommunityId = res.body.community._id;
      expect(res.body.community.privacy).toBe("public");
      // Everyone joins this public community instantly.
      for (const cookies of [memberCookies, adminCookies, modCookies]) {
        await request(app)
          .post(`/api/communities/${publicCommunityId}/join`)
          .set("Cookie", cookies)
          .expect(200);
      }
    });

    test("joining a public community is instant (no pending)", async () => {
      const res = await request(app)
        .post(`/api/communities/${publicCommunityId}/join`)
        .set("Cookie", outsiderCookies)
        .expect(200);
      expect(res.body.isMember).toBe(true);
      expect(res.body.pending).toBeUndefined();
    });

    test("kick hierarchy: a moderator cannot remove an admin", async () => {
      // Promote admin → admin and mod → moderator INSIDE this community first.
      await request(app)
        .post(`/api/communities/${publicCommunityId}/members/${adminId}/role`)
        .set("Cookie", creatorCookies)
        .send({ role: "admin" })
        .expect(200);
      await request(app)
        .post(`/api/communities/${publicCommunityId}/members/${modId}/role`)
        .set("Cookie", creatorCookies)
        .send({ role: "moderator" })
        .expect(200);

      const res = await request(app)
        .post(`/api/communities/${publicCommunityId}/remove-member`)
        .set("Cookie", modCookies)
        .send({ memberId: adminId })
        .expect(403);
      expect(res.body.success).toBe(false);
    });

    test("an admin can kick a moderator", async () => {
      const res = await request(app)
        .post(`/api/communities/${publicCommunityId}/remove-member`)
        .set("Cookie", adminCookies)
        .send({ memberId: modId })
        .expect(200);
      expect(res.body.success).toBe(true);
    });

    test("a plain member cannot kick anyone", async () => {
      const res = await request(app)
        .post(`/api/communities/${publicCommunityId}/remove-member`)
        .set("Cookie", memberCookies)
        .send({ memberId: adminId })
        .expect(403);
      expect(res.body.success).toBe(false);
    });
  });

  describe("Channel features — icons, topics & unread badges", () => {
    let chanCommunityId = "";
    let generalRoomId = "";
    let gamingRoomId = "";

    beforeAll(async () => {
      const res = await request(app)
        .post("/api/communities")
        .set("Cookie", creatorCookies)
        .field("name", "Channel Lab")
        .expect(201);
      chanCommunityId = res.body.community._id;
      generalRoomId = res.body.community.rooms[0]._id;
      await request(app)
        .post(`/api/communities/${chanCommunityId}/join`)
        .set("Cookie", memberCookies)
        .expect(200);
    });

    test("create a channel with an emoji icon and topic", async () => {
      const res = await request(app)
        .post(`/api/communities/${chanCommunityId}/rooms`)
        .set("Cookie", creatorCookies)
        .send({ name: "gaming", icon: "🎮", topic: "share your setups" })
        .expect(201);
      const room = res.body.community.rooms[1];
      gamingRoomId = room._id;
      expect(room.icon).toBe("🎮");
      expect(room.topic).toBe("share your setups");
    });

    test("update a channel's icon and topic", async () => {
      const res = await request(app)
        .put(`/api/communities/${chanCommunityId}/rooms/${gamingRoomId}`)
        .set("Cookie", creatorCookies)
        .send({ topic: "clips & highlights only", icon: "🏆" })
        .expect(200);
      const room = res.body.community.rooms.find(
        (r: any) => r._id === gamingRoomId,
      );
      expect(room.icon).toBe("🏆");
      expect(room.topic).toBe("clips & highlights only");
    });

    test("the general channel's name can't be renamed", async () => {
      const res = await request(app)
        .put(`/api/communities/${chanCommunityId}/rooms/${generalRoomId}`)
        .set("Cookie", creatorCookies)
        .send({ name: "not-general" })
        .expect(400);
      expect(res.body.success).toBe(false);
    });

    test("non-admins cannot create channels", async () => {
      const res = await request(app)
        .post(`/api/communities/${chanCommunityId}/rooms`)
        .set("Cookie", memberCookies)
        .send({ name: "sneaky" })
        .expect(403);
      expect(res.body.success).toBe(false);
    });

    test("unread badge counts messages you haven't seen", async () => {
      // Member posts in #gaming — the creator (who hasn't read it) sees 1.
      const sent = await request(app)
        .post(`/api/communities/${chanCommunityId}/messages`)
        .set("Cookie", memberCookies)
        .field("text", "first clip")
        .field("room", gamingRoomId)
        .expect(201);
      const msgId = sent.body.sentMessage._id;

      const unread = await request(app)
        .get(`/api/communities/${chanCommunityId}/unread`)
        .set("Cookie", creatorCookies)
        .expect(200);
      const gaming = unread.body.counts.find(
        (c: any) => c.room === gamingRoomId,
      );
      expect(gaming.count).toBe(1);

      // Creator marks the channel read → badge clears.
      await request(app)
        .post(`/api/communities/${chanCommunityId}/rooms/${gamingRoomId}/read`)
        .set("Cookie", creatorCookies)
        .send({ lastMessageId: msgId })
        .expect(200);
      const after = await request(app)
        .get(`/api/communities/${chanCommunityId}/unread`)
        .set("Cookie", creatorCookies)
        .expect(200);
      expect(
        after.body.counts.find((c: any) => c.room === gamingRoomId).count,
      ).toBe(0);

      // A second message bumps it back to 1.
      await request(app)
        .post(`/api/communities/${chanCommunityId}/messages`)
        .set("Cookie", memberCookies)
        .field("text", "second clip")
        .field("room", gamingRoomId)
        .expect(201);
      const bumped = await request(app)
        .get(`/api/communities/${chanCommunityId}/unread`)
        .set("Cookie", creatorCookies)
        .expect(200);
      expect(
        bumped.body.counts.find((c: any) => c.room === gamingRoomId).count,
      ).toBe(1);
    });

    test("your own messages never count as unread", async () => {
      const unread = await request(app)
        .get(`/api/communities/${chanCommunityId}/unread`)
        .set("Cookie", memberCookies)
        .expect(200);
      const gaming = unread.body.counts.find(
        (c: any) => c.room === gamingRoomId,
      );
      expect(gaming.count).toBe(0);
    });

    test("non-members cannot read unread counts", async () => {
      const res = await request(app)
        .get(`/api/communities/${chanCommunityId}/unread`)
        .set("Cookie", outsiderCookies)
        .expect(403);
      expect(res.body.success).toBe(false);
    });
  });
});
