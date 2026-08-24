import * as Sentry from "@sentry/react";

// Initialize Sentry for error tracking and performance monitoring
export const initSentry = () => {
  if (import.meta.env.PROD && import.meta.env.VITE_SENTRY_DSN) {
    Sentry.init({
      dsn: import.meta.env.VITE_SENTRY_DSN,
      environment: import.meta.env.MODE,
      tracesSampleRate: import.meta.env.PROD ? 0.1 : 0,
      integrations: [
        // In-app user feedback widget — users can report bugs or suggest features
        // without leaving the app. Only shown in production when DSN is configured.
        Sentry.feedbackIntegration({
          colorScheme: "dark",
          isEmailRequired: false,
          showBranding: false,
          formTitle: "Report an Issue",
          submitButtonLabel: "Send Feedback",
          messagePlaceholder: "Describe what happened or what you'd like to see...",
        }),
      ],
      beforeSend(event, hint) {
        // Filter out certain errors if needed
        if (event.exception) {
          const error = hint.originalException;
          // Ignore specific error types if needed
          if (error instanceof Error && error.message.includes("ResizeObserver")) {
            return null;
          }
        }
        return event;
      },
    });
  }
};

export const captureException = (error: Error, context?: Record<string, any>) => {
  Sentry.captureException(error, {
    extra: context,
  });
};

/**
 * Open the Sentry feedback widget programmatically.
 * Useful for adding a "Report Bug" button in settings or the dock.
 */
export const openFeedbackWidget = () => {
  try {
    const widget = Sentry.getFeedback();
    if (widget) {
      widget.createForm().catch(() => {
        // Widget form failed to open
      });
    }
  } catch {
    // Widget not available (e.g. not in production or DSN not configured) —
    // deliberately silent: nothing must ever print to the browser console.
  }
};
