import { Server as SocketIOServer, Socket } from "socket.io";
import http from "http";
import os from "os";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import * as cookie from "cookie";
import { Redis } from "ioredis";
import { createAdapter } from "@socket.io/redis-adapter";
import { env } from "./env";
import { resolveClientIp } from "./trustProxy";
import { logger } from "../utilities/logger";
import { getCache, setCache, deleteCache, clearChatCache } from "./cache";
import { redis } from "./redis";
import { Conversation } from "../models/conversation.model";
import { CommunityMessage, SEENBY_CAP } from "../models/communityMessage.model";
import { Community } from "../models/community.model";
import { Message } from "../models/message.model";
import Post from "../models/post.model";
import Comment from "../models/comment.model";
import Block from "../models/block.model";
import { User } from "../models/user.model";
import { createNotification } from "../utilities/notification";

// Extended socket type with auth properties
type UserSocket = Socket & {
  userId?: string;
  isAuthenticated?: boolean;
  activeConversationId?: string;
};

let io: SocketIOServer;

// Track online users in-memory for reliable presence broadcasts
const onlineUsers = new Set<string>();

// ── Realtime event log (reconnect backfill) ─────────────────────────────
// Every user-scoped realtime event (messages, notifications, follows) is
// appended to a per-user Redis list so a client that was disconnected
// (mobile backgrounding, socket blips) can request "everything since X"
// on reconnect and catch up — no reload needed. Without this, an event
// emitted while the socket was dead was LOST forever, which is why users
// had to reload 10-20 times to see a comment/community/message.
const RT_EVENT_LOG_TTL = 2 * 60 * 60; // 2h — long enough for a phone to stay backgrounded
const RT_EVENT_LOG_MAX = 50; // cap per user — reduced from 200 to save Redis writes

const rtEventLogKey = (userId: string) => `rt:events:${userId}`;

// Counter to throttle expensive ltrim/expire operations — only run them
// every N writes instead of on EVERY event. This cuts 3 Redis commands
// down to 1 for most events (~66% fewer Redis calls from event logging).
let eventWriteCounter = 0;
const TRIM_EVERY_N = 10; // trim + expire every 10 events per user

/**
 * Append an event to a user's realtime log (best-effort, never throws).
 * Only call for user-scoped events — the sender/recipient are known.
 *
 * Optimized: only RPUSH on every call; LTRIM + EXPIRE are batched every
 * TRIM_EVERY_N writes to reduce Redis round-trips on the free tier.
 */
export const logUserRealtimeEvent = async (
  userId: string,
  event: string,
  payload: unknown,
): Promise<void> => {
  try {
    const key = rtEventLogKey(userId);
    const entry = JSON.stringify({ ts: Date.now(), event, payload });
    // Always push (1 Redis command per event)
    await redis.rpush(key, entry);
    // Only trim + expire every N writes to save Redis commands
    eventWriteCounter++;
    if (eventWriteCounter % TRIM_EVERY_N === 0) {
      await redis.ltrim(key, -RT_EVENT_LOG_MAX, -1);
      await redis.expire(key, RT_EVENT_LOG_TTL);
    }
  } catch (err: any) {
    logger.warn("logUserRealtimeEvent failed", { error: err.message });
  }
};

/**
 * Fetch a user's logged events newer than `sinceTs` (epoch ms).
 * Returns them oldest-first so the client applies them in order.
 */
export const getRealtimeEventsSince = async (
  userId: string,
  sinceTs: number,
): Promise<{ ts: number; event: string; payload: any }[]> => {
  try {
    const raw = await redis.lrange(rtEventLogKey(userId), 0, -1);
    if (!raw || raw.length === 0) return [];
    const events: { ts: number; event: string; payload: any }[] = [];
    for (const entry of raw) {
      try {
        const parsed = JSON.parse(entry);
        if (parsed.ts > sinceTs) events.push(parsed);
      } catch {
        // skip malformed entries
      }
    }
    // lrange returns oldest→newest (we rpush), so it's already in order
    return events;
  } catch (err: any) {
    logger.warn("getRealtimeEventsSince failed", { error: err.message });
    return [];
  }
};

// Live socket count per user. One account can hold several sockets at once
// (phone + PC, or a tab backgrounding and reconnecting). The account must
// stay "online" until the LAST socket disconnects — otherwise a phone
// backgrounding (which kills its WebSocket) would instantly flip the whole
// account offline on every other device.
const userSocketCounts = new Map<string, number>();

/**
 * Adjusts the live socket count for a user. Returns the remaining count
 * after this socket (dis)connects. The disconnect handler uses the result
 * to decide whether to mark the user offline: only when the count hits 0
 * (the last device closed its socket).
 */
const countUserSocket = (userId: string, delta: 1 | -1): number => {
  const next = (userSocketCounts.get(userId) || 0) + delta;
  if (next <= 0) {
    userSocketCounts.delete(userId);
    return 0;
  }
  userSocketCounts.set(userId, next);
  return next;
};

/**
 * Returns the IDs of every community the user is a member of.
 * Cached in Redis for 5 minutes so connect/disconnect (frequent on mobile)
 * doesn't hit the DB every time. The join/leave controllers invalidate via
 * a short TTL trade-off; join/leave also emit presence directly.
 */
const getUserCommunityIds = async (userId: string): Promise<string[]> => {
  try {
    const cached = await getCache<string[]>(`user:communities:${userId}`);
    if (cached && cached.length > 0) return cached;
    const communities = await Community.find({ "members.user": userId })
      .select("_id")
      .lean();
    const ids = communities.map((c: any) => c._id.toString());
    setCache(`user:communities:${userId}`, ids, 300).catch(() => {});
    return ids;
  } catch (error: any) {
    logger.error("Failed to fetch user community IDs", {
      error: error.message,
      userId,
    });
    return [];
  }
};

/**
 * True when the user has an active socket connection (in-memory presence).
 * Used by the community join/leave controllers to announce membership.
 */
export const isUserOnline = (userId: string): boolean => {
  return onlineUsers.has(userId);
};

/**
 * Number of users currently connected to this instance (in-memory presence).
 * Used by the admin stats endpoint as the authoritative "online now" count —
 * the Redis presence keys are only a short-TTL mirror and updatedAt is bumped
 * by logins/profile edits, so neither is a reliable activity signal.
 */
export const getOnlineUsersCount = (): number => {
  return onlineUsers.size;
};

/**
 * Bot-presence bridge — lets simulated users appear ONLINE exactly like a
 * real connected socket: green dots in chat lists, "active now" counts in
 * communities, presence events to their conversation partners. The bot farm
 * scheduler calls this for awake bots (and markUserOffline for sleeping
 * ones) so bots show the same live status signals real users get, without
 * ever holding a real socket connection.
 */
export const markUserOnline = async (userId: string): Promise<void> => {
  try {
    if (onlineUsers.has(userId)) return;
    onlineUsers.add(userId);

    // Notify conversation partners (same shape a socket connect sends)
    const conversations = await Conversation.find({ participants: userId })
      .select("participants")
      .lean();
    const partnerIds: string[] = [];
    for (const conv of conversations) {
      const other = conv.participants.find(
        (p: any) => p.toString() !== userId,
      );
      if (other) partnerIds.push(other.toString());
    }
    for (const otherId of new Set(partnerIds)) {
      getIO().to(`user:${otherId}`).emit("user:presence", {
        userId,
        status: "online",
      });
    }

    // Notify communities (live green dots in community member lists)
    const communityIds = await getUserCommunityIds(userId);
    for (const cid of communityIds) {
      getIO()
        .to(`community:${cid}`)
        .emit("community:presence", { communityId: cid, userId, status: "online" });
    }
  } catch (error: any) {
    logger.error("markUserOnline failed", { error: error.message, userId });
  }
};

/** Remove a simulated user from live presence (night sleep, farm stopped). */
export const markUserOffline = async (userId: string): Promise<void> => {
  try {
    if (!onlineUsers.has(userId)) return;
    onlineUsers.delete(userId);

    const conversations = await Conversation.find({ participants: userId })
      .select("participants")
      .lean();
    const partnerIds: string[] = [];
    for (const conv of conversations) {
      const other = conv.participants.find(
        (p: any) => p.toString() !== userId,
      );
      if (other) partnerIds.push(other.toString());
    }
    for (const otherId of new Set(partnerIds)) {
      getIO().to(`user:${otherId}`).emit("user:presence", {
        userId,
        status: "offline",
      });
    }

    const communityIds = await getUserCommunityIds(userId);
    for (const cid of communityIds) {
      getIO()
        .to(`community:${cid}`)
        .emit("community:presence", { communityId: cid, userId, status: "offline" });
    }
  } catch (error: any) {
    logger.error("markUserOffline failed", { error: error.message, userId });
  }
};

/**
 * Broadcasts a member's online/offline status to a community room so every
 * open community chat can show live green dots (like personal chat presence).
 */
export const emitCommunityPresence = (
  communityId: string,
  userId: string,
  status: "online" | "offline",
) => {
  try {
    getIO()
      .to(`community:${communityId}`)
      .emit("community:presence", { communityId, userId, status });
  } catch (error: any) {
    logger.error("Failed to emit community presence", {
      error: error.message,
      communityId,
      userId,
    });
  }
};

// Track active community group calls (LiveKit) so other members can be
// notified to join the same room. Map: communityId -> call info
// participants is a Set of userIds currently in the call — used to clear
// the record when the LAST participant leaves (crash-safe, not starter-only).
const activeCommunityCalls = new Map<
  string,
  {
    roomName: string;
    type: "audio" | "video";
    startedBy: string;
    startedAt: number;
    participants: Set<string>;
  }
>();

// Expire stale group-call records after 10 minutes so a crashed starter's
// call doesn't leave a phantom "join call" banner forever.
const CALL_RECORD_TTL_MS = 10 * 60 * 1000;

// ── Call activity system messages (WhatsApp-style) ────────────────────
// WhatsApp shows centered "Voice call started / ended" chips inside the chat
// history. We record those as system messages so BOTH participants see the
// call event in their conversation (and the list preview shows it).

// In-flight 1:1 WebRTC calls — keyed by sorted user pair so we can attach a
// duration to the "ended" message and avoid double-recording (both peers
// emit call:end when the call finishes).
const activeDirectCalls = new Map<
  string,
  {
    type: "audio" | "video";
    startedAt: number | null;
    createdAt: number;
  }
