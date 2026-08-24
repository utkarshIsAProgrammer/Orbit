import { syncBluesky } from "./blueskySync";
import { syncMastodon } from "./mastodonSync";
import { syncLemmy } from "./lemmySync";
import { startBlueskyFirehose } from "./blueskyFirehose";
import { registerMaintenanceJob } from "../../configs/queue";
import { logger } from "../../utilities/logger";

/**
 * External feed orchestrator — periodically pulls fresh public content from
 * Bluesky, Mastodon, and Lemmy into ExternalPost, plus a LIVE Bluesky
 * firehose subscription that lands new posts within seconds.
 *
 * Sync is deliberately conservative: anonymous public endpoints, small
 * per-run volumes, and polite pacing between requests (see each sync).
 * The firehose (see blueskyFirehose.ts) adds real-time freshness on top.
 */

const SYNC_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
const SYNC_CRON_PATTERN = "*/15 * * * *"; // every 15 minutes

let started = false;
let timer: NodeJS.Timeout | null = null;
let syncPromise: Promise<number> | null = null;
let stopFirehose: (() => Promise<void>) | null = null;

/** Run one full sync cycle (all networks). Safe to call concurrently. */
export async function runExternalSyncCycle(): Promise<number> {
  // Guard against overlapping runs (e.g. timer + manual trigger)
  if (syncPromise) return syncPromise;
  const run = (async () => {
    const started = Date.now();
    const results = await Promise.allSettled([
      syncBluesky(),
      syncMastodon(),
      syncLemmy(),
    ]);
    const inserted = results.reduce(
      (sum, r) => sum + (r.status === "fulfilled" ? r.value : 0),
      0
    );
    logger.info("External feed sync cycle complete", {
      inserted,
      bluesky: results[0].status === "fulfilled" ? results[0].value : "error",
      mastodon: results[1].status === "fulfilled" ? results[1].value : "error",
      lemmy: results[2].status === "fulfilled" ? results[2].value : "error",
      tookMs: Date.now() - started,
    });
    return inserted;
  })().finally(() => {
    syncPromise = null;
  });
  syncPromise = run;
  return syncPromise;
}

/** Start the periodic sync loop (idempotent). */
export function startExternalSync(): void {
  if (started) return;
  started = true;

  // True when this process is a cluster WORKER. In cluster mode the primary
  // process forks workers and exits, so everything below only ever runs in
  // workers — the guard keeps timers/firehose from being started N times.
  const isClusterWorker = (() => {
    try {
      const cluster = require("cluster") as { isPrimary?: boolean };
      return cluster.isPrimary === false;
    } catch {
      // single-process mode — no cluster module
      return false;
    }
  })();

  // ── 15-min poll cycle ──
  // Prefers a BullMQ repeatable maintenance job: the schedule lives in Redis,
  // so it runs exactly once per interval no matter how many processes are
  // up (in cluster mode every worker registers the same job id — idempotent).
  // Falls back to an in-process timer when BullMQ isn't configured.
  void registerMaintenanceJob("external-sync", SYNC_CRON_PATTERN).then(
    (registered) => {
      if (registered) {
        logger.info(
          "External feed sync poll registered as BullMQ repeatable job (every 15 minutes)",
        );
      } else if (!isClusterWorker) {
        // In-process fallback (single-process mode only — cluster workers
        // would each run their own timer).
        logger.info(
          "External feed sync poll using in-process timer (every 15 minutes)",
        );
        timer = setInterval(() => {
          void runExternalSyncCycle();
        }, SYNC_INTERVAL_MS);
      }
    },
  );

  // First run shortly after boot so the Web tab has content immediately.
  // Single-process mode only — in cluster mode the repeatable job covers it
  // (and an early run from every worker would duplicate outbound load).
  if (!isClusterWorker) {
    timer = setTimeout(() => {
      void runExternalSyncCycle();
    }, 30 * 1000);
  } else {
    logger.info("External feed sync initial run skipped on cluster worker");
  }

  // ── Live Bluesky firehose ──
  // Long-lived stream (not job-shaped) — new posts land within seconds
  // instead of waiting for the next 15-minute poll. Started async from the
  // primary process only; failure is non-fatal (the poller keeps the Web
  // tab populated).
  if (isClusterWorker) {
    logger.info("Bluesky firehose skipped on cluster worker");
    return;
  }
  void startBlueskyFirehose()
    .then((stop) => {
      stopFirehose = stop;
    })
    .catch((err: any) => {
      logger.error("Bluesky firehose failed to start", { error: err?.message });
    });
}

/** Stop the periodic sync loop (used in tests). */
export async function stopExternalSync(): Promise<void> {
  if (timer) {
    clearTimeout(timer);
    clearInterval(timer);
    timer = null;
  }
  if (stopFirehose) {
    const stop = stopFirehose;
    stopFirehose = null;
    await stop();
  }
}
