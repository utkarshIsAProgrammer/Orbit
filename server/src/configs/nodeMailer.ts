import { Resend } from "resend";
import nodemailer from "nodemailer";
import { env } from "./env";
import { logger } from "../utilities/logger";

type MailUser = {
  email: string;
  username: string;
};

type MailPayload = {
  to: string;
  subject: string;
  text?: string;
  html: string;
};

// Brevo REST API — PRIMARY transport when configured (free tier: 300
// emails/day). The app's other providers act as fallbacks only.
const brevoConfigured = Boolean(env.BREVO_API_KEY);
const BREVO_ENDPOINT = "https://api.brevo.com/v3/smtp/email";
const BREVO_FROM = env.BREVO_FROM_EMAIL || "no-reply@orbit.app";
const BREVO_NAME = env.BREVO_SENDER_NAME || "ORBIT";

const sendViaBrevo = async (payload: MailPayload) => {
  // Hard 15s timeout — a hung request must never block awaited callers
  // (OTP / forgot-password emails in auth flows) if the API stalls.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  let res: Response;
  try {
    res = await fetch(BREVO_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": env.BREVO_API_KEY!,
      },
      body: JSON.stringify({
        sender: { name: BREVO_NAME, email: BREVO_FROM },
        to: [{ email: payload.to }],
        subject: payload.subject,
        // The existing branded HTML templates are passed through as-is.
        htmlContent: payload.html,
        ...(payload.text ? { textContent: payload.text } : {}),
      }),
      signal: controller.signal,
    });
  } catch (err: any) {
    if (err?.name === "AbortError") throw new Error("Brevo request timed out after 15s");
    throw err;
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Brevo ${res.status}: ${detail.slice(0, 300)}`);
  }
};

// Resend REST API — tertiary transport (used when Brevo/SendCoreX are off).
const resend = env.RESEND_API_KEY ? new Resend(env.RESEND_API_KEY) : null;

// SendCoreX REST API — PRIMARY transport (shared sending domains mean no DNS
// verification is needed; the from/senderName come from the dashboard
// provisioned sender on a shared domain like orbit@corexsend.com).
const sendcorexConfigured = Boolean(env.SENDCOREX_API_KEY);
const SENDCOREX_ENDPOINT = "https://mail.sendcorex.com/v3.0/send";
const SENDCOREX_FROM = env.SENDCOREX_FROM_EMAIL || "orbit@corexsend.com";
const SENDCOREX_NAME = env.SENDCOREX_SENDER_NAME || "ORBIT";

const sendViaSendcorex = async (payload: MailPayload) => {
  // Hard 15s timeout — a hung request must never block awaited callers
  // (OTP / forgot-password emails in auth flows) if the API stalls.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  let res: Response;
  try {
    res = await fetch(SENDCOREX_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: env.SENDCOREX_API_KEY!,
      },
      body: JSON.stringify({
        to: payload.to,
        from: SENDCOREX_FROM,
        senderName: SENDCOREX_NAME,
        subject: payload.subject,
        body: payload.html,
        ...(env.SENDCOREX_REPLY_TO ? { replyTo: env.SENDCOREX_REPLY_TO } : {}),
      }),
      signal: controller.signal,
    });
  } catch (err: any) {
    if (err?.name === "AbortError") throw new Error("SendCoreX request timed out after 15s");
    throw err;
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`SendCoreX ${res.status}: ${detail.slice(0, 300)}`);
  }
};

// Legacy nodemailer SMTP transport — used only when neither API is configured
// (local development / self-hosting). Gmail-style SMTP often fails on Render,
// which is exactly why SendCoreX/Resend exist here.
const transporter = env.SMTP_HOST
  ? nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: 587,
      secure: false, // true for port 465, false for other ports
      auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
      // Mail content is application-generated; never allow a template or input
      // to make Nodemailer read a local file or fetch a URL while composing.
      disableFileAccess: true,
      disableUrlAccess: true,
    })
  : null;

const FROM = env.RESEND_FROM_EMAIL || '"ORBIT" <onboarding@resend.dev>';
const APP_URL = (env.CLIENT_URL || "").replace(/\/$/, "");

// Startup visibility: log which transport is active (or that mail is off) so
// a misconfigured deployment is obvious instead of failing silently per-send.
if (brevoConfigured) {
  logger.info("Mail transport: brevo (primary)", { from: BREVO_FROM });
} else if (sendcorexConfigured) {
  logger.info("Mail transport: sendcorex", { from: SENDCOREX_FROM });
} else if (resend) {
  logger.info("Mail transport: resend");
  if (env.NODE_ENV === "production" && !env.RESEND_FROM_EMAIL) {
    logger.warn(
      "RESEND_FROM_EMAIL is not set — emails will only reach the Resend account owner's inbox. Set a verified-domain sender before launch."
    );
  }
} else if (transporter) {
  logger.info("Mail transport: smtp (nodemailer)");
} else {
  logger.warn("Mail transport: NONE — set BREVO_API_KEY, SENDCOREX_API_KEY, RESEND_API_KEY or SMTP_HOST to enable emails.");
}

/**
 * Single send path — Brevo first, then SendCoreX, then Resend, then SMTP
 * fallback. Throws on failure so the caller can decide how to handle it
 * (most callers fire-and-forget).
 */
const send = async (payload: MailPayload) => {
  if (brevoConfigured) {
    await sendViaBrevo(payload);
    return;
  }
  if (sendcorexConfigured) {
    await sendViaSendcorex(payload);
    return;
  }
  if (resend) {
    const { error } = await resend.emails.send({
      from: FROM,
      to: [payload.to],
      subject: payload.subject,
      ...(payload.text ? { text: payload.text } : {}),
      html: payload.html,
    });
    if (error) throw new Error(error.message);
    return;
  }
  if (transporter) {
    await transporter.sendMail({ from: FROM, ...payload });
    return;
  }
  throw new Error("No mail transport configured (set BREVO_API_KEY, SENDCOREX_API_KEY, RESEND_API_KEY or SMTP_*)");
};

/**
 * Send a pre-built email payload. Used by the BullMQ email worker — the
 * payload was queued by `queueEmail` and carries the same shape as
 * MailPayload, so it reuses the identical transport chain.
 */
export const sendQueuedEmail = async (payload: MailPayload): Promise<void> => {
  await send(payload);
};

/**
 * Fire-and-forget email delivery: queue via BullMQ when configured
 * (retries + no request blocking), otherwise send directly. The caller
 * never awaits the actual SMTP/API round-trip.
 */
export const queueEmail = async (payload: MailPayload): Promise<void> => {
  try {
    const { enqueueEmail } = await import("./queue");
    const queued = await enqueueEmail(payload);
    if (queued) return;
    // No Redis / enqueue failed → direct send (non-blocking for callers
    // that already fire-and-forget; awaited callers keep their behavior).
    await send(payload);
  } catch (err: any) {
    logger.error("queueEmail failed", { to: payload.to, error: err.message });
  }
};

/* ──────────────────────────────────────────────────────────────────────
 * Email design system — two branded themes, both on ORBIT's black+gold
 * identity:
 *
 *   • "prelaunch" — the landing page look: near-black void, warm gold
 *     halo, elegant serif voice, script ORBIT wordmark, dashed gold seat
 *     badge. Used for waitlist + launch emails (the pre-launch story).
 *
 *   • "app" — the in-app look: the app's glassy dark panels, gold accents,
 *     cursive serif headings. Used for all post-launch transactional mail
 *     (welcome, OTP, password, deletion).
 *
 * Every template is table-based with inline styles for the widest email
 * client support (Outlook, Gmail, Apple Mail). User-provided strings are
 * HTML-escaped so a username can never inject markup.
 * ────────────────────────────────────────────────────────────────────── */

const esc = (s: string): string =>
  s.replace(/[&<>"']/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : "&#39;"
  );

const firstName = (name: string): string =>
  (name || "there").trim().split(/\s+/)[0] || "there";

type EmailDesign = {
  theme: "prelaunch" | "app";
  eyebrow: string;
  title: string;
  bodyHtml: string;
  badge?: { label: string; value: string; mono?: boolean };
  cta?: { label: string; url: string };
  footerNote?: string;
};

const T = {
  prelaunch: {
    bg: "#09090b",
    card: "#131316",
    border: "rgba(255,255,255,0.10)",
    text: "#fafafa",
    mist: "#a1a1aa",
    gold: "#d4af37",
    goldSoft: "rgba(212,175,55,0.10)",
    goldLine: "rgba(212,175,55,0.55)",
    hairline: "rgba(255,255,255,0.08)",
    // CTA button — gold-filled pill with black text (reads as a solid,
    // tappable button on the near-black card).
    ctaBg: "#d4af37",
    ctaText: "#09090b",
    ctaBorder: "#f0d890",
  },
  app: {
    bg: "#09090b",
    card: "#121216",
    border: "rgba(255,255,255,0.10)",
    text: "#fafafa",
    mist: "#a1a1aa",
    gold: "#d4af37",
    goldSoft: "rgba(212,175,55,0.10)",
    goldLine: "rgba(212,175,55,0.55)",
    hairline: "rgba(255,255,255,0.08)",
    // CTA button — white pill with a gold ring (button affordance even in
    // clients that flatten backgrounds).
    ctaBg: "#ffffff",
    ctaText: "#09090b",
    ctaBorder: "#d4af37",
  },
};

const renderEmail = (d: EmailDesign): string => {
  const t = T[d.theme];
  const serif = "'Cormorant Garamond', Georgia, 'Times New Roman', serif";
  const sans = "'Manrope', -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
  const script = "'Great Vibes', 'Brush Script MT', cursive";

  const halo =
    d.theme === "prelaunch"
      ? "background:radial-gradient(ellipse at 50% 0%,rgba(212,175,55,0.14) 0%,rgba(212,175,55,0.05) 45%,transparent 70%);"
      : "background:radial-gradient(ellipse at 50% 0%,rgba(255,255,255,0.07) 0%,transparent 62%);";

  const badge = d.badge
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:26px auto 6px;">
        <tr>
          <td align="center" style="border:1px dashed ${t.goldLine};background:${t.goldSoft};border-radius:18px;padding:18px 34px;">
            <div style="font-size:10px;letter-spacing:3px;text-transform:uppercase;color:${t.mist};margin-bottom:6px;">${esc(d.badge.label)}</div>
            <div style="font-size:${d.badge.mono ? "30px" : "42px"};line-height:1.05;font-weight:700;color:${t.gold};${d.badge.mono ? "font-family:ui-monospace,'SF Mono',Consolas,monospace;" : `font-family:${serif};`}">${esc(d.badge.value)}</div>
          </td>
        </tr>
      </table>`
    : "";

  const cta = d.cta
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:28px auto 6px;">
        <tr>
          <td align="center" style="border-radius:999px;background:${t.ctaBg};border:2px solid ${t.ctaBorder};mso-padding-alt:0;">
            <a href="${esc(d.cta.url)}" style="display:inline-block;padding:14px 46px;border-radius:999px;background:${t.ctaBg};color:${t.ctaText};font-family:${sans};font-size:14px;font-weight:800;letter-spacing:2px;text-transform:uppercase;text-decoration:none;">${esc(d.cta.label)}&nbsp;&rarr;</a>
          </td>
        </tr>
      </table>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="dark">
  <meta name="supported-color-schemes" content="dark">
  <title>${esc(d.eyebrow)} — ORBIT</title>
</head>
<body style="margin:0;padding:0;background:${t.bg};-webkit-text-size-adjust:100%;">
  <div style="${halo}padding:44px 16px 40px;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
      <tr>
        <td align="center">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:560px;background:${t.card};border:1px solid ${t.border};border-radius:22px;overflow:hidden;">
            <tr>
              <td style="padding:34px 34px 8px;text-align:center;">
                <div style="font-family:${script};font-size:${d.theme === "prelaunch" ? "46px" : "42px"};color:${t.gold};line-height:1;">Orbit</div>
                <div style="height:1px;background:linear-gradient(90deg,transparent,${t.gold} 30%,${t.gold} 70%,transparent);margin:18px auto 0;width:70%;"></div>
              </td>
            </tr>
            <tr>
              <td style="padding:26px 34px 34px;">
                <div style="font-family:${serif};font-size:11px;letter-spacing:4px;text-transform:uppercase;color:${t.mist};text-align:center;margin-bottom:14px;">${esc(d.eyebrow)}</div>
                <div style="font-family:${serif};font-size:27px;line-height:1.15;font-weight:600;color:${t.text};text-align:center;letter-spacing:-0.01em;">${d.title}</div>
                <div style="font-family:${sans};font-size:15px;line-height:1.75;color:#e4e4e7;margin-top:20px;text-align:left;">${d.bodyHtml}</div>
                ${badge}
                ${cta}
              </td>
            </tr>
            <tr>
              <td style="padding:0 34px 22px;">
                <div style="height:1px;background:${t.hairline};"></div>
                <div style="font-family:${sans};font-size:11.5px;line-height:1.6;color:${t.mist};text-align:center;padding-top:18px;">
                  ${d.footerNote ? `${esc(d.footerNote)}<br>` : ""}ORBIT — your inner circle, zero noise.&nbsp;✦
                </div>
              </td>
            </tr>
          </table>
          <div style="font-family:${sans};font-size:10.5px;color:#52525b;text-align:center;margin-top:20px;padding:0 24px;line-height:1.7;">
            You received this because you joined the ORBIT waitlist or hold an ORBIT account.<br>
            No spam, no ads — only the moments that matter.
          </div>
        </td>
      </tr>
    </table>
  </div>
</body>
</html>`;
};

const welcomeBody = (name: string) => `
  <p style="margin:0 0 16px;">Hi ${esc(name)},</p>
  <p style="margin:0 0 16px;">Welcome to <b style="color:#ffffff;">ORBIT</b> — your inner circle, zero noise. No ads in your feed, no drama in your DMs. Just the people you actually care about, one quiet orbit away.</p>
  <p style="margin:0;">Post a thought, drop a <i style="color:#e3c16f;">glance</i> that vanishes by midnight, or jump straight into a voice call with the people who matter. It all lives here.</p>
`;

/* ─── PRE-LAUNCH (landing page theme) ─────────────────────────── */

// waitlist confirmation email — sent the moment someone reserves their seat
export const sendWaitlistConfirmationMail = async (
  user: MailUser & { position?: number | null; removeUrl?: string | null }
) => {
  try {
    const seat = typeof user.position === "number" ? `#${user.position.toLocaleString()}` : "reserved";
    const name = firstName(user.username);
    const removeLine = user.removeUrl
      ? `<p style="margin:14px 0 0;font-size:12.5px;line-height:1.6;color:#a1a1aa;">Didn't sign up with this email, or changed your mind? <a href="${esc(user.removeUrl)}" style="color:${T.prelaunch.gold};text-decoration:underline;">Remove it from the list</a> — one click, no login.</p>`
      : "";
    const html = renderEmail({
      theme: "prelaunch",
      eyebrow: "Your seat is reserved",
      title: `You're in, ${esc(name)}.`,
      bodyHtml: `
        <p style="margin:0 0 16px;">Your seat on the ORBIT waitlist is saved — <b style="color:#ffffff;">${esc(user.email)}</b> will be your key.</p>
        <p style="margin:0 0 16px;">On launch day you'll sign in with this email and walk straight in — <i style="color:#e3c16f;">ahead of everyone else</i>, with your inner circle already waiting.</p>
        <p style="margin:0;">No spam, no ads. Just one email when the door opens. ✦</p>
        ${removeLine}
      `,
      badge: { label: "Your seat", value: seat },
      cta: { label: "See what's inside", url: APP_URL || "https://orbit.social" },
      footerNote: "The moment ORBIT goes live, you'll be first through the door.",
    });
    await send({
      to: user.email,
      subject: "You're on the ORBIT waitlist ✦",
      text: `Hi ${name},\n\nYou're in — seat ${seat} is reserved on the ORBIT waitlist.\n\nOn launch day you'll sign in with this email and walk straight in, ahead of everyone else, with your inner circle.\n\nNo spam, no ads. Just one email when the door opens.\n${user.removeUrl ? `\nDidn't sign up with this email, or changed your mind? Remove it here: ${user.removeUrl}` : ""}\n\n— the ORBIT team`,
      html,
    });
    logger.info("Waitlist confirmation email sent", { email: user.email });
    return true;
  } catch (err: any) {
    logger.error("Failed to send waitlist email:", { error: err.message });
    return false;
  }
};

