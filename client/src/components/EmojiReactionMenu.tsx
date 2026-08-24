import React, {
	useState,
	useEffect,
	useRef,
	useLayoutEffect,
	lazy,
	Suspense,
} from "react";
import { createPortal } from "react-dom";
import { motion } from "motion/react";
import { Smile, SmilePlus, Plus, X as XIcon, Loader2, Trash2 } from "lucide-react";

// Full WhatsApp-style categorized emoji picker (all emojis, categories, search,
// recently-used, skin tones) — lazy-loaded so the heavy emoji dataset only
// downloads the first time the picker is opened. Forced to dark theme + native
// emoji rendering (same glyphs the OS keyboard shows).
const EmojiPicker = lazy(() =>
	import("emoji-picker-react").then((mod) => ({
		default: (props: React.ComponentProps<typeof mod.default>) =>
			// Spread props first so the forced dark theme + native emoji rendering
			// can never be overridden by a caller.
			React.createElement(mod.default, {
				...props,
				theme: mod.Theme.DARK,
				emojiStyle: mod.EmojiStyle.NATIVE,
			}),
	})),
);

// Black/white (zinc) theme for the picker, matching the app's dark UI exactly.
// Overrides every emoji-picker-react CSS variable away from its blue-ish
// defaults so the panel looks native to Orbit: SOLID zinc-900 surfaces, white
// text, white active-category icon.
// Orbit's design language: the picker's background is solid zinc-900
// (#18181b) — NO glass, NO translucency — so the panel is fully opaque and
// nothing behind it ever shows through. White-on-black hovers
// (white/5..white/10) and white/10 borders — the same treatment as the emoji
// selector menu & comment drawer. No blue, no gray fills.
const EMOJI_PICKER_THEME = {
	// Solid zinc-900 — the emoji selector must NOT have a glass/translucent
	// effect, so the panel is fully opaque and nothing shows through it.
	"--epr-bg-color": "#18181b",
	// Category labels are display:none anyway — solid zinc-900 too.
	"--epr-category-label-bg-color": "#18181b",
	// Border comes from the outer popover container (white/10), so the
	// picker's own border is hidden to avoid a doubled outline.
	"--epr-picker-border-color": "transparent",
	"--epr-text-color": "#f4f4f5", // zinc-100
	"--epr-hover-bg-color": "rgba(255,255,255,0.06)",
	"--epr-hover-bg-color-reduced-opacity": "rgba(255,255,255,0.04)",
	"--epr-focus-bg-color": "rgba(255,255,255,0.08)",
	"--epr-highlight-color": "#ffffff", // white accent, no blue
	// Search box matches the app's comment input: zinc-900/40, border-white/5,
	// zinc-900/60 + border-white/10 when focused, with the inner shadow.
	"--epr-search-input-bg-color": "rgba(24,24,27,0.4)", // zinc-900/40
	"--epr-search-input-bg-color-active": "rgba(24,24,27,0.6)", // zinc-900/60
	"--epr-search-input-text-color": "#f4f4f5",
	"--epr-search-input-placeholder-color": "#71717a", // zinc-500
	"--epr-search-border-color": "rgba(255,255,255,0.05)", // white/5
	"--epr-search-border-color-active": "rgba(255,255,255,0.1)", // white/10
	"--epr-category-icon-active-color": "#ffffff",
	"--epr-category-navigation-button-size": "18px",
	"--epr-emoji-size": "20px",
	"--epr-emoji-padding": "2px",
	"--epr-emoji-hover-color": "rgba(255,255,255,0.08)",
	"--epr-skin-tone-picker-menu-color": "#18181b",
	"--epr-skin-tone-outer-border-color": "rgba(255,255,255,0.2)",
	"--epr-skin-tone-inner-border-color": "#18181b",
	// Skin-tone dot hover/focus rings — white, never the library's blue.
	"--epr-active-skin-hover-color": "rgba(255,255,255,0.15)",
	"--epr-active-skin-tone-indicator-border-color": "rgba(255,255,255,0.6)",
	"--epr-emoji-variation-picker-bg-color": "#18181b",
	"--epr-emoji-variation-indicator-color": "rgba(255,255,255,0.2)",
	"--epr-emoji-variation-indicator-color-hover": "#e4e4e7",
	"--epr-picker-border-radius": "12px",
	"--epr-horizontal-padding": "8px",
	"--epr-header-padding": "6px 8px",
	"--epr-search-input-height": "26px",
	"--epr-search-input-padding": "0 28px",
	"--epr-search-input-border-radius": "6px",
	"--epr-category-label-height": "0px",
	"--epr-category-label-text-color": "#71717a", // zinc-500
} as React.CSSProperties;

// Emoji-grid layout constants, kept next to the theme because they must stay
// in sync with it. The library lays out emojis with repeat(auto-fill,
// fullsize), so the GRID width must be an exact multiple of the cell size
// (20px emoji + 2px padding each side = 24px) — otherwise the last column is
// partially clipped at the edge (the "cut emojis" bug). The grid sits inside
// the picker with 2 × --epr-horizontal-padding (8px each side), so
// pickerW = 16 + 24×N guarantees perfectly aligned columns.
const EMOJI_CELL = 24;
const EMOJI_GRID_PAD = 16; // 2 × --epr-horizontal-padding (8px)

