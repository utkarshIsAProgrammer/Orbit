import { Router } from "express";
import { protect } from "../middlewares/auth.middleware";
import { generalLimiter } from "../middlewares/ratelimit.middleware";
import { getMissions, claimMission } from "../controllers/dailyMission.controllers";

const router = Router();
router.use(protect, generalLimiter);
router.get("/today", getMissions);
router.post("/claim", claimMission);
export default router;
