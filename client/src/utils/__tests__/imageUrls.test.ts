import { describe, expect, it } from "vitest";
import { optimizeImageUrl } from "../imageUrls";

describe("optimizeImageUrl", () => {
	it("returns empty string for falsy input", () => {
		expect(optimizeImageUrl(null)).toBe("");
		expect(optimizeImageUrl(undefined)).toBe("");
		expect(optimizeImageUrl("")).toBe("");
	});

	it("passes through non-Cloudinary URLs untouched", () => {
		const url = "https://example.com/image.png";
		expect(optimizeImageUrl(url, 200)).toBe(url);
	});

	it("leaves animated GIFs at original resolution", () => {
		const gif = "https://res.cloudinary.com/demo/image/upload/v123/anim.gif";
		expect(optimizeImageUrl(gif, 96)).toBe(gif);
	});

	it("appends a width/quality/format transform to a raw URL (version segment)", () => {
		const raw = "https://res.cloudinary.com/demo/image/upload/v123/chat/photo.jpg";
		expect(optimizeImageUrl(raw, 800)).toBe(
			"https://res.cloudinary.com/demo/image/upload/w_800,q_auto,f_auto/v123/chat/photo.jpg",
		);
	});

	it("appends a transform to a version-less raw URL", () => {
		const raw = "https://res.cloudinary.com/demo/image/upload/photo.jpg";
		expect(optimizeImageUrl(raw, 96)).toBe(
			"https://res.cloudinary.com/demo/image/upload/w_96,q_auto,f_auto/photo.jpg",
		);
	});

	it("does NOT double-transform a baked URL — swaps the existing width instead", () => {
		const baked =
			"https://res.cloudinary.com/demo/image/upload/c_limit,w_1200,q_auto,f_auto/v123/avatar.jpg";
		expect(optimizeImageUrl(baked, 96)).toBe(
			"https://res.cloudinary.com/demo/image/upload/c_limit,w_96,q_auto,f_auto/v123/avatar.jpg",
		);
	});

	it("adds a width to a baked URL that has transforms but no width", () => {
		const baked =
			"https://res.cloudinary.com/demo/image/upload/q_auto,f_auto/v123/photo.jpg";
		expect(optimizeImageUrl(baked, 400)).toBe(
			"https://res.cloudinary.com/demo/image/upload/q_auto,f_auto,w_400/v123/photo.jpg",
		);
	});

	it("defaults to 96px width when not specified", () => {
		const raw = "https://res.cloudinary.com/demo/image/upload/v123/a.png";
		expect(optimizeImageUrl(raw)).toBe(
			"https://res.cloudinary.com/demo/image/upload/w_96,q_auto,f_auto/v123/a.png",
		);
	});
});
