import { storeExternalPosts, fetchJson, type NormalizedExternalPost } from "./normalizer";
import { extractMedia, CREATORS } from "./blueskySync";
import { logger } from "../../utilities/logger";

// @atproto/sync is ESM-only and its deep dependency (multiformats/cid) is not
// resolvable through tsx's CJS loader, which is how `npm run dev` runs the
// server. Plain `node` (production `dist/`) handles it fine via require(esm).
// To keep the dev server bootable in ALL environments we load the package
// lazily at runtime and treat any load failure as a non-fatal feature
// disablement — the 15-minute poller keeps the Web tab populated regardless.
let firehoseLib: typeof import("@atproto/sync") | null = null;
let firehoseLibLoadPromise: Promise<boolean> | null = null;

async function loadFirehoseLib(): Promise<boolean> {
  if (firehoseLib) return true;
  if (firehoseLibLoadPromise) return firehoseLibLoadPromise;
  firehoseLibLoadPromise = (async () => {
    try {
      firehoseLib = await import("@atproto/sync");
      logger.info("Bluesky firehose library loaded");
      return true;
    } catch (err: any) {
      logger.warn("Bluesky firehose library unavailable — live feed disabled", {
        error: err?.message?.slice(0, 120),
      });
      return false;
    }
  })();
  return firehoseLibLoadPromise;
}

/**
 * Live Bluesky firehose — turns the 15-minute polling cycle into a stream
 * that lands new posts within seconds.
 *
 * We subscribe to the network-wide repo firehose (com.atproto.sync.
 * subscribeRepos) via the official `@atproto/sync` Firehose client, which
 * handles CBOR decoding, cursor persistence, heartbeats, and reconnection.
 * Only `app.bsky.feed.post` creates are delivered (filterCollections), and
 * we keep the workload small:
 *
 *   1. CURATED CREATORS — posts from the well-known pool (same handles the
 *      poller uses) are always ingested, so their newest posts appear live.
 *   2. GENERAL SAMPLE — a small, rate-limited sample of the wider network
 *      (preferring posts with media) so the feed stays alive with discovery
 *      content without flooding the DB.
 *
 * Author profiles (handle / displayName / avatar) are resolved in batches
 * against the public AppView API and cached in-memory for an hour.
 */

const PUBLIC_API = "https://public.api.bsky.app";

// How many non-curated posts to admit per minute (hard cap).
const GENERAL_PER_MINUTE = Number(process.env.BLUESKY_FIREHOSE_GENERAL_PER_MIN ?? 20);

// Sample rates for general (non-curated) posts. Media is heavily favored so
// the live stream feeds the feed with visual posts (the whole point of the
// open-web feed); text-only posts trickle in at a low rate for variety.
const SAMPLE_WITH_MEDIA = 0.5; // keep ~1 in 2 posts that have images/video
const SAMPLE_TEXT_ONLY = 0.02; // keep ~1 in 50 text-only posts

const PROFILE_TTL_MS = 60 * 60 * 1000; // 1 hour

interface CachedProfile {
  handle: string;
  displayName: string;
  avatar: string;
  profileUrl: string;
  fetchedAt: number;
}

// did -> profile (bounded TTL cache, pruned lazily)
const profileCache = new Map<string, CachedProfile>();
const profileFetching = new Map<string, Promise<CachedProfile | null>>();

// The Firehose class type comes from the lazily-loaded ESM lib; derive it
// from the import type so no static import is needed.
type FirehoseInstance = InstanceType<(typeof import("@atproto/sync"))["Firehose"]>;
let firehose: FirehoseInstance | null = null;
let flushTimer: NodeJS.Timeout | null = null;
let stopped = false;

// Pending posts waiting for the next batch flush.
let pending: NormalizedExternalPost[] = [];
// Rolling window for the general-per-minute cap.
let generalWindow: number[] = [];
// Seq of the last processed event (for reconnect resume).
let lastSeq: number | undefined;

// ─── Profile resolution ─────────────────────────────────────────────

async function resolveProfile(did: string): Promise<CachedProfile | null> {
  const cached = profileCache.get(did);
  if (cached && Date.now() - cached.fetchedAt < PROFILE_TTL_MS) return cached;
  if (profileFetching.has(did)) return profileFetching.get(did)!;
  const p = (async () => {
    try {
      const data = await fetchJson(
        `${PUBLIC_API}/xrpc/app.bsky.actor.getProfiles?actors=${encodeURIComponent(did)}`,
        {},
        8000
      );
      const prof = data?.profiles?.[0];
      if (!prof) return null;
      const built: CachedProfile = {
        handle: prof.handle || did,
        displayName: prof.displayName || prof.handle || "Bluesky user",
        avatar: prof.avatar || "",
        profileUrl: prof.handle
          ? `https://bsky.app/profile/${encodeURIComponent(prof.handle)}`
          : "",
        fetchedAt: Date.now(),
      };
      profileCache.set(did, built);
      return built;
    } catch {
      return null;
    } finally {
      profileFetching.delete(did);
    }
  })();
  profileFetching.set(did, p);
  return p;
}

