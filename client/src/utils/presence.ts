/**
 * WhatsApp-style presence line for a chat partner.
 * - Online → "Active now"
 * - Offline with a known stamp → humanized "Last seen …" (just now / Xm ago /
 *   Xh ago / yesterday / Xd ago / date)
 * - Offline without a stamp (fresh user, no session yet) → plain "Offline"
 */
export function formatPresence(
	presence: "online" | "offline" | undefined,
	lastSeenAt?: number,
): string {
	if (presence === "online") return "Active now";
	if (!lastSeenAt || lastSeenAt <= 0) return "Offline";

	const diffMs = Date.now() - lastSeenAt;
	if (diffMs < 0) return "Offline"; // clock skew — don't invent the future
	const mins = Math.floor(diffMs / 60000);
	if (mins < 1) return "Last seen just now";
	if (mins < 60) return `Last seen ${mins}m ago`;

	const hours = Math.floor(mins / 60);
	if (hours < 24) return `Last seen ${hours}h ago`;

	const days = Math.floor(hours / 24);
	if (days === 1) return "Last seen yesterday";
	if (days < 7) return `Last seen ${days}d ago`;

	return `Last seen ${new Date(lastSeenAt).toLocaleDateString("en-US", {
		day: "numeric",
		month: "short",
	})}`;
}
