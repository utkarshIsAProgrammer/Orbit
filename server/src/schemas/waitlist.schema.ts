/**
 * @file waitlist.schema.ts
 * @description Zod validation for the public waitlist signup form.
 */

import { z } from "zod";

/** Schema for joining the waitlist (public endpoint — no auth required). */
export const joinWaitlistSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email("That doesn't look like a valid email.")
    .max(200, "Email must be less than 200 characters."),
  name: z
    .string()
    .trim()
    .max(80, "Name must be less than 80 characters.")
    .optional(),
  source: z
    .string()
    .trim()
    .max(120, "Source must be less than 120 characters.")
    .optional(),
  // ── Anti-spam fields (sent by the landing page form) ──────────────
  // Honeypot — hidden field bots fill. Humans leave it empty.
  website: z
    .string()
    .trim()
    .max(120, "Website must be less than 120 characters.")
    .optional(),
  // Epoch ms when the form was rendered; used for the minimum-form-time
  // check (only enforced in production).
  formStart: z.coerce.number().optional(),
  // Cloudflare Turnstile widget token (required only when the server has
  // TURNSTILE_SECRET_KEY configured).
  turnstileToken: z
    .string()
    .trim()
    .max(2048, "Turnstile token too long.")
    .optional(),
});

export type JoinWaitlistInput = z.infer<typeof joinWaitlistSchema>;
