import express from "express";
import {
  googleAuth,
  googleAuthCallback,
  oauthExchange,
} from "../controllers/oauth.controllers";

const router = express.Router();

// Initiate Google OAuth login
router.get("/google", googleAuth);

// Google OAuth callback
router.get("/google/callback", googleAuthCallback);

// One-time code exchange (POST — sets the session via a normal XHR response,
// the same channel as /api/auth/login, so it survives mobile cookie
// restrictions that drop the callback's redirect-set cookies)
router.post("/oauth-exchange", oauthExchange);

export { router as oauthRoutes };
