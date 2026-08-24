import express from "express";
import {
  joinWaitlist,
  getWaitlistCount,
  listWaitlist,
  removeFromWaitlist,
} from "../controllers/waitlist.controller";
import { protect } from "../middlewares/auth.middleware";
import { waitlistLimiter } from "../middlewares/ratelimit.middleware";

const router = express.Router();

// Public — used by the landing page waitlist form.
// /join is strictly limited (spam); /count rides the app-wide generalLimiter
// since every visitor hits it once on page load.
router.post("/join", waitlistLimiter, joinWaitlist);
router.get("/count", getWaitlistCount);

// One-click opt-out — the token is unguessable (48 hex chars from the
// confirmation email), so no limiter is needed; it can only remove one seat.
router.get("/remove/:token", removeFromWaitlist);

// Admin only — review everyone on the list
router.get("/", protect, waitlistLimiter, listWaitlist);

export { router as waitlistRoutes };