// launch-day email — sent to every waitlist member when ORBIT goes live.
// Only called from scripts/send-launch-emails.ts (admin-triggered), never
// from a request handler, so delivery rate is fully controlled by the caller.
//
// `appUrl` is explicit (not just env.CLIENT_URL) because the admin usually
// runs this script from a local machine whose .env says localhost — emails
// must always link to the REAL live app, never a dev server.
export const sendLaunchMail = async (
  user: MailUser & { appUrl?: string; preview?: boolean },
) => {
  try {
    const name = firstName(user.username);
    const appUrl = (user.appUrl || APP_URL || "https://orbit-your-inner-circle.vercel.app").replace(/\/$/, "");
    const html = renderEmail({
      theme: "prelaunch",
      eyebrow: "Launch day",
      title: `The door is open, ${esc(name)}.`,
      bodyHtml: `
        <p style="margin:0 0 16px;">Hi ${esc(name)},</p>
        <p style="margin:0 0 16px;">Your reserved seat just became a <b style="color:${T.prelaunch.gold};">key</b> — ORBIT is live, and everyone can now sign up.</p>
        <p style="margin:0 0 16px;">But you were here first. Sign in with <b style="color:#ffffff;">${esc(user.email)}</b> — the email you joined the waitlist with — and your <b style="color:${T.prelaunch.gold};">Day One rewards</b> unlock automatically:</p>
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:20px 0 4px;border:1px solid ${T.prelaunch.goldLine};border-radius:16px;background:${T.prelaunch.goldSoft};">
          <tr>
            <td style="padding:16px 18px;">
              <div style="font-size:10.5px;letter-spacing:2.5px;text-transform:uppercase;color:${T.prelaunch.mist};margin-bottom:12px;">Your Day One rewards</div>
              <div style="font-family:'Manrope',-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:13.5px;line-height:1.7;color:#e4e4e7;">
                <div style="padding:5px 0;"><span style="color:${T.prelaunch.gold};">✦</span> &nbsp;<b style="color:#ffffff;">Aurum theme</b> — the warm black &amp; gold from the ORBIT landing page</div>
                <div style="padding:5px 0;"><span style="color:${T.prelaunch.gold};">✦</span> &nbsp;<b style="color:#ffffff;">Day One flair</b> — a sparkle beside your name, everywhere</div>
                <div style="padding:5px 0;"><span style="color:${T.prelaunch.gold};">✦</span> &nbsp;<b style="color:#ffffff;">First Orbit ring</b> — a golden halo around your avatar</div>
              </div>
            </td>
          </tr>
        </table>
        <p style="margin:16px 0 0;">Make sure you log in with <b style="color:#ffffff;">${esc(user.email)}</b> and not a different address — the rewards are tied to this one. No noise, no ads. Just your circle. ✦</p>
      `,
      badge: { label: "Your status", value: "Day One ✦" },
      cta: { label: "Log in to ORBIT", url: appUrl },
      footerNote: "You were here first — wear it well.",
    });
    if (user.preview) {
      // Tooling aid — print the composed email without sending it.
      // eslint-disable-next-line no-console
      console.log(
        JSON.stringify({ to: user.email, subject: "The door is open — ORBIT is live ✦", text: `[plain-text omitted]`, html }),
      );
      return true;
    }
    await queueEmail({
      to: user.email,
      subject: "The door is open — ORBIT is live ✦",
      text: `Hi ${name},\n\nLaunch day is here. Your reserved seat just became a key — ORBIT is live, and everyone can now sign up.\n\nBut you were here first. Log in with ${user.email} (the email you joined the waitlist with) and your Day One rewards unlock automatically:\n\n  ✦ Aurum theme — the warm black & gold from the ORBIT landing page\n  ✦ Day One flair — a sparkle beside your name, everywhere\n  ✦ First Orbit ring — a golden halo around your avatar\n\nLog in here: ${appUrl}\n\nUse ${user.email} — the rewards are tied to that address. No noise, no ads. Just your circle.\n\n— the ORBIT team`,
      html,
    });
    logger.info("Launch email sent", { email: user.email });
    return true;
  } catch (err: any) {
    logger.error("Failed to send launch email:", { error: err.message });
    return false;
  }
};

