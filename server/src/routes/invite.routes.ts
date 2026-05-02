import express from "express";
import {
  generateInviteCode,
  getMyInvites,
  redeemInviteCode,
  getInviteStats,
} from "../controllers/invite.controllers";
import { protect } from "../middlewares/auth.middleware";
import { generalLimiter } from "../middlewares/ratelimit.middleware";

const router = express.Router();
router.use(protect);

router.get("/code", generalLimiter, generateInviteCode);
router.get("/", generalLimiter, getMyInvites);
router.get("/stats", generalLimiter, getInviteStats);
router.post("/redeem/:code", generalLimiter, redeemInviteCode);

export { router as inviteRoutes };

// invite links include exp claim; reject if expired

// regex check: /^[A-Z0-9]{8}$/ before querying database

// use crypto.timingSafeEqual for code comparison instead of ===
