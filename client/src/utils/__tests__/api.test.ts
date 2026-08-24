// @vitest-environment jsdom
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "../api";

describe("apiFetch", () => {
	const fetchMock = vi.fn();

	beforeEach(() => {
		vi.stubGlobal("fetch", fetchMock);
		fetchMock.mockReset();
		Object.defineProperty(window, "localStorage", {
			value: {
				getItem: vi.fn((key: string) =>
					key === "orbit_jwt_token" ? null : null,
				),
				setItem: vi.fn(),
				removeItem: vi.fn(),
				clear: vi.fn(),
			},
			configurable: true,
		});
		document.cookie = "csrf-token=test-token";
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("does not send a bearer token from localStorage for authenticated requests", async () => {
		localStorage.setItem("orbit_jwt_token", "stolen-token");
		fetchMock.mockResolvedValue(
			new Response(JSON.stringify({ success: true }), { status: 200 }),
		);

		await apiFetch("/api/auth/me", { method: "GET" });

		const [, init] = fetchMock.mock.calls[0];
		expect(init?.headers).not.toMatchObject({
			Authorization: "Bearer stolen-token",
		});
	});

	it("dispatches an auth-expired event when the server rejects the session", async () => {
		const authExpiredHandler = vi.fn();
		window.addEventListener("auth:expired", authExpiredHandler);
		fetchMock.mockResolvedValue(
			new Response(JSON.stringify({ message: "expired" }), {
				status: 401,
			}),
		);

		await apiFetch("/api/auth/me", { method: "GET" });

		expect(authExpiredHandler).toHaveBeenCalledTimes(1);
	});
});
