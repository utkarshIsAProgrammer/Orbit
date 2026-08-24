import { Router } from "express";
import { protect } from "../middlewares/auth.middleware";
import { generalLimiter } from "../middlewares/ratelimit.middleware";
import { getLinkPreview } from "../controllers/linkPreview.controllers";

const router = Router();
router.use(protect, generalLimiter);
router.get("/", getLinkPreview);
export default router;
