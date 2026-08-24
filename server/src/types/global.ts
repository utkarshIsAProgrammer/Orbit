/**
 * Runtime utility functions used across controllers.
 * These were previously in global.d.ts which is type-only — Jest couldn't resolve them.
 */

/**
 * Typed catch clause helper — safely access error properties.
 */
export function asError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err));
}

/**
 * Extract a safe error message from an unknown error.
 */
export function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return "Unknown error";
}

/**
 * Safe error logger.
 */
export function logError(logger: any, message: string, err: unknown, extra?: Record<string, unknown>): void {
  const error = asError(err);
  logger.error(message, { error: error.message, stack: error.stack, ...extra });
}

/**
 * Multer file utilities.
 */
export interface MulterFile {
  fieldname: string;
  originalname: string;
  encoding: string;
  mimetype: string;
  path: string;
  size: number;
  filename: string;
}

export interface MulterFiles {
  [fieldname: string]: MulterFile[];
}

/**
 * Extract files from `req.files` with proper typing.
 */
export function getMulterFiles(files: unknown): MulterFiles {
  return (files as MulterFiles) || {};
}