>();

const callPairKey = (a: string, b: string) => [a, b].sort().join("|");

// Rings that were never answered (and whose caller never emitted call:missed
// — e.g. the tab was closed mid-ring) would otherwise linger in memory
// forever. Drop any entry that never connected after 5 minutes (the client
// ring timeout is 45s, so 5 min is generous but safe).
const pruneStaleDirectCalls = () => {
  const now = Date.now();
  for (const [key, entry] of activeDirectCalls) {
    if (entry.startedAt === null && now - entry.createdAt > 5 * 60 * 1000) {
      activeDirectCalls.delete(key);
    }
  }
};

// Emit a freshly-saved system message to both participants' sockets + update
// the conversation's lastMessage preview (without touching unread counts —
// call events are not unread-able). Mirrors the sendMessage emit path.
const emitDirectCallSystemMessage = async (message: any) => {
  const populated = await Message.findById(message._id)
    .populate("sender", "username fullName profilePic isVerified statusText waitlistPerk")
    .lean();
  if (!populated) return;

  await Conversation.updateOne(
    { _id: message.conversation },
    { lastMessage: message._id, lastAction: null },
  );

  emitNewMessage(message.conversation.toString(), populated);
  io.to(`user:${message.sender}`).emit("message:new", populated);
  io.to(`user:${message.recipient}`).emit("message:new", populated);

  // Drop cached message lists so a reload shows the system message.
  clearChatCache(
    message.conversation.toString(),
    [message.sender.toString(), message.recipient.toString()],
  ).catch(() => {});
  logger.info("Recorded call system message", {
    system: message.system,
    conversationId: message.conversation.toString(),
  });
};

// Create a "call started/ended/missed" system message in the 1:1
// conversation between two users (looked up by participant pair).
// Exported so the bot farm can have bots "call" real users (missed calls).
export const recordDirectCallSystemMessage = async (params: {
  userA: string;
  userB: string;
  system: "call_started" | "call_ended" | "call_missed";
  callType: "audio" | "video";
  callDuration?: number;
}) => {
  try {
    const conversation = await Conversation.findOne({
      participants: { $all: [params.userA, params.userB] },
    })
      .select("_id")
      .lean();
    if (!conversation) return;

    const message = await Message.create({
      conversation: conversation._id,
      sender: params.userA,
      recipient: params.userB,
      system: params.system,
      callType: params.callType,
      callDuration: params.callDuration || 0,
      text: "",
      seen: true,
    });
    await emitDirectCallSystemMessage(message);

    // Call events → notify the CALLEE (in-app notification + device push,
    // like WhatsApp's call log):
    //   • call_missed  → "Alex tried to call you"
    //   • call_started → "Alex called you"
    //   • call_ended   → "Call ended · 12m 30s" (with duration)
    // createNotification handles block checks, per-category prefs, the
    // socket emit and the push, so nothing else is needed here.
    if (params.system === "call_missed") {
      // Mark the conversation so the CALLEE's chat list shows the red
      // missed-call badge (cleared when they open the conversation).
      await Conversation.updateOne(
        { _id: conversation._id },
        {
          $set: {
            missedCall: {
              for: params.userB,
              by: params.userA,
              callType: params.callType,
              createdAt: new Date(),
            },
          },
        },
      );
      await createNotification({
        recipient: params.userB, // callee
        sender: params.userA, // caller
        type: "call_missed",
        callType: params.callType,
      });
    } else if (params.system === "call_started") {
      await createNotification({
        recipient: params.userB, // callee
        sender: params.userA, // caller
        type: "call_started",
        callType: params.callType,
      });
    } else if (params.system === "call_ended") {
      // Both participants get a call-log record — the wording is neutral
      // ("Call with X ended · 12m 30s"), so it reads correctly for each.
      await Promise.allSettled([
        createNotification({
          recipient: params.userB, // callee
          sender: params.userA, // caller
          type: "call_ended",
          callType: params.callType,
          callDuration: params.callDuration || 0,
        }),
        createNotification({
          recipient: params.userA, // caller — swapped sender avoids the
          sender: params.userB, // self-notification skip
          type: "call_ended",
          callType: params.callType,
          callDuration: params.callDuration || 0,
        }),
      ]);
    }
  } catch (err: any) {
    logger.error("Failed to record call system message", {
      error: err.message,
      system: params.system,
    });
  }
};

// Notify ONLINE members that a community call just started, so they can jump
// in. Skips the starter, caps at 30 recipients (a huge community can't flood
// everyone's bell), and only hits users currently connected — a member who
// opens the app later still sees the in-chat "call started" chip instead.
//
// NOTE: `onlineUsers` is process-local. With the Redis socket.io adapter
// (multi-instance), members connected to OTHER instances may be missed — a
// graceful degradation: they still see the in-chat chip on next open.
const notifyCommunityCallStarted = async (
  communityId: string,
  starterId: string,
  callType: "audio" | "video",
) => {
  try {
    const community = await Community.findById(communityId)
      .select("members.user")
      .lean();
    if (!community?.members?.length) return;

    const memberIds: string[] = [];
    for (const m of community.members as any[]) {
      const id = m?.user?.toString();
      if (id && id !== starterId && onlineUsers.has(id)) {
        memberIds.push(id);
      }
    }

    // Cap recipients to keep bursts bounded (typical groups are way under),
    // shuffling first so a large community doesn't always notify the same
    // first-30 members.
    const recipients = memberIds
      .map((id) => ({ id, r: Math.random() }))
      .sort((a, b) => a.r - b.r)
      .slice(0, 30)
      .map((o) => o.id);
    if (recipients.length === 0) return;

    await Promise.allSettled(
      recipients.map((recipientId) =>
        createNotification({
          recipient: recipientId,
          sender: starterId,
          type: "call_started",
          community: communityId,
          callType,
        }),
      ),
    );
    logger.info("Notified online members of community call", {
      communityId,
      recipients: recipients.length,
    });
  } catch (err: any) {
    logger.error("Failed to notify community call started", {
      error: err.message,
      communityId,
    });
  }
};

// Community call system message — recorded in the community's general room
// (room: null) so it shows in the main chat timeline like WhatsApp.
const recordCommunityCallSystemMessage = async (params: {
  communityId: string;
  senderId: string;
  system: "call_started" | "call_ended";
  callType: "audio" | "video";
  callDuration?: number;
}) => {
  try {
    const message = await CommunityMessage.create({
      community: params.communityId,
      room: null,
      sender: params.senderId,
      system: params.system,
      callType: params.callType,
      callDuration: params.callDuration || 0,
      text: "",
    });
    const populated = await CommunityMessage.findById(message._id)
      .populate("sender", "username fullName profilePic isVerified statusText waitlistPerk")
      .lean();
    if (populated) {
      io.to(`community:${params.communityId}`).emit(
        "community:message:new",
        populated,
      );
    }
    logger.info("Recorded community call system message", {
      system: params.system,
      communityId: params.communityId,
    });
  } catch (err: any) {
    logger.error("Failed to record community call system message", {
      error: err.message,
      system: params.system,
    });
  }
};

const pruneStaleCommunityCalls = () => {
  const now = Date.now();
  for (const [communityId, call] of activeCommunityCalls) {
    if (now - call.startedAt > CALL_RECORD_TTL_MS) {
      activeCommunityCalls.delete(communityId);
      logger.info("Expired stale community group call record", { communityId });
    }
  }
};

// Module-level references for Redis adapter clients (needed for graceful shutdown)
let redisPubClient: Redis | null = null;
let redisSubClient: Redis | null = null;

// Track connection attempts for rate limiting — in-memory to save Redis commands.
// Per-instance state is fine on a single free-tier instance.
const socketRateWindows = new Map<string, number[]>();
const SOCKET_RATE_WINDOW_MS = 60_000;
const SOCKET_RATE_MAX = 60; // 60/min — mobile browsers reconnect often

const checkConnectionRateLimit = (ip: string): boolean => {
  try {
    const now = Date.now();
    const windowStart = now - SOCKET_RATE_WINDOW_MS;
    const hits = (socketRateWindows.get(ip) || []).filter(
      (t) => t > windowStart,
    );

    if (hits.length >= SOCKET_RATE_MAX) {
      return false;
    }

    hits.push(now);
    socketRateWindows.set(ip, hits);

    // Bound memory: drop IPs idle for > 2 minutes
    if (socketRateWindows.size > 5_000) {
      const expireAt = now - SOCKET_RATE_WINDOW_MS * 2;
      for (const [key, arr] of socketRateWindows) {
        if ((arr[arr.length - 1] ?? 0) < expireAt) {
          socketRateWindows.delete(key);
        }
      }
    }

    return true;
  } catch {
    return true;
  }
};

