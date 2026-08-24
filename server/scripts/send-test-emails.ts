/**
 * Admin tool — sends EVERY ORBIT email template to a test inbox so the
 * founder can inspect the look and feel of each one (HTML + plain text +
 * delivery) without triggering the real flows.
 *
 * Usage:
 *   npx tsx scripts/send-test-emails.ts                          # → devutkarshya1@gmail.com
 *   npx tsx scripts/send-test-emails.ts --to=me@example.com      # → custom inbox
 *   npx tsx scripts/send-test-emails.ts --dry-run                # preview recipients, send nothing
 *
 * IMPORTANT: run with CLIENT_URL pointing at the LIVE app so every link
 * in the email is clickable from your inbox (your local .env says
 * localhost, which would produce dead links). Example:
 *
 *   CLIENT_URL=https://orbit-your-inner-circle.vercel.app \
 *     npx tsx scripts/send-test-emails.ts
 *
 * Must be run from server/ so dotenv finds .env.
 */
import "dotenv/config";
import {
  sendWaitlistConfirmationMail,
  sendLaunchMail,
  sendWelcomeMail,
  sendNewDeviceLoginMail,
  sendPasswordUpdateMail,
  sendOtpMail,
  sendForgotPasswordMail,
  sendDeletionMail,
} from "../src/configs/nodeMailer";

const toArg = process.argv.find((a) => a.startsWith("--to="));
const TO = (toArg ? toArg.split("=")[1] : "devutkarshya1@gmail.com").trim();
const isDryRun = process.argv.includes("--dry-run");

// Prefer an explicit env override (CLIENT_URL=... on the command line) over
// the local .env value, so links resolve to the real app.
const liveApp = process.env.CLIENT_URL?.includes("localhost")
  ? "https://orbit-your-inner-circle.vercel.app"
  : (process.env.CLIENT_URL || "https://orbit-your-inner-circle.vercel.app").replace(/\/$/, "");

const user = { email: TO, username: "Dev" };

const steps: { label: string; run: () => Promise<unknown> }[] = [
  {
    label: "1/8 Waitlist confirmation (prelaunch theme)",
    run: () => sendWaitlistConfirmationMail({ ...user, position: 33, removeUrl: `${liveApp}/api/waitlist/remove/testtoken123` }),
  },
  {
    label: "2/8 LAUNCH — the door is open (Day One rewards)",
    run: () => sendLaunchMail({ ...user, appUrl: liveApp }),
  },
  {
    label: "3/8 Welcome (app theme)",
    run: () => sendWelcomeMail(user),
  },
  {
    label: "4/8 New-device login alert",
    run: () => sendNewDeviceLoginMail({ ...user, deviceLabel: "Chrome on macOS", ip: "203.0.113.42" }),
  },
  {
    label: "5/8 Password changed",
    run: () => sendPasswordUpdateMail(user),
  },
  {
    label: "6/8 One-time code (OTP)",
    run: () => sendOtpMail(user, "482913"),
  },
  {
    label: "7/8 New password set (forgot-password)",
    run: () => sendForgotPasswordMail(user),
  },
  {
    label: "8/8 Account deleted",
    run: () => sendDeletionMail(user),
  },
];

async function main() {
  console.log(`Test recipient: ${TO}`);
  console.log(`App URL in emails: ${liveApp}`);
  if (isDryRun) {
    console.log("\nDRY RUN — nothing will be sent. Recipients:");
    steps.forEach((s) => console.log(`  ${s.label} → ${TO}`));
    console.log("\nSend for real with: CLIENT_URL=" + liveApp + " npx tsx scripts/send-test-emails.ts");
    return;
  }
  console.log("\nSending…\n");
  let ok = 0;
  let fail = 0;
  for (const step of steps) {
    try {
      await step.run();
      console.log(`✅ ${step.label} — sent to ${TO}`);
      ok++;
    } catch (err: any) {
      console.error(`❌ ${step.label} — FAILED: ${err?.message || err}`);
      fail++;
    }
    // small pause so Brevo's per-minute rate limit isn't hit
    await new Promise((r) => setTimeout(r, 1500));
  }
  console.log(`\nDone — ${ok} sent, ${fail} failed. Check ${TO}'s inbox.`);
  process.exit(fail ? 1 : 0);
}

main().catch((err) => {
  console.error("Test-email run failed:", err);
  process.exit(1);
});