// The 7 default quick reactions shown in the emoji menu (horizontal bar)
const QUICK_EMOJIS = [
	"👍",
	"❤️",
	"😂",
	"😮",
	"😢",
	"😠",
	"🎉",
];

// localStorage key for emojis the user adds to the reaction menu via "+"
const CUSTOM_EMOJIS_KEY = "orbit_comment_custom_emojis";

// Window event broadcast after a user adds a custom emoji, so every mounted
// menu refreshes its local copy of the list.
const CUSTOM_EMOJIS_CHANGED_EVENT = "commentCustomEmojisChanged";

// ─── Idle-time warm-up ─────────────────────────────────────────────
// The emoji-picker-react chunk is ~75 kB gzipped (UI + en emoji dataset).
// Instead of downloading it only when the user first opens the full picker
// (a visible wait on slow connections), warm it up at browser-idle time as
// soon as THIS module first loads — i.e. once any comment, personal chat or
// community chat renders on screen. The module cache is shared, so by the
// time the user actually opens the picker, the chunk is already
// downloaded AND parsed and the menu pops in instantly.
//
// Module-scoped + idempotent so it fires exactly once per page load no
// matter how many menu instances mount (chats render one per message).
let emojiPickerWarmupScheduled = false;
const warmupEmojiPicker = () => {
	// Never schedule real module fetches under vitest/jest — the menu is
	// rendered in tests without a bundler resolving the import.
	if (import.meta.env?.MODE === "test") return;
	if (emojiPickerWarmupScheduled) return;
	emojiPickerWarmupScheduled = true;
	// Defer to browser idle time so warming never competes with the initial
	// feed/chat paint; fall back to a short timer where rIC is unavailable.
	const fire = () => {
		import("emoji-picker-react").catch(() => {
			/* best-effort preload — the lazy() import handles real failures */
		});
	};
	if (typeof window !== "undefined" && "requestIdleCallback" in window) {
		try {
			const ric = (window as unknown as {
				requestIdleCallback: (cb: () => void, opts?: { timeout?: number }) => void;
			}).requestIdleCallback;
			ric(fire, { timeout: 2500 });
			return;
		} catch {
			/* fall through to the timer path */
		}
	}
	if (typeof window !== "undefined") {
		window.setTimeout(fire, 1500);
	}
};
// Also warm on first user interaction (pointer/keydown) as a faster trigger
// than rIC on pages where the user interacts before idle. Fires once.
const warmupOnFirstInteraction = () => {
	warmupEmojiPicker();
	window.removeEventListener("pointerdown", warmupOnFirstInteraction);
	window.removeEventListener("keydown", warmupOnFirstInteraction);
};
if (typeof window !== "undefined") {
	// Warm the picker the moment the first menu-bearing screen loads
	// (module evaluates once per page, no matter how many menus mount).
	warmupEmojiPicker();
	window.addEventListener("pointerdown", warmupOnFirstInteraction, {
		passive: true,
		capture: true,
	});
	window.addEventListener("keydown", warmupOnFirstInteraction, {
		passive: true,
		capture: true,
	});
}

// Read the persisted custom-emoji list (used at mount and on sync events)
const readCustomEmojis = (): string[] => {
	if (typeof window === "undefined") return [];
	try {
		const saved = localStorage.getItem(CUSTOM_EMOJIS_KEY);
		const parsed = saved ? JSON.parse(saved) : [];
		return Array.isArray(parsed)
			? parsed.filter((e): e is string => typeof e === "string")
			: [];
	} catch {
		return [];
	}
};

interface EmojiReactionMenuProps {
	/** Called with the chosen emoji; the menu closes itself afterwards. */
	onReact: (emoji: string) => void;
	/**
	 * Where the quick-reaction bar prefers to open relative to the trigger.
	 * "up" (comments) opens above whenever it fits; "auto" (chat bubbles)
	 * picks whichever side has more room. Both flip vertically AND
	 * horizontally as needed so the bar never gets clipped on any screen.
	 */
	direction?: "up" | "auto";
	/** Custom content for the trigger button (default: a Smile icon). */
	triggerContent?: React.ReactNode;
	/** Optional class for the trigger button. */
	triggerClassName?: string;
	ariaLabel?: string;
	title?: string;
	/**
	 * Render the quick-reaction pill ALWAYS-OPEN with no trigger button, so it
	 * can be embedded at the top of the long-press message context menu
	 * (personal + community chats). Shows the exact same options as the
	 * popover: quick reactions, custom emojis, pick-any-emoji and add-to-menu.
	 */
	inline?: boolean;
}

/**
 * The shared comment-style emoji reaction menu: a trigger button that opens a
 * quick-reaction bar (7 emojis + any user-added emojis + "pick any emoji" +
 * "+ add to menu"), plus the full WhatsApp-style emoji-picker popover. BOTH
 * are rendered in portals with viewport-flipping geometry so no scroll
 * container or comment drawer can ever clip them. Used by comments, personal
 * chat and community chat so every surface shows THE SAME menu.
 */