export const initSocket = async (server: http.Server) => {
  io = new SocketIOServer(server, {
    cors: {
      origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
        if (!origin) {
          callback(null, true);
          return;
        }
        const originWithoutSlash = origin.replace(/\/$/, "");

        // In development, allow any localhost origin
        if (env.NODE_ENV === "development") {
          const isLocalhost =
            originWithoutSlash.startsWith("http://localhost:") ||
            originWithoutSlash.startsWith("http://127.0.0.1:") ||
            originWithoutSlash.startsWith("https://localhost:") ||
            originWithoutSlash.startsWith("https://127.0.0.1:");
          if (isLocalhost) {
            callback(null, true);
            return;
          }
        }

        // Also check the configured CLIENT_URL
        if (originWithoutSlash === env.CLIENT_URL.replace(/\/$/, "")) {
          callback(null, true);
          return;
        }

        callback(new Error("Not allowed by CORS"));
      },
      credentials: true,
    },
    perMessageDeflate: {
      threshold: 1024, // only compress messages > 1 KB
    },
    connectTimeout: 10000,
    maxHttpBufferSize: 100_000,
  });

  // ── Redis adapter for multi-instance support ─────────────
  // Allows Socket.io events to broadcast across multiple server processes
  // (cluster workers) via Redis pub/sub. In single-process mode every emit
  // stays in-memory — routing realtime events through Upstash pub/sub would
  // burn the free-tier command quota for nothing (each event is a publish).
  // Mirrors server.ts's cluster detection so the gate can't drift; an
  // explicit SOCKET_REDIS_ADAPTER=true env override forces it on for
  // multi-service deployments (e.g. several Render instances behind a proxy).
  const isClusterWorkerMode =
    process.env.NODE_ENV === "production" &&
    process.env.CLUSTER_ENABLED !== "false" &&
    Math.min(
      os.cpus().length,
      parseInt(process.env.CLUSTER_MAX_WORKERS || "2", 10),
    ) > 1;
  const useRedisAdapter =
    process.env.SOCKET_REDIS_ADAPTER === "true" || isClusterWorkerMode;

  try {
    // Trim aggressively — pasted env vars often carry trailing newlines/
    // quotes that would make ioredis fail to connect. A malformed URL must
    // fall back to single-instance mode, not crash boot.
    const redisUrl = (
      env.UPSTASH_REDIS_URL
        ? env.UPSTASH_REDIS_URL.trim().replace(/^"|"$/g, "")
        : env.UPSTASH_REDIS_REST_URL
          ? `rediss://default:${(env.UPSTASH_REDIS_REST_TOKEN || "").trim()}@${new URL(env.UPSTASH_REDIS_REST_URL.trim().replace(/^"|"$/g, "")).hostname}:6379`
          : null
    );

    if (useRedisAdapter && redisUrl && /^rediss?:\/\//i.test(redisUrl)) {
      redisPubClient = new Redis(redisUrl, {
        tls: { rejectUnauthorized: false },
        enableReadyCheck: true,
        lazyConnect: true,
        connectTimeout: 10000,
        maxRetriesPerRequest: 3,
        retryStrategy: (times) => Math.min(times * 200, 3000),
      });
      redisSubClient = redisPubClient.duplicate();

      // ioredis emits 'error' on the client when a connection dies — without
      // a listener it prints "[ioredis] Unhandled error event" (e.g. the
      // EPIPE during shutdown teardown). Log it instead; the adapter handles
      // reconnects on its own.
      redisPubClient.on("error", (err: Error) => {
        logger.warn("Socket.io Redis pubClient error", {
          error: err.message,
        });
      });
      redisSubClient.on("error", (err: Error) => {
        logger.warn("Socket.io Redis subClient error", {
          error: err.message,
        });
      });

      await Promise.all([redisPubClient.connect(), redisSubClient.connect()]);

      io.adapter(createAdapter(redisPubClient, redisSubClient));
      logger.info(
        "Socket.io Redis adapter initialized for multi-instance support",
      );
    } else {
      logger.info(
        useRedisAdapter
          ? "Socket.io Redis adapter skipped (no Redis URL configured)"
          : "Socket.io running in single-instance mode — in-memory adapter (no Redis pub/sub traffic)",
      );
    }
  } catch (error: any) {
    logger.warn("Failed to initialize Socket.io Redis adapter, falling back to single-instance mode", {
      error: error.message,
    });
  }

  io.use(async (socket: Socket, next) => {
    const s = socket as UserSocket;
    // Resolve the real client IP for the connection limiter — skips internal
    // proxy hops (Render's 10.x edge under the Vercel→Render topology) so a
    // flaky mobile connection can't exhaust a shared internal-IP bucket.
    const remoteAddress = socket.conn.remoteAddress || "unknown";
    const clientIp = resolveClientIp({
      remoteAddress,
      xForwardedFor:
        typeof socket.handshake.headers["x-forwarded-for"] === "string"
          ? (socket.handshake.headers["x-forwarded-for"] as string)
          : undefined,
    });
    
    // Rate limit connections using Redis
    const allowed = checkConnectionRateLimit(clientIp);
    if (!allowed) {
      logger.warn("Socket connection rate limited", { ip: clientIp });
      return next(new Error("Too many connection attempts. Please try again later."));
    }

    let token = socket.handshake.auth.token || socket.handshake.headers.token;

    // Also check cookies if token not found in auth/headers
    if (!token && socket.handshake.headers.cookie) {
      const cookies = cookie.parse(socket.handshake.headers.cookie);
      token = cookies.jwt;
    }

    if (token) {
      try {
        const decoded = jwt.verify(token, env.JWT_SECRET, {
          issuer: "orbit",
          audience: "orbit-users",
        }) as any;
        s.userId = decoded.userId;
        s.isAuthenticated = true;
        logger.info("Socket authenticated", { userId: s.userId, ip: clientIp });
      } catch (error) {
        // Invalid token - log but allow connection for public events
        logger.warn("Socket auth failed with invalid token", { 
          ip: clientIp,
          error: error instanceof Error ? error.message : "Unknown error"
        });
        s.isAuthenticated = false;
      }
    } else {
      s.isAuthenticated = false;
    }
    
    next();
  });

  io.on("connection", (socket: Socket) => {
    const s = socket as UserSocket;

    // Calls can only be signalled between users who share a direct-message
    // conversation. This prevents an authenticated account from using the
    // signalling server to ring arbitrary users or relay malformed payloads.
    const canRelayCall = async (
      targetUserId: unknown,
      opts?: { skipBlockCheck?: boolean },
    ): Promise<boolean> => {
      const skipBlockCheck = opts?.skipBlockCheck === true;
      if (
        !s.userId ||
        typeof targetUserId !== "string" ||
        targetUserId === s.userId ||
        !mongoose.isObjectIdOrHexString(targetUserId)
      ) {
        return false;
      }

      if (!s.data) {
        s.data = {};
      }
      if (!s.data.authorizedCalls) {
        s.data.authorizedCalls = new Set<string>();
      }

      // Block status is re-checked on every security-critical (and
      // low-frequency) relay — a block created mid-session must stop a
      // previously-authorized target from ringing again. The one exception
      // is the high-frequency call:ice-candidate path (passes
      // skipBlockCheck): candidates only flow after an offer/answer has
      // already been exchanged, and the next offer re-checks the block, so
      // a mid-call block is torn down at the signaling layer without
      // paying a DB round-trip per candidate.
      if (!skipBlockCheck) {
        const isBlocked = await Block.exists({
          $or: [
            { blocker: s.userId, blocked: targetUserId },
            { blocker: targetUserId, blocked: s.userId },
          ],
        });
        if (isBlocked) {
          s.data.authorizedCalls.delete(targetUserId);
          return false;
        }
      }

      if (s.data.authorizedCalls.has(targetUserId)) {
        return true;
      }

      const sharedConversation = await Conversation.exists({
        participants: { $all: [s.userId, targetUserId] },
      });
      
      const allowed = Boolean(sharedConversation);
      if (allowed) {
        s.data.authorizedCalls.add(targetUserId);
      }
      return allowed;
    };
    logger.info("User connected", { 
      userId: s.userId, 
      isAuthenticated: s.isAuthenticated,
      socketId: socket.id 
    });

    if (s.userId) {
      socket.join(`user:${s.userId}`);
      onlineUsers.add(s.userId);
      // One more live socket for this account (multi-device presence)
      countUserSocket(s.userId, 1);

      // Broadcast presence IMMEDIATELY — not gated behind Redis.
      // Mobile browsers kill WebSocket when backgrounded, so we need to fire
      // presence as fast as possible before the user switches away.
      //
      // Uses CACHED conversation partner IDs to avoid a DB query on every
      // connect/disconnect (which can be frequent with mobile backgrounding).
      const broadcastOnline = async () => {
        try {
          // Try Redis cache first for conversation partner IDs
          const cachedPartners = await getCache<string[]>(`user:partners:${s.userId}`);
          let partnerIds: string[] = [];

          if (cachedPartners && cachedPartners.length > 0) {
            partnerIds = cachedPartners;
          } else {
            // Cache miss — query DB and cache for 5 minutes
            const conversations = await Conversation.find({ participants: s.userId }).select("participants").lean();
            partnerIds = conversations
              .map((conv) => {
                const other = conv.participants.find((p: any) => p.toString() !== s.userId);
                return other ? other.toString() : null;
              })
              .filter(Boolean) as string[];

            // Cache partner IDs (5 min TTL — new conversations update via clearByPattern on creation)
            setCache(`user:partners:${s.userId}`, partnerIds, 300).catch(() => {});
          }

          // Notify partners that this user is online
          for (const otherId of partnerIds) {
            io.to(`user:${otherId}`).emit("user:presence", {
              userId: s.userId,
              status: "online",
            });
          }

          // Send partner presences to the newly connected user
          for (const otherId of partnerIds) {
            if (onlineUsers.has(otherId)) {
              io.to(`user:${s.userId}`).emit("user:presence", {
                userId: otherId,
                status: "online",
              });
            }
          }
        } catch (error: any) {
          logger.error("Error broadcasting online presence", { error: error.message, userId: s.userId });
        }
      };

      // Fire immediately (no await — don't block connection for this)
      broadcastOnline();

      // Broadcast presence to every community the user belongs to (live green
      // dots for community chats), and sync the current online members back to
      // the newly connected user so community chats show who's active without
      // waiting for a community:join round-trip.
      const broadcastCommunityPresence = async () => {
        try {
          const communityIds = await getUserCommunityIds(s.userId!);
          if (communityIds.length === 0) return;
          for (const cid of communityIds) {
            io.to(`community:${cid}`).emit("community:presence", {
              communityId: cid,
              userId: s.userId,
              status: "online",
            });
          }
          // One query for all member lists, then send per-community sync
          const communities = await Community.find({
            _id: { $in: communityIds },
          })
            .select("members")
            .lean();
          for (const community of communities) {
            const memberIds = ((community as any).members || [])
              .map((m: any) => m.user?.toString())
              .filter(Boolean) as string[];
            const onlineIds = memberIds.filter(
              (id: string) => id !== s.userId && onlineUsers.has(id),
            );
            if (onlineIds.length > 0) {
              io.to(`user:${s.userId}`).emit("community:presence:sync", {
                communityId: (community as any)._id.toString(),
                onlineUserIds: onlineIds,
              });
            }
          }
        } catch (error: any) {
          logger.error("Error broadcasting community online presence", {
            error: error.message,
            userId: s.userId,
          });
        }
      };
      broadcastCommunityPresence();

      // Redis: persist presence in background with short TTL (60s)
      setCache(`presence:user:${s.userId}`, "online", 60).catch(err => {
        logger.error("Failed to set user presence in Redis", { error: err instanceof Error ? err.message : String(err), userId: s.userId });
      });
      // Record "last seen" so partners can show "last seen Xm ago" once the
      // user goes offline. Long TTL (7 days) — "last seen yesterday" etc.
      // needs the stamp to outlive the online session. One extra write per
      // connection only (heartbeat stays single-write) to protect the Redis
      // budget.
      setCache(`presence:user:${s.userId}:lastseen`, Date.now(), 60 * 60 * 24 * 7).catch(err => {
        logger.error("Failed to set user last-seen in Redis", { error: err instanceof Error ? err.message : String(err), userId: s.userId });
      });
    }

    // Presence heartbeat — client sends this periodically to refresh their online status.
    // Without this, brief network blips (e.g. mobile backgrounding, tab switches) can
    // cause the user to fall out of onlineUsers, making them appear offline to partners.
    socket.on("presence:heartbeat", () => {
      if (!s.userId) return;

      // Refresh in-memory presence (may have been cleared by a stale disconnect event)
      onlineUsers.add(s.userId);

      // Refresh Redis TTL so getUserPresenceStatus() returns "online"
      setCache(`presence:user:${s.userId}`, "online", 60).catch(err => {
        logger.error("Failed to refresh presence in Redis on heartbeat", { error: err instanceof Error ? err.message : String(err), userId: s.userId });
      });
    });

    // Reconnect backfill — the client sends the ts of the last realtime event
    // it processed; we replay everything newer from its per-user event log so
    // nothing is lost when the socket was dead (mobile backgrounding, blips).
    // Without this, missed events were only recovered by reloading 10-20 times.
    socket.on("events:sync", async ({ since }: { since?: number } = {}) => {
      if (!s.userId) return;
      try {
        const events = await getRealtimeEventsSince(
          s.userId,
          typeof since === "number" && since > 0 ? since : 0,
        );
        if (events.length === 0) return;
        for (const ev of events) {
          // Re-emit through THIS socket so every existing client handler
          // (App.tsx, Chat.tsx, Communities.tsx…) runs exactly as if the
          // event had arrived live — no client-side replay mapping needed.
          s.emit(ev.event, ev.payload);
        }
        logger.info("Replayed realtime events on reconnect", {
          userId: s.userId,
          count: events.length,
        });
      } catch (err: any) {
        logger.error("events:sync failed", { error: err.message, userId: s.userId });
      }
    });

    // Join conversation room
    socket.on("chat:join", async ({ conversationId }) => {
      if (!s.userId || !conversationId || !mongoose.Types.ObjectId.isValid(conversationId)) return;
      // Narrowed copy for the fire-and-forget bookkeeping closure below (TS
      // narrowing does not flow into nested functions).
      const joiningUserId = s.userId;

      try {
        const conversation = await Conversation.findById(conversationId).select("participants").lean();
        if (!conversation) return;

        const isParticipant = (conversation.participants || []).some(
          (p: any) => p.toString() === s.userId
        );
        if (!isParticipant) {
          logger.warn("Unauthorized socket attempt to join chat room", { userId: s.userId, conversationId });
          return;
        }

        s.data.activeConversationId = conversationId;
        socket.join(`conversation:${conversationId}`);
        logger.info("Socket joined conversation", { userId: s.userId, conversationId });

        // Mark all messages from the other user in this conversation as seen
        await Message.updateMany(
          { conversation: conversationId, recipient: s.userId, seen: false },
          { $set: { seen: true, seenAt: new Date() } }
        );

        // Emit messages:seen IMMEDIATELY after the mark — the sender's blue
        // tick must not wait for the unread/missed-call bookkeeping below.
        // On slow infrastructure those extra sequential DB round-trips used to
        // delay the tick by several seconds, which reads as "ticks not
        // real-time". Always emitted — even when modifiedCount was 0 the UI
        // needs the event to show double-ticks for already-seen messages.
        io.to(`conversation:${conversationId}`).emit("messages:seen", {
          conversationId,
          seenBy: s.userId,
          seenAt: new Date(),
        });

        // The rest is bookkeeping (unread badge, missed-call badge, cache
        // eviction) — fire it without blocking the seen-tick broadcast above.
        void (async () => {
          try {
            // Always clear unread counts when joining (even if no unseen messages)
            await Conversation.findByIdAndUpdate(conversationId, {
              $set: { [`unreadCounts.${s.userId}`]: 0 }
            });

            // A missed-call badge belonging to this user is cleared the moment
            // they open the conversation (WhatsApp behavior). Broadcast so the
            // badge also disappears on the user's OTHER devices, and drop the
            // cached conversation list so a reload can't resurrect it.
            const missedCallClear = await Conversation.updateOne(
              { _id: conversationId, "missedCall.for": s.userId },
              { $set: { missedCall: null } },
            );
            if (missedCallClear.modifiedCount > 0) {
              io.to(`user:${joiningUserId}`).emit(
                "conversation:missed-call-cleared",
                { conversationId },
              );
              clearChatCache(conversationId, [joiningUserId]).catch(() => {});
            }

            // Delivered receipts: opening the conversation means this user's
            // device has now received every incoming message (they were
            // offline until now). Bulk-mark the undelivered ones so the
            // sender's "Message info" panel shows a Delivered time after a
            // reload — the seen update above already covers the blue tick.
            await Message.updateMany(
              {
                conversation: conversationId,
                recipient: joiningUserId,
                deliveredAt: null,
              },
              { $set: { deliveredAt: new Date() } },
            );
          } catch (err: any) {
            logger.error("Error in chat:join bookkeeping", {
              error: err.message,
              conversationId,
              userId: s.userId,
            });
          }
        })();
      } catch (error: any) {
        logger.error("Error marking messages seen on chat:join", { error: error.message, conversationId, userId: s.userId });
      }
    });

    // Leave conversation room
    socket.on("chat:leave", ({ conversationId }) => {
      s.data.activeConversationId = undefined;
      socket.leave(`conversation:${conversationId}`);
      logger.info("Socket left conversation", { userId: s.userId, conversationId });
    });

    // Typing indicator
    socket.on("chat:typing", ({ conversationId, isTyping }) => {
      if (!s.userId || !conversationId) return;
      socket.to(`conversation:${conversationId}`).emit("chat:typing", {
        conversationId,
        userId: s.userId,
        isTyping,
      });
    });

    // Voice note recording indicator
    socket.on("chat:recording", ({ conversationId, isRecording }) => {
      if (!s.userId || !conversationId) return;
      socket.to(`conversation:${conversationId}`).emit("chat:recording", {
        conversationId,
        userId: s.userId,
        isRecording,
      });
    });

    socket.on("disconnect", (reason) => {
      logger.info("User disconnected", { 
        userId: s.userId, 
        socketId: socket.id,
        reason 
      });

      if (s.userId) {
        // Remove the user from any community group calls they were in, so a
        // crashed/disconnected participant doesn't leave a phantom call record.
        for (const [communityId, call] of activeCommunityCalls) {
          if (call.participants.has(s.userId)) {
            call.participants.delete(s.userId);
            if (call.participants.size === 0) {
              activeCommunityCalls.delete(communityId);
              // Emit immediately (never delay the banner dismissal on a DB
              // round-trip), then record the ended call in the background so
              // the community list can show "Voice call ended".
              io.to(`community:${communityId}`).emit("community:call-ended", {
                communityId,
                type: call.type,
              });
              // WhatsApp-style "Call ended" chip (participant crash/disconnect),
              // with the duration tracked from when the call connected.
              const durationSec = Math.max(
                0,
                Math.round((Date.now() - call.startedAt) / 1000),
              );
              void recordCommunityCallSystemMessage({
                communityId,
                senderId: call.startedBy,
                system: "call_ended",
                callType: call.type,
                callDuration: durationSec,
              });
              getCallActor(call.startedBy).then((actor) => {
                void recordCommunityCallAction(
                  communityId,
                  call.type,
                  actor,
                  "ended",
                  durationSec,
                );
              });
              logger.info("Community group call ended (participant disconnected)", { communityId });
            }
          }
        }
        // Multi-device awareness: this socket is gone, but the account may
        // still be connected on another device (phone backgrounding is the
        // classic case — its WebSocket drops while the PC stays online). Only
        // mark the user offline when the LAST socket for the account closes.
        const remainingSockets = countUserSocket(s.userId, -1);
        if (remainingSockets > 0) {
          // Still connected elsewhere — presence stays online.
          logger.info("User still connected on another device, keeping online", {
            userId: s.userId,
            remainingSockets,
          });
          return;
        }

        // Remove from in-memory tracking
        onlineUsers.delete(s.userId);

        // Broadcast offline IMMEDIATELY — not gated behind Redis
        const broadcastOffline = async () => {
          try {
            const conversations = await Conversation.find({ participants: s.userId }).select("participants").lean();
            for (const conv of conversations) {
              const otherParticipant = conv.participants.find((p: any) => p.toString() !== s.userId);
              if (otherParticipant) {
                io.to(`user:${otherParticipant.toString()}`).emit("user:presence", {
                  userId: s.userId,
                  status: "offline",
                });
              }
            }
          } catch (error) {
            logger.error("Error broadcasting offline presence", { error, userId: s.userId });
          }
        };

        broadcastOffline();

        // Notify every community the user belongs to that they went offline
        // (removes their green dot from open community chats in realtime).
        const broadcastCommunityOffline = async () => {
          try {
            const communityIds = await getUserCommunityIds(s.userId!);
            for (const cid of communityIds) {
              io.to(`community:${cid}`).emit("community:presence", {
                communityId: cid,
                userId: s.userId,
                status: "offline",
              });
            }
          } catch (error: any) {
            logger.error("Error broadcasting community offline presence", {
              error: error.message,
              userId: s.userId,
            });
          }
        };
        broadcastCommunityOffline();

        // Redis: clear presence in background (failure is non-critical)
        deleteCache(`presence:user:${s.userId}`).catch(err => {
          logger.error("Failed to delete user presence from Redis", { error: err.message, userId: s.userId });
        });
        // Update "last seen" at the moment they leave — this is the stamp
        // partners see ("last seen 5m ago") until they return.
        setCache(`presence:user:${s.userId}:lastseen`, Date.now(), 60 * 60 * 24 * 7).catch(err => {
          logger.error("Failed to update user last-seen on disconnect", { error: err.message, userId: s.userId });
        });
      }
    });

    // ── WebRTC Call Signaling ──────────────────────────────────────
    // Relay call offer (SDP + ICE candidates bundled) to the callee
    socket.on("call:offer", async (data: { targetUserId: string; sdp: unknown; type: "audio" | "video" }) => {
      if (!data || !["audio", "video"].includes(data.type) || !data.sdp || !(await canRelayCall(data.targetUserId))) return;
      logger.info("Relaying call:offer", { from: s.userId, to: data.targetUserId, type: data.type });
      io.to(`user:${data.targetUserId}`).emit("call:offer", {
        callerId: s.userId,
        sdp: data.sdp,
        type: data.type,
      });

      // Track the ring from the OFFER (the server sees the real type here —
      // call:answer's payload doesn't carry it). startedAt flips to a timestamp
      // when the callee answers, giving call:end its duration.
      pruneStaleDirectCalls();
      const key = callPairKey(s.userId!, data.targetUserId);
      if (!activeDirectCalls.has(key)) {
        activeDirectCalls.set(key, {
          type: data.type,
          startedAt: null,
          createdAt: Date.now(),
        });
      }
    });

    // Relay call answer back to the caller
    socket.on("call:answer", async (data: { targetUserId: string; sdp: unknown }) => {
      if (!data || !data.sdp || !(await canRelayCall(data.targetUserId))) return;
      logger.info("Relaying call:answer", { from: s.userId, to: data.targetUserId });
      io.to(`user:${data.targetUserId}`).emit("call:answer", {
        calleeId: s.userId,
        sdp: data.sdp,
      });

      // Call connected — record a WhatsApp-style "Voice call started" system
      // message in the 1:1 conversation (sender = caller, so the chip reads
      // the same for both participants). Only records the FIRST answer —
      // ICE-restart answers (already active) don't re-record.
      pruneStaleDirectCalls();
      const key = callPairKey(s.userId!, data.targetUserId);
      const existing = activeDirectCalls.get(key);
      if (existing && existing.startedAt === null) {
        existing.startedAt = Date.now();
        void recordDirectCallSystemMessage({
          userA: data.targetUserId, // caller
          userB: s.userId!, // callee
          system: "call_started",
          callType: existing.type,
        });
      }
    });

    // Relay ICE candidates between peers
    socket.on("call:ice-candidate", async (data: { targetUserId: string; candidate: unknown }) => {
      // High-frequency path — skip the block DB query; the offer/answer
      // that preceded these candidates already passed the block check.
      if (!data || !data.candidate || !(await canRelayCall(data.targetUserId, { skipBlockCheck: true }))) return;
      io.to(`user:${data.targetUserId}`).emit("call:ice-candidate", {
        senderId: s.userId,
        candidate: data.candidate,
      });
    });

    // ICE restart (network handoff — WiFi → cellular, etc.)
    socket.on("call:ice-restart", async (data: { targetUserId: string; sdp: unknown }) => {
      if (!data || !data.sdp || !(await canRelayCall(data.targetUserId))) return;
      logger.info("Relaying call:ice-restart", { from: s.userId, to: data.targetUserId });
      io.to(`user:${data.targetUserId}`).emit("call:ice-restart", {
        senderId: s.userId,
        sdp: data.sdp,
      });
    });

    // End call notification
    socket.on("call:end", async (data: { targetUserId: string }) => {
      if (!data || !(await canRelayCall(data.targetUserId))) return;
      logger.info("Relaying call:end", { from: s.userId, to: data.targetUserId });
      io.to(`user:${data.targetUserId}`).emit("call:end", {
        endedBy: s.userId,
      });

      // Call ended — record the WhatsApp-style "Call ended" chip with the
      // duration tracked from when the call connected. The pair entry is
      // deleted so the second peer's call:end (both sides hang up) doesn't
      // record a duplicate.
      pruneStaleDirectCalls();
      const key = callPairKey(s.userId!, data.targetUserId);
      const entry = activeDirectCalls.get(key);
      if (entry) {
        activeDirectCalls.delete(key);
        if (entry.startedAt !== null) {
          const duration = Math.max(
            0,
            Math.round((Date.now() - entry.startedAt) / 1000),
          );
          void recordDirectCallSystemMessage({
            userA: s.userId!,
            userB: data.targetUserId,
            system: "call_ended",
            callType: entry.type,
            callDuration: duration,
          });
        } else {
          // The call ended before anyone answered — declined or cancelled
          // while ringing. Record a "Missed call" chip (WhatsApp does the
          // same), so the event isn't silently dropped.
          void recordDirectCallSystemMessage({
            userA: s.userId!,
            userB: data.targetUserId,
            system: "call_missed",
            callType: entry.type,
          });
        }
      }
    });

    // Missed call notification (callee didn't answer within timeout)
    socket.on("call:missed", async (data: { targetUserId: string }) => {
      if (!data || !(await canRelayCall(data.targetUserId))) return;
      logger.info("Relaying call:missed", { from: s.userId, to: data.targetUserId });
      io.to(`user:${data.targetUserId}`).emit("call:missed", {
        callerId: s.userId,
      });

      // Caller never got an answer — record a "Missed call" chip.
      pruneStaleDirectCalls();
      const key = callPairKey(s.userId!, data.targetUserId);
      const entry = activeDirectCalls.get(key);
      if (entry && entry.startedAt === null) {
        activeDirectCalls.delete(key);
        void recordDirectCallSystemMessage({
          userA: s.userId!, // caller
          userB: data.targetUserId, // callee
          system: "call_missed",
          callType: entry.type,
        });
      }
    });

    // ── Community Socket Events ──────────────────────────────────────
    socket.on("community:join", async ({ communityId }) => {
      if (!s.userId || !communityId) return;
      if (!mongoose.isObjectIdOrHexString(communityId)) return;

      try {
        // Only actual members may subscribe to the community room. This
        // prevents an authenticated non-member from receiving message,
        // call, and presence events for communities they don't belong to.
        const community = await Community.findById(communityId).select("members").lean();
        if (!community) return;
        const isMember = (community as any).members?.some(
          (m: any) => m.user?.toString() === s.userId
        );
        if (!isMember) return;

        socket.join(`community:${communityId}`);
        logger.info("Socket joined community", { userId: s.userId, communityId });

        // Send back current online members so the client can show green dots
        const memberIds = (community as any).members?.map((m: any) => m.user?.toString()).filter(Boolean) || [];
        const onlineMemberIds = memberIds.filter((id: string) => id !== s.userId && onlineUsers.has(id));
        if (onlineMemberIds.length > 0) {
          io.to(`user:${s.userId}`).emit("community:presence:sync", {
            communityId,
            onlineUserIds: onlineMemberIds,
          });
        }
      } catch (error: any) {
        logger.error("Error syncing community presence", { error: error.message, communityId, userId: s.userId });
      }
    });

    socket.on("community:leave", ({ communityId }) => {
      if (!s.userId || !communityId) return;
      socket.leave(`community:${communityId}`);
      logger.info("Socket left community", { userId: s.userId, communityId });
    });

    // ── Community Group Call Signaling (LiveKit) ────────────────────
    // A member started a group call. Record it and notify the rest of the
    // community room so they can join the same LiveKit room.
    // ── Group call membership helpers ────────────────────────────────
    const isCommunityMember = async (communityId: string, userId: string): Promise<boolean> => {
      try {
        const community = await Community.findById(communityId).select("members").lean();
        if (!community) return false;
        return (community as any).members?.some(
          (m: any) => m.user?.toString() === userId
        ) ?? false;
      } catch {
        return false;
      }
    };

    // Builds a lightweight actor snapshot (name + username) for a user so
    // the community list preview can render "Name started a voice call".
    const getCallActor = async (userId: string) => {
      try {
        const user = await User.findById(userId)
          .select("fullName username isVerified")
          .lean();
        return {
          _id: userId,
          fullName: user?.fullName || "",
          username: user?.username || "",
        };
      } catch {
        return { _id: userId, fullName: "", username: "" };
      }
    };

    // Records a call start/end as the community's lastAction so the list
    // preview can show "Name started a voice call" / "Voice call ended".
    const recordCommunityCallAction = async (
      communityId: string,
      type: "audio" | "video",
      actor: { _id: string; fullName: string; username: string },
      status: "started" | "ended",
      callDuration?: number,
    ) => {
      try {
        await Community.findByIdAndUpdate(communityId, {
          $set: {
            lastAction: {
              type: "call",
              callType: type,
              callStatus: status,
              actor,
              createdAt: new Date(),
              // Duration only matters for the "ended" preview ("Voice call
              // ended · 12m 30s").
              ...(status === "ended" && callDuration ? { callDuration } : {}),
            },
          },
        });
      } catch (err: any) {
        logger.error("Failed to record community call lastAction", {
          error: err.message,
        });
      }
    };

    // Clears the call record if the caller is (or has become) the last
    // participant. Broadcasts community:call-ended so all members hide the
    // join banner. Safe to call for any participant, not just the starter.
    const clearCommunityCallIfEmpty = (communityId: string, leavingUserId: string) => {
      const call = activeCommunityCalls.get(communityId);
      if (!call) return;
      call.participants.delete(leavingUserId);
      // Only clear when truly empty (or the record has gone stale)
      if (call.participants.size === 0) {
        activeCommunityCalls.delete(communityId);
        // Emit immediately (never delay the banner dismissal on a DB
        // round-trip), then record the ended call in the background so the
        // community list can show "Voice call ended".
        io.to(`community:${communityId}`).emit("community:call-ended", {
          communityId,
          type: call.type,
        });
        // WhatsApp-style "Call ended" chip in the community chat timeline,
        // with the duration tracked from when the call connected.
        const durationSec = Math.max(
          0,
          Math.round((Date.now() - call.startedAt) / 1000),
        );
        void recordCommunityCallSystemMessage({
          communityId,
          senderId: call.startedBy,
          system: "call_ended",
          callType: call.type,
          callDuration: durationSec,
        });
        getCallActor(call.startedBy).then((actor) => {
          void recordCommunityCallAction(
            communityId,
            call.type,
            actor,
            "ended",
            durationSec,
          );
        });
        logger.info("Community group call ended (last participant left)", { communityId });
      }
    };

    // A member started a NEW group call (first joiner). Creates the record
    // if none exists; if one already exists (call in progress), the user is
    // simply added as a participant — ownership is NOT overwritten.
    socket.on(
      "community:call-started",
      async (data: { communityId: string; roomName: string; type: "audio" | "video" }) => {
        if (!s.userId || !data || !data.communityId || !data.roomName || !data.type) return;
        if (data.type !== "audio" && data.type !== "video") return;

        pruneStaleCommunityCalls();

        try {
          if (!(await isCommunityMember(data.communityId, s.userId))) return;

          const existing = activeCommunityCalls.get(data.communityId);
          const isNewCall = !existing;

          if (isNewCall) {
            activeCommunityCalls.set(data.communityId, {
              roomName: data.roomName,
              type: data.type,
              startedBy: s.userId,
              startedAt: Date.now(),
              participants: new Set([s.userId]),
            });
            logger.info("Community group call started", {
              communityId: data.communityId,
              roomName: data.roomName,
              type: data.type,
              startedBy: s.userId,
            });
            // Record the call start so the list preview can show who started it
            const actor = await getCallActor(s.userId);
            await recordCommunityCallAction(
              data.communityId,
              data.type,
              actor,
              "started",
            );
            // WhatsApp-style "Call started" chip in the community timeline.
            void recordCommunityCallSystemMessage({
              communityId: data.communityId,
              senderId: s.userId,
              system: "call_started",
              callType: data.type,
            });
            // Notify ONLINE members (excluding the starter) so they can join
            // the call — capped so a huge community can't flood its members.
            void notifyCommunityCallStarted(
              data.communityId,
              s.userId,
              data.type,
            );
            // Notify everyone in the community room that a call is live
            io.to(`community:${data.communityId}`).emit("community:call-started", {
              communityId: data.communityId,
              roomName: data.roomName,
              type: data.type,
              startedBy: s.userId,
              actor,
            });
          } else {
            // Existing call — just add this user as a participant.
            // No broadcast: other members already see the live banner.
            existing.participants.add(s.userId);
          }
        } catch (error: any) {
          logger.error("Error announcing community group call", { error: error.message, communityId: data.communityId });
        }
      }
    );

    // A member left/ended the group call. Clears the record when the last
    // participant leaves (works for any participant, not just the starter).
    socket.on("community:call-ended", (data: { communityId: string }) => {
      if (!s.userId || !data || !data.communityId) return;
      clearCommunityCallIfEmpty(data.communityId, s.userId);
    });

    // A member wants to know if there's an active call they can join
    socket.on("community:call-status", async ({ communityId }) => {
      if (!s.userId || !communityId) return;
      if (!(await isCommunityMember(communityId, s.userId))) return;
      pruneStaleCommunityCalls();
      const call = activeCommunityCalls.get(communityId);
      if (call) {
        const actor = await getCallActor(call.startedBy);
        io.to(`user:${s.userId}`).emit("community:call-started", {
          communityId,
          roomName: call.roomName,
          type: call.type,
          startedBy: call.startedBy,
          actor,
        });
      }
    });

    socket.on("community:typing", ({ communityId, isTyping }) => {
      if (!s.userId || !communityId) return;
      socket.to(`community:${communityId}`).emit("community:typing", {
        communityId,
        userId: s.userId,
        isTyping,
      });
    });

    socket.on("community:seen", async ({ communityId }) => {
      if (!s.userId || !communityId || !mongoose.Types.ObjectId.isValid(communityId)) return;
      try {
        // Find the messages this user has NOT yet seen, sent by OTHERS — the
        // sender's own messages must never get their own id in seenBy (a
        // sender reading their own message isn't a read receipt). Only these
        // IDs are broadcast, so repeated community:seen events (every chat
        // open, every re-connect) stay idempotent instead of re-appending.
        const unseen = await CommunityMessage.find({
          community: communityId,
          isDeleted: { $ne: true },
          sender: { $ne: s.userId },
          seenBy: { $ne: s.userId },
        })
          .select("_id")
          .lean();

        if (unseen.length === 0) return;

        const messageIds = unseen.map((m) => m._id.toString());

        // Bounded read-receipt array: union the new reader in and keep only
        // the most recent SEENBY_CAP ids in ONE atomic pipeline. A plain
        // $addToSet grows seenBy by one entry per member read on every
        // message — on a big community that's unbounded. $setUnion dedupes
        // (same semantics as $addToSet) and $slice rotates out the oldest
        // readers, so the array stays ≤ SEENBY_CAP forever. The blue tick
        // only needs to know whether ANYONE has seen the message, so the
        // newest N readers are plenty.
        await CommunityMessage.updateMany(
          { _id: { $in: messageIds } },
          [
            {
              $set: {
                seenBy: {
                  $slice: [
                    {
                      $setUnion: [
                        { $ifNull: ["$seenBy", []] },
                        [new mongoose.Types.ObjectId(s.userId!)],
                      ],
                    },
                    -SEENBY_CAP,
                  ],
                },
              },
            },
          ],
          { updatePipeline: true } // required for array (aggregation-pipeline) updates in Mongoose 9
        );

        // Broadcast so every member's client flips the sender's blue ticks in
        // realtime — without this the DB was marked but NO event ever fired,
        // so ticks only appeared after a manual reload. Same contract as
        // direct chat's `messages:seen`.
        io.to(`community:${communityId}`).emit("community:seen-update", {
          communityId,
          messageIds,
          seenByUserId: s.userId,
        });
      } catch (error: any) {
        logger.error("Error marking community messages seen", { error: error.message, communityId, userId: s.userId });
      }
    });

    // Request presence sync for community members
    socket.on("community:request:presence", async ({ communityId }) => {
      if (!s.userId || !communityId) return;
      try {
        const community = await Community.findById(communityId).select("members").lean();
        if (community) {
          const memberIds = (community as any).members?.map((m: any) => m.user?.toString()).filter(Boolean) || [];
          const onlineMemberIds = memberIds.filter((id: string) => id !== s.userId && onlineUsers.has(id));
          io.to(`user:${s.userId}`).emit("community:presence:sync", {
            communityId,
            onlineUserIds: onlineMemberIds,
          });
        }
      } catch (error: any) {
        logger.error("Error syncing community presence on request", { error: error.message, communityId, userId: s.userId });
      }
    });

    // Handle unauthorized access attempts to protected events
    socket.on("error", (error) => {
      logger.error("Socket error", { 
        userId: s.userId, 
        error: error.message 
      });
    });
  });

  logger.info("Socket.io initialized");
  return io;
};