/* ─── POST-LAUNCH (app theme) ─────────────────────────────────── */

// signup email
export const sendWelcomeMail = async (user: MailUser) => {
  try {
    const name = firstName(user.username);
    const html = renderEmail({
      theme: "app",
      eyebrow: "Welcome",
      title: "Welcome to your inner circle.",
      bodyHtml: welcomeBody(name),
      cta: { label: "Start exploring", url: APP_URL || "https://orbit.social" },
      footerNote: "Glad you're here, " + name + ".",
    });
    await queueEmail({
      to: user.email,
      subject: "Welcome to ORBIT ✦",
      text: `Hi ${name}! Welcome to ORBIT — your inner circle, zero noise.\n\nPost a thought, drop a glance that vanishes by midnight, or jump into a voice call with the people who matter.\n\n→ ${APP_URL || "https://orbit.social"}`,
      html,
    });
    logger.info("Welcome email sent!");
  } catch (err: any) {
    logger.error("Failed to send email:", { error: err.message });
  }
};

// new-device login alert email — sent when a login comes from a deviceId
// the account has never seen before (security alert, like Instagram/Google)
export const sendNewDeviceLoginMail = async (
  user: MailUser & { deviceLabel?: string; ip?: string },
) => {
  try {
    const name = firstName(user.username);
    const device = user.deviceLabel || "a new device";
    const location = user.ip ? ` from ${user.ip}` : "";
    const html = renderEmail({
      theme: "app",
      eyebrow: "Security",
      title: "New sign-in on your account.",
      bodyHtml: `
        <p style="margin:0 0 16px;">Hi ${esc(name)},</p>
        <p style="margin:0 0 16px;">We noticed a sign-in to your ORBIT account (<b style="color:#ffffff;">${esc(user.email)}</b>) from <b style="color:${T.app.gold};">${esc(device)}</b>${location}.</p>
        <p style="margin:0 0 16px;">Was this you? Great — nothing else to do. If it <b>wasn't</b> you, someone else may have your password.</p>
        <p style="margin:0;"><a href="${esc(APP_URL || "https://orbit.social")}" style="color:${T.app.gold};text-decoration:underline;">Reset your password</a> right away, and contact support if you can't get in.</p>
      `,
      cta: { label: "Secure my account", url: APP_URL || "https://orbit.social" },
      footerNote: "Security alert for " + user.email + ".",
    });
    await queueEmail({
      to: user.email,
      subject: "New sign-in to your ORBIT account",
      text: `Hi ${name},\n\nWe noticed a sign-in to your ORBIT account (${user.email}) from ${device}${location}.\n\nIf this was you, nothing else to do. If it wasn't, reset your password immediately at ${APP_URL || "https://orbit.social"}.`,
      html,
    });
    logger.info("New-device login email sent!", { email: user.email });
  } catch (err: any) {
    logger.error("Failed to send new-device login email:", { error: err.message });
  }
};

