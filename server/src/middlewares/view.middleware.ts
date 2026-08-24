import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { User } from "../models/user.model";
import { env } from "../configs/env";

export const protectViews = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const token = req.cookies?.jwt;

    // no login → continue
    if (!token) {
      return next();
    }

    // verify token — same issuer/audience as the main protect middleware so
    // a token minted for another context (or with a shared/rotated secret)
    // can never be reused for view tracking.
    const decoded = jwt.verify(token, env.JWT_SECRET, {
      algorithms: ["HS256"],
      issuer: "orbit",
      audience: "orbit-users",
    }) as {
      userId: string;
    };

    // attach user
    const user = await User.findById(decoded.userId).select("-password");

    if (user) {
      req.user = user as any;
    }

    next();
  } catch {
    next();
  }
};