export const getIO = () => {
  if (!io) {
    throw new Error("Socket.io not initialized");
  }
  return io;
};


// ─── Event batching ──────────────────────────────────────────────────
// Batches multiple emits for the same event into a single flush per
// microtask tick. For high-frequency events (likes, saves, follows),
// only the last payload is sent to avoid flooding clients.

interface BatchEntry {
  room: string | undefined;
  data: any;
}

const pendingBatches = new Map<string, BatchEntry[]>();

const flushBatch = (event: string) => {
  const batch = pendingBatches.get(event);
  if (!batch || batch.length === 0) return;
  pendingBatches.delete(event);

  for (const entry of batch) {
    if (entry.room) {
      io.to(entry.room).emit(event, entry.data);
    } else {
      io.emit(event, entry.data);
    }
  }
};

/** Events where every payload is unique and must not be dropped by batching. */
const IMMEDIATE_EVENTS = new Set([
  "post:created",
  "post:deleted",
  "post:updated",
  "poll:updated",
  "post:comment",
  "comment:reply",
  "comment:updated",
  "comment:deleted",
  "comment:reaction",
  "post:reaction",
  "comment:like",
  "comment:unlike",
  "user:follow",
  "user:unfollow",
  "post:pin",
  "post:unpin",
  "user:updated",
]);

