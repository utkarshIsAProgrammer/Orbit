import express from "express";
import { getFeed } from "../controllers/feed.controllers";
import { protect } from "../middlewares/auth.middleware";
import { generalLimiter } from "../middlewares/ratelimit.middleware";

const router = express.Router();
router.use(protect);

router.get("/", generalLimiter, getFeed);

export { router as feedRoutes };

// single aggregation with  instead of N+1 queries

// filter out posts where author.isActive == false in feed query
