import { Router } from "express";
import { protect } from "../middlewares/auth.middleware";
import { generalLimiter } from "../middlewares/ratelimit.middleware";
import { exportPosts, exportProfile, exportMessages } from "../controllers/dataExport.controller";

const router = Router();
router.use(protect, generalLimiter);
router.get("/posts", exportPosts);
router.get("/profile", exportProfile);
router.get("/messages", exportMessages);

export default router;