const batchEmit = (event: string, data: any, room?: string) => {
  if (IMMEDIATE_EVENTS.has(event)) {
    if (room) {
      io.to(room).emit(event, data);
    } else {
      io.emit(event, data);
    }
    return;
  }
  if (!pendingBatches.has(event)) {
    pendingBatches.set(event, []);
    queueMicrotask(() => flushBatch(event));
  }
  const batch = pendingBatches.get(event)!;
  batch.push({ room: room ?? undefined, data });
};

// ─── Emit helpers (all use event batching) ───────────────────────────

export const sendNotification = (userId: string, notification: any) => {
  try {
    const curriedIo = getIO();
    curriedIo.to(`user:${userId}`).emit("notification", notification);
    // Backfill log: notifications are the #1 thing users miss when their
    // socket was dead (phone backgrounded) — replay on reconnect.
    void logUserRealtimeEvent(userId, "notification", notification);
    logger.info("Notification sent via socket", { userId, notificationType: notification.type });
  } catch (error: any) {
    logger.error("Failed to send socket notification", { error: error.message, userId });
  }
};

export const emitPostLike = (postId: string, userId: string, likesCount: number) => {
  try {
    batchEmit("post:like", { postId, userId, likesCount });
  } catch (error: any) {
    logger.error("Failed to emit post:like", { error: error.message });
  }
};

