import { Router } from "express";
import { protect } from "../middlewares/auth.middleware";
import { generalLimiter } from "../middlewares/ratelimit.middleware";
import { getMyXP, getUserXP, getAchievements } from "../controllers/xp.controllers";

const router = Router();
router.use(protect, generalLimiter);
router.get("/", getMyXP);
// MUST be registered before "/:userId" so "/achievements" isn't swallowed
// by the userId param route.
router.get("/achievements", getAchievements);
router.get("/:userId", getUserXP);
export default router;
