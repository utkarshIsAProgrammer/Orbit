import express from "express";
import { getFeed } from "../controllers/feed.controllers";
import { protect } from "../middlewares/auth.middleware";
import { generalLimiter } from "../middlewares/ratelimit.middleware";

const router = express.Router();
router.use(protect);

router.get("/", generalLimiter, getFeed);

export { router as feedRoutes };
