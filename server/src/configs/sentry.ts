/**
 * Sentry Monitoring & Error Tracking Integration
 *
 * Provides production-grade error monitoring and performance tracking.
 * Uses Sentry SDK v10 API (OpenTelemetry-based).
 */

import * as Sentry from "@sentry/node";
import { nodeProfilingIntegration } from "@sentry/profiling-node";
import { env } from "./env";
import { logger } from "../utilities/logger";

/**
 * Initialize Sentry with the configured DSN.
 * In dev/test, sampling is disabled to avoid noise.
 *
 * The Express error handler middleware must be applied manually
 * AFTER init via `app.use(Sentry.expressErrorHandler())`.
 */
export const initSentry = (): void => {
  const dsn = env.SENTRY_DSN;

  if (!dsn) {
    logger.info("Sentry DSN not configured — skipping Sentry initialization");
    return;
  }

  const isDev = env.NODE_ENV === "development" || env.NODE_ENV === "test";

  Sentry.init({
    dsn,
    integrations: [
      // Express error tracking (auto-detected, no app argument needed)
      Sentry.expressErrorHandler(),
      // Continuous profiling for CPU-intensive operations
      nodeProfilingIntegration(),
    ],
    tracesSampleRate: isDev ? 0.0 : parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE || "0.2"),
    profilesSampleRate: isDev ? 0.0 : parseFloat(process.env.SENTRY_PROFILES_SAMPLE_RATE || "0.1"),
    environment: env.NODE_ENV,
    release: process.env.SENTRY_RELEASE || undefined,
    debug: isDev,
    enabled: !isDev,
  });

  logger.info("Sentry initialized for error monitoring & profiling", {
    environment: env.NODE_ENV,
    tracesSampleRate: isDev ? 0.0 : 0.2,
  });
};

/**
 * Sentry error handler middleware — place last, before the global error handler.
 * Automatically captures unhandled errors.
 */
export const sentryErrorHandler = Sentry.expressErrorHandler();

/**
 * Manually capture an exception with context.
 */
export const captureException = (error: Error, context?: Record<string, unknown>): void => {
  Sentry.captureException(error, { extra: context });
};

/**
 * Manually capture a message.
 */
export const captureMessage = (message: string, context?: Record<string, unknown>): void => {
  Sentry.captureMessage(message, { level: "error", extra: context });
};
