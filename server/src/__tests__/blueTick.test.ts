/**
 * End-to-end Socket.IO test — the "blue tick" (read receipt) chain.
 *
 * Uses the REAL socket module (jest.unmock overrides the global
 * mockSocket from setupAfterEnv) so the full flow runs: user A sends a
 * message over HTTP, user B's socket emits chat:join on the conversation,
 * the server marks the messages seen and broadcasts `messages:seen`, and
 * user A's socket receives it — exactly what paints the double-tick on
 * the sender's device.
 */
jest.unmock("../configs/socket");

import request from "supertest";
import express from "express";
import cookieParser from "cookie-parser";
import http from "http";
import { io as ioc, Socket as ClientSocket } from "socket.io-client";
import mongoose from "mongoose";
import { initSocket, shutdownSocket } from "../configs/socket";
import { Message } from "../models/message.model";

const PORT = 5399;

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

describe("Blue tick (read receipt) chain", () => {
  let server: http.Server;
  let app: express.Express;
  let authApp: express.Express;
  let userA: { id: string; token: string; cookie: string };
  let userB: { id: string; token: string };
  let conversationId = "";
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

    const a = await signup("blueticka", "blueticka@orbit.test", "male");
    const b = await signup("bluetickb", "bluetickb@orbit.test", "female");
    userA = { id: a.id, token: a.token, cookie: a.cookie };
    userB = { id: b.id, token: b.token };

    // Chat app
    app = express();
    app.use(express.json());
    app.use(cookieParser());
    const { chatRoutes } = await import("../routes/chat.routes");
    app.use("/api/chats", chatRoutes);
    app.use(
      (err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
        res.status(err.statusCode || 500).json({ success: false, message: err.message });
      },
    );

    // Create a conversation between A and B
    const conv = await request(app)
      .post("/api/chats/conversations")
      .set("Cookie", a.cookie)
      .send({ recipientId: b.id })
      .expect(201);
    conversationId = conv.body.conversation._id as string;

    // Boot the real socket server
    server = http.createServer(app);
    await initSocket(server);
    await new Promise<void>((resolve) => server.listen(PORT, "127.0.0.1", resolve));

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

  it("marks messages seen + emits messages:seen when the recipient joins the conversation", async () => {
    // A sends a message BEFORE B has opened the conversation (seen should be false)
    const sendRes = await request(app)
      .post(`/api/chats/conversations/${conversationId}/messages`)
      .set("Cookie", userA.cookie)
      .field("text", "hello from mobile before you joined")
      .expect(201);
    expect(sendRes.body.sentMessage.seen).toBe(false);

    // A opens the conversation (joins the room so it can hear messages:seen)
    socketA.emit("chat:join", { conversationId });
    await new Promise((r) => setTimeout(r, 300));

    // B (the recipient / PC) opens the conversation → server marks seen + emits
    const seenPromise = waitForEvent<{
      conversationId: string;
      seenBy: string;
    }>(socketA, "messages:seen");
    socketB.emit("chat:join", { conversationId });
    const seen = await seenPromise;
    expect(seen.conversationId).toBe(conversationId);
    expect(seen.seenBy).toBe(userB.id);

    // The stored message is now seen
    const stored = await Message.findOne({
      conversation: conversationId,
      sender: userA.id,
    }).lean();
    expect(stored?.seen).toBe(true);
    expect(stored?.seenAt).toBeDefined();
  });

  it("returns seen:true at send time when the recipient is actively viewing", async () => {
    // B's socket is already joined from the previous test → actively viewing
    const sendRes = await request(app)
      .post(`/api/chats/conversations/${conversationId}/messages`)
      .set("Cookie", userA.cookie)
      .send({ text: "hello while you are viewing" })
      .expect(201);
    expect(sendRes.body.sentMessage.seen).toBe(true);
    expect(sendRes.body.sentMessage.seenAt).toBeDefined();

    // A's socket should ALSO get the immediate messages:seen broadcast
    const seen = await waitForEvent<{ seenBy: string }>(socketA, "messages:seen");
    expect(seen.seenBy).toBe(userB.id);
  });
});