// password update email
export const sendPasswordUpdateMail = async (user: MailUser) => {
  try {
    const name = firstName(user.username);
    const html = renderEmail({
      theme: "app",
      eyebrow: "Security",
      title: "Your password was changed.",
      bodyHtml: `
        <p style="margin:0 0 16px;">Hi ${esc(name)},</p>
        <p style="margin:0 0 16px;">The password for your ORBIT account (<b style="color:#ffffff;">${esc(user.email)}</b>) was updated successfully.</p>
        <p style="margin:0 0 16px;">Didn't do this? <a href="${esc(APP_URL || "https://orbit.social")}" style="color:${T.app.gold};text-decoration:underline;">Reset your password</a> right away and contact support.</p>
        <p style="margin:0;">Otherwise, nothing else changed — you're all set. ✦</p>
      `,
      cta: { label: "Account settings", url: APP_URL || "https://orbit.social" },
      footerNote: "Security notice for " + user.email + ".",
    });
    await queueEmail({
      to: user.email,
      subject: "Password Successfully Updated!",
      text: `Hi ${name}! Your ORBIT account password was updated successfully.\n\nIf this wasn't you, reset your password immediately at ${APP_URL || "https://orbit.social"}.`,
      html,
    });
    logger.info("Password update email sent!");
  } catch (err: any) {
    logger.error("Failed to send email:", { error: err.message });
  }
};

