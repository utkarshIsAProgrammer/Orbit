/**
 * Scroll a message into view and "pop" its bubble.
 *
 * Used by the pinned-message banners, the "view all pinned" jumps and the
 * reply-to quote jump — everywhere a message needs to be brought into focus.
 * Only the bubble itself animates (a quick scale bounce via the
 * `.msg-pinned-highlight` class): the avatar column, reactions and other row
 * furniture stay completely untouched, and no outline/ring is drawn.
 *
 * Returns false when the message isn't in the current loaded list so callers
 * can surface a fallback ("scroll up to find it") instead of failing silently.
 */
export const popMessageBubble = (messageId: string): boolean => {
	const row = document.getElementById(`msg-${messageId}`);
	const bubble = row?.querySelector('[data-msg-bubble="true"]');
	if (!row || !bubble) return false;

	row.scrollIntoView({ behavior: "smooth", block: "center" });
	bubble.classList.add("msg-pinned-highlight");
	// Drop the class as soon as the pop finishes so rapid re-clicks replay it
	// (re-adding an already-present class would restart nothing). Bound to the
	// actual animation instead of a hardcoded timeout so the util never drifts
	// from the CSS duration.
	const remove = () => bubble.classList.remove("msg-pinned-highlight");
	bubble.addEventListener("animationend", remove, { once: true });

	return true;
};
