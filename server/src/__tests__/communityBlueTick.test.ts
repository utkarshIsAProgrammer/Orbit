/**
 * End-to-end Socket.IO test — the community-chat "blue tick" (read receipt)
 * chain.
 *
 * Uses the REAL socket module (jest.unmock overrides the global mockSocket
 * from setupAfterEnv) so the full flow runs: user A sends a community
 * message over HTTP, user B's socket emits `community:seen` on the
 * community, the server marks the messages seen and broadcasts
 * `community:seen-update`, and user A's socket (in the community room)
 * receives it — exactly what paints the blue ticks on the sender's device.
 *
 * Regression coverage for the bug where the DB was marked seen but no event
 * was ever emitted, so ticks only appeared after a manual reload.
 */
jest.unmock("../configs/socket");

import request from "supertest";
import express from "express";
import cookieParser from "cookie-parser";
import http from "http";
import { io as ioc, Socket as ClientSocket } from "socket.io-client";
import { initSocket, shutdownSocket } from "../configs/socket";
import { CommunityMessage } from "../models/communityMessage.model";

const PORT = 5401;

async function waitForEvent<T>(
  socket: ClientSocket,
  event: string,
  timeoutMs = 5000,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`Timed out waiting for "${event}"`));
    }, timeoutMs);
    const handler = (payload: T) => {
      clearTimeout(timer);
      socket.off(event, handler);
      resolve(payload);
    };
    socket.on(event, handler);
  });
}

describe("Community blue tick (read receipt) chain", () => {
  let server: http.Server;
  let app: express.Express;
  let authApp: express.Express;
  let userA: { id: string; token: string; cookie: string };
  let userB: { id: string; token: string; cookie: string };
  let communityId = "";
  let socketA: ClientSocket;
  let socketB: ClientSocket;

  beforeAll(async () => {
    // Auth app for signup
    authApp = express();
    authApp.use(express.json());
    authApp.use(cookieParser());
    const { authRoutes } = await import("../routes/auth.routes");
    authApp.use("/api/auth", authRoutes);
    authApp.use(
      (err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
        res.status(err.statusCode || 500).json({ success: false, message: err.message });
      },
    );

    const signup = async (username: string, email: string, gender: string) => {
      const res = await request(authApp).post("/api/auth/signup").send({
        username,
        email,
        password: "Password123!",
        confirmPassword: "Password123!",
        fullName: `Test ${username}`,
        gender,
      });
      expect(res.status).toBe(201);
      return {
        id: res.body.user._id as string,
        token: res.body.token as string,
        cookie: (res.headers["set-cookie"] || [])
          .filter((c: string) => c.startsWith("jwt="))
          .map((c: string) => c.split(";")[0])[0],
      };
    };

    const a = await signup("comticka", "comticka@orbit.test", "male");
    const b = await signup("comtickb", "comtickb@orbit.test", "female");
    userA = { id: a.id, token: a.token, cookie: a.cookie };
    userB = { id: b.id, token: b.token, cookie: b.cookie };

    // Community app
    app = express();
    app.use(express.json());
    app.use(cookieParser());
    const { communityRoutes } = await import("../routes/community.routes");
    app.use("/api/communities", communityRoutes);
    app.use(
      (err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
        res.status(err.statusCode || 500).json({ success: false, message: err.message });
      },
    );

    // Boot the real socket server FIRST — createCommunity/joinCommunity emit
    // via getIO(), which throws "Socket.io not initialized" until initSocket
    // has run (the blue-tick chain needs those controllers to succeed).
    server = http.createServer(app);
    await initSocket(server);
    await new Promise<void>((resolve) => server.listen(PORT, "127.0.0.1", resolve));

    // A creates a public community, B joins it
    const createRes = await request(app)
      .post("/api/communities")
      .set("Cookie", a.cookie)
      .field("name", "Blue Tick Club")
      .field("description", "read receipts test")
      .expect(201);
    communityId = createRes.body.community._id as string;

    await request(app)
      .post(`/api/communities/${communityId}/join`)
      .set("Cookie", b.cookie)
      .expect(200);

    socketA = ioc(`http://127.0.0.1:${PORT}`, {
      auth: { token: a.token },
      transports: ["websocket"],
      reconnection: false,
    });
    socketB = ioc(`http://127.0.0.1:${PORT}`, {
      auth: { token: b.token },
      transports: ["websocket"],
      reconnection: false,
    });
    await Promise.all([
      new Promise<void>((resolve, reject) => {
        socketA.on("connect", () => resolve());
        socketA.on("connect_error", (e) => reject(e));
      }),
      new Promise<void>((resolve, reject) => {
        socketB.on("connect", () => resolve());
        socketB.on("connect_error", (e) => reject(e));
      }),
    ]);
  });

  afterAll(async () => {
    socketA?.disconnect();
    socketB?.disconnect();
    await shutdownSocket();
    await new Promise<void>((resolve) => server?.close(() => resolve()));
  });

  it("marks community messages seen + emits community:seen-update when a member reads", async () => {
    // A sends a message BEFORE B has opened the community (seenBy should be empty)
    const sendRes = await request(app)
      .post(`/api/communities/${communityId}/messages`)
      .set("Cookie", userA.cookie)
      .field("text", "hello from before you joined")
      .expect(201);
    const messageId = sendRes.body.sentMessage._id as string;
    expect(sendRes.body.sentMessage.seenBy || []).toHaveLength(0);

    // A joins the community room so it can hear community:seen-update
    socketA.emit("community:join", { communityId });
    await new Promise((r) => setTimeout(r, 300));

    // B (the reader) opens the community → server marks seen + broadcasts
    const seenPromise = waitForEvent<{
      communityId: string;
      messageIds: string[];
      seenByUserId: string;
    }>(socketA, "community:seen-update");
    socketB.emit("community:seen", { communityId });
    const seen = await seenPromise;
    expect(seen.communityId).toBe(communityId);
    expect(seen.messageIds).toContain(messageId);
    expect(seen.seenByUserId).toBe(userB.id);

    // The stored message is now marked seen by B
    const stored = await CommunityMessage.findById(messageId).lean();
    expect((stored?.seenBy || []).map(String)).toContain(userB.id);
  });

  it("never marks the reader's own messages as seen by themselves", async () => {
    // B sends a message, then opens the chat — B's own message must NOT get B
    // in seenBy (a sender reading their own message isn't a read receipt).
    const sendRes = await request(app)
      .post(`/api/communities/${communityId}/messages`)
      .set("Cookie", userB.cookie)
      .field("text", "my own message")
      .expect(201);
    const messageId = sendRes.body.sentMessage._id as string;

    socketB.emit("community:seen", { communityId });
    await new Promise((r) => setTimeout(r, 500));

    const stored = await CommunityMessage.findById(messageId).lean();
    const seenBy = (stored?.seenBy || []).map(String);
    expect(seenBy).not.toContain(userB.id);
  });
});
