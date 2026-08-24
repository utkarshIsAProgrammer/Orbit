/**
 * syncQueue.ts — Offline mutation queue.
 *
 * When the user performs a mutation (send message, like post, etc.)
 * while offline, the request is stored in Dexie's syncQueue table
 * and replayed in FIFO order when the network is restored.
 *
 * The processor is called automatically when `navigator.onLine` changes
 * to true, and can also be called manually.
 */

import { db, type SyncQueueEntry } from "./offlineDB";
import { logger } from "./logger";

/** Maximum number of retry attempts before giving up. */
const MAX_RETRIES = 5;

/** Base delay for exponential backoff (ms). */
const BASE_DELAY = 1000; // 1s

/** Maximum delay between retries (ms). */
const MAX_DELAY = 30_000; // 30s

// ── Adding to the queue ───────────────────────────────────────────────────

/**
 * Add a mutation to the offline sync queue.
 * Returns the auto-generated entry ID.
 */
export async function addToSyncQueue(
	url: string,
	method: "POST" | "PUT" | "DELETE",
	body?: unknown,
	headers?: Record<string, string>,
): Promise<void> {
	// ── Dedupe / coalesce ─────────────────────────────────────────────
	// Offline taps can queue the same mutation multiple times (e.g. like a
	// post 3 times while offline) or toggle it on/off (like then unlike).
	// Replaying all of them is noisy and can flip state twice. Rules:
	//   1. Same URL + same method + same body → skip (already queued).
	//   2. Same URL + opposite toggle (POST vs DELETE) → cancel BOTH — the
	//      net effect is "no change", so neither should be replayed.
	// This mirrors what the server's own toggle endpoints do server-side.
	const serializedBody = body !== undefined ? JSON.stringify(body) : undefined;
	const queued = await db.syncQueue.where("url").equals(url).toArray();

	for (const existing of queued) {
		if (existing.method === method && existing.body === serializedBody) {
			logger.info("syncQueue: Duplicate mutation skipped", {
				url,
				method,
			});
			return; // already queued — don't duplicate
		}
		// POST↔DELETE toggle on the same URL cancels out (like/unlike,
		// follow/unfollow, save/unsave, repost/unrepost…).
		if (
			(existing.method === "POST" && method === "DELETE") ||
			(existing.method === "DELETE" && method === "POST")
		) {
			logger.info("syncQueue: Toggle cancelled (POST↔DELETE)", {
				url,
			});
			if (existing.id !== undefined) {
				await db.syncQueue.delete(existing.id);
			}
			return; // net effect is no change — queue nothing
		}
	}

	const entry: SyncQueueEntry = {
		url,
		method,
		body: serializedBody,
		headers,
		createdAt: Date.now(),
		retryCount: 0,
	};

	await db.syncQueue.add(entry);
	logger.info("syncQueue: Added mutation to queue", {
		url,
		method,
		isOnline: navigator.onLine,
	});

	// If we're already online, try to flush immediately
	if (navigator.onLine) {
		// Small delay to allow the caller to finish its flow
		setTimeout(() => processSyncQueue(), 100);
	}
}

/**
 * Remove a single entry from the queue (after successful processing).
 */
async function removeFromQueue(id: number): Promise<void> {
	await db.syncQueue.delete(id);
}

// ── Processing the queue ──────────────────────────────────────────────────

let isProcessing = false;

/**
 * Process all pending mutations in FIFO order.
 * Called automatically when coming back online.
 */
export async function processSyncQueue(): Promise<void> {
	if (isProcessing) return;
	if (!navigator.onLine) return;

	isProcessing = true;
	logger.info("syncQueue: Starting queue processing");

	try {
		const entries = await db.syncQueue
			.orderBy("createdAt")
			.toArray();

		if (entries.length === 0) {
			isProcessing = false;
			return;
		}

		logger.info(`syncQueue: Processing ${entries.length} entries`);

		for (const entry of entries) {
			if (!navigator.onLine) {
				logger.warn("syncQueue: Went offline, pausing");
				break;
			}

			await processEntry(entry);
		}
	} catch (err) {
		logger.error("syncQueue: Processing error", err);
	} finally {
		isProcessing = false;
	}
}

/**
 * Process a single queue entry.
 * Returns true if successful, false if it should be retried later.
 */
async function processEntry(entry: SyncQueueEntry): Promise<boolean> {
	if (entry.id === undefined) return false;

	try {
		const headers: Record<string, string> = {
			"Content-Type": "application/json",
			...entry.headers,
		};

		// Read CSRF token if needed
	const csrfMatch = document.cookie.match(
		/(?:^|;\s*)csrf-token=([^;]*)/,
	);
	if (csrfMatch) {
		headers["x-csrf-token"] = csrfMatch[1]!;
	}

		const fetchOptions: RequestInit = {
			method: entry.method,
			headers,
			credentials: "include" as RequestCredentials,
		};

		if (entry.body && entry.method !== "DELETE") {
			fetchOptions.body = entry.body;
		}

		const res = await fetch(entry.url, fetchOptions);

		if (res.ok) {
			logger.info("syncQueue: Entry processed", {
				id: entry.id,
				url: entry.url,
			});
			await removeFromQueue(entry.id);
			return true;
		}

		// Server rejected — if it's a 4xx, don't retry
		if (res.status >= 400 && res.status < 500) {
			logger.error("syncQueue: Non-retryable error", {
				id: entry.id,
				status: res.status,
				url: entry.url,
			});
			// Remove from queue — not worth retrying
			await removeFromQueue(entry.id);
			return true;
		}

		// 5xx — retry with backoff
		throw new Error(`Server error: ${res.status}`);
	} catch (err: any) {
		const newRetryCount = entry.retryCount + 1;
		const errorMsg = err?.message || String(err);

		if (newRetryCount >= MAX_RETRIES) {
			logger.error("syncQueue: Max retries reached, removing", {
				id: entry.id,
				url: entry.url,
				error: errorMsg,
			});
			await removeFromQueue(entry.id);
			return true;
		}

		// Update retry count and schedule retry
		await db.syncQueue.update(entry.id, {
			retryCount: newRetryCount,
			lastError: errorMsg,
		});

		logger.warn("syncQueue: Will retry entry", {
			id: entry.id,
			retryCount: newRetryCount,
			error: errorMsg,
		});

		return false;
	}
}

// ── Retry scheduling (exponential backoff) ────────────────────────────────

/**
 * Schedule a retry for failed entries using exponential backoff.
 * Called after a failed batch processing attempt.
 */
export function scheduleRetry(entry: SyncQueueEntry): void {
	if (entry.id === undefined) return;
	const delay = Math.min(
		BASE_DELAY * Math.pow(2, entry.retryCount),
		MAX_DELAY,
	);
	setTimeout(() => processSyncQueue(), delay);
}

// ── Queue introspection ───────────────────────────────────────────────────

/** Get the number of pending mutations in the queue. */
export async function getQueueSize(): Promise<number> {
	return db.syncQueue.count();
}

/** Get all pending entries (for debugging/display). */
export async function getQueueEntries(): Promise<SyncQueueEntry[]> {
	return db.syncQueue.orderBy("createdAt").toArray();
}