export const emitPostUnlike = (postId: string, userId: string, likesCount: number) => {
  try {
    batchEmit("post:unlike", { postId, userId, likesCount });
  } catch (error: any) {
    logger.error("Failed to emit post:unlike", { error: error.message });
  }
};

export const emitPostSave = (postId: string, userId: string, savesCount: number) => {
  try {
    batchEmit("post:save", { postId, userId, savesCount });
  } catch (error: any) {
    logger.error("Failed to emit post:save", { error: error.message });
  }
};

export const emitPostUnsave = (postId: string, userId: string, savesCount: number) => {
  try {
    batchEmit("post:unsave", { postId, userId, savesCount });
  } catch (error: any) {
    logger.error("Failed to emit post:unsave", { error: error.message });
  }
};

export const emitPostRepost = (postId: string, userId: string, repostsCount: number) => {
  try {
    batchEmit("post:repost", { postId, userId, repostsCount });
  } catch (error: any) {
    logger.error("Failed to emit post:repost", { error: error.message });
  }
};

export const emitPostUnrepost = (postId: string, userId: string, repostsCount: number) => {
  try {
    batchEmit("post:unrepost", { postId, userId, repostsCount });
  } catch (error: any) {
    logger.error("Failed to emit post:unrepost", { error: error.message });
  }
};

