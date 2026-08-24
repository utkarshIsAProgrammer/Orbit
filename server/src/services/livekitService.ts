/**
 * LiveKit Service — Group Video/Audio Calls
 *
 * Manages LiveKit rooms and access tokens for multi-participant
 * video and audio calls (SFU-based).
 *
 * Complements the existing 1-on-1 WebRTC call system by providing
 * group call infrastructure.
 */

import { AccessToken, RoomServiceClient } from "livekit-server-sdk";
import { logger } from "../utilities/logger";

// ─── Configuration ─────────────────────────────────────────────────

const LIVEKIT_URL = process.env.LIVEKIT_URL || "";
const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY || "";
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET || "";

const isConfigured = (): boolean => {
  if (!LIVEKIT_URL || !LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
    logger.warn(
      "[LiveKit] LIVEKIT_URL, LIVEKIT_API_KEY, or LIVEKIT_API_SECRET not configured — group calls disabled",
    );
    return false;
  }
  return true;
};

// ─── Room Service Client ───────────────────────────────────────────

let roomClient: RoomServiceClient | null = null;

function getRoomClient(): RoomServiceClient | null {
  if (!isConfigured()) return null;

  if (!roomClient) {
    roomClient = new RoomServiceClient(LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET);
  }

  return roomClient;
}

// ─── Room Management ───────────────────────────────────────────────

export interface RoomOptions {
  maxParticipants?: number;
  emptyTimeout?: number; // seconds before room is deleted when empty
}

/**
 * Create a new LiveKit room for a group call.
 */
export async function createRoom(
  roomName: string,
  options: RoomOptions = {},
): Promise<{ roomName: string } | null> {
  const client = getRoomClient();
  if (!client) return null;

  try {
    await client.createRoom({
      name: roomName,
      maxParticipants: options.maxParticipants || 8,
      emptyTimeout: options.emptyTimeout || 60,
    });

    logger.info(`[LiveKit] Room created: ${roomName}`);
    return { roomName };
  } catch (err) {
    logger.error(`[LiveKit] Failed to create room: ${roomName}`, {
      error: (err as Error).message,
    });
    return null;
  }
}

/**
 * Generate an access token for a participant to join a room.
 *
 * `metadata` is optional JSON stringified data (e.g. the user's avatar URL)
 * that LiveKit propagates to every participant in the room, so the client can
 * render real profile pictures on tiles instead of initials.
 */
export async function generateToken(
  roomName: string,
  participantName: string,
  identity: string,
  canPublish: boolean = true,
  canSubscribe: boolean = true,
  metadata?: string,
): Promise<string | null> {
  if (!isConfigured()) return null;

  try {
    const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
      identity,
      name: participantName,
      ...(metadata ? { metadata } : {}),
    });

    at.addGrant({
      roomJoin: true,
      room: roomName,
      canPublish,
      canSubscribe,
    });

    const token = await at.toJwt();
    return token;
  } catch (err) {
    logger.error(`[LiveKit] Failed to generate token for ${identity}`, {
      error: (err as Error).message,
    });
    return null;
  }
}

/**
 * List all active rooms.
 */
export async function listRooms(): Promise<string[]> {
  const client = getRoomClient();
  if (!client) return [];

  try {
    const rooms = await client.listRooms();
    return rooms.map((r) => r.name || "");
  } catch (err) {
    logger.error("[LiveKit] Failed to list rooms", {
      error: (err as Error).message,
    });
    return [];
  }
}

/**
 * Delete a room and disconnect all participants.
 */
export async function deleteRoom(roomName: string): Promise<boolean> {
  const client = getRoomClient();
  if (!client) return false;

  try {
    await client.deleteRoom(roomName);
    logger.info(`[LiveKit] Room deleted: ${roomName}`);
    return true;
  } catch (err) {
    logger.error(`[LiveKit] Failed to delete room: ${roomName}`, {
      error: (err as Error).message,
    });
    return false;
  }
}

/**
 * Get participant count in a room.
 */
export async function getParticipantCount(roomName: string): Promise<number> {
  const client = getRoomClient();
  if (!client) return 0;

  try {
    const participants = await client.listParticipants(roomName);
    return participants.length;
  } catch {
    return 0;
  }
}
