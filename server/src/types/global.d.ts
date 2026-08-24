import { Request } from "express";
import { UserDocument } from "../models/user.model";

/**
 * Augment Express Request to include `user` and `requestId`.
 */
declare global {
  namespace Express {
    interface Request {
      user?: any;
      requestId?: string;
    }
  }
}

/** Reusable type for Express route handler. */
export type TypedRequest<P = Record<string, string>> = Request<P>;

/** Standard API JSON response shape. */
export interface ApiResponse<T = unknown> {
  success: boolean;
  message?: string;
  data?: T;
  [key: string]: unknown;
}

/** Pagination query params. */
export interface PaginationQuery {
  cursor?: string;
  limit?: string;
  page?: string;
}

/** Generic cache wrapper. */
export interface CacheWrapper<T> {
  data: T;
  cachedAt: number;
}