/**
 * Resolves the set of personal rooms that may see a given post in realtime.
 * - public posts → everyone (room omitted → global broadcast)
 * - closeFriends posts → only the author + their close friends
 * Returns null when no rooms apply (post missing → caller should drop).
 */
const resolvePostAudienceRooms = async (post: any): Promise<string[] | null> => {
  if (!post) return null;
  if (post.visibility !== "closeFriends") return [];
  const authorId = post.author?._id?.toString() || post.author?.toString();
  if (!authorId) return null;
  const author = await User.findById(authorId).select("closeFriends").lean();
  const rooms = new Set<string>([`user:${authorId}`]);
  (author?.closeFriends || []).forEach((id: any) => rooms.add(`user:${id.toString()}`));
  return Array.from(rooms);
};

/**
 * Routes an event to the audience of a post (by postId). closeFriends posts
 * never leak to non-close-friends in realtime.
 */
const emitToPostAudience = (event: string, postId: string, data: any) => {
  void (async () => {
    try {
      const post = await Post.findById(postId).select("author visibility").lean();
      const rooms = await resolvePostAudienceRooms(post);
      if (rooms === null) return;
      if (rooms.length === 0) {
        batchEmit(event, data);
      } else {
        rooms.forEach((room) => batchEmit(event, data, room));
      }
    } catch (error: any) {
      logger.error(`Failed to route ${event} to post audience`, { error: error.message, postId });
    }
  })();
};

/**
 * Routes an event to the audience of the post that owns a comment.
 */
const emitToCommentAudience = (event: string, commentId: string, data: any) => {
  void (async () => {
    try {
      const comment = await Comment.findById(commentId).select("post").lean();
      const postId = comment?.post?.toString();
      if (!postId) {
        batchEmit(event, data);
        return;
      }
      await emitToPostAudience(event, postId, data);
    } catch (error: any) {
      logger.error(`Failed to route ${event} to comment audience`, { error: error.message, commentId });
    }
  })();
};

/**
 * Invokes emitFn for every personal room allowed to see a post, or with an
 * empty room list for public posts (global broadcast).
 */
const routeToPostRooms = (post: any, emitFn: (room: string) => void) => {
  void (async () => {
    try {
      const rooms = await resolvePostAudienceRooms(post);
      if (rooms === null) return;
      if (rooms.length === 0) {
        emitFn("");
      } else {
        rooms.forEach(emitFn);
      }
    } catch (error: any) {
      logger.error("Failed to route post to rooms", { error: (error as Error).message });
    }
  })();
};

export const emitPostComment = (postId: string, comment: any, userId: string, commentsCount: number) => {
  emitToPostAudience("post:comment", postId, { postId, comment, userId, commentsCount });
};

export const emitCommentReply = (postId: string, commentId: string, reply: any, userId: string, commentsCount: number, repliesCount: number) => {
  emitToPostAudience("comment:reply", postId, { postId, commentId, reply, userId, commentsCount, repliesCount });
};

export const emitCommentLike = (commentId: string, userId: string, likesCount: number) => {
  emitToCommentAudience("comment:like", commentId, { commentId, userId, likesCount });
};

export const emitCommentUnlike = (commentId: string, userId: string, likesCount: number) => {
  emitToCommentAudience("comment:unlike", commentId, { commentId, userId, likesCount });
};

export const emitPostCreated = (post: any) => {
  try {
    // closeFriends posts must NEVER reach non-close-friends in realtime — the
    // GET feed filters them, but the socket broadcast used to leak the whole
    // post payload to every connected client. Target only the author + their
    // close friends' personal rooms instead of broadcasting to everyone.
    if (post?.visibility === "closeFriends") {
      void (async () => {
        try {
          const authorId = post.author?._id?.toString() || post.author?.toString();
          if (!authorId) return;
          const author = await User.findById(authorId).select("closeFriends").lean();
          const recipientIds = new Set<string>([authorId]);
          (author?.closeFriends || []).forEach((id: any) =>
            recipientIds.add(id.toString()),
          );
          recipientIds.forEach((rid) => {
            batchEmit("post:created", post, `user:${rid}`);
          });
        } catch (err) {
          logger.error("Failed to route closeFriends post:created", { error: (err as Error).message });
        }
      })();
      return;
    }
    batchEmit("post:created", post);
  } catch (error: any) {
    logger.error("Failed to emit post:created", { error: error.message });
  }
};

export const emitPostDeleted = (postId: string) => {
  try {
    batchEmit("post:deleted", postId);
  } catch (error: any) {
    logger.error("Failed to emit post:deleted", { error: error.message });
  }
};

export const emitPostUpdated = (post: any) => {
  try {
    if (post?.visibility === "closeFriends") {
      void routeToPostRooms(post, (rid) => batchEmit("post:updated", post, `user:${rid}`));
      return;
    }
    batchEmit("post:updated", post);
  } catch (error: any) {
    logger.error("Failed to emit post:updated", { error: error.message });
  }
};

export const emitPollUpdated = (postId: string, poll: any) => {
  emitToPostAudience("poll:updated", postId, { postId, poll });
};

export const emitCommentUpdated = (comment: any) => {
  const postId = comment?.post?.toString() || comment?.postId;
  if (postId) {
    emitToPostAudience("comment:updated", postId, comment);
  } else {
    try {
      batchEmit("comment:updated", comment);
    } catch (error: any) {
      logger.error("Failed to emit comment:updated", { error: error.message });
    }
  }
};

export const emitCommentDeleted = (postId: string, commentId: string, commentsCount: number) => {
  emitToPostAudience("comment:deleted", postId, { postId, commentId, commentsCount });
};

export const emitFollowUser = (
  targetUserId: string,
  followerId: string,
  followersCount: number,
  followerFollowingCount?: number,
) => {
  try {
    batchEmit("user:follow", {
      targetUserId,
      followerId,
      followersCount,
      followerFollowingCount,
    });
    // Backfill log for both users — a follow while the target was offline
    // must show up on reconnect (counts + follow button state).
    void logUserRealtimeEvent(targetUserId, "user:follow", {
      targetUserId,
      followerId,
      followersCount,
      followerFollowingCount,
    });
    void logUserRealtimeEvent(followerId, "user:follow", {
      targetUserId,
      followerId,
      followersCount,
      followerFollowingCount,
    });
  } catch (error: any) {
    logger.error("Failed to emit user:follow", { error: error.message });
  }
};

export const emitUnfollowUser = (
  targetUserId: string,
  followerId: string,
  followersCount: number,
  followerFollowingCount?: number,
) => {
  try {
    batchEmit("user:unfollow", {
      targetUserId,
      followerId,
      followersCount,
      followerFollowingCount,
    });
    void logUserRealtimeEvent(targetUserId, "user:unfollow", {
      targetUserId,
      followerId,
      followersCount,
      followerFollowingCount,
    });
    void logUserRealtimeEvent(followerId, "user:unfollow", {
      targetUserId,
      followerId,
      followersCount,
      followerFollowingCount,
    });
  } catch (error: any) {
    logger.error("Failed to emit user:unfollow", { error: error.message });
  }
};

export const emitPostShare = (postId: string, sharesCount: number) => {
  try {
    batchEmit("post:share", { postId, sharesCount });
  } catch (error: any) {
    logger.error("Failed to emit post:share", { error: error.message });
  }
};

export const emitUserShare = (userId: string, sharesCount: number) => {
  try {
    batchEmit("user:share", { userId, sharesCount });
  } catch (error: any) {
    logger.error("Failed to emit user:share", { error: error.message });
  }
};

/**
 * Emits a post reaction event (add or remove) to the post's audience.
 */
export const emitPostReaction = (
  postId: string,
  payload: { reaction: any; type: "add" | "remove" }
) => {
  emitToPostAudience("post:reaction", postId, { postId, ...payload });
};

/**
 * Emits a comment reaction event (add or remove).
 */
export const emitCommentReaction = (
  commentId: string,
  payload: { reaction: any; type: "add" | "remove" }
) => {
  try {
    batchEmit("comment:reaction", { commentId, ...payload });
  } catch (error: any) {
    logger.error("Failed to emit comment:reaction", { error: error.message, commentId });
  }
};

/**
 * Emits a message reaction event (add or remove) to the conversation room,
 * AND to each participant's personal room so the reaction is received even when
 * the other user is not actively viewing the conversation.
 */
export const emitMessageReaction = async (
  conversationId: string,
  payload: { messageId: string; reaction: any; type: "add" | "remove" },
  participantIds?: string[]
) => {
  try {
    // Always emit to the conversation room (for active viewers)
    io.to(`conversation:${conversationId}`).emit("message:reaction", payload);
    
    // Also emit to each participant's personal room so the reaction is received
    // even when they're not actively viewing the conversation
    if (participantIds && participantIds.length > 0) {
      for (const pId of participantIds) {
        io.to(`user:${pId}`).emit("message:reaction", payload);
      }
    }
  } catch (error: any) {
    logger.error("Failed to emit message:reaction", { error: error.message, conversationId });
  }
};

export const emitPostView = (postId: string, viewsCount: number) => {
  try {
    batchEmit("post:view", { postId, viewsCount });
  } catch (error: any) {
    logger.error("Failed to emit post:view", { error: error.message });
  }
};

export const emitUserView = (userId: string, viewsCount: number) => {
  try {
    batchEmit("user:view", { userId, viewsCount });
  } catch (error: any) {
    logger.error("Failed to emit user:view", { error: error.message });
  }
};

export const emitPostPin = (postId: string, userId: string) => {
  try {
    batchEmit("post:pin", { postId, userId });
  } catch (error: any) {
    logger.error("Failed to emit post:pin", { error: error.message });
  }
};

export const emitPostUnpin = (postId: string, userId: string) => {
  try {
    batchEmit("post:unpin", { postId, userId });
  } catch (error: any) {
    logger.error("Failed to emit post:unpin", { error: error.message });
  }
};

// ─── Chat Feature Socket Helpers ─────────────────────────────────────

/**
 * Checks if the recipient of a message is actively in the conversation room.
 * This is used to determine if the message should be marked 'seen' immediately.
 */
