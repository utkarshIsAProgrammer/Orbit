import { useState, type FormEvent } from "react";
import {
  ArrowRight,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  Mail,
  User,
} from "lucide-react";
import { APP_URL } from "../config";
import { Reveal } from "./Reveal";
import { Magnetic } from "./Magnetic";

/**
 * Login / Sign up — the app's own auth flow, embedded in the landing page.
 *
 * Posts through the APP's `/api` proxy (the same Vercel rewrite the app
 * uses) so the JWT + CSRF cookies land on the app's domain; on success we
 * redirect to the app, which picks the session straight up.
 */

type Mode = "login" | "signup";

const AUTH_API = `${APP_URL.replace(/\/+$/, "")}/api`;

export function AuthSection() {
  const [mode, setMode] = useState<Mode>("login");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // login fields
  const [identity, setIdentity] = useState("");
  // signup fields
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  // shared
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  // Stable per-browser id so the server can run its new-device security email.
  const deviceId = (() => {
    try {
      let id = localStorage.getItem("orbit_device_id");
      if (!id) {
        id = `lp-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
        localStorage.setItem("orbit_device_id", id);
      }
      return id;
    } catch {
      return "";
    }
  })();

  const googleUrl = `${AUTH_API}/auth/google?deviceId=${encodeURIComponent(
    deviceId,
  )}&deviceLabel=${encodeURIComponent(
    typeof navigator !== "undefined"
      ? `${navigator.platform} · ${navigator.userAgent.slice(0, 80)}`
      : "Landing page",
  )}`;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setError("");

    if (mode === "signup") {
      if (username.trim().length < 3) {
        setError("Username must be at least 3 characters.");
        return;
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
        setError("That doesn't look like a valid email.");
        return;
      }
      if (password.length < 6) {
        setError("Password must be at least 6 characters.");
        return;
      }
      if (password !== confirmPassword) {
        setError("Passwords don't match.");
        return;
      }
    } else {
      if (!identity.trim()) {
        setError("Enter your username or email.");
        return;
      }
      if (!password) {
        setError("Enter your password.");
        return;
      }
    }

    setLoading(true);
    try {
      const isSignup = mode === "signup";
      const res = await fetch(
        `${AUTH_API}/auth/${isSignup ? "signup" : "login"}`,
        {
          method: "POST",
          credentials: "include",
          headers: isSignup
            ? undefined
            : { "Content-Type": "application/json" },
          body: isSignup
            ? (() => {
                const fd = new FormData();
                fd.append("username", username.trim().toLowerCase());
                fd.append("email", email.trim().toLowerCase());
                fd.append("password", password);
                fd.append("confirmPassword", confirmPassword);
                fd.append("gender", "others");
                return fd;
              })()
            : JSON.stringify({
                usernameOrEmail: identity.trim(),
                password,
                deviceId,
                deviceLabel: "Landing page",
              }),
        },
      );
      const data = await res.json().catch(() => ({}));

      if (res.ok && data?.success) {
        // Cookie is set on the app domain — hand off.
        window.location.href = `${APP_URL.replace(/\/+$/, "")}/?auth_success=true`;
        return;
      }
      setError(
        data?.message ||
          (isSignup
            ? "Couldn't create the account — try again."
            : "Invalid username or password."),
      );
    } catch {
      setError("Can't reach the server right now — please try again.");
    } finally {
      setLoading(false);
    }
  };

  const inputCls =
    "w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3.5 pr-11 text-sm text-white outline-none transition-all duration-300 placeholder:text-white/25 hover:border-white/20 focus:border-amber/50 focus:bg-white/[0.05] focus:shadow-[0_0_34px_-10px_rgba(212,175,55,0.55)]";

  return (
    <section
      id="auth"
      className="relative overflow-hidden py-28 sm:py-36"
    >
      <div className="pointer-events-none absolute inset-0 halo" />

      <div className="relative z-10 mx-auto max-w-md px-6 text-center">
        <Reveal>
          <span className="u-label text-[11px] tracking-[0.22em] text-white/55">
            ( already_have_a_seat )
          </span>
        </Reveal>
        <Reveal delay={0.08}>
          <span className="script mt-5 block text-4xl text-white/85 sm:text-5xl">
            walk right in
          </span>
        </Reveal>

        <Reveal delay={0.18}>
          <div className="glass relative mx-auto mt-10 overflow-hidden rounded-2xl p-6 text-left sm:p-7">
            {/* mode toggle */}
            <div className="mb-6 grid grid-cols-2 gap-1 rounded-full border border-white/10 bg-white/[0.03] p-1">
              {(["login", "signup"] as Mode[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => {
                    setMode(m);
                    setError("");
                  }}
                  className={`rounded-full py-2 text-[10px] font-black uppercase tracking-[0.16em] transition-all duration-300 cursor-pointer ${
                    mode === m
                      ? "bg-white text-black"
                      : "text-white/45 hover:text-white"
                  }`}
                >
                  {m === "login" ? "Sign In" : "Create Account"}
                </button>
              ))}
            </div>

            <form onSubmit={submit} noValidate className="flex flex-col gap-4">
              {mode === "signup" ? (
                <>
                  <div className="relative">
                    <User className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-white/30" />
                    <input
                      type="text"
                      autoComplete="off"
                      placeholder="Username"
                      value={username}
                      onChange={(e) =>
                        setUsername(
                          e.target.value.toLowerCase().replace(/\s+/g, ""),
                        )
                      }
                      disabled={loading}
                      className={`${inputCls} pl-11`}
                    />
                  </div>
                  <div className="relative">
                    <Mail className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-white/30" />
                    <input
                      type="email"
                      inputMode="email"
                      autoComplete="email"
                      placeholder="you@example.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      disabled={loading}
                      className={`${inputCls} pl-11`}
                    />
                  </div>
                </>
              ) : (
                <div className="relative">
                  <User className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-white/30" />
                  <input
                    type="text"
                    autoComplete="off"
                    placeholder="Username or email"
                    value={identity}
                    onChange={(e) => setIdentity(e.target.value)}
                    disabled={loading}
                    className={`${inputCls} pl-11`}
                  />
                </div>
              )}

              {/* password */}
              <div className="relative">
                <Lock className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-white/30" />
                <input
                  type={showPassword ? "text" : "password"}
                  autoComplete={mode === "signup" ? "new-password" : "current-password"}
                  placeholder="Password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={loading}
                  className={`${inputCls} pl-11`}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-white/35 transition-colors hover:text-white cursor-pointer"
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>

              {mode === "signup" && (
                <div className="relative">
                  <Lock className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-white/30" />
                  <input
                    type={showConfirm ? "text" : "password"}
                    autoComplete="new-password"
                    placeholder="Confirm password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    disabled={loading}
                    className={`${inputCls} pl-11`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirm(!showConfirm)}
                    aria-label={showConfirm ? "Hide confirm" : "Show confirm"}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-white/35 transition-colors hover:text-white cursor-pointer"
                  >
                    {showConfirm ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
              )}

              {error && (
                <p
                  className="text-left text-xs font-medium text-rose-300/90"
                  role="alert"
                >
                  {error}
                </p>
              )}

              <Magnetic strength={0.25}>
                <button
                  type="submit"
                  disabled={loading}
                  className="btn btn-primary w-full disabled:opacity-50"
                >
                  {loading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      {mode === "signup" ? "Creating account" : "Signing in"}
                    </>
                  ) : (
                    <>
                      {mode === "signup" ? "Create Account" : "Sign In"}
                      <ArrowRight className="h-4 w-4" />
                    </>
                  )}
                </button>
              </Magnetic>
            </form>

            {/* divider */}
            <div className="relative my-5">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-white/10" />
              </div>
              <div className="relative flex justify-center">
                <span className="bg-[#0a0a0b] px-2 font-mono text-[10px] uppercase tracking-[0.2em] text-white/30">
                  or
                </span>
              </div>
            </div>

            {/* Google */}
            <a
              href={googleUrl}
              className="flex w-full items-center justify-center gap-2.5 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3.5 text-sm font-semibold text-white transition-all duration-300 hover:border-white/25 hover:bg-white/[0.06]"
            >
              <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24">
                <path
                  fill="#4285F4"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
                />
                <path
                  fill="#34A853"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                />
                <path
                  fill="#EA4335"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                />
              </svg>
              Continue with Google
            </a>

            <p className="mt-5 text-center text-[11px] uppercase tracking-[0.18em] text-white/25">
              your seat is saved · same account on the app
            </p>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
