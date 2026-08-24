import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .optional()
    .default("development"),
  PORT: z.coerce.number().int().positive().optional().default(5002),

  // How many proxy hops (or which proxy IPs) to trust when deriving the
  // client IP from X-Forwarded-For. Secure default: only trust a loopback
  // proxy — remote clients cannot spoof the header on directly-exposed
  // hosts. Hosts behind a platform proxy (Render/Heroku/Cloudflare) should
  // set TRUST_PROXY=1 (their edge rewrites XFF with the real client IP).
  TRUST_PROXY: z.string().optional().default(""),
  MONGO_URI: z.string().min(1, "MONGO_URI is required"),
  JWT_SECRET: z.string().min(1, "JWT_SECRET is required"),
  UPSTASH_REDIS_REST_URL: z.string().optional().default(""),
  UPSTASH_REDIS_REST_TOKEN: z.string().optional().default(""),
  UPSTASH_REDIS_URL: z
    .string()
    .optional(),
  CLOUDINARY_NAME: z.string().min(1, "CLOUDINARY_NAME is required"),
  CLOUDINARY_API_KEY: z.string().min(1, "CLOUDINARY_API_KEY is required"),
  CLOUDINARY_API_SECRET: z.string().min(1, "CLOUDINARY_API_SECRET is required"),
  // Legacy SMTP (nodemailer) — kept for local dev / self-hosting.
  SMTP_HOST: z.string().optional().default(""),
  SMTP_USER: z.string().optional().default(""),
  SMTP_PASS: z.string().optional().default(""),
  // Resend (REST email API — reliable on Render/Serverless, no SMTP needed).
  // When RESEND_API_KEY is set, all mail goes through Resend; otherwise it
  // falls back to nodemailer/SMTP for local development.
  RESEND_API_KEY: z.string().optional().default(""),
  // From-address for Resend (must be a verified domain or onboarding@resend.dev)
  RESEND_FROM_EMAIL: z.string().optional().default("ORBIT <onboarding@resend.dev>"),
  // SendCoreX (REST email API with shared sending domains — no DNS setup).
  // Takes priority over Resend when set. from + senderName + replyTo come
  // from the shared-domain sender provisioned in the SendCoreX dashboard
  // (e.g. orbit@corexsend.com) so the user never has to verify a domain.
  SENDCOREX_API_KEY: z.string().optional().default(""),
  SENDCOREX_FROM_EMAIL: z.string().optional().default("orbit@corexsend.com"),
  SENDCOREX_SENDER_NAME: z.string().optional().default("ORBIT"),
  SENDCOREX_REPLY_TO: z.string().optional().default(""),
  // Brevo (transactional email API — free tier: 300 emails/day). When
  // BREVO_API_KEY is set it becomes the PRIMARY transport for every email
  // the app sends (welcome, OTP, password reset, deletion, waitlist). The
  // branded HTML templates pass straight through via htmlContent, so no
  // template rewrite is needed.
  BREVO_API_KEY: z.string().optional().default(""),
  BREVO_FROM_EMAIL: z.string().optional().default("no-reply@orbit.app"),
  BREVO_SENDER_NAME: z.string().optional().default("ORBIT"),
  CLIENT_URL: z.url("CLIENT_URL must be a valid URL"),

  // Google Gemini free-tier API key (Google AI Studio, no card needed). When
  // set, the bot farm's conversations/replies become genuinely contextual;
  // without it, bots fall back to their template brain and still work.
  GEMINI_API_KEY: z.string().optional().default(""),

  // Origin of the standalone marketing landing page (e.g. https://orbit.love).
  // When set, the server allows CORS + CSRF-trusted origins from it so the
  // public waitlist form can POST directly. Falls back to allowing it only
  // when explicitly configured.
  LANDING_PAGE_URL: z.string().optional().default(""),

  // Public URL of this API (e.g. https://orbit-backend.onrender.com). When set,
  // the server pings its own /api/ping every 5 minutes to keep free-tier
  // hosts (Render free) from sleeping during idle periods.
  PUBLIC_API_URL: z.string().optional().default(""),

  // ── Waitlist anti-spam ────────────────────────────────────────────
  // Cloudflare Turnstile secret key. When set, POST /api/waitlist/join
  // REQUIRES a valid turnstile token from the landing page widget
  // (fail-closed). Leave empty to skip Turnstile — the honeypot + timer +
  // disposable-domain + MX checks still apply.
  TURNSTILE_SECRET_KEY: z.string().optional().default(""),
  // Set "true" to skip the real-MX-record DNS check on submitted email
  // domains (used in tests / offline dev). Production keeps it ON unless
  // explicitly disabled.
  WAITLIST_SKIP_DNS: z
    .enum(["true", "false"])
    .optional()
    .default("false"),
  // Extra disposable email domains to block, comma-separated, appended to
  // the built-in blocklist (e.g. "10minutemail.com,mailinator.com").
  WAITLIST_EXTRA_BLOCKED_DOMAINS: z.string().optional().default(""),

  // Web Push VAPID keys for push notifications (optional — push works without them)
  VAPID_PUBLIC_KEY: z.string().optional().default(""),
  VAPID_PRIVATE_KEY: z.string().optional().default(""),
  VAPID_SUBJECT: z.string().optional().default("mailto:orbit@example.com"),

  // ImageKit Configuration
  IMAGEKIT_PUBLIC_KEY: z.string().optional().default(""),
  IMAGEKIT_PRIVATE_KEY: z.string().optional().default(""),
  IMAGEKIT_URL_ENDPOINT: z.string().optional().default("https://ik.imagekit.io/orbitinnercircle/"),

  // Sentry Monitoring
  SENTRY_DSN: z.string().optional().default(""),

  // Google OAuth
  GOOGLE_CLIENT_ID: z.string().optional().default(""),
  GOOGLE_CLIENT_SECRET: z.string().optional().default(""),
  GOOGLE_CALLBACK_URL: z.string().optional().default(""),

  // BullMQ Background Jobs
  // Set to "true" to enable BullMQ workers (requires TCP REDIS_URL).
  // When "false" or unset, node-cron handles scheduled tasks instead —
  // saves ~50K+ Redis commands/day from BullMQ's idle polling.
  ENABLE_BULLMQ: z.enum(["true", "false"]).optional().default("false"),
  REDIS_URL: z.string().optional().default(""),

  // Meilisearch Full-Text Search
  MEILISEARCH_URL: z.string().optional().default(""),
  MEILISEARCH_API_KEY: z.string().optional().default(""),

  // LiveKit Group Video Calls
  LIVEKIT_URL: z.string().optional().default(""),
  LIVEKIT_API_KEY: z.string().optional().default(""),
  LIVEKIT_API_SECRET: z.string().optional().default(""),

  // Logtail Cloud Log Management
  LOGTAIL_SOURCE_TOKEN: z.string().optional().default(""),
});

export type Env = z.infer<typeof envSchema>;

export const validateEnv = (): Env => {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const formatted = result.error.flatten().fieldErrors;
    console.error("Invalid or missing environment variables:");
    for (const [key, messages] of Object.entries(formatted)) {
      console.error(`  ${key}: ${(messages ?? []).join(", ")}`);
    }
    process.exit(1);
  }

  return result.data;
};

export const env = validateEnv();
