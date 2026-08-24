import type { CookieOptions } from "express";
import { env } from "./env";

export const cookieOptions: CookieOptions = {
	httpOnly: true,
	secure: env.NODE_ENV === "production",
	sameSite: env.NODE_ENV === "production" ? "none" : "lax",
};
