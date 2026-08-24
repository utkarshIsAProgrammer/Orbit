import express from "express";
import {
  updatePassword,
  requestOtpForForgotPassword,
  verifyOtpAndForgotPassword,
} from "../controllers/password.controllers";
import { protect } from "../middlewares/auth.middleware";
import { otpLimiter, authLimiter } from "../middlewares/ratelimit.middleware";

const router = express.Router();

router.post("/request-otp", otpLimiter, requestOtpForForgotPassword);
router.post("/forgot", otpLimiter, requestOtpForForgotPassword); // Client alias

router.post(
  "/verify-and-forgot-password",
  authLimiter,
  verifyOtpAndForgotPassword,
);
router.post("/reset", authLimiter, verifyOtpAndForgotPassword); // Client alias

router.post("/update-password", protect, authLimiter, updatePassword);

export { router as passwordRoutes };