/** Resolve creator handles → DIDs once at startup (batch call). */
async function resolveCreatorDids(): Promise<Set<string>> {
  const dids = new Set<string>();
  try {
    const data = await fetchJson(
      `${PUBLIC_API}/xrpc/app.bsky.actor.getProfiles?actors=${CREATORS.map(encodeURIComponent).join("&actors=")}`,
      {},
      10000
    );
    for (const prof of data?.profiles || []) {
      if (prof?.did) {
        dids.add(prof.did);
        profileCache.set(prof.did, {
          handle: prof.handle || prof.did,
          displayName: prof.displayName || prof.handle || "Bluesky user",
          avatar: prof.avatar || "",
          profileUrl: prof.handle
            ? `https://bsky.app/profile/${encodeURIComponent(prof.handle)}`
            : "",
          fetchedAt: Date.now(),
        });
      }
    }
  } catch (err: any) {
    logger.warn("Bluesky firehose: creator DID resolution failed", {
      error: err?.message,
    });
  }
  return dids;
}

// ─── Admission control ──────────────────────────────────────────────

function allowGeneralPost(): boolean {
  const now = Date.now();
  // Prune the rolling minute window (drop timestamps older than 60s)
  while (generalWindow.length > 0) {
    const oldest = generalWindow[0];
    if (oldest === undefined || now - oldest <= 60_000) break;
    generalWindow.shift();
  }
  if (generalWindow.length >= GENERAL_PER_MINUTE) return false;
  generalWindow.push(now);
  return true;
}

// ─── Event handling ─────────────────────────────────────────────────

async function handleCommit(evt: any, curatedDids: Set<string>): Promise<void> {
  if (evt.event !== "create") return; // only new posts
  const did: string = evt.did;
  if (!did || evt.collection !== "app.bsky.feed.post") return;
  const record = evt.record;
  const text: string = (record?.text || "").trim();
  if (!text) return;

  const isCurated = curatedDids.has(did);
  if (!isCurated) {
    // Rate-limited general sampling. "Has media" means an actual extracted
    // image/video (not a bare link card, which embeds without media).
    const hasMedia = extractMedia(record?.embed, did).length > 0;
    const sampleRate = hasMedia ? SAMPLE_WITH_MEDIA : SAMPLE_TEXT_ONLY;
    if (Math.random() > sampleRate) return;
    if (!allowGeneralPost()) return;
  }

  const [profile] = isCurated
    ? [profileCache.get(did) || null]
    : [await resolveProfile(did)];

  const rkey = evt.rkey || (typeof evt.uri === "string" ? evt.uri.split("/").pop() : "");
  if (!rkey) return;

  pending.push({
    source: "bluesky",
    sourceId: typeof evt.uri === "string" ? evt.uri : `at://${did}/app.bsky.feed.post/${rkey}`,
    url: `https://bsky.app/profile/${encodeURIComponent(profile?.handle || did)}/post/${rkey}`,
    content: text,
    author: {
      handle: profile?.handle || did,
      displayName: profile?.displayName || profile?.handle || "Bluesky user",
      avatar: profile?.avatar || "",
      profileUrl: profile?.profileUrl || "",
    },
    media: extractMedia(record?.embed, did),
    stats: { likes: 0, reposts: 0, replies: 0 },
    originalCreatedAt: new Date(record?.createdAt || evt.time || Date.now()),
  });
}

// ─── Batch flush ────────────────────────────────────────────────────

async function flushPending(): Promise<void> {
  if (pending.length === 0) return;
  const batch = pending;
  pending = [];
  try {
    const { inserted } = await storeExternalPosts(batch);
    if (inserted > 0) {
      logger.debug("Bluesky firehose batch stored", { inserted });
    }
  } catch (err: any) {
    logger.warn("Bluesky firehose flush failed", { error: err?.message });
  }
}

// ─── Lifecycle ──────────────────────────────────────────────────────

/**
 * Start the live firehose consumer. Resolves curated creator DIDs, opens
 * the subscription, and flushes buffered posts every 5s. Idempotent.
 * Returns a stop function for tests.
 */
export async function startBlueskyFirehose(): Promise<() => Promise<void>> {
  if (firehose) return () => firehose!.destroy();
  stopped = false;

  // Lazy-load the ESM library (safe on tsx dev and node prod).
  const libOk = await loadFirehoseLib();
  if (!libOk || !firehoseLib) return async () => {};
  const { Firehose } = firehoseLib;
  const { IdResolver } = await import("@atproto/identity");

  // Resolve the curated creators (also warms the profile cache)
  const curatedDids = await resolveCreatorDids();
  logger.info("Bluesky firehose starting", { curatedCount: curatedDids.size });

  const idResolver = new IdResolver();

  firehose = new Firehose({
    idResolver,
    filterCollections: ["app.bsky.feed.post"],
    unauthenticatedCommits: true,
    excludeIdentity: true,
    excludeAccount: true,
    excludeSync: true,
    getCursor: () => lastSeq,
    maxReconnectSeconds: 60,
    handleEvent: async (evt: any) => {
      if (stopped) return;
      if (evt.seq !== undefined) lastSeq = evt.seq;
      await handleCommit(evt, curatedDids);
    },
    onError: (err: Error) => {
      logger.warn("Bluesky firehose error", { error: err?.message });
    },
  });

  // Start in the background — never block boot on the socket
  void firehose.start().catch((err: any) => {
    logger.error("Bluesky firehose stopped", { error: err?.message });
  });

  flushTimer = setInterval(() => void flushPending(), 5000);
  flushTimer.unref?.();

  const stop = async () => {
    stopped = true;
    if (flushTimer) {
      clearInterval(flushTimer);
      flushTimer = null;
    }
    await flushPending();
    if (firehose) {
      const fh = firehose;
      firehose = null;
      await fh.destroy();
    }
  };

  return stop;
}

/** True while the subscription is open (for tests/diagnostics). */
export function isFirehoseRunning(): boolean {
  return firehose !== null;
}
