import { BadgeCheck } from "lucide-react";

interface VerifiedBadgeProps {
	className?: string;
	iconClassName?: string;
}

/**
 * Gold verified checkmark — the app's signature aurora/gold accent, kept
 * deliberately away from X/Instagram blue. Rendered next to a user's name
 * when their account has been verified by an admin. Accepts size overrides
 * via className so it can scale to every surface (profile header, feed
 * cards, comments, chat bubbles).
 */
export default function VerifiedBadge({
	className = "",
	iconClassName = "",
}: VerifiedBadgeProps) {
	return (
		<span
			className={`inline-flex items-center justify-center ${className}`}
			title="Verified account"
			aria-label="Verified account"
			role="img"
		>
			<BadgeCheck className={`text-amber-400 ${iconClassName}`} strokeWidth={2.5} />
		</span>
	);
}
