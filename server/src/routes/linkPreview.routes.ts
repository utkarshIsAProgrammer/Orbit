import { Router } from "express";
import { protect } from "../middlewares/auth.middleware";
import { generalLimiter } from "../middlewares/ratelimit.middleware";
import { getLinkPreview } from "../controllers/linkPreview.controllers";

const router = Router();
router.use(protect, generalLimiter);
router.get("/", getLinkPreview);
export default router;

// block private IPs (10.x, 172.16-31.x, 192.168.x, 127.x, ::1) before fetch
