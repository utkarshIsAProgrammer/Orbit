import { Router } from "express";
import { protect } from "../middlewares/auth.middleware";
import { generalLimiter } from "../middlewares/ratelimit.middleware";
import { translate, detect } from "../controllers/translation.controllers";

const router = Router();
router.use(protect, generalLimiter);
router.post("/", translate);
router.post("/detect", detect);
export default router;