// otp email
export const sendOtpMail = async (user: MailUser, otp: string) => {
  try {
    const name = firstName(user.username);
    const html = renderEmail({
      theme: "app",
      eyebrow: "Verification",
      title: "Your one-time code.",
      bodyHtml: `
        <p style="margin:0 0 6px;">Hi ${esc(name)},</p>
        <p style="margin:0 0 16px;">Use this code to finish what you started:</p>
      `,
      badge: { label: "Verification code", value: otp, mono: true },
      footerNote: "This code expires in 15 minutes. Never share it with anyone.",
    });
    const text = `Hi ${name}!\n\nYour ORBIT verification code is: ${otp}\n\nThis code expires in 15 minutes. Don't reveal it to anyone.`;    await queueEmail({
      to: user.email,
      subject: "Your ORBIT verification code", text, html });
    logger.info("OTP email sent!");
  } catch (err: any) {
    logger.error("Failed to send OTP email:", { error: err.message });
  }
};

// forgot password email
export const sendForgotPasswordMail = async (user: MailUser) => {
  try {
    const name = firstName(user.username);
    const html = renderEmail({
      theme: "app",
      eyebrow: "Security",
      title: "New password set.",
      bodyHtml: `
        <p style="margin:0 0 16px;">Hi ${esc(name)},</p>
        <p style="margin:0 0 16px;">You've successfully created a new password for your ORBIT account.</p>
        <p style="margin:0 0 16px;">If this wasn't you, <a href="${esc(APP_URL || "https://orbit.social")}" style="color:${T.app.gold};text-decoration:underline;">secure your account</a> now.</p>
        <p style="margin:0;">Back to your circle. ✦</p>
      `,
      cta: { label: "Sign in to ORBIT", url: APP_URL || "https://orbit.social" },
      footerNote: "Password change confirmation for " + user.email + ".",
    });
    await queueEmail({
      to: user.email,
      subject: "New password set successfully",
      text: `Hi ${name}! You've successfully created your new ORBIT password.\n\nIf this wasn't you, secure your account at ${APP_URL || "https://orbit.social"} immediately.`,
      html,
    });
    logger.info("Forgot password email sent!");
  } catch (err: any) {
    logger.error("Failed to send forgot password email:", { error: err.message });
  }
};

