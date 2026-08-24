import express from "express";
import {
  createReport,
  getReports,
  reviewReport,
} from "../controllers/report.controllers";
import { protect } from "../middlewares/auth.middleware";
import { generalLimiter } from "../middlewares/ratelimit.middleware";

const router = express.Router();
router.use(protect);

router.post("/", generalLimiter, createReport);
router.get("/", generalLimiter, getReports);
router.put("/:reportId/review", generalLimiter, reviewReport);

export { router as reportRoutes };
