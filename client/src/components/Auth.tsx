import React, { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { useKeyboardOpen } from "../hooks/useKeyboardOpen";

import {
  Lock,
  User,
  ShieldCheck,
  AlertCircle,
  ArrowRight,
  Eye,
  EyeOff,
} from "lucide-react";

// The Google OAuth flow MUST stay on the SAME origin as its callback. The
// server sets an httpOnly `oauth_state` cookie when the flow starts and
// verifies it on the callback — and that cookie is host-scoped. If the flow
// started on the backend origin (e.g. Render) while the callback lands on
// this origin (the Vercel app, which proxies /api/* to the backend), the
// cookie never travels to the callback and the state check ALWAYS fails
// ("Google Sign-In failed", every time).
//
// So the button navigates to a RELATIVE /api/auth/google path on THIS
// origin. Vercel (prod) and the Vite dev server (dev) both proxy /api/* to
// the backend, so the flow works identically everywhere — the oauth_state
// cookie is stored on this origin and echoed back on the callback.
const GOOGLE_OAUTH_URL = `/api/auth/google?deviceId=${encodeURIComponent(
	getDeviceId(),
)}&deviceLabel=${encodeURIComponent(getDeviceLabel())}`;
import { User as UserType } from "../types";
import GlassCard from "./GlassCard";
import ShinyText from "./ShinyText";
import ValidationMessage from "./ValidationMessage";
import CharCounter from "./CharCounter";
import { apiFetch } from "../utils/api";
import { isFeatureOn } from "../utils/featureGates";
import {
  validateSignup,
  validateLogin,
  type SignupData,
  type LoginData,
} from "../utils/validation";
import { getDeviceId, getDeviceLabel } from "../utils/deviceId";

// ── Free-tier cold-start resilience ─────────────────────────────────────────
// The backend runs on a free-tier host (Render) that sleeps after ~15 min of
// inactivity and takes 30–60s to cold-start. While it boots, Vercel's proxy
// answers 502/503/504. These helpers retry through that window so login/signup
// and Google OAuth never surface a raw 503 page.

const COLD_START_STATUSES = new Set([502, 503, 504]);

/**
 * Run a mutation through apiFetch, retrying while the backend is cold-starting.
 * Mutations only retry on 502/503/504 (server not ready) or network failures —
 * a genuine 4xx (bad credentials, validation) is returned immediately.
 */
async function apiFetchWithColdStartRetry(
	url: string,
	options: RequestInit,
): Promise<Response> {
	const maxAttempts = 5;
	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		try {
			const res = await apiFetch(url, options);
			if (!COLD_START_STATUSES.has(res.status)) return res;
			// Server still booting — fall through and retry
		} catch {
			// Network failure while online: server is likely mid-boot; retry
		}
		if (attempt < maxAttempts) {
			// 3s, 6s, 9s, 12s backoff — covers the 30–60s cold-start window
			await new Promise((r) => setTimeout(r, 3000 * attempt));
		}
	}
	return apiFetch(url, options); // final attempt
}

/**
 * Poll /api/ping until the backend answers, or time out. Used before the
 * Google OAuth full-page navigation — without it, a sleeping server renders
 * the browser's raw "503 Service Unavailable" page.
 */
async function warmUpServer(maxWaitMs = 45_000): Promise<boolean> {
	const deadline = Date.now() + maxWaitMs;
	while (Date.now() < deadline) {
		try {
			const res = await apiFetch("/api/ping", {
				bypassCache: true,
				cache: "no-store",
			});
			if (res.ok) return true;
		} catch {
			// server still booting — keep polling
		}
		await new Promise((r) => setTimeout(r, 3000));
	}
	return false;
}

interface AuthProps {
  onAuthSuccess: (user: UserType, token?: string) => void;
  onForgotPasswordClick: () => void;
  initialShowSignup?: boolean;
}

