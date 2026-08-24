#!/usr/bin/env node
/**
 * Socket.IO End-to-End Test Script (revised)
 * =============================================
 *
 * Tests real-time event propagation between two simulated users.
 * Unlike unit tests, this requires a running server with database + Redis.
 *
 * Architecture: Events flow through HTTP controllers → Database → Socket emit helpers.
 * This test makes actual HTTP API calls and listens for the resulting socket events.
 *
 * Prerequisites:
 *   - MongoDB and Redis running (docker or local)
 *   - Server running (npm run dev in orbit-server/)
 *   - At least 2 users seeded in the database
 *
 * Usage:
 *   cd orbit-server && node scripts/test-socket-e2e.mjs
 *
 * What it tests:
 *   ✓ WebSocket connection with JWT auth
 *   ✓ Online presence broadcast
 *   ✓ Chat events (message:new, chat:typing)
 *   ✓ Like/unlike events (post:like, post:unlike)
 *   ✓ Save/unsave events (post:save, post:unsave)
 *   ✓ Repost/unrepost events (post:repost, post:unrepost)
 *   ✓ Comment events (post:comment)
 *   ✓ Follow/unfollow events (user:follow, user:unfollow)
 *   ✓ Post lifecycle (post:created, post:deleted)
 *   ✓ Notification events
 *   ✓ Count accuracy (authoritative server counts)
 */

import "dotenv/config";
import { io as ioc } from "socket.io-client";
import { MongoClient, ObjectId } from "mongodb";
import jwt from "jsonwebtoken";

// ── Config ──────────────────────────────────────────────────────────
const SERVER_URL = process.env.SERVER_URL || "http://localhost:5002";
const MONGO_URI  = process.env.MONGO_URI  || "mongodb://localhost:27017/orbit";
const JWT_SECRET = process.env.JWT_SECRET || "change-me-in-production";

// ── Test Runner ─────────────────────────────────────────────────────
let passed = 0;
let failed = 0;
const failures = [];

function assert(label, condition, detail = "") {
  if (condition) {
    console.log(`  ✅ ${label}`);
    passed++;
  } else {
    console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ""}`);
    failed++;
    failures.push({ label, detail });
  }
}

function waitForEvent(socket, event, timeout = 8000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout (${timeout}ms) waiting for "${event}"`));
    }, timeout);
    socket.once(event, (data) => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}

