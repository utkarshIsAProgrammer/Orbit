import { useLayoutEffect, type RefObject } from "react";

/**
 * The actually-visible viewport region, in layout-viewport coordinates.
 *
 * `window.innerHeight` is unreliable on mobile: with the on-screen keyboard
 * open or dynamic browser toolbars, it reports MORE than the user can see, so
 * a `position: fixed` menu clamped to `innerHeight` still renders below the
 * fold and gets visually cut off. The Visual Viewport API gives the true
 * visible bounds (offsetTop/offsetLeft are where the visible region starts
 * within the layout viewport, which is the coordinate space `fixed` uses).
 */
export const getVisibleViewport = (): {
	left: number;
	top: number;
	width: number;
	height: number;
} => {
	const vv = window.visualViewport;
	if (vv) {
		return {
			left: vv.offsetLeft,
			top: vv.offsetTop,
			width: vv.width,
			height: vv.height,
		};
	}
	return {
		left: 0,
		top: 0,
		width: document.documentElement.clientWidth,
		height: window.innerHeight,
	};
};

/**
 * Clamp a `position: fixed` menu element fully inside the visible viewport.
 * Returns the corrected { left, top } in px — apply via el.style.left/top.
 * Measures the element's ACTUAL rendered size, so menus that are taller than
 * any open-time height estimate (extra items, translations, big fonts) are
 * clamped correctly instead of being cut off at the bottom.
 */
export const clampFixedMenuToViewport = (
	el: HTMLElement,
	margin = 12,
): { left: number; top: number } => {
	const rect = el.getBoundingClientRect();
	const vp = getVisibleViewport();
	let left = rect.left;
	let top = rect.top;
	// Right / bottom overflow — pull back so the whole menu is visible.
	if (rect.right + margin > vp.left + vp.width) {
		left = vp.left + vp.width - rect.width - margin;
	}
	if (rect.bottom + margin > vp.top + vp.height) {
		top = vp.top + vp.height - rect.height - margin;
	}
	// Left / top overflow — never tuck under a toolbar either.
	if (rect.left < vp.left + margin) {
		left = vp.left + margin;
	}
	if (rect.top < vp.top + margin) {
		top = vp.top + margin;
	}
	// Guard against negative positions when the menu is larger than the
	// viewport itself (extreme zoom / tiny screens): anchor to the top-left.
	if (left < vp.left) left = vp.left + margin;
	if (top < vp.top) top = vp.top + margin;
	return { left, top };
};

/**
 * Hook: after a context menu mounts (or its open-state changes), measure it
 * and clamp it fully inside the visible viewport. Runs in useLayoutEffect —
 * before paint — so the user never sees the uncorrected position.
 */
export const useMenuViewportClamp = (
	ref: RefObject<HTMLElement | null>,
	open: unknown,
) => {
	useLayoutEffect(() => {
		const el = ref.current;
		if (!el || !open) return;
		const { left, top } = clampFixedMenuToViewport(el);
		el.style.left = `${left}px`;
		el.style.top = `${top}px`;
	}, [ref, open]);
};