export const isRecipientActiveInConversation = async (
  conversationId: string,
  recipientId: string
): Promise<boolean> => {
  try {
    const sockets = await io.in(`user:${recipientId}`).fetchSockets();
    for (const s of sockets) {
      if ((s as any).data?.activeConversationId === conversationId) {
        return true;
      }
    }
  } catch (error: any) {
    logger.error("Error checking recipient active status", {
      error: error.message,
      conversationId,
      recipientId,
    });
  }
  return false;
};

/**
 * Fetches user online status from Redis.
 */
export const getUserPresenceStatus = async (userId: string): Promise<string> => {
  try {
    const presence = await getCache<string>(`presence:user:${userId}`);
    return presence || "offline";
  } catch (error: any) {
    logger.error("Error fetching user presence status", {
      error: error.message,
      userId,
    });
    return "offline";
  }
};

/**
 * Fetches multiple users' last-seen timestamps in a single batch MGET command.
 * Returns ms epoch per userId (0 when never seen in the last 7 days).
 */
export const getUserLastSeens = async (
  userIds: string[],
): Promise<Record<string, number>> => {
  if (userIds.length === 0) return {};
  try {
    const keys = userIds.map((id) => `presence:user:${id}:lastseen`);
    const results = await redis.mget<string[]>(...keys);
    const lastSeenMap: Record<string, number> = {};
    userIds.forEach((id, idx) => {
      const raw = results[idx];
      const ts = raw ? Number(raw) : 0;
      lastSeenMap[id] = Number.isFinite(ts) && ts > 0 ? ts : 0;
    });
    return lastSeenMap;
  } catch (error: any) {
    logger.error("Error fetching batch user last-seen", {
      error: error.message,
      userIds,
    });
    const fallbackMap: Record<string, number> = {};
    userIds.forEach((id) => {
      fallbackMap[id] = 0;
    });
    return fallbackMap;
  }
};

/**
 * Fetches multiple user online statuses in a single batch MGET command.
 */
export const getUserPresenceStatuses = async (userIds: string[]): Promise<Record<string, string>> => {
  if (userIds.length === 0) return {};
  try {
    const keys = userIds.map((id) => `presence:user:${id}`);
    const results = await redis.mget<string[]>(...keys);
    const presenceMap: Record<string, string> = {};
    userIds.forEach((id, idx) => {
      presenceMap[id] = results[idx] || "offline";
    });
    return presenceMap;
  } catch (error: any) {
    logger.error("Error fetching batch user presence statuses", {
      error: error.message,
      userIds,
    });
    const fallbackMap: Record<string, string> = {};
    userIds.forEach((id) => {
      fallbackMap[id] = "offline";
    });
    return fallbackMap;
  }
};

/**
 * Emits a user profile update event to notify all connected clients.
 * Also emits to all of the user's conversation rooms so participant data
 * (name, profile pic, etc.) is updated in real-time for chat partners.
 */
export const emitUserUpdated = async (user: any) => {
  try {
    // 1. Broadcast to all connected clients (for profile views, etc.)
    batchEmit("user:updated", user);
    
    // 2. Also emit to each conversation the user is in, so chat partners
    //    see updated name/profile pic immediately
    if (user._id) {
      const conversations = await Conversation.find({ participants: user._id }).select("_id").lean();
      for (const conv of conversations) {
        io.to(`conversation:${conv._id.toString()}`).emit("user:updated", user);
      }
    }
  } catch (error: any) {
    logger.error("Failed to emit user:updated", { error: error.message });
  }
};

/**
 * Emits an account deletion event so other clients know to clean up.
 */
export const emitAccountDeleted = (userId: string) => {
  try {
    io.emit("account:deleted", { userId });
  } catch (error: any) {
    logger.error("Failed to emit account:deleted", { error: error.message });
  }
};

/**
 * Emits a new message event to the conversation room.
 */
export const emitNewMessage = (conversationId: string, message: any) => {
  try {
    io.to(`conversation:${conversationId}`).emit("message:new", message);
    // Backfill log for BOTH participants so a reconnect replays the message
    // even if the recipient's socket was dead when it arrived.
    const senderId = message?.sender?._id?.toString() || message?.sender?.toString?.();
    const recipientId = message?.recipient?._id?.toString() || message?.recipient?.toString?.();
    if (senderId) void logUserRealtimeEvent(senderId, "message:new", message);
    if (recipientId) void logUserRealtimeEvent(recipientId, "message:new", message);

    // Mark the message DELIVERED for the recipient (WhatsApp semantics: the
    // socket emit above is their device receiving it). Idempotent — the
    // `deliveredAt: null` filter means only the first delivery stamps it.
    // Then notify the sender's devices with a messages:delivered event so the
    // ✓ → ✓✓ transition + the "Message info" panel update live, even when
    // the recipient is online but NOT viewing the chat (so no seen event
    // fires). Fire-and-forget: the send path must not wait on this write.
    if (recipientId && message?._id) {
      void (async () => {
        try {
          const deliveredAt = new Date();
          const res = await Message.updateOne(
            { _id: message._id, deliveredAt: null },
            { $set: { deliveredAt } },
          );
          if (res.modifiedCount > 0 && senderId) {
            const payload = {
              conversationId,
              messageId: message._id.toString(),
              deliveredAt,
            };
            io.to(`conversation:${conversationId}`).emit(
              "messages:delivered",
              payload,
            );
            io.to(`user:${senderId}`).emit("messages:delivered", payload);
          }
        } catch (error: any) {
          logger.error("Failed to mark message delivered", {
            error: error.message,
            messageId: message?._id?.toString(),
          });
        }
      })();
    }
  } catch (error: any) {
    logger.error("Failed to emit message:new", { error: error.message, conversationId });
  }
};

/**
 * Emits a message edit event to the conversation room.
 */
export const emitMessageEdit = (conversationId: string, message: any, participantIds?: string[]) => {
  try {
    io.to(`conversation:${conversationId}`).emit("message:edit", message);
    
    // Also emit to each participant's personal room so the conversations list updates
    // when they are not actively viewing this conversation
    if (participantIds && participantIds.length > 0) {
      for (const pId of participantIds) {
        io.to(`user:${pId}`).emit("message:edit", message);
      }
    }
  } catch (error: any) {
    logger.error("Failed to emit message:edit", { error: error.message, conversationId });
  }
};

/**
 * Emits a message pin event to the conversation room and each participant's personal room.
 */
export const emitMessagePin = (conversationId: string, messageId: string, participantIds?: string[], pinnedMessages?: any[]) => {
  try {
    const payload = { conversationId, messageId, pinnedMessages };
    io.to(`conversation:${conversationId}`).emit("message:pin", payload);
    
    if (participantIds && participantIds.length > 0) {
      for (const pId of participantIds) {
        io.to(`user:${pId}`).emit("message:pin", payload);
      }
    }
  } catch (error: any) {
    logger.error("Failed to emit message:pin", { error: error.message, conversationId });
  }
};

/**
 * Emits a message unpin event to the conversation room and each participant's personal room.
 */
export const emitMessageUnpin = (conversationId: string, messageId: string, participantIds?: string[], pinnedMessages?: any[]) => {
  try {
    const payload = { conversationId, messageId, pinnedMessages };
    io.to(`conversation:${conversationId}`).emit("message:unpin", payload);
    
    if (participantIds && participantIds.length > 0) {
      for (const pId of participantIds) {
        io.to(`user:${pId}`).emit("message:unpin", payload);
      }
    }
  } catch (error: any) {
    logger.error("Failed to emit message:unpin", { error: error.message, conversationId });
  }
};

/**
 * Emits a message deletion event to the conversation room and each participant's personal room.
 * Broadcasting to personal rooms ensures the conversation list updates even when the user
 * is not actively viewing the conversation.
 */
export const emitMessageDelete = (conversationId: string, messageId: string, participantIds?: string[]) => {
  try {
    io.to(`conversation:${conversationId}`).emit("message:delete", { messageId });
    
    // Also emit to each participant's personal room so the conversation list updates
    // when they are not actively viewing this conversation
    if (participantIds && participantIds.length > 0) {
      for (const pId of participantIds) {
        io.to(`user:${pId}`).emit("message:delete", { messageId });
      }
    }
  } catch (error: any) {
    logger.error("Failed to emit message:delete", { error: error.message, conversationId, messageId });
  }
};

/**
 * Emits a delete-for-me event so the deleting user's client hides the message.
 */
export const emitMessageDeleteForMe = (conversationId: string, messageId: string, deletedByUserId: string) => {
  try {
    io.to(`conversation:${conversationId}`).emit("message:delete-for-me", { messageId, deletedByUserId });
  } catch (error: any) {
    logger.error("Failed to emit message:delete-for-me", { error: error.message, conversationId, messageId });
  }
};

/**
 * Emits a live chat notification to a user's personal room when they are not viewing the active chat.
 */
export const emitChatNotification = (recipientId: string, payload: any) => {
  try {
    io.to(`user:${recipientId}`).emit("chat:notification", payload);
  } catch (error: any) {
    logger.error("Failed to emit chat:notification", { error: error.message, recipientId });
  }
};

/**
 * Forcefully disconnects all active socket instances for a specific user ID (e.g. when banned).
 */
export const disconnectUserSockets = (userId: string) => {
  try {
    if (io) {
      io.in(`user:${userId}`).disconnectSockets(true);
    }
  } catch (error: any) {
    logger.error("Failed to disconnect user sockets", { error: error.message, userId });
  }
};

// ─── Graceful shutdown ───────────────────────────────────────────────
export const shutdownSocket = async (): Promise<void> => {
  logger.info("Shutting down Socket.io...");
  
  // Disconnect Redis adapter clients
  if (redisPubClient) {
    try {
      await redisPubClient.quit();
      logger.info("Redis pubClient disconnected.");
    } catch (err) {
      logger.warn("Error disconnecting Redis pubClient:", { error: err instanceof Error ? err.message : String(err) });
    }
    redisPubClient = null;
  }
  if (redisSubClient) {
    try {
      await redisSubClient.quit();
      logger.info("Redis subClient disconnected.");
    } catch (err) {
      logger.warn("Error disconnecting Redis subClient:", { error: err instanceof Error ? err.message : String(err) });
    }
    redisSubClient = null;
  }
  
  // Close Socket.io server
  if (io) {
    io.close(() => {
      logger.info("Socket.io server closed.");
    });
  }
};
