/**
 * Clear follow/profile caches after the counter repair (one-shot).
 * Removes stale `followers:*`, `following:*`, and user-profile route caches
 * so corrected counts show instantly instead of after TTL expiry.
 *
 * Run: npx tsx scripts/clear-follow-caches.ts
 */
import "./load-env"; // must run before src imports (env validation)
import { clearByPattern } from "../src/configs/cache";

async function main() {
  const patterns = [
    "followers:*",
    "following:*",
    "follows:*",
    "api:*:*follows*",
    "api:*:*users*",
    "user:*",
    "users:*",
  ];
  for (const p of patterns) {
    await clearByPattern(p);
    console.log("cleared:", p);
  }
  console.log("Done.");
  process.exit(0);
}

main().catch((e) => {
  console.error("Failed:", e.message);
  process.exit(1);
});
