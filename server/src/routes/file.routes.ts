import { Router } from "express";
import { protect } from "../middlewares/auth.middleware";
import { generalLimiter } from "../middlewares/ratelimit.middleware";
import { downloadFile } from "../controllers/fileDownload.controller";

const router = Router();

// Proxy file/document downloads through Cloudinary's authenticated admin API
// (the standard delivery CDN 401s non-image originals on this account).
router.use(protect, generalLimiter);
router.get("/download", downloadFile);

export default router;
