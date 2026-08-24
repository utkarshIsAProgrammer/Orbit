import express from "express";
import {
  signup,
  login,
  logout,
  getCurrentUser,
} from "../controllers/auth.controllers";
import { protect } from "../middlewares/auth.middleware";
import { authLimiter } from "../middlewares/ratelimit.middleware";
import upload from "../middlewares/upload.middleware";

const router = express.Router();

/**
 * @openapi
 * /api/auth/signup:
 *   post:
 *     tags: [Auth]
 *     summary: Register a new user account
 *     description: Creates a new user with username, email, password, and optional profile/banner images.
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [username, fullName, email, password, confirmPassword]
 *             properties:
 *               username: { type: string, example: alice }
 *               fullName: { type: string, example: "Alice Smith" }
 *               email: { type: string, format: email, example: alice@example.com }
 *               password: { type: string, format: password, example: "securePass123" }
 *               confirmPassword: { type: string, example: "securePass123" }
 *               bio: { type: string, example: "Full-stack developer & designer" }
 *               profilePic: { type: string, format: binary }
 *               bannerImage: { type: string, format: binary }
 *     responses:
 *       201:
 *         description: Account created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 user: { $ref: '#/components/schemas/User' }
 *                 token: { type: string }
 *       400:
 *         description: Validation error (missing fields, existing username/email)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post(
  "/signup",
  authLimiter,
  upload.fields([
    { name: "profilePic", maxCount: 1 },
    { name: "bannerImage", maxCount: 1 },
  ]),
  signup,
);

/**
 * @openapi
 * /api/auth/login:
 *   post:
 *     tags: [Auth]
 *     summary: Sign in with username/email and password
 *     description: Authenticates a user and returns a JWT token in an httpOnly cookie.
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [usernameOrEmail, password]
 *             properties:
 *               usernameOrEmail: { type: string, example: alice }
 *               password: { type: string, format: password, example: "securePass123" }
 *     responses:
 *       200:
 *         description: Login successful, JWT set in httpOnly cookie
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 user: { $ref: '#/components/schemas/User' }
 *                 token: { type: string }
 *       401:
 *         description: Invalid credentials
 */
router.post("/login", authLimiter, login);

/**
 * @openapi
 * /api/auth/logout:
 *   post:
 *     tags: [Auth]
 *     summary: Sign out current user
 *     description: Clears the JWT cookie and invalidates the session.
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Logged out successfully
 */	// Logout is idempotent and must always succeed — even when the session is
	// already expired, cookies were cleared (e.g. after account deletion), or the
	// user no longer exists. It only clears cookies, so it doesn't need `protect`.
	router.post("/logout", logout);

/**
 * @openapi
 * /api/auth/me:
 *   get:
 *     tags: [Auth]
 *     summary: Get currently authenticated user
 *     description: Returns the authenticated user's profile. Used for session validation.
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Current user data
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 user: { $ref: '#/components/schemas/User' }
 *       401:
 *         description: Not authenticated
 */
router.get("/me", protect, getCurrentUser);

export { router as authRoutes };
