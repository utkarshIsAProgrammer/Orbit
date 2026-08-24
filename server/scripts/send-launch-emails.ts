/**
 * Admin trigger — sends the launch-day "The door is open" email to every
 * waitlist member, using the app's Brevo mailer (with its SendCoreX/Resend/
 * SMTP fallbacks). Idempotent: each record gets emailed at most once thanks
 * to `launchEmailedAt`, so re-running the script never double-emails.
 *
 * Usage:
 *   npx tsx scripts/send-launch-emails.ts            # send to everyone pending
 *   npx tsx scripts/send-launch-emails.ts --dry-run  # preview recipients only
 *   npx tsx scripts/send-launch-emails.ts --limit 50 # cap batch size
 *   npx tsx scripts/send-launch-emails.ts --preview-html # print one composed email, don't send
 *   npx tsx scripts/send-launch-emails.ts --url=https://orbit-your-inner-circle.vercel.app
 *
 * Must be run from server/ so dotenv finds .env.
 *
 * The app URL defaults to the live production app. Local .env files usually
 * say CLIENT_URL=http://localhost:5173 — never email that to real users.
 */
import "dotenv/config";
import mongoose from "mongoose";
import { Waitlist } from "../src/models/waitlist.model";
import { Bot } from "../src/models/bot.model";
import { sendLaunchMail } from "../src/configs/nodeMailer";

const isDryRun = process.argv.includes("--dry-run");
const previewHtml = process.argv.includes("--preview-html");
const limitArg = process.argv.find((a) => a.startsWith("--limit="));
const LIMIT = limitArg ? Number(limitArg.split("=")[1]) || 100 : 100;

// Repeatable --exclude-email=you@x.com — skip specific addresses (e.g. the
// admin's own seat). Bot accounts are ALWAYS skipped automatically.
const EXCLUDE_EMAILS = new Set(
  process.argv
    .filter((a) => a.startsWith("--exclude-email="))
    .map((a) => a.split("=")[1].toLowerCase().trim()),
);

// The login link emailed to every member. Defaults to the live production app
// so a local run can never email a localhost URL; override with --url=.
const urlArg = process.argv.find((a) => a.startsWith("--url="));
const APP_URL = urlArg
  ? urlArg.split("=")[1]
  : process.env.CLIENT_URL && !process.env.CLIENT_URL.includes("localhost")
    ? process.env.CLIENT_URL.replace(/\/$/, "")
    : "https://orbit-your-inner-circle.vercel.app";

const BATCH_SIZE = 20; // send in small batches so a mailer hiccup doesn't lose the run

async function main() {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error("MONGO_URI is not set in .env");
    process.exit(1);
  }

  await mongoose.connect(uri);
  console.log(
    previewHtml
      ? "PREVIEW — printing one composed email (nothing sent)"
      : isDryRun
        ? "DRY RUN — nothing will be sent"
        : "Connected. Sending launch emails...",
  );

  // Bot usernames → their waitlist emails (username@gmail.com) are fake
  // seats added for the landing counter — never email them.
  const botLocalParts = new Set(
    (await Bot.find({}).select("username").lean()).map((b) => b.username),
  );

  // Only seats that never got the launch email (and aren't removed).
  const cursor = Waitlist.find({ launchEmailedAt: null, status: { $ne: "removed" } })
    .sort({ createdAt: 1 })
    .limit(LIMIT)
    .cursor();

  let sent = 0;
  let skipped = 0;
  let batch: any[] = [];

  const flush = async () => {
    if (batch.length === 0) return;
    const docs = batch;
    batch = [];
    // Sequential per doc (the mailer already has an internal 15s timeout);
    // never parallel-blast to avoid tripping Brevo rate limits.
  for (const doc of docs) {
    const emailKey = (doc.email || "").toLowerCase().trim();
    const local = emailKey.split("@")[0];
    if (EXCLUDE_EMAILS.has(emailKey) || botLocalParts.has(local)) {
      if (isDryRun) console.log(`  - skipped (excluded): ${doc.email}`);
      skipped++;
      continue;
    }
    if (previewHtml) {
      // Print ONE fully-composed email (first pending recipient) and stop.
      const ok = await sendLaunchMail({
        email: doc.email,
        username: doc.name || doc.email.split("@")[0] || "there",
        appUrl: APP_URL,
        preview: true,
      });
      if (!ok) console.warn(`  ! failed to compose: ${doc.email}`);
      console.log("\n(PREVIEW done — nothing was emailed. Remove --preview-html to send.)");
      await mongoose.disconnect();
      process.exit(0);
    }
    if (isDryRun) {
      // Preview mode: count the recipient but never call the mailer.
      sent++;
      continue;
    }
      const ok = await sendLaunchMail({
        email: doc.email,
        username: doc.name || doc.email.split("@")[0] || "there",
        appUrl: APP_URL,
      });
      if (ok) {
        sent++;
        await Waitlist.updateOne(
          { _id: doc._id },
          { $set: { launchEmailedAt: new Date() } },
        );
      } else {
        skipped++;
        console.warn(`  ! failed (kept pending for retry): ${doc.email}`);
      }
    }
  };

  for await (const doc of cursor) {
    batch.push(doc);
    if (batch.length >= BATCH_SIZE) await flush();
  }
  await flush();

  console.log(
    isDryRun
      ? `DRY RUN complete — ${sent} would be emailed`
      : `Done — emailed ${sent}, failed/skipped ${skipped}`,
  );
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error("Launch email run failed:", err);
  process.exit(1);
});