export default function EmojiReactionMenu({
	onReact,
	direction = "up",
	triggerContent,
	triggerClassName,
	ariaLabel = "React with an emoji",
	title = "React",
	inline = false,
}: EmojiReactionMenuProps) {
	// Quick bar open state
	const [showBar, setShowBar] = useState(false);
	// Full picker popover state: "react" = react directly, "add" = add to menu
	const [pickerOpen, setPickerOpen] = useState(false);
	const [pickerMode, setPickerMode] = useState<"react" | "add">("react");
	// Open the full picker upward when there's room above the button,
	// otherwise flip it downward so it never gets clipped by the screen.
	const [pickerOpensUp, setPickerOpensUp] = useState(true);
	// Viewport coordinates for the portal-rendered popover (position: fixed),
	// plus the picker height sized to the space actually available on screen.
	const [pickerX, setPickerX] = useState(8);
	const [pickerY, setPickerY] = useState(8);
	const [pickerWidth, setPickerWidth] = useState(336);
	const [pickerHeight, setPickerHeight] = useState(384);
	// Quick bar viewport coordinates + direction. Like the full picker, the
	// bar is portal-rendered to document.body with position:fixed so comment
	// drawers / chat scroll containers can never clip it. It flips up/down
	// (preference from `direction`, clamped by real space) and left/right
	// (right-aligns to the trigger when it would overflow the right edge).
	const [barOpensUp, setBarOpensUp] = useState(direction !== "auto");
	const [barX, setBarX] = useState(8);
	const [barY, setBarY] = useState(8);
	// Close-animation flags: the quick bar / full picker stay mounted for a
	// few frames after dismissal so they can spring OUT (matching the chat
	// message long-press menu motion) instead of vanishing instantly.
	const [closingBar, setClosingBar] = useState(false);
	const [closingPicker, setClosingPicker] = useState(false);
	const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	// Full emoji picker popover ref (outside-click dismissal)
	const fullPickerRef = useRef<HTMLDivElement>(null);
	// Menu wrapper (trigger) ref (outside-click dismissal)
	const menuRef = useRef<HTMLDivElement>(null);
	const triggerRef = useRef<HTMLButtonElement>(null);
	// Quick bar ref (outside-click dismissal + post-render measurement)
	const quickBarRef = useRef<HTMLDivElement>(null);
	// Emojis the user added to the menu via "+" (persisted per device).
	const [customEmojis, setCustomEmojis] = useState<string[]>(readCustomEmojis);

	// Measured quick-bar size, kept in a ref so scroll/geometry recalculations
	// reuse it instead of reading the DOM every time. Zero until first render.
	const barSizeRef = useRef({ w: 0, h: 0 });

	// Persist a user-added emoji so it appears in this device's reaction menu
	// (prepended so the newest addition shows first), then broadcast so every
	// mounted menu picks it up immediately.
	const addCustomEmoji = (emoji: string) => {
		setCustomEmojis((prev) => {
			if (prev.includes(emoji)) return prev;
			const next = [emoji, ...prev].slice(0, 24);
			try {
				localStorage.setItem(CUSTOM_EMOJIS_KEY, JSON.stringify(next));
			} catch {
				/* storage unavailable — non-critical */
			}
			return next;
		});
		window.dispatchEvent(new CustomEvent(CUSTOM_EMOJIS_CHANGED_EVENT));
	};

	// Remove a single user-added emoji from the menu (persisted + broadcast).
	const removeCustomEmoji = (emoji: string) => {
		setCustomEmojis((prev) => {
			const next = prev.filter((e) => e !== emoji);
			try {
				localStorage.setItem(CUSTOM_EMOJIS_KEY, JSON.stringify(next));
			} catch {
				/* storage unavailable — non-critical */
			}
			return next;
		});
		window.dispatchEvent(new CustomEvent(CUSTOM_EMOJIS_CHANGED_EVENT));
	};

	// Clear ALL user-added emojis from the menu (persisted + broadcast).
	const clearCustomEmojis = () => {
		setCustomEmojis([]);
		try {
			localStorage.setItem(CUSTOM_EMOJIS_KEY, JSON.stringify([]));
		} catch {
			/* storage unavailable — non-critical */
		}
		window.dispatchEvent(new CustomEvent(CUSTOM_EMOJIS_CHANGED_EVENT));
	};

	// Fit the quick bar to the trigger button + viewport. Horizontal: starts
	// at the trigger's left edge, but if that would push the bar past the
	// right edge (e.g. the "React" trigger mid-card on mobile) it right-aligns
	// to the trigger instead, then clamps to the viewport. Vertical: flips
	// above/below based on which side has room (comments keep "up" whenever
	// it fits).
	const computeBarGeometry = () => {
		const btn = triggerRef.current;
		if (!btn) return;
		const rect = btn.getBoundingClientRect();
		const vw = window.innerWidth;
		const vh = window.innerHeight;
		const GAP = 8;
		const { w: measuredW, h: measuredH } = barSizeRef.current;
		// Estimate before first render so the portal appears in roughly the
		// right spot; useLayoutEffect then measures and snaps it precisely.
		const estW = vw < 640 ? 272 : 300;
		const barW = measuredW > 0 ? measuredW : estW;
		const barH = measuredH > 0 ? measuredH : 48;

		const roomUp = rect.top - GAP;
		const roomDown = vh - rect.bottom - GAP;
		// "up" preference for comments whenever there's room; "auto" (chat)
		// picks the side with more room. Never leave the bar hanging off-screen.
		let up: boolean;
		if (direction === "up") up = roomUp >= GAP;
		else up = roomUp >= roomDown;
		if (up && roomUp < GAP && roomDown >= GAP) up = false;
		setBarOpensUp(up);

		// Left-align unless that overflows the right edge — then right-align
		// to the trigger, and clamp into the viewport either way.
		let x = rect.left;
		if (x + barW > vw - GAP) x = rect.right - barW;
		x = Math.min(Math.max(GAP, x), Math.max(GAP, vw - barW - GAP));
		setBarX(x);

		const y = up ? rect.top - barH - GAP : rect.bottom + GAP;
		setBarY(Math.min(Math.max(GAP, y), Math.max(GAP, vh - barH - GAP)));
	};

	// Measure the quick bar the moment it renders so it lands pixel-perfect,
	// then keep it glued to the trigger: re-fit on viewport changes and follow
	// it through any scroll. If the trigger scrolls fully off-screen, close.
	useEffect(() => {
		if (!showBar) return;
		computeBarGeometry();
		const onViewportChange = () => computeBarGeometry();
		let raf = 0;
		const onScroll = (e: Event) => {
			const bar = quickBarRef.current;
			if (bar && e.target instanceof Node && bar.contains(e.target)) {
				return;
			}
			const btn = triggerRef.current;
			if (!btn) return;
			const r = btn.getBoundingClientRect();
			const vw = window.innerWidth;
			const vh = window.innerHeight;
			const offScreen =
				r.bottom < 0 || r.top > vh || r.right < 0 || r.left > vw;
			if (offScreen) {
				setShowBar(false);
				setPickerOpen(false);
				return;
			}
			if (raf) return;
			raf = requestAnimationFrame(() => {
				raf = 0;
				computeBarGeometry();
			});
		};
		window.addEventListener("resize", onViewportChange);
		window.addEventListener("orientationchange", onViewportChange);
		window.addEventListener("scroll", onScroll, {
			capture: true,
			passive: true,
		});
		return () => {
			window.removeEventListener("resize", onViewportChange);
			window.removeEventListener("orientationchange", onViewportChange);
			window.removeEventListener("scroll", onScroll, { capture: true });
			if (raf) cancelAnimationFrame(raf);
		};
	}, [showBar]);

	// Measure the quick bar's real size after it appears (and when the custom
	// emoji list changes it), then recompute position so it's pixel-perfect.
	// Runs before paint, so the corrected placement is visible from frame one.
	useLayoutEffect(() => {
		if (!showBar) return;
		const el = quickBarRef.current;
		if (!el) return;
		const r = el.getBoundingClientRect();
		if (r.width > 0 && r.height > 0) {
			barSizeRef.current = { w: r.width, h: r.height };
			computeBarGeometry();
		}
	}, [showBar, customEmojis]);

	// Measure the trigger button and fit the picker popover to the current
	// viewport. Horizontally it stays at the trigger's spot (left-aligned).
	// Vertically it is CENTERED on the button — it extends equally above and
	// below, so it never looks like it hangs off the top or the bottom. Its
	// height is capped by whichever side of the button's center has less room.
	const computePickerGeometry = () => {
		// Inline (context-menu) mode has no trigger button — anchor the full
		// picker to the always-open pill itself.
		const btn = triggerRef.current || menuRef.current;
		if (!btn) return;
		const rect = btn.getBoundingClientRect();
		const vw = window.innerWidth;
		const vh = window.innerHeight;
		const GAP = 8;
		const HEADER_H = 44; // mode header + close button row
		const MIN_H = 200; // below this the emoji grid is unusable
		// Device-aware max width: extra compact on phones, compact on tablets,
		// roomier on desktop. Mobile is 16 + 8×24 = 208px (8 whole columns).
		const PICKER_MAX_W = vw < 640 ? 208 : vw < 1024 ? 280 : 320;
		const PICKER_MAX_H = vw < 640 ? 252 : vw < 1024 ? 336 : 400;
		// Width snapped to a WHOLE number of emoji columns + grid padding.
		const availW = Math.min(PICKER_MAX_W, vw - GAP * 2);
		const columns = Math.max(6, Math.floor((availW - EMOJI_GRID_PAD) / EMOJI_CELL));
		const pickerW = EMOJI_GRID_PAD + columns * EMOJI_CELL;
		const centerY = rect.top + rect.height / 2;
		const roomUp = centerY - GAP;
		const roomDown = vh - centerY - GAP;
		const MAX_TOTAL_H = PICKER_MAX_H + HEADER_H;
		const MIN_TOTAL_H = MIN_H + HEADER_H;
		const maxTotal = Math.min(
			MAX_TOTAL_H,
			vh - GAP * 2,
			2 * Math.min(roomUp, roomDown),
		);
		const totalH = Math.min(Math.max(MIN_TOTAL_H, maxTotal), vh - GAP * 2);
		const pickerH = Math.max(0, totalH - HEADER_H);
		setPickerOpensUp(roomUp >= roomDown);
		setPickerWidth(pickerW);
		setPickerHeight(pickerH);
		const x = Math.min(
			Math.max(GAP, rect.left),
			Math.max(GAP, vw - pickerW - GAP),
		);
		setPickerX(x);
		const y = centerY - totalH / 2;
		setPickerY(Math.min(Math.max(GAP, y), Math.max(GAP, vh - totalH - GAP)));
	};

	// While the picker is open, keep it glued to the trigger button: re-fit on
	// viewport changes and follow the button through any scroll so it never
	// detaches. If the button scrolls out of view entirely, close cleanly.
	useEffect(() => {
		if (!pickerOpen) return;
		computePickerGeometry();
		const onViewportChange = () => computePickerGeometry();
		let raf = 0;
		const onScroll = (e: Event) => {
			const popover = fullPickerRef.current;
			if (popover && e.target instanceof Node && popover.contains(e.target)) {
				return;
			}
			const btn = triggerRef.current;
			if (!btn) return;
			const r = btn.getBoundingClientRect();
			const vw = window.innerWidth;
			const vh = window.innerHeight;
			const offScreen = r.bottom < 0 || r.top > vh || r.right < 0 || r.left > vw;
			if (offScreen) {
				setPickerOpen(false);
				setShowBar(false);
				return;
			}
			if (raf) return;
			raf = requestAnimationFrame(() => {
				raf = 0;
				computePickerGeometry();
			});
		};
		window.addEventListener("resize", onViewportChange);
		window.addEventListener("orientationchange", onViewportChange);
		window.addEventListener("scroll", onScroll, {
			capture: true,
			passive: true,
		});
		return () => {
			window.removeEventListener("resize", onViewportChange);
			window.removeEventListener("orientationchange", onViewportChange);
			window.removeEventListener("scroll", onScroll, { capture: true });
			if (raf) cancelAnimationFrame(raf);
		};
	}, [pickerOpen]);

	// Open the full WhatsApp-style emoji picker ("react" = react directly,
	// "add" = add the chosen emoji to the menu). Portal-rendered to
	// document.body with position:fixed so scroll containers can never clip it.
	const openFullPicker = (mode: "react" | "add") => {
		setPickerMode(mode);
		setShowBar(false);
		setPickerOpen(true);
		computePickerGeometry();
	};

	// A reaction was chosen (quick emoji or from the full picker) — close
	// everything and hand the emoji to the caller.
	const handleReact = (emoji: string) => {
		setShowBar(false);
		setPickerOpen(false);
		onReact(emoji);
	};

	// Spring the open menu(s) out before unmounting them: keeps the mounted
	// portal alive for one short animation (150ms) then removes it.
	const animateClose = () => {
		if (showBar) setClosingBar(true);
		if (pickerOpen) setClosingPicker(true);
		if (!showBar && !pickerOpen) return;
		if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
		closeTimerRef.current = setTimeout(() => {
			setShowBar(false);
			setPickerOpen(false);
			setClosingBar(false);
			setClosingPicker(false);
		}, 200);
	};

	// Clear the close timer if the component unmounts mid-animation.
	useEffect(() => {
		return () => {
			if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
		};
	}, []);

	// Toggle the quick bar. On open, reset the measured size so geometry
	// recomputes cleanly, then position it against the current viewport.
	// On close, spring it out instead of vanishing instantly.
	const toggleBar = () => {
		if (!showBar || closingBar) {
			// Opening: cancel any pending close animation so a fast
			// re-click mid-fade reopens cleanly.
			if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
			setClosingBar(false);
			setClosingPicker(false);
			barSizeRef.current = { w: 0, h: 0 };
			computeBarGeometry();
			setShowBar(true);
		} else {
			animateClose();
		}
	};

	// Close the menus when clicking/tapping outside them (also Escape).
	// These document listeners are attached ONLY while a menu is open: in
	// chats there can be hundreds of mounted menus (one per message bubble),
	// so permanent listeners would stack up and bloat every scroll/click.
	const menuOpen = showBar || pickerOpen || closingBar || closingPicker;
	useEffect(() => {
		if (!menuOpen) return;
		const handleOutsideClick = (e: MouseEvent | TouchEvent) => {
			if (
				menuRef.current &&
				!menuRef.current.contains(e.target as Node) &&
				(!fullPickerRef.current ||
					!fullPickerRef.current.contains(e.target as Node)) &&
				(!quickBarRef.current ||
					!quickBarRef.current.contains(e.target as Node))
			) {
				animateClose();
			}
		};
		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key !== "Escape") return;
			animateClose();
		};
		document.addEventListener("mousedown", handleOutsideClick);
		document.addEventListener("touchstart", handleOutsideClick);
		document.addEventListener("keydown", handleKeyDown);
		return () => {
			document.removeEventListener("mousedown", handleOutsideClick);
			document.removeEventListener("touchstart", handleOutsideClick);
			document.removeEventListener("keydown", handleKeyDown);
		};
	}, [menuOpen]);

	// Keep the custom-emoji list in sync across every mounted menu when a
	// "+" add happens anywhere in the app.
	useEffect(() => {
		const handleCustomEmojisChanged = () =>
			setCustomEmojis(readCustomEmojis());
		window.addEventListener(
			CUSTOM_EMOJIS_CHANGED_EVENT,
			handleCustomEmojisChanged,
		);
		return () =>
			window.removeEventListener(
				CUSTOM_EMOJIS_CHANGED_EVENT,
				handleCustomEmojisChanged,
			);
	}, []);

	// Keep the picker warm even if the module-level warm-up was cancelled
	// (e.g. interaction fired before idle): opening the quick bar or the full
	// picker is the last-resort trigger. The module cache makes repeat
	// imports free, so this never re-downloads.
	useEffect(() => {
		if (showBar || pickerOpen || inline) {
			warmupEmojiPicker();
		}
	}, [showBar, pickerOpen, inline]);

	// Compact emoji buttons on phones so more fit before the row scrolls,
	// roomier on sm+. Shared by quick + custom emojis.
	const emojiBtnClass =
		"shrink-0 h-8 w-8 sm:h-9 sm:w-9 rounded-lg flex items-center justify-center text-lg sm:text-xl hover:bg-white/10 hover:scale-110 active:scale-95 transition-all cursor-pointer";

	// The quick-reaction row: emoji buttons + divider + "pick any emoji" +
	// "+ add to menu". Shared by the popover bar and the inline context-menu
	// pill so every surface shows the SAME options.
	const renderBarRow = () => (
		<div className="flex items-stretch">
			{/* Horizontally scrollable emoji row (hidden scrollbar) */}
			<div className="relative flex items-center gap-0.5 px-1.5 py-1.5 overflow-x-auto max-w-[10.5rem] sm:max-w-[12.5rem] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
				{/* User-added emojis FIRST, newest at the very front — so the most
				    recently added emoji is immediately clickable when the pill
				    opens, then the default quick emojis. (customEmojis is stored
				    newest-first by addCustomEmoji.) A tiny × in the corner removes
				    just that emoji from the menu. */}
				{customEmojis.map((emoji) => (
					<div key={emoji} className="relative shrink-0">
						<button
							onClick={(e) => {
								e.stopPropagation();
								handleReact(emoji);
							}}
							className={emojiBtnClass}
							title={`React with ${emoji}`}>
							{emoji}
						</button>
						<button
							onClick={(e) => {
								e.stopPropagation();
								removeCustomEmoji(emoji);
							}}
							className="absolute -right-0.5 -top-0.5 z-10 flex h-3.5 w-3.5 items-center justify-center rounded-full border border-white/20 bg-zinc-950 text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors cursor-pointer"
							title={`Remove ${emoji} from menu`}
							aria-label={`Remove ${emoji} from menu`}>
							<XIcon className="h-2 w-2" />
						</button>
					</div>
				))}
				{QUICK_EMOJIS.map((emoji) => (
					<button
						key={emoji}
						onClick={(e) => {
							e.stopPropagation();
							handleReact(emoji);
						}}
						className={emojiBtnClass}
						title={`React with ${emoji}`}>
						{emoji}
					</button>
				))}
				{/* Fade hint on the right edge (more emojis to scroll) */}
				<div className="pointer-events-none absolute inset-y-0 right-0 w-6 bg-gradient-to-l from-white/5 to-transparent" />
			</div>

			{/* Divider + fixed action icons */}
			<div className="w-px bg-white/10 my-1.5 shrink-0" />
			<div className="flex items-center gap-0.5 px-1.5 py-1.5 shrink-0">
				<button
					onClick={(e) => {
						e.stopPropagation();
						openFullPicker("react");
					}}
					className="h-8 w-8 sm:h-9 sm:w-9 rounded-lg flex items-center justify-center text-zinc-300 hover:bg-white/10 hover:text-white transition-colors cursor-pointer"
					title="Pick any emoji"
					aria-label="Pick any emoji">
					<SmilePlus className="h-4 w-4" />
				</button>
				<button
					onClick={(e) => {
						e.stopPropagation();
						openFullPicker("add");
					}}
					className="h-8 w-8 sm:h-9 sm:w-9 rounded-lg flex items-center justify-center text-zinc-300 hover:bg-white/10 hover:text-white transition-colors cursor-pointer"
					title="Add emoji to menu"
					aria-label="Add emoji to menu">
					<Plus className="h-4 w-4" />
				</button>
				{customEmojis.length > 0 && (
					<button
						onClick={(e) => {
							e.stopPropagation();
							clearCustomEmojis();
						}}
						className="h-8 w-8 sm:h-9 sm:w-9 rounded-lg flex items-center justify-center text-zinc-400 hover:bg-red-500/10 hover:text-red-400 transition-colors cursor-pointer"
						title="Clear all saved emojis"
						aria-label="Clear all saved emojis">
						<Trash2 className="h-4 w-4" />
					</button>
				)}
			</div>
		</div>
	);

	return (
		<div className="relative inline-flex" ref={menuRef}>
			{/* Inline (context-menu) mode: the quick-reaction pill renders
			    always-open with no trigger — embedded at the top of the
			    long-press message menu (personal + community chats). */}
			{inline ? (
				renderBarRow()
			) : (
				<>
					<button
						ref={triggerRef}
						onClick={(e) => {
							e.stopPropagation();
							toggleBar();
						}}
						onTouchStart={(e) => e.stopPropagation()}
						onContextMenu={(e) => e.stopPropagation()}
						className={
							triggerClassName ||
							"flex items-center gap-1 text-[12px] font-medium text-zinc-500 hover:text-white transition-colors cursor-pointer"
						}
						aria-haspopup="menu"
						aria-expanded={showBar || pickerOpen}
						aria-label={ariaLabel}
						title={title}
					>
						{triggerContent ?? <Smile className="h-3.5 w-3.5" />}
					</button>

			{/* Quick-reaction bar — portal-rendered to document.body with
			    position:fixed (viewport coordinates) like the full picker, so
			    comment drawers / chat scroll containers can NEVER clip it.
			    Flips above/below the trigger and left/right-aligns so it always
			    stays fully on screen. The entry pop uses the motion.div's own
			    initial->animate spring (no AnimatePresence needed for enter;
			    wrapping a createPortal() child in AnimatePresence silently
			    DROPS it in motion v12 — the bar never mounts). */}
			{typeof document !== "undefined" &&
				(showBar || closingBar) &&
				!pickerOpen &&
				createPortal(
					<motion.div
						ref={quickBarRef}
						initial={{
							opacity: 0,
							scale: 0.95,
							y: barOpensUp ? 8 : -8,
						}}
						animate={
							showBar
								? { opacity: 1, scale: 1, y: 0 }
								: { opacity: 0, scale: 0.95, y: barOpensUp ? 8 : -8 }
						}
						transition={{
							type: "spring",
							damping: 30,
							stiffness: 600,
							mass: 0.7,
						}}
						className={`fixed z-[400] overflow-hidden rounded-2xl border border-white/10 bg-zinc-900 shadow-[0_25px_65px_-15px_rgba(0,0,0,0.85)] ${
							showBar ? "" : "pointer-events-none"
						}`}
						style={{
							left: barX,
							top: barY,
							maxWidth: "calc(100vw - 1rem)",
						}}
						role="menu"
						aria-label="Quick emoji reactions"
						onClick={(e) => e.stopPropagation()}>
						{/* Orbit signature: 1px glass edge-light along the top edge
						    — same as the full picker popover. */}
						<div className="pointer-events-none absolute inset-x-0 top-0 h-[1px] bg-linear-to-r from-transparent via-white/20 to-transparent" />
						{renderBarRow()}
					</motion.div>,
					document.body,
				)}
				</>
			)}

			{/* Full WhatsApp-style emoji picker popover — portal to document.body
			    with position:fixed (viewport coordinates) so scroll containers can
			    NEVER clip it. Anchored to the trigger, flips up/down, sized to
			    the space on screen. */}
			{typeof document !== "undefined" &&
				(pickerOpen || closingPicker) &&
				createPortal(
					<motion.div
						ref={fullPickerRef}
						initial={{ opacity: 0, scale: 0.96, y: pickerOpensUp ? 8 : -8 }}
						animate={
							pickerOpen
								? { opacity: 1, scale: 1, y: 0 }
								: { opacity: 0, scale: 0.96, y: pickerOpensUp ? 8 : -8 }
						}
						transition={{ type: "spring", damping: 30, stiffness: 600, mass: 0.7 }}
						className={`orbit-emoji-picker-popover fixed z-[400] overflow-hidden rounded-2xl border border-white/10 bg-zinc-900 shadow-[0_25px_65px_-15px_rgba(0,0,0,0.85)] ${
							pickerOpen ? "" : "pointer-events-none"
						}`}
						style={{
							left: pickerX,
							top: pickerY,
							width: pickerWidth,
							maxWidth: "calc(100vw - 1rem)",
						}}
						onClick={(e) => e.stopPropagation()}>
						{/* Orbit signature: 1px glass edge-light along the top edge */}
						<div className="pointer-events-none absolute inset-x-0 top-0 h-[1px] bg-linear-to-r from-transparent via-white/20 to-transparent" />
						{/* The library renders its search icon as a fixed 20px sprite — too
							big for this compact bar. Override it with a small white
							magnifier that matches the black/white theme. */}
						<style>{`
							/* The library forces 'sans-serif' on every element inside
								.epr-main. Restore the app's Manrope stack so the picker's
								text matches the rest of the app. */
							.orbit-emoji-picker-popover .epr-main * {
								font-family: var(--font-sans);
							}
							.orbit-emoji-picker-popover .epr-icn-search {
								top: 50%;
								transform: translateY(-50%);
								left: 10px;
								width: 15px;
								height: 15px;
								background-size: 15px;
								background-position: 0 0;
								background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2371717a' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Ccircle cx='11' cy='11' r='8'/%3E%3Cpath d='m21 21-4.3-4.3'/%3E%3C/svg%3E");
							}
							.orbit-emoji-picker-popover .epr-dark-theme .epr-icn-search {
								background-position: 0 0;
							}
							/* Active category gets a CIRCULAR accent (white/10 disc) behind
								the icon instead of any blue. */
							.orbit-emoji-picker-popover .epr-cat-btn {
								border-radius: 50%;
							}
							.orbit-emoji-picker-popover .epr-cat-btn:hover,
							.orbit-emoji-picker-popover .epr-cat-btn.epr-active {
								background-color: rgba(255,255,255,0.1);
								box-shadow: 0 0 0 3px rgba(255,255,255,0.08);
							}
							/* Category labels hidden entirely */
							.orbit-emoji-picker-popover .epr-emoji-category-label {
								display: none;
							}
							/* Subtle divider between category groups */
							.orbit-emoji-picker-popover .epr-emoji-category + .epr-emoji-category {
								margin-top: 10px;
								padding-top: 8px;
								border-top: 1px solid rgba(255,255,255,0.06);
							}
							/* Search input shrunk to match the mini label scale */
							.orbit-emoji-picker-popover .epr-search-container > input {
								font-size: 10px;
								box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.25);
							}
							/* Native, instant scrolling through the emoji grid —
								scroll-behavior: smooth animates EVERY wheel/trackpad tick
								and fights momentum, which is what makes it feel laggy.
								With it off, wheel/touch scrolling is immediate and buttery;
								category jumps set scrollTop directly and stay instant too.
								Scrollbar is hidden but scrolling still works. */
							.orbit-emoji-picker-popover .epr-body {
								overflow-y: auto;
								/* Layout+paint containment: the browser skips work on emoji
									outside the visible grid while scrolling — smoother. */
								contain: content;
								scrollbar-width: none;
								-ms-overflow-style: none;
								overscroll-behavior: contain;
								-webkit-overflow-scrolling: touch;
							}
							.orbit-emoji-picker-popover .epr-body::-webkit-scrollbar {
								display: none;
							}
							/* The inline skin-tone fan defaults to a square-cornered chip that
								looks detached from the trigger dot. Restyle it as a slim,
								fully-rounded pill (the app's rounded-full language) with a
								subtle border so it reads as one connected menu. */
							.orbit-emoji-picker-popover .epr-skin-tones:not(.epr-vertical) {
								padding: 0;
								border-radius: 9999px;
								border: 1px solid rgba(255,255,255,0.1);
								transition-duration: 0.15s;
							}
							/* The fan and its dots default to a sluggish 0.3s/0.35s
								expansion — snap them to the app's snappy motion. */
							.orbit-emoji-picker-popover .epr-skin-tones:not(.epr-vertical) .epr-tone {
								transition-duration: 0.15s;
							}
							/* Skin-tone color dots: circular, not rounded squares. Each dot
								is 15px inside a 28px slot, pinned right:0 by the library — so it
								sits 6.5px off-center in its circle/pill. Pull it back 6.5px so
								every dot (and the collapsed anchor dot) is perfectly centered.
								Scoped to the horizontal fan only (the vertical variant is never
								rendered — preview is hidden — and uses different slot geometry). */
							.orbit-emoji-picker-popover .epr-skin-tones:not(.epr-vertical) .epr-tone {
								border-radius: 50%;
								right: 6.5px;
							}
						`}</style>
						{/* Header: mode label + close */}
						<div className="flex items-center justify-between gap-2 border-b border-white/10 px-3 py-2">
							<span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
								{pickerMode === "add" ? "Add to your menu" : "React with emoji"}
							</span>
							<button
							onClick={() => {
								animateClose();
							}}
								className="flex h-6 w-6 items-center justify-center rounded-md text-zinc-400 hover:bg-white/10 hover:text-white transition-colors cursor-pointer"
								aria-label="Close emoji picker">
								<XIcon className="h-3.5 w-3.5" />
							</button>
						</div>
						<Suspense
							fallback={
								<div
									className="flex w-full items-center justify-center"
									style={{ height: pickerHeight }}>
									<Loader2 className="h-6 w-6 animate-spin text-zinc-500" />
								</div>
							}>
							{/* All emojis mount at once (lazyLoadEmojis off) so scrolling never
							    reveals them one by one, just like an offline app. The picker
							    still virtualizes to the visible window, so paint stays fast. */}
							<EmojiPicker
								height={pickerHeight}
								width="100%"
								lazyLoadEmojis={false}
								previewConfig={{ showPreview: false }}
								searchPlaceholder="Search emojis…"
								onEmojiClick={(emojiData) => {
									const emoji = emojiData.emoji;
									if (pickerMode === "add") {
										addCustomEmoji(emoji);
									} else {
										handleReact(emoji);
									}
									setPickerOpen(false);
								}}
								style={EMOJI_PICKER_THEME}
							/>
						</Suspense>
					</motion.div>,
					document.body,
				)}
		</div>
	);
}