function waitForAnyEvent(socket, events, timeout = 8000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout (${timeout}ms) waiting for any of [${events.join(", ")}]`));
    }, timeout);
    const cleanup = () => {
      clearTimeout(timer);
      for (const ev of events) {
        socket.off(ev);
      }
    };
    for (const ev of events) {
      socket.once(ev, (data) => {
        cleanup();
        resolve({ event: ev, data });
      });
    }
  });
}

async function apiCall(method, path, token, body) {
  const opts = {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body && !(body instanceof FormData) ? { "Content-Type": "application/json" } : {}),
    },
  };
  if (body) {
    opts.body = body instanceof FormData ? body : JSON.stringify(body);
  }
  const res = await fetch(`${SERVER_URL}${path}`, opts);
  const data = await res.json();
  return { status: res.status, ok: res.ok, data };
}

async function getTestUsers() {
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  const db = client.db();
  const users = await db.collection("users")
    .find({})
    .limit(2)
    .project({ _id: 1, email: 1, username: 1, fullName: 1 })
    .toArray();
  await client.close();

  if (users.length < 2) {
    throw new Error(
      `Need ≥2 users in database (found ${users.length}). Run a seed script first:\n` +
      `  cd orbit-server && npx tsx scripts/seed-multiple-users.ts`
    );
  }

  return users.map((u) => ({
    ...u,
    _id: u._id.toString(),
    token: jwt.sign({ userId: u._id.toString() }, JWT_SECRET, {
      issuer: "orbit",
      audience: "orbit-users",
    }),
  }));
}

async function ensureConversation(alice, bob) {
  const mongo = new MongoClient(MONGO_URI);
  await mongo.connect();
  const conversations = mongo.db().collection("conversations");

  // Use ObjectIds to match Mongoose schema (Conversation uses Schema.Types.ObjectId for participants)
  const aliceOid = new ObjectId(alice._id);
  const bobOid = new ObjectId(bob._id);

  let conv = await conversations.findOne({
    participants: { $all: [aliceOid, bobOid] },
  });

  if (!conv) {
    const result = await conversations.insertOne({
      participants: [aliceOid, bobOid],
      unreadCounts: { [alice._id]: 0, [bob._id]: 0 },
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    conv = { _id: result.insertedId };
    console.log(`  📝 Created test conversation: ${conv._id}`);
  } else {
    console.log(`  📝 Using existing conversation: ${conv._id}`);
  }

  await mongo.close();
  return conv._id.toString();
}

// Helper: post a message via HTTP API and return the response
async function sendMessageApi(token, conversationId, text) {
  const formData = new FormData();
  formData.append("text", text);
  return apiCall("POST", `/api/chats/conversations/${conversationId}/messages`, token, formData);
}

// ── Main ────────────────────────────────────────────────────────────
async function main() {
  console.log();
  console.log("┌──────────────────────────────────────────────┐");
  console.log("│     ORBIT Socket.IO E2E Test Suite           │");
  console.log(`│     Server: ${SERVER_URL.padEnd(35)}│`);
  console.log("└──────────────────────────────────────────────┘");
  console.log();

  const users = await getTestUsers();
  const [alice, bob] = users;

  console.log(`Using users: ${alice.username} (Alice) ↔ ${bob.username} (Bob)\n`);

  // Create the conversation between Alice and Bob BEFORE connecting sockets,
  // so the server's presence broadcast (which queries conversation partners)
  // can find Alice ↔ Bob relationship when they connect.
  const convId = await ensureConversation(alice, bob);

  // ── 1. Auth & Connection ────────────────────────────────
  console.log("── 1. Auth & Connection ──");

  // Connect Alice first, then Bob — so Bob is guaranteed to get Alice's presence
  const socketA = ioc(SERVER_URL, {
    auth: { token: alice.token },
    transports: ["websocket"],
  });

  await new Promise((r) => socketA.on("connect", r));
  await new Promise((r) => setTimeout(r, 500)); // let presence propagate

  const socketB = ioc(SERVER_URL, {
    auth: { token: bob.token },
    transports: ["websocket"],
  });

  // Bob registers presence listener BEFORE connecting, so the server's
  // "send current online presences on connect" logic will fire into it
  const presencePromise = waitForAnyEvent(socketB, ["user:presence"], 6000);
  await new Promise((r) => socketB.on("connect", r));

  assert("Alice socket connected", socketA.connected);
  assert("Bob socket connected", socketB.connected);

  const presence = await presencePromise.catch(() => null);
  assert("Bob receives presence event on connect", presence !== null);
  if (presence) {
    assert("Presence status is 'online'", presence.data.status === "online");
    console.log(`     ↳ User ${presence.data.userId.slice(-6)} came online`);
  }

  // ── 2. Chat Events ──────────────────────────────────────
  console.log("\n── 2. Chat Events ──");

  // Both join the conversation room
  socketA.emit("chat:join", { conversationId: convId });
  await new Promise((r) => setTimeout(r, 200));
  socketB.emit("chat:join", { conversationId: convId });
  await new Promise((r) => setTimeout(r, 200));

  // Alice sends a message via the HTTP API → controller calls emitNewMessage()
  const msgPromise = waitForEvent(socketB, "message:new");
  const msgResult = await sendMessageApi(alice.token, convId, `Hello Bob! E2E test at ${new Date().toISOString()}`);
  assert("Message HTTP API returns success", msgResult.ok && msgResult.data?.success);
  const msgSocket = await msgPromise.catch(() => null);
  assert("message:new received by Bob via socket", msgSocket !== null);
  if (msgSocket) {
    assert("Message text preserved in socket event", msgSocket.text && msgSocket.text.includes("Hello Bob"));
    assert("Message has conversation ID", msgSocket.conversation === convId);
  }

  // Bob joins the conversation → server triggers messages:seen for Alice
  const seenPromise = waitForEvent(socketA, "messages:seen");
  socketB.emit("chat:join", { conversationId: convId });
  const seen = await seenPromise.catch(() => null);
  assert("messages:seen received by Alice", seen !== null);
  if (seen) {
    assert("Seen event has conversationId", !!seen.conversationId);
    assert("Seen event has seenBy", !!seen.seenBy);
  }

  // Cleanup chat rooms
  socketA.emit("chat:leave", { conversationId: convId });
  socketB.emit("chat:leave", { conversationId: convId });

  // ── 3. Post Events ──────────────────────────────────────
  console.log("\n── 3. Post Events ──");

  // Create a post via HTTP API → controller calls emitPostCreated()
  const postCreatePromise = waitForEvent(socketB, "post:created");
  const newPostForm = new FormData();
  newPostForm.append("title", "E2E Test Post");
  newPostForm.append("content", `Test content from ${alice.username} at ${new Date().toISOString()}`);
  const postResult = await apiCall("POST", "/api/posts", alice.token, newPostForm);
  assert("Post creation API returns success", postResult.ok && postResult.data?.success);
  const postData = postResult.data?.post;
  const postId = postData?._id;
  assert("Post was created with an ID", !!postId);

  const createdPost = await postCreatePromise.catch(() => null);
  assert("post:created received by Bob via socket", createdPost !== null);
  if (createdPost) {
    assert("Post author is Alice", createdPost.author?._id === alice._id);
    assert("Post title preserved", createdPost.title === "E2E Test Post");
  }

  // ── 4. Like Events ──────────────────────────────────────
  console.log("\n── 4. Like Events ──");

  // Bob likes Alice's post via HTTP → controller calls emitPostLike()
  const likePromise = waitForEvent(socketA, "post:like");
  const likeResult = await apiCall("POST", `/api/likes/post/${postId}`, bob.token);
  assert("Like API returns success", likeResult.ok && likeResult.data?.success);
  const likeEv = await likePromise.catch(() => null);
  assert("post:like received by Alice via socket", likeEv !== null);
  if (likeEv) {
    assert("Like count is positive", likeEv.likesCount >= 1);
    assert("Like event has post ID", likeEv.postId === postId);
  }

  // Bob unlikes via HTTP → controller calls emitPostUnlike()
  const unlikePromise = waitForEvent(socketA, "post:unlike");
  await apiCall("POST", `/api/likes/post/${postId}`, bob.token);
  const unlikeEv = await unlikePromise.catch(() => null);
  assert("post:unlike received by Alice via socket", unlikeEv !== null);

  // ── 5. Save Events ──────────────────────────────────────
  console.log("\n── 5. Save Events ──");

  const savePromise = waitForEvent(socketA, "post:save");
  const saveResult = await apiCall("POST", `/api/saves/${postId}`, bob.token);
  assert("Save API returns success", saveResult.ok && saveResult.data?.success);
  const saveEv = await savePromise.catch(() => null);
  assert("post:save received by Alice via socket", saveEv !== null);

  const unsavePromise = waitForEvent(socketA, "post:unsave");
  await apiCall("POST", `/api/saves/${postId}`, bob.token);
  const unsaveEv = await unsavePromise.catch(() => null);
  assert("post:unsave received by Alice via socket", unsaveEv !== null);

  // ── 6. Repost Events ────────────────────────────────────
  console.log("\n── 6. Repost Events ──");

  const repostPromise = waitForEvent(socketA, "post:repost");
  const repostResult = await apiCall("POST", `/api/reposts/${postId}`, bob.token);
  assert("Repost API returns success", repostResult.ok && repostResult.data?.success);
  const repostEv = await repostPromise.catch(() => null);
  assert("post:repost received by Alice via socket", repostEv !== null);

  const unrepostPromise = waitForEvent(socketA, "post:unrepost");
  await apiCall("POST", `/api/reposts/${postId}`, bob.token);
  const unrepostEv = await unrepostPromise.catch(() => null);
  assert("post:unrepost received by Alice via socket", unrepostEv !== null);

  // ── 7. Comment Events ───────────────────────────────────
  console.log("\n── 7. Comment Events ──");

  const commentPromise = waitForEvent(socketA, "post:comment");
  const commentResult = await apiCall("POST", `/api/comments/${postId}`, bob.token, {
    content: "Great post from the E2E test suite!",
  });
  assert("Comment API returns success", commentResult.ok && commentResult.data?.success);
  const commentEv = await commentPromise.catch(() => null);
  assert("post:comment received by Alice via socket", commentEv !== null);
  if (commentEv) {
    assert("Comment has post ID", commentEv.postId === postId);
    assert("Comment count is positive", commentEv.commentsCount >= 1);
  }

  // ── 8. Follow Events ────────────────────────────────────
  console.log("\n── 8. Follow Events ──");

  // Bob follows Alice via HTTP → controller calls emitFollowUser()
  const followPromise = waitForEvent(socketB, "user:follow");
  const followResult = await apiCall("POST", `/api/follows/${alice._id}`, bob.token);
  assert("Follow API returns success", followResult.ok && followResult.data?.success);
  const followEv = await followPromise.catch(() => null);
  assert("user:follow received by target (Bob himself via personal room)", followEv !== null);
  if (followEv) {
    assert("Follow event has targetUserId", followEv.targetUserId === alice._id);
    assert("Follow event has followerId", followEv.followerId === bob._id);
  }

  // Bob unfollows Alice via HTTP → controller calls emitUnfollowUser()
  const unfollowPromise = waitForEvent(socketB, "user:unfollow");
  await apiCall("POST", `/api/follows/${alice._id}`, bob.token);
  const unfollowEv = await unfollowPromise.catch(() => null);
  assert("user:unfollow received by target via socket", unfollowEv !== null);

  // ── 9. Notification Event ───────────────────────────────
  console.log("\n── 9. Notification Events ──");

  // Unlike triggers a notification to the post author
  // Bob liked Alice's post earlier → the like controller should have sent
  // a notification. Let's verify by listening on Alice's socket.
  const notifPromise = waitForAnyEvent(socketA, ["notification"], 5000);
  // Bob likes Alice's post again to trigger a notification
  const likeAgainResult = await apiCall("POST", `/api/likes/post/${postId}`, bob.token);
  assert("Like API returns success (for notification)", likeAgainResult.ok && likeAgainResult.data?.success);
  const notif = await notifPromise.catch(() => null);
  assert("notification received by Alice via socket", notif !== null);
  if (notif) {
    assert("Notification type is set", !!notif.data.type);
  }

  // ── 10. Post Deletion ───────────────────────────────────
  console.log("\n── 10. Post Deletion ──");

  // Alice deletes her post via HTTP → controller calls emitPostDeleted()
  const deletePromise = waitForEvent(socketB, "post:deleted");
  const deleteResult = await apiCall("DELETE", `/api/posts/${postId}`, alice.token);
  assert("Post deletion API returns success", deleteResult.ok && deleteResult.data?.success);
  const deletedData = await deletePromise.catch(() => null);
  assert("post:deleted received by Bob via socket", deletedData !== null);
  // The emitPostDeleted sends just the postId string
  if (deletedData) {
    const deletedId = typeof deletedData === "string" ? deletedData : deletedData.postId || deletedData._id;
    assert("Deleted post ID matches", deletedId === postId);
  }

  // ── 11. WebRTC signaling relay ───────────────────────────
  // This validates the server portion of a call: offer, answer, and ICE
  // candidates must be delivered to the intended authenticated participant.
  // Browser media capture/TURN connectivity is intentionally tested separately.
  console.log("\n── 11. WebRTC Signaling Relay ──");
  const offerPromise = waitForEvent(socketB, "call:offer");
  const offer = { type: "offer", sdp: "v=0\\r\\no=- 0 0 IN IP4 127.0.0.1" };
  socketA.emit("call:offer", { targetUserId: bob._id, sdp: offer, type: "audio" });
  const receivedOffer = await offerPromise.catch(() => null);
  assert("Call offer relayed to callee", receivedOffer?.callerId === alice._id);
  assert("Call offer SDP preserved", receivedOffer?.sdp?.sdp === offer.sdp);

  const answerPromise = waitForEvent(socketA, "call:answer");
  const answer = { type: "answer", sdp: "v=0\\r\\no=- 1 1 IN IP4 127.0.0.1" };
  socketB.emit("call:answer", { targetUserId: alice._id, sdp: answer });
  const receivedAnswer = await answerPromise.catch(() => null);
  assert("Call answer relayed to caller", receivedAnswer?.calleeId === bob._id);
  assert("Call answer SDP preserved", receivedAnswer?.sdp?.sdp === answer.sdp);

  const candidatePromise = waitForEvent(socketB, "call:ice-candidate");
  const candidate = { candidate: "candidate:1 1 udp 1 127.0.0.1 9 typ host", sdpMid: "0", sdpMLineIndex: 0 };
  socketA.emit("call:ice-candidate", { targetUserId: bob._id, candidate });
  const receivedCandidate = await candidatePromise.catch(() => null);
  assert("ICE candidate relayed to callee", receivedCandidate?.senderId === alice._id);
  assert("ICE candidate preserved", receivedCandidate?.candidate?.candidate === candidate.candidate);

  // ── Cleanup ─────────────────────────────────────────────
  socketA.disconnect();
  socketB.disconnect();

  // ── Results ─────────────────────────────────────────────
  console.log();
  console.log("┌──────────────────────────────────────────────┐");

  if (failures.length > 0) {
    console.log(`│  ❌  ${failed}/${passed + failed} tests FAILED               │`);
    console.log("├──────────────────────────────────────────────┤");
    for (const f of failures) {
      console.log(`│  • ${(f.label + (f.detail ? `: ${f.detail}` : "")).padEnd(44)}│`);
    }
  } else {
    console.log(`│  ✅  All ${passed} tests PASSED!                        │`);
  }
  console.log("└──────────────────────────────────────────────┘");
  console.log();

  process.exit(failures.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("\n❌ Fatal error:", err.message);
  console.error(err.stack);
  process.exit(1);
});
