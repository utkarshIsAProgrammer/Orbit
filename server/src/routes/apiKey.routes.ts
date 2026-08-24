import { Router } from "express";
import { protect } from "../middlewares/auth.middleware";
import { generalLimiter, interactionLimiter } from "../middlewares/ratelimit.middleware";
import { generateApiKey, getApiKeys, revokeApiKey } from "../controllers/apiKey.controller";

const router = Router();
router.use(protect, generalLimiter);
router.post("/keys", interactionLimiter, generateApiKey);
router.get("/keys", getApiKeys);
router.delete("/keys/:keyId", revokeApiKey);

export default router;