// account deletion email
export const sendDeletionMail = async (user: MailUser) => {
  try {
    const name = firstName(user.username);
    const html = renderEmail({
      theme: "app",
      eyebrow: "Farewell",
      title: "Sorry to see you go.",
      bodyHtml: `
        <p style="margin:0 0 16px;">Hi ${esc(name)},</p>
        <p style="margin:0 0 16px;">Your ORBIT account was deleted successfully, along with your data.</p>
        <p style="margin:0 0 16px;">Whenever you miss your circle, you're always welcome back — a fresh account takes seconds.</p>
        <p style="margin:0;">Until then, take care. ✦</p>
      `,
      cta: { label: "Come back anytime", url: APP_URL || "https://orbit.social" },
      footerNote: "This confirms the deletion of " + user.email + ".",
    });
    await queueEmail({
      to: user.email,
      subject: "ORBIT account deleted",
      text: `Hi ${name}! Sorry to see you go — your ORBIT account was deleted successfully. You're always welcome back.`,
      html,
    });
    logger.info("Account deletion email sent!");
  } catch (err: any) {
    logger.error("Failed to send account deletion email:", { error: err.message });
  }
};

// EmailService class wraps Resend, Brevo, SendCoreX, and SMTP transports

// strip newlines and null bytes from all email header fields
