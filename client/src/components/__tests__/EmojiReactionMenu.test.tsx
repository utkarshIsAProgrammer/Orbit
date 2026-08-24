import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import EmojiReactionMenu from "../EmojiReactionMenu";

afterEach(() => {
	cleanup();
	document.body.innerHTML = "";
	localStorage.clear();
	vi.useRealTimers();
});

describe("EmojiReactionMenu trigger → bar", () => {
	it("opens the quick bar when the trigger is clicked", () => {
		const onReact = vi.fn();
		render(
			<EmojiReactionMenu
				onReact={onReact}
				direction="up"
				triggerContent={<>Smile icon</>}
				ariaLabel="React to this comment"
			/>,
		);

		const trigger = screen.getByRole("button", {
			name: "React to this comment",
		});
		expect(trigger).toBeTruthy();

		fireEvent.click(trigger);

		const bar = document.querySelector('[role="menu"]');
		expect(bar, "quick bar should render in document.body").toBeTruthy();
		expect(document.body.textContent || "").toContain("👍");

		const thumbsUp = Array.from(
			document.body.querySelectorAll("button"),
		).find((b) => b.textContent === "👍");
		expect(thumbsUp, "thumbs-up button should exist").toBeTruthy();
		fireEvent.click(thumbsUp as HTMLButtonElement);
		expect(onReact).toHaveBeenCalledWith("👍");

		// Bar closes after picking an emoji
		expect(document.querySelector('[role="menu"]')).toBeNull();
	});

	it("renders user-added emojis first, newest at the front", () => {
		// Pre-seed the persisted custom-emoji list (newest-first as
		// addCustomEmoji stores it): 🔥 was added last, ✨ before it.
		localStorage.setItem(
			"orbit_comment_custom_emojis",
			JSON.stringify(["🔥", "✨"]),
		);
		render(<EmojiReactionMenu onReact={vi.fn()} />);
		const trigger = screen.getByRole("button", {
			name: "React with an emoji",
		});
		fireEvent.click(trigger);

		const emojis = Array.from(
			document.querySelectorAll('[role="menu"] button'),
		)
			.map((b) => b.textContent?.trim())
			// The custom-emoji remove (×) buttons render an SVG icon with no
			// text — drop them so only actual emoji buttons are compared.
			.filter((t): t is string => Boolean(t));

		// Newest added emoji at the very front, then the older custom emoji,
		// then the default quick emojis.
		expect(emojis[0]).toBe("🔥");
		expect(emojis[1]).toBe("✨");
		expect(emojis.indexOf("🔥")).toBeLessThan(emojis.indexOf("👍"));
		expect(emojis.indexOf("✨")).toBeLessThan(emojis.indexOf("👍"));
		expect(emojis).toContain("👍");
	});

	it("toggle closes and reopens the bar", () => {
		vi.useFakeTimers();
		render(<EmojiReactionMenu onReact={vi.fn()} />);
		const trigger = screen.getByRole("button", {
			name: "React with an emoji",
		});
		fireEvent.click(trigger);
		expect(document.querySelector('[role="menu"]')).toBeTruthy();
		fireEvent.click(trigger);
		// The closing animation springs the bar out over ~200ms before the
		// portal unmounts — advance past it, then it should be gone.
		expect(document.querySelector('[role="menu"]')).toBeTruthy();
		act(() => {
			vi.advanceTimersByTime(250);
		});
		expect(document.querySelector('[role="menu"]')).toBeNull();
		fireEvent.click(trigger);
		expect(document.querySelector('[role="menu"]')).toBeTruthy();
	});
});
