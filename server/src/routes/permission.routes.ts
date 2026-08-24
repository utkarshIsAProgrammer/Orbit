import { Router } from "express";
import { protect } from "../middlewares/auth.middleware";
import { generalLimiter } from "../middlewares/ratelimit.middleware";
import { getPermissions, updatePermissions } from "../controllers/permission.controllers";

const router = Router();
router.use(protect, generalLimiter);

router.get("/", getPermissions);
router.put("/", updatePermissions);

export default router;
