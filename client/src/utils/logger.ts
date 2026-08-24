/**
 * Silent logger — suppresses all browser console output.
 * All methods are no-ops to keep the browser console clean.
 */

export const logger = {
  error: (..._args: unknown[]) => {
    // Silenced
  },
  warn: (..._args: unknown[]) => {
    // Silenced
  },
  log: (..._args: unknown[]) => {
    // Silenced
  },
  info: (..._args: unknown[]) => {
    // Silenced
  },
};
