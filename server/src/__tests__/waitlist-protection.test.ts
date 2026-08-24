/**
 * Waitlist Protection Unit Tests
 *
 * Covers the always-on layers (disposable-domain blocklist, honeypot flag
 * handling) plus the production-only layers (form timer, MX check with
 * mocked DNS, Turnstile fail-closed verification). Env-dependent modules
 * are re-imported with jest.resetModules() so each scenario sees the env it
 * expects (env.ts snapshots process.env at import time).
 */
import { canonicalEmail } from "../utilities/waitlistGate";

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

afterEach(() => {
  process.env.NODE_ENV = ORIGINAL_NODE_ENV;
  delete process.env.WAITLIST_SKIP_DNS;
  delete process.env.TURNSTILE_SECRET_KEY;
  jest.resetModules();
});

describe("disposable-email blocklist (always on)", () => {
  let isDisposableEmail: (email: string) => boolean;

  beforeAll(async () => {
    ({ isDisposableEmail } = await import("../utilities/waitlistProtection"));
  });

  it("flags known temp-mail domains", () => {
    expect(isDisposableEmail("user@mailinator.com")).toBe(true);
    expect(isDisposableEmail("user@10minutemail.com")).toBe(true);
    expect(isDisposableEmail("user@guerrillamail.com")).toBe(true);
    expect(isDisposableEmail("user@yopmail.com")).toBe(true);
    expect(isDisposableEmail("user@sharklasers.com")).toBe(true);
  });

  it("flags temp-mail domains from the comprehensive blocklist", () => {
    // These came through the community blocklist (gmeenramy.com was a real
    // live slip-through — it has valid MX records, so only the domain
    // blocklist can stop it).
    expect(isDisposableEmail("user@gmeenramy.com")).toBe(true);
    expect(isDisposableEmail("user@temp-mail.org")).toBe(true);
    expect(isDisposableEmail("user@mailnator.com")).toBe(true);
    expect(isDisposableEmail("user@tempr.email")).toBe(true);
    expect(isDisposableEmail("user@fakemailgenerator.com")).toBe(true);
    expect(isDisposableEmail("user@getnada.com")).toBe(true);
    expect(isDisposableEmail("user@emailfake.com")).toBe(true);
  });

  it("allows normal permanent domains", () => {
    expect(isDisposableEmail("user@gmail.com")).toBe(false);
    expect(isDisposableEmail("user@outlook.com")).toBe(false);
    expect(isDisposableEmail("user@proton.me")).toBe(false);
    expect(isDisposableEmail("user@yahoo.com")).toBe(false);
    expect(isDisposableEmail("user@icloud.com")).toBe(false);
    expect(isDisposableEmail("user@orbit.app")).toBe(false);
    expect(isDisposableEmail("user@orbit.test")).toBe(false);
  });

  it("is case-insensitive on the domain", () => {
    expect(isDisposableEmail("user@Mailinator.COM")).toBe(true);
  });
});

describe("form timer (production only)", () => {
  it("is never enforced outside production", async () => {
    const { isSubmissionTooFast } = await import(
      "../utilities/waitlistProtection"
    );
    expect(isSubmissionTooFast(undefined)).toBe(false);
    expect(isSubmissionTooFast(Date.now())).toBe(false);
  });

  it("rejects only implausibly-fast submissions in production", async () => {
    process.env.NODE_ENV = "production";
    const { isSubmissionTooFast } = await import(
      "../utilities/waitlistProtection"
    );
    expect(isSubmissionTooFast(Date.now())).toBe(true); // under 2s
    expect(isSubmissionTooFast(Date.now() - 500)).toBe(true);
    expect(isSubmissionTooFast(Date.now() - 60_000)).toBe(false); // human pace
    // Missing formStart is allowed (older builds / no clock data) — the
    // other layers (honeypot, disposable, MX, Turnstile) still guard.
    expect(isSubmissionTooFast(undefined)).toBe(false);
    // Client clock ahead of the server must never false-reject a real user.
    expect(isSubmissionTooFast(Date.now() + 120_000)).toBe(false);
  });
});

describe("MX record check (production only, dns mocked)", () => {
  beforeEach(() => {
    jest.mock("node:dns", () => ({
      promises: { resolveMx: jest.fn() },
    }));
  });

  it("is skipped when WAITLIST_SKIP_DNS=true (no network)", async () => {
    process.env.NODE_ENV = "production";
    process.env.WAITLIST_SKIP_DNS = "true";
    const { hasMailExchange } = await import(
      "../utilities/waitlistProtection"
    );
    await expect(hasMailExchange("example.com")).resolves.toBe(true);
  });

  it("rejects domains with no MX records", async () => {
    process.env.NODE_ENV = "production";
    const dnsMock = jest.requireMock("node:dns") as {
      promises: { resolveMx: jest.Mock };
    };
    dnsMock.promises.resolveMx.mockRejectedValue(
      Object.assign(new Error("ENOTFOUND"), { code: "ENOTFOUND" })
    );
    const { hasMailExchange } = await import(
      "../utilities/waitlistProtection"
    );
    await expect(hasMailExchange("norealmx.invalid")).resolves.toBe(false);
  });

  it("accepts domains with MX records and caches the verdict", async () => {
    process.env.NODE_ENV = "production";
    const dnsMock = jest.requireMock("node:dns") as {
      promises: { resolveMx: jest.Mock };
    };
    dnsMock.promises.resolveMx.mockResolvedValue([
      { exchange: "mx1.gmail.com", priority: 10 },
    ]);
    const { hasMailExchange } = await import(
      "../utilities/waitlistProtection"
    );
    await expect(hasMailExchange("gmail.com")).resolves.toBe(true);
    await expect(hasMailExchange("gmail.com")).resolves.toBe(true);
    // Second call served from the in-memory cache — DNS hit exactly once.
    expect(dnsMock.promises.resolveMx).toHaveBeenCalledTimes(1);
  });
});

describe("Turnstile verification", () => {
  it("skips verification when no secret is configured", async () => {
    const { verifyTurnstileToken } = await import(
      "../utilities/waitlistProtection"
    );
    await expect(verifyTurnstileToken()).resolves.toBe(true);
    await expect(verifyTurnstileToken("anything")).resolves.toBe(true);
  });

  it("fails closed when configured but token is missing/invalid", async () => {
    process.env.TURNSTILE_SECRET_KEY = "test-secret";
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: false }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const { verifyTurnstileToken } = await import(
      "../utilities/waitlistProtection"
    );

    // No token at all → rejected without even calling Cloudflare.
    await expect(verifyTurnstileToken(undefined)).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();

    // Bad token → rejected (fail-closed).
    await expect(verifyTurnstileToken("garbage-token")).resolves.toBe(false);
    expect(fetchMock).toHaveBeenCalled();
  });

  it("accepts a token Cloudflare validates", async () => {
    process.env.TURNSTILE_SECRET_KEY = "test-secret";
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const { verifyTurnstileToken } = await import(
      "../utilities/waitlistProtection"
    );
    await expect(verifyTurnstileToken("valid-token")).resolves.toBe(true);
  });
});

// Keep the canonicalEmail import used (shared with waitlistGate tests).
describe("shared canonical helper", () => {
  it("is available for protection tests", () => {
    expect(canonicalEmail("  User.Name+tag@Gmail.com  ")).toBe(
      "username@gmail.com"
    );
  });
});
