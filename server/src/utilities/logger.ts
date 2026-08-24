/**
 * Orbit Server — Production Logger
 *
 * In production, logs to both stdout (JSON) and rotating files.
 * In development/test, logs to stdout only with colorized output.
 *
 * File rotation config is controlled via env vars:
 *   LOG_DIR     — Directory for log files (default: ./logs)
 *   LOG_LEVEL   — Minimum log level (default: info)
 *   LOG_MAX_FILES — Max days to retain log files (default: 30)
 */

import winston from "winston";
import DailyRotateFile from "winston-daily-rotate-file";
import path from "path";
import fs from "fs";

const env = process.env.NODE_ENV || "development";
const logDir = process.env.LOG_DIR || path.join(process.cwd(), "logs");
const logLevel = process.env.LOG_LEVEL || (env === "production" ? "info" : "debug");
const maxFiles = process.env.LOG_MAX_FILES || "30";

// Ensure log directory exists (no-op in serverless environments)
if (env === "production" && logDir) {
  try {
    fs.mkdirSync(logDir, { recursive: true });
  } catch {
    // Log directory creation failed — fall back to console-only
  }
}

// ─── Logtail / Better Stack (Cloud Log Management) ────────────────
// Sends JSON logs to Better Stack's HTTPS endpoint for production debugging.
// Only active when LOGTAIL_SOURCE_TOKEN is set in the environment.
const LOGTAIL_TOKEN = process.env.LOGTAIL_SOURCE_TOKEN || "";

// ─── Transports ────────────────────────────────────────────────────

const transports: winston.transport[] = [
  // Logtail cloud transport — logs sent via HTTPS to Better Stack's ingest endpoint
  ...(env === "production" && LOGTAIL_TOKEN
    ? [new winston.transports.Http({
        host: "in.logtail.com",
        path: `/${LOGTAIL_TOKEN}`,
        ssl: true,
        format: winston.format.json(),
      })]
    : []),

  // Console transport — always active for container/PM2 logging
  new winston.transports.Console({
    level: logLevel,
    format:
      env === "production" || env === "test"
        ? winston.format.combine(
            winston.format.timestamp(),
            winston.format.errors({ stack: true }),
            winston.format.json(),
          )
        : env === "development"
          ? winston.format.combine(
              winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
              winston.format.colorize(),
              winston.format.printf(({ timestamp, level, message, ...meta }) => {
                const metaStr = Object.keys(meta).length
                  ? ` ${JSON.stringify(meta)}`
                  : "";
                return `${timestamp} [${level}]: ${message}${metaStr}`;
              }),
            )
          : winston.format.combine(
              winston.format.timestamp(),
              winston.format.errors({ stack: true }),
              winston.format.json(),
            ),
  }),
];

// File transports — only in production
if (env === "production") {
  // Combined log (all levels)
  transports.push(
    new DailyRotateFile({
      filename: path.join(logDir, "orbit-%DATE%.log"),
      datePattern: "YYYY-MM-DD",
      zippedArchive: true,
      maxFiles,
      level: logLevel,
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json(),
      ),
    }),
  );

  // Error-level log (separate file for quick debugging)
  transports.push(
    new DailyRotateFile({
      filename: path.join(logDir, "orbit-error-%DATE%.log"),
      datePattern: "YYYY-MM-DD",
      zippedArchive: true,
      maxFiles,
      level: "error",
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json(),
      ),
    }),
  );
}

// ─── Logger Instance ───────────────────────────────────────────────

const logger = winston.createLogger({
  level: logLevel,
  defaultMeta: {
    service: "orbit-server",
    environment: env,
    pid: process.pid,
  },
  transports,
  // Do not exit on uncaught errors from logger itself
  exitOnError: false,
});

// ─── Stream for Morgan / HTTP request logging ──────────────────────
export const logStream = {
  write: (message: string) => {
    logger.info(message.trim());
  },
};

export { logger };
export default logger;