export default function Auth({
  onAuthSuccess,
  onForgotPasswordClick,
  initialShowSignup = false,
}: AuthProps) {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Common Fields
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  // Field-level validation errors
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // Set or clear one field's error (no-op when nothing changes, so typing
  // never causes unnecessary re-renders).
  const setFieldError = (field: string, message?: string) => {
    setFieldErrors((prev) => {
      if (!message) {
        if (!prev[field]) return prev;
        const next = { ...prev };
        delete next[field];
        return next;
      }
      if (prev[field] === message) return prev;
      return { ...prev, [field]: message };
    });
  };

  // ── Live field validation ────────────────────────────────────────────────
  // Errors appear IMMEDIATELY as the user types — no waiting for the submit
  // click. `fresh` carries the just-typed value so validation never lags a
  // keystroke behind state. Empty fields are only flagged on blur (or submit)
  // — showing "required" on the very first keystroke would be noise.
  const validateSignupField = (
    field: string,
    fresh: Partial<SignupData> = {},
  ) => {
    const errs = validateSignup({
      username,
      email,
      password,
      confirmPassword,
      ...fresh,
    });
    setFieldError(field, errs[field]);
  };

  const validateLoginField = (
    field: string,
    fresh: Partial<LoginData> = {},
  ) => {
    const errs = validateLogin({
      usernameOrEmail: identity,
      password,
      ...fresh,
    });
    setFieldError(field, errs[field]);
  };

  // Google OAuth entry — carries the browser's stable deviceId so the server
  // can run the same "new device login" security email as the local login flow.
  const googleOAuthUrl = GOOGLE_OAUTH_URL;

  // Toggle between login and signup views.
  const [showSignup, setShowSignup] = useState(initialShowSignup);

  // True while the Google OAuth flow is warming up the (possibly sleeping)
  // backend before performing the full-page redirect to Google.
  const [wakingServer, setWakingServer] = useState(false);

  // Google OAuth entry — the button is a plain anchor; intercept the click so
  // we can wait for the backend to answer /api/ping before navigating. Without
  // this, a cold-starting free-tier server shows the browser's raw 503 page.
  const handleGoogleOAuth = async (e: React.MouseEvent) => {
    e.preventDefault();
    if (wakingServer) return;
    setWakingServer(true);
    setError(null);
    try {
      const ready = await warmUpServer();
      if (ready) {
        window.location.href = googleOAuthUrl;
      } else {
        setError(
          "Orbit's server is still starting up. Give it a minute, then try again.",
        );
      }
    } finally {
      setWakingServer(false);
    }
  };

  // Login identity (username or mail)
  const [identity, setIdentity] = useState("");

  // Signup fields
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [gender] = useState<"male" | "female" | "others">("others");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  // Sign up Form Submit
  const handleSignupSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errors = validateSignup({
      username,
      email,
      password,
      confirmPassword,
    });
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      setError(null);
      return;
    }
    setFieldErrors({});

    setError(null);
    setLoading(true);

    const formData = new FormData();
    formData.append("username", username.toLowerCase().trim());
    formData.append("email", email.toLowerCase().trim());
    formData.append("password", password);
    formData.append("confirmPassword", confirmPassword);
    formData.append("gender", gender);

    try {
      const res = await apiFetchWithColdStartRetry("/api/auth/signup", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();

      if (res.ok && data.success) {
        onAuthSuccess(data.user, data.token);
      } else {
        setError(data.message || "Registration failed.");
      }
    } catch (err) {
      setError("Failed to register profile. Server is currently offline.");
    } finally {
      setLoading(false);
    }
  };

  // Login Form Submit
  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errors = validateLogin({ usernameOrEmail: identity, password });
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      setError(null);
      return;
    }
    setFieldErrors({});

    setError(null);
    setLoading(true);

    try {
      const res = await apiFetchWithColdStartRetry("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          usernameOrEmail: identity.trim(),
          password,
          deviceId: getDeviceId(),
          deviceLabel: getDeviceLabel(),
        }),
      });
      const data = await res.json();

      if (res.ok && data.success) {
        onAuthSuccess(data.user, data.token);
      } else {
        setError(data.message || "Invalid username or password.");
      }
    } catch (err) {
      setError("Connection failure to the server.");
    } finally {
      setLoading(false);
    }
  };

  const isKeyboardOpen = useKeyboardOpen();

  return (
    <div className="flex w-full flex-col items-center">
      {/* Brand Identity Constellation Ring - compact */}
      <div className="mb-4 text-center select-none">
        <div className="relative inline-block">
          <div className="absolute -inset-1 rounded-full bg-linear-to-r from-zinc-200 to-zinc-400 dark:from-zinc-800 dark:to-zinc-600 blur opacity-30 group-hover:opacity-100 transition duration-1000 group-hover:duration-200 animate-tilt"></div>
          <h1 className="font-orbit-logo relative mt-2.5 font-sans text-xl font-black tracking-[0.25em] text-white uppercase">
            <ShinyText text="ORBIT" speed={3.5} />
          </h1>
        </div>
        <p className="text-[11px] text-zinc-400 dark:text-zinc-500 font-extrabold uppercase tracking-[0.25em] mt-1.5 font-sans">
          simple social circle
        </p>
      </div>

      <GlassCard className={`w-full max-w-lg border-white/10 shadow-[0_25px_65px_-15px_rgba(0,0,0,0.85)] hover:border-white/20 transition-all duration-300 rounded-4xl ${
        isKeyboardOpen ? "p-3.5 lg:p-5" : "p-5 lg:p-6"
      }`}>
        {/* Compact Header Title inside card */}
        {!isKeyboardOpen && (
        <div className="mb-3 text-center">
          <h2 className="text-display-sm text-white">
            {showSignup ? "Join Orbit Today!" : "Welcome Back"}
          </h2>
          <p className="text-[8px] text-zinc-400 mt-0.5 uppercase tracking-wider font-mono">
            {showSignup ? "Create an account to post and share moments" : "Sign in to continue to your feed"}
          </p>
        </div>
        )}

        {error && (
          <div className="mb-3 flex items-start gap-2 rounded-2xl border border-red-950/30 bg-red-950/20 p-2.5 text-[11px] text-red-400 font-sans">
            <AlertCircle className="h-3.5 w-3.5 shrink-0 text-red-400 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        <AnimatePresence mode="wait">
          {showSignup ? (
            <motion.div
              key="signup"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
          >
          <form onSubmit={handleSignupSubmit} noValidate className={`font-sans transition-all duration-200 ${
            isKeyboardOpen ? "space-y-2" : "space-y-2.5"
          }`}>
            <h3 className="text-label font-semibold text-white/90 mb-2.5">Create Account</h3>

            {/* Username */}
            <div className="space-y-1 text-left">
              <label htmlFor="signup-username" className="text-[12px] md:text-sm font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 pl-3.5">Username</label>
              <input
                id="signup-username"
                type="text"
                required
                autoComplete="off"
                placeholder="alice"
                value={username}
                onChange={(e) => {
                  const v = e.target.value.toLowerCase().replace(/\s+/g, "");
                  setUsername(v);
                  // Flag invalid values the moment they're typed; wait for blur
                  // to complain about an empty field.
                  if (v.trim()) validateSignupField("username", { username: v });
                  else setFieldError("username");
                }}
                onBlur={() => validateSignupField("username", { username })}
                maxLength={100}
                aria-describedby={fieldErrors.username ? "signup-username-error" : undefined}
                className="w-full rounded-lg border border-zinc-800 bg-zinc-950/20 py-2 px-3.5 text-[12px] md:text-sm font-medium text-white placeholder-zinc-500 focus:outline-none focus:border-white focus:bg-zinc-900 focus:ring-1 focus:ring-white/10 transition-all"
              />
              <div className="flex items-center justify-between px-1">
                <ValidationMessage id="signup-username-error" message={fieldErrors.username} />
                <CharCounter current={username.length} max={100} />
              </div>
            </div>

            <div className="space-y-1 text-left">
              <label htmlFor="signup-email" className="text-[12px] md:text-sm font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 pl-3.5">Email Address</label>                <input
                id="signup-email"
                type="email"
                required
                autoComplete="off"
                placeholder="alice@gmail.com"
                value={email}
                onChange={(e) => {
                  const v = e.target.value;
                  setEmail(v);
                  if (v.trim()) validateSignupField("email", { email: v });
                  else setFieldError("email");
                }}
                onBlur={() => validateSignupField("email", { email })}
                aria-describedby={fieldErrors.email ? "signup-email-error" : undefined}
                className="w-full rounded-full border border-zinc-800 bg-zinc-950/20 py-2 px-3.5 text-[12px] md:text-sm font-medium text-white placeholder-zinc-500 focus:outline-none focus:border-white focus:bg-zinc-900 focus:ring-1 focus:ring-white/10 transition-all"
              />
              <ValidationMessage id="signup-email-error" message={fieldErrors.email} />
            </div>

            {/* Password + Confirm Password side by side */}
            <div className="grid grid-cols-2 gap-2.5">
              <div className="space-y-1 text-left">
                <label htmlFor="signup-password" className="text-[12px] md:text-sm font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 pl-3.5">Password</label>
                <div className="relative">
                  <input
                    id="signup-password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="new-password"
                    required
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => {
                      const v = e.target.value;
                      setPassword(v);
                      if (v) validateSignupField("password", { password: v });
                      else setFieldError("password");
                      // Confirm depends on the password — keep its match error
                      // in sync so an old "passwords do not match" can't linger.
                      if (confirmPassword)
                        validateSignupField("confirmPassword", { password: v });
                    }}
                    onBlur={() => validateSignupField("password", { password })}
                    aria-describedby={fieldErrors.password ? "signup-password-error" : undefined}
                    className="w-full rounded-full border border-zinc-800 bg-zinc-950/20 py-2 pl-3.5 pr-9 text-[12px] md:text-sm font-medium text-white placeholder-zinc-500 focus:outline-none focus:border-white focus:bg-zinc-900 focus:ring-1 focus:ring-white/10 transition-all"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute inset-y-0 right-0 flex items-center pr-3 text-zinc-400 hover:text-black dark:hover:text-white cursor-pointer"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                  </button>
                </div>
                <ValidationMessage id="signup-password-error" message={fieldErrors.password} />
              </div>

              <div className="space-y-1 text-left">
                <label htmlFor="signup-confirm-password" className="text-[12px] md:text-sm font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 pl-3.5">Confirm</label>
                <div className="relative">
                  <input
                    id="signup-confirm-password"
                    type={showConfirmPassword ? "text" : "password"}
                    autoComplete="new-password"
                    required
                    placeholder="••••••••"
                    value={confirmPassword}
                    onChange={(e) => {
                      const v = e.target.value;
                      setConfirmPassword(v);
                      if (v)
                        validateSignupField("confirmPassword", { confirmPassword: v });
                      else setFieldError("confirmPassword");
                    }}
                    onBlur={() =>
                      validateSignupField("confirmPassword", { confirmPassword })
                    }
                    aria-describedby={fieldErrors.confirmPassword ? "signup-confirm-password-error" : undefined}
                    className="w-full rounded-full border border-zinc-800 bg-zinc-950/20 py-2 pl-3.5 pr-9 text-[12px] md:text-sm font-medium text-white placeholder-zinc-500 focus:outline-none focus:border-white focus:bg-zinc-900 focus:ring-1 focus:ring-white/10 transition-all"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    className="absolute inset-y-0 right-0 flex items-center pr-3 text-zinc-400 hover:text-black dark:hover:text-white cursor-pointer"
                    aria-label={showConfirmPassword ? "Hide confirm password" : "Show confirm password"}
                  >
                    {showConfirmPassword ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                  </button>
                </div>
                <ValidationMessage id="signup-confirm-password-error" message={fieldErrors.confirmPassword} />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}					className="flex w-full items-center justify-center gap-2 rounded-full bg-aurora py-2.5 text-[12px] md:text-sm font-bold tracking-widest uppercase text-white shadow-aurora transition-all hover:opacity-90 active:scale-[0.98] disabled:opacity-40 cursor-pointer border border-white/10"
            >
              {loading ? "Creating Account..." : "Create Account"}
              <ShieldCheck className="h-3.5 w-3.5" />
            </button>

            {/* Divider */}
            <div className="relative my-3">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-zinc-800/50" />
              </div>
              <div className="relative flex justify-center text-xs">
                <span className="bg-zinc-950 px-2 text-zinc-500 font-bold">OR</span>
              </div>
            </div>

            {/* Google Sign-Up Button */}
            <a
              href={googleOAuthUrl}
              onClick={handleGoogleOAuth}
              aria-disabled={wakingServer}
              className="flex w-full items-center justify-center gap-2.5 rounded-full border border-zinc-700 bg-zinc-950/50 py-2.5 text-[12px] md:text-sm font-bold text-white transition-all hover:bg-zinc-900 hover:border-zinc-500 active:scale-[0.98] cursor-pointer"
            >
              <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" />
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
              </svg>
              {wakingServer ? "Waking up server…" : "Continue with Google"}
            </a>

            <div className="text-center mt-3 pt-2.5 border-t border-zinc-800/50">
              <span className="text-[12px] md:text-sm text-zinc-500 font-semibold">Already have an account? </span>
              <button
                type="button"
                onClick={() => { setShowSignup(false); setError(null); setFieldErrors({}); }}
                className="text-[12px] md:text-sm font-bold text-white hover:text-zinc-300 underline underline-offset-2 cursor-pointer transition-colors"
              >
                Sign In
              </button>
            </div>
          </form>
          </motion.div>
        ) : (
          <motion.div
              key="login"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
          >
          <form onSubmit={handleLoginSubmit} noValidate className={`font-sans transition-all duration-200 ${
            isKeyboardOpen ? "space-y-2.5" : "space-y-3.5"
          }`}>
            <h3 className="text-label font-semibold text-white/90 mb-3">Sign In</h3>
            <div className="space-y-1.5 text-left">
              <label htmlFor="login-identity" className="text-[12px] md:text-sm font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 pl-4">Username or Email</label>
              <div className="relative group">
                <span className="absolute inset-y-0 left-0 flex items-center pl-4.5 text-zinc-400 group-focus-within:text-black dark:group-focus-within:text-white transition-colors">
                  <User className="h-4 w-4" />
                </span>
                <input
                  id="login-identity"
                  type="text"
                  required
                  autoComplete="off"
                  placeholder="alice@gmail.com"
                  value={identity}
                  onChange={(e) => {
                    const v = e.target.value;
                    setIdentity(v);
                    if (v.trim())
                      validateLoginField("identity", { usernameOrEmail: v });
                    else setFieldError("identity");
                  }}
                  onBlur={() =>
                    validateLoginField("identity", { usernameOrEmail: identity })
                  }
                  aria-describedby={fieldErrors.identity ? "login-identity-error" : undefined}
                  className="w-full rounded-full border border-zinc-800 bg-zinc-950/20 py-3 max-sm:py-2 pl-11 max-sm:pl-9 pr-4.5 max-sm:pr-3.5 text-xs md:text-[13px] font-medium text-white placeholder-zinc-500 transition-all focus:border-white focus:bg-zinc-900 focus:outline-none focus:ring-1 focus:ring-white/10"
                />
              </div>
              <ValidationMessage id="login-identity-error" message={fieldErrors.identity} />
            </div>

            <div className="space-y-1.5 text-left">
              <div className="flex items-center justify-between pl-4">
                <label htmlFor="login-password" className="text-[12px] md:text-sm font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Password</label>
                <button
                  type="button"
                  onClick={onForgotPasswordClick}
                  className="text-[12px] md:text-sm font-bold text-zinc-400 dark:text-zinc-400 hover:text-white dark:hover:text-zinc-200 transition-colors focus:outline-none cursor-pointer"
                >
                  Forgot Password?
                </button>
              </div>
              <div className="relative group">
                <span className="absolute inset-y-0 left-0 flex items-center pl-4.5 text-zinc-400 group-focus-within:text-black dark:group-focus-within:text-white transition-colors">
                  <Lock className="h-4 w-4" />
                </span>
                <input
                  id="login-password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  required
                  placeholder="••••••••••••"
                  value={password}
                  onChange={(e) => {
                    const v = e.target.value;
                    setPassword(v);
                    if (v) validateLoginField("password", { password: v });
                    else setFieldError("password");
                  }}
                  onBlur={() => validateLoginField("password", { password })}
                  aria-describedby={fieldErrors.password ? "login-password-error" : undefined}
                  className="w-full rounded-full border border-zinc-800 bg-zinc-950/20 py-3 max-sm:py-2 pl-11 max-sm:pl-9 pr-11 max-sm:pr-9 text-xs md:text-[13px] font-medium text-white placeholder-zinc-500 transition-all focus:border-white focus:bg-zinc-900 focus:outline-none focus:ring-1 focus:ring-white/10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 right-0 flex items-center pr-4.5 text-zinc-400 dark:text-zinc-500 hover:text-black dark:hover:text-white cursor-pointer transition-colors"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                </button>
              </div>
              <ValidationMessage id="login-password-error" message={fieldErrors.password} />
            </div>

            <button
              type="submit"
              disabled={loading}					className="flex w-full items-center justify-center gap-2 rounded-full bg-aurora py-3.5 max-sm:py-2.5 text-[12px] md:text-sm font-bold tracking-widest uppercase text-white shadow-aurora transition-all hover:opacity-90 hover:shadow-aurora active:scale-[0.98] disabled:opacity-40 cursor-pointer border border-white/10"
            >
              {loading ? "Signing In..." : "Sign In"}
              <ArrowRight className="h-3.5 w-3.5" />
            </button>

            {/* Divider */}
            <div className="relative my-4">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-zinc-800/50" />
              </div>
              <div className="relative flex justify-center text-xs">
                <span className="bg-zinc-950 px-2 text-zinc-500 font-bold">OR</span>
              </div>
            </div>

            {/* Google Sign-In Button */}
            <a
              href={googleOAuthUrl}
              onClick={handleGoogleOAuth}
              aria-disabled={wakingServer}
              className="flex w-full items-center justify-center gap-2.5 rounded-full border border-zinc-700 bg-zinc-950/50 py-3 max-sm:py-2.5 text-[12px] md:text-sm font-bold text-white transition-all hover:bg-zinc-900 hover:border-zinc-500 active:scale-[0.98] cursor-pointer"
            >
              <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" />
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
              </svg>
              {wakingServer ? "Waking up server…" : "Sign in with Google"}
            </a>

            <div className="text-center mt-5 pt-4 border-t border-zinc-800/50">
              <span className="text-[12px] md:text-sm text-zinc-500 font-semibold">Don't have an account? </span>
              {isFeatureOn("signups_open") ? (
                <button
                  type="button"
                  onClick={() => { setShowSignup(true); setError(null); setFieldErrors({}); }}
                  className="text-[12px] md:text-sm font-bold text-white hover:text-zinc-300 underline underline-offset-2 cursor-pointer transition-colors"
                >
                  Create Account
                </button>
              ) : (
                <span className="text-[12px] md:text-sm font-bold text-zinc-500">
                  Signups are paused right now
                </span>
              )}
            </div>
          </form>
          </motion.div>
        )}
        </AnimatePresence>
      </GlassCard>
    </div>
  );
}
