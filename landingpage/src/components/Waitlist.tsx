import { useEffect, useRef, useState, type FormEvent } from "react";
import { gsap } from "gsap";
import { ArrowRight, Loader2, PartyPopper } from "lucide-react";
import { WAITLIST_API_URL, TURNSTILE_SITE_KEY } from "../config";
import { Reveal } from "./Reveal";
import { Magnetic } from "./Magnetic";
import { SplitWords } from "./SplitWords";
import { Parallax } from "./Parallax";

type Phase = "idle" | "loading" | "success" | "already" | "error";

/** Animates a number from 0 → value (comma-formatted). */
function CountUp({ value, className }: { value: number; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obj = { n: 0 };
    const tw = gsap.to(obj, {
      n: value,
      duration: 1.8,
      ease: "power2.out",
      onUpdate: () => {
        el.textContent = Math.round(obj.n).toLocaleString();
      },
    });
    return () => {
      tw.kill();
    };
  }, [value]);
  return (
    <span ref={ref} className={className}>
      0
    </span>
  );
}

export function Waitlist() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  // Honeypot — invisible field bots auto-fill; humans never touch it.
  const [website, setWebsite] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState("");
  const [position, setPosition] = useState<number | null>(null);
  const [count, setCount] = useState(0);
  const [turnstileToken, setTurnstileToken] = useState("");

  const formRef = useRef<HTMLDivElement>(null);
  const successRef = useRef<HTMLDivElement>(null);
  const burstRef = useRef<HTMLDivElement>(null);

  // When the form first rendered — sent to the server so it can reject
  // submissions that are too fast to be human (bots/scripts).
  const formStartRef = useRef(Date.now());

  // Optional Cloudflare Turnstile widget (rendered only when configured).
  const turnstileRef = useRef<HTMLDivElement>(null);
  const turnstileWidgetRef = useRef<string | undefined>(undefined);

  // Load + render Turnstile once, only if a site key is configured.
  useEffect(() => {
    if (!TURNSTILE_SITE_KEY) return;
    const render = () => {
      const ts = window.turnstile;
      if (!ts || !turnstileRef.current || turnstileWidgetRef.current) return;
      const siteKey = TURNSTILE_SITE_KEY;
      if (!siteKey) return;
      try {
        turnstileWidgetRef.current = ts.render(turnstileRef.current, {
          sitekey: siteKey,
          theme: "dark",
          callback: (t) => setTurnstileToken(t),
          "expired-callback": () => setTurnstileToken(""),
          "error-callback": () => setTurnstileToken(""),
        });
      } catch {
        /* widget already rendered */
      }
    };
    if (window.turnstile) {
      render();
      return;
    }
    const script = document.createElement("script");
    script.src =
      "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.onload = render;
    document.head.appendChild(script);
  }, []);

  // Live "already in line" counter from the server
  useEffect(() => {
    let alive = true;
    fetch(`${WAITLIST_API_URL}/waitlist/count`)
      .then((r) => r.json())
      .then((d) => {
        if (alive && typeof d?.count === "number") setCount(d.count);
      })
      .catch(() => {
        /* server not up in dev — counter stays at 0 */
      });
    return () => {
      alive = false;
    };
  }, []);

  // Choreographed swap: form out → success in, with a gold burst
  useEffect(() => {
    if (phase !== "success" && phase !== "already") return;
    const form = formRef.current;
    const success = successRef.current;
    const burst = burstRef.current;
    if (!form || !success) return;

    const ctx = gsap.context(() => {
      const tl = gsap.timeline();
      tl.to(form, {
        y: -14,
        opacity: 0,
        scale: 0.98,
        duration: 0.4,
        ease: "power2.in",
        onComplete: () => {
          form.style.display = "none";
          success.style.display = "block";
        },
      })
        .fromTo(
          success,
          { y: 26, opacity: 0, scale: 0.92 },
          { y: 0, opacity: 1, scale: 1, duration: 0.7, ease: "back.out(1.6)" },
          "-=0.15"
        )
        .fromTo(
          burst,
          { scale: 0.4, opacity: 0.9 },
          {
            scale: 2.4,
            opacity: 0,
            duration: 1.4,
            ease: "power2.out",
          },
          "-=0.55"
        );
    });
    return () => ctx.revert();
  }, [phase]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (phase === "loading" || phase === "success" || phase === "already") return;

    const trimmed = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setError("That doesn't look like a valid email.");
      setPhase("error");
      return;
    }

    // Turnstile configured but not solved? Ask for the human check first.
    if (TURNSTILE_SITE_KEY && !turnstileToken) {
      setError("Please complete the human check before reserving.");
      setPhase("error");
      return;
    }

    setPhase("loading");
    setError("");
    try {
      const res = await fetch(`${WAITLIST_API_URL}/waitlist/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: trimmed,
          name: name.trim() || undefined,
          source: "landing-page",
          website: website || undefined,
          formStart: formStartRef.current,
          turnstileToken: turnstileToken || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 429) {
          setError("That was fast! Give it a minute and try again.");
        } else {
          setError(
            data?.message || "Something went wrong — please try again."
          );
        }
        setPhase("error");
        // Let a fresh human-check pass the next attempt.
        if (TURNSTILE_SITE_KEY) {
          setTurnstileToken("");
          window.turnstile?.reset(turnstileWidgetRef.current);
        }
        return;
      }
      setPosition(typeof data?.position === "number" ? data.position : null);
      setPhase(data?.alreadyJoined ? "already" : "success");
    } catch {
      setError("Can't reach the server right now — please try again.");
      setPhase("error");
    }
  };

  return (
    <section
      id="waitlist"
      className="relative overflow-hidden py-28 sm:py-40"
    >
      {/* giant watermark — parallaxes gently while scrolling */}
      <Parallax
        speed={0.05}
        className="pointer-events-none absolute inset-0 z-0 flex items-center justify-center overflow-hidden"
      >
        <span className="headline text-outline select-none whitespace-nowrap text-[30vw] leading-none opacity-[0.13]">
          SOON
        </span>
      </Parallax>
      <div className="pointer-events-none absolute inset-0 halo" />

      <div className="relative z-10 mx-auto max-w-2xl px-6 text-center">
        <Reveal>
          <span className="u-label text-[11px] tracking-[0.22em] text-white/55">
            ( waitlist_is_open )
          </span>
        </Reveal>
        <Reveal delay={0.08}>
          <span className="script mt-5 block text-4xl text-white/85 sm:text-5xl">
            be first inside
          </span>
        </Reveal>
        <SplitWords
          as="h2"
          text="Claim"
          italic="your seat."
          className="headline mt-4 text-6xl leading-[0.95] text-white sm:text-7xl"
        />
        <Reveal delay={0.18}>
          <p className="mx-auto mt-6 max-w-sm text-sm leading-relaxed text-mist">
            Drop your email. On launch day you sign in with it and walk
            straight in — ahead of everyone else, with your people.
          </p>
        </Reveal>

        {/* live social-proof counter */}
        <Reveal delay={0.24}>
          <div className="mt-8 inline-flex items-center gap-2.5 rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-white/55 backdrop-blur-md">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber opacity-60" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-amber" />
            </span>
            <span className="font-mono text-amber">
              <CountUp value={count} className="tabular-nums" />
            </span>
            already in line
          </div>
        </Reveal>

        {/* the card */}
        <Reveal delay={0.3}>
          <div className="mx-auto mt-10 max-w-md">
            <div className="glass relative overflow-hidden rounded-2xl p-6 sm:p-7">
              {/* gold burst behind the success state */}
              <div
                ref={burstRef}
                className="pointer-events-none absolute left-1/2 top-1/2 h-56 w-56 -translate-x-1/2 -translate-y-1/2 rounded-full bg-amber/20 blur-3xl"
                style={{ opacity: 0 }}
              />

              <div ref={formRef}>
                <div className="mb-3 flex items-center justify-between">
                  <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-white/30">
                    input_email
                  </span>
                  <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-amber/50">
                    required
                  </span>
                </div>

                <form onSubmit={submit} noValidate>
                  <div className="flex flex-col gap-3">
                    {/* Honeypot — hidden from humans, irresistible to bots. */}
                    <div
                      aria-hidden="true"
                      className="pointer-events-none absolute -left-[9999px] top-auto h-px w-px overflow-hidden opacity-0"
                    >
                      <label htmlFor="wl-website">Leave this field empty</label>
                      <input
                        id="wl-website"
                        type="text"
                        name="website"
                        value={website}
                        onChange={(e) => setWebsite(e.target.value)}
                        tabIndex={-1}
                        autoComplete="off"
                        placeholder="Leave this field empty"
                      />
                    </div>
                    <div className="relative">
                      <input
                        type="text"
                        autoComplete="name"
                        value={name}
                        onChange={(e) => {
                          setName(e.target.value);
                          if (phase === "error") {
                            setPhase("idle");
                            setError("");
                          }
                        }}
                        placeholder="Your name (optional)"
                        disabled={phase === "loading"}
                        aria-label="Your name"
                        className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3.5 text-sm text-white outline-none transition-all duration-300 placeholder:text-white/25 hover:border-white/20 focus:border-amber/50 focus:bg-white/[0.05] focus:shadow-[0_0_34px_-10px_rgba(212,175,55,0.55)] disabled:opacity-50"
                      />
                    </div>
                    <div className="flex flex-col gap-3 sm:flex-row">
                      <div className="relative flex-1">
                        <input
                          type="email"
                          inputMode="email"
                          autoComplete="email"
                          value={email}
                          onChange={(e) => {
                            setEmail(e.target.value);
                            if (phase === "error") {
                              setPhase("idle");
                              setError("");
                            }
                          }}
                          placeholder="you@example.com"
                          disabled={phase === "loading"}
                          aria-label="Email address"
                          className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3.5 text-sm text-white outline-none transition-all duration-300 placeholder:text-white/25 hover:border-white/20 focus:border-amber/50 focus:bg-white/[0.05] focus:shadow-[0_0_34px_-10px_rgba(212,175,55,0.55)] disabled:opacity-50"
                        />
                      </div>
                      <Magnetic strength={0.3}>
                        <button
                          type="submit"
                          disabled={phase === "loading"}
                          className="btn btn-primary w-full whitespace-nowrap sm:w-auto"
                        >
                        {phase === "loading" ? (
                          <>
                            <Loader2 className="h-4 w-4 animate-spin" />
                            Reserving
                          </>
                        ) : (
                          <>
                            Reserve my seat
                            <ArrowRight className="h-4 w-4" />
                          </>
                        )}
                      </button>
                      </Magnetic>
                    </div>
                  </div>

                  {/* Cloudflare Turnstile human check (only when configured) */}
                  {TURNSTILE_SITE_KEY && (
                    <div className="mt-4 flex justify-center">
                      <div ref={turnstileRef} />
                    </div>
                  )}
                </form>

                {phase === "error" && (
                  <p
                    className="mt-3 text-left text-xs font-medium text-rose-300/90"
                    role="alert"
                  >
                    {error}
                  </p>
                )}

                <p className="mt-4 text-[11px] uppercase tracking-[0.18em] text-white/25">
                  no spam · no ads · your seat is saved
                </p>
              </div>

              {/* success / already-on-list state */}
              <div ref={successRef} className="relative hidden py-6">
                <PartyPopper className="mx-auto h-8 w-8 text-amber" />
                <div className="script mt-4 text-5xl text-gradient-warm">
                  {phase === "already" ? "you're set." : "you're in."}
                </div>
                {position !== null && (
                  <div className="mt-4 font-mono text-[11px] uppercase tracking-[0.24em] text-white/40">
                    seat_no ·{" "}
                    <span className="text-amber">#{position.toLocaleString()}</span>
                  </div>
                )}
                <p className="mx-auto mt-3 max-w-xs text-xs leading-relaxed text-mist">
                  {phase === "already"
                    ? "You were already on the list — we've kept your seat warm."
                    : "We'll email you the moment the door opens. Bring your people."}
                </p>
              </div>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
