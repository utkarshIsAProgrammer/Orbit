import { Router } from "express";
import { protect } from "../middlewares/auth.middleware";
import { generalLimiter } from "../middlewares/ratelimit.middleware";
import {
  blockUser,
  unblockUser,
  getBlockedUsers,
  checkBlocked,
  muteUser,
  unmuteUser,
} from "../controllers/block.controllers";

const router = Router();

router.use(protect);
router.use(generalLimiter);

router.post("/:userId", blockUser);
router.delete("/:userId", unblockUser);
router.get("/", getBlockedUsers);
router.get("/:userId/check", checkBlocked);
router.post("/:userId/mute", muteUser);
router.delete("/:userId/mute", unmuteUser);

export default router;
