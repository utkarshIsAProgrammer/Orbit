import { useRef } from "react";
import { BellOff, PhoneMissed } from "lucide-react";
import UserAvatar from "./UserAvatar";
import DayOneFlair from "./DayOneFlair";
import ConversationLastMessage from "./ConversationLastMessage";
import type { User as UserType, Conversation } from "../types";

interface ConversationListItemProps {
	conv: Conversation;
	user: UserType;
	onSelect: () => void;
	/** Opens the mute/delete context menu at the given screen position. */
	onOpenMenu: (e: { clientX: number; clientY: number }, conv: Conversation) => void;
	formatMessageTime: (iso: string) => string;
}

const LONG_PRESS_MS = 500;

export default function ConversationListItem({
	conv,
	user,
	onSelect,
	onOpenMenu,
	formatMessageTime,
}: ConversationListItemProps) {
	const partner =
		conv.participants.find((p) => p && p._id !== user._id) || user;
	// WhatsApp-style "Message yourself" chat — the partner IS the user. The
	// server flags it with isSelfChat so we render the friendly label instead
	// of the user's own name as if chatting with a stranger.
	const isSelfChat =
		(conv as any).isSelfChat ||
		((conv.participants?.length || 0) > 1 &&
			conv.participants.every((p) => p && p._id === user._id));
	const presence: "online" | "offline" = conv.presence || "offline";
	const unread = conv.unreadCounts?.[user._id] || 0;
	const isMuted = !!conv.muted;
	// Red missed-call badge — only the callee (missedCall.for === me) sees it.
	const hasMissedCall =
		!!conv.missedCall && conv.missedCall.for === user._id;

	// Long-press (mobile) — 500ms hold opens the menu, same feel as messages.
	const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const suppressClickRef = useRef(false);

	const clearLongPress = () => {
		if (longPressTimerRef.current) {
			clearTimeout(longPressTimerRef.current);
			longPressTimerRef.current = null;
		}
	};

	const handleTouchStart = (e: React.TouchEvent) => {
		clearLongPress();
		suppressClickRef.current = false;
		const touch = e.touches[0];
		if (!touch) return;
		longPressTimerRef.current = setTimeout(() => {
			suppressClickRef.current = true;
			onOpenMenu({ clientX: touch.clientX, clientY: touch.clientY }, conv);
		}, LONG_PRESS_MS);
	};

	const handleTouchMove = () => {
		// Scrolling cancels the hold
		clearLongPress();
	};

	const handleTouchEnd = () => {
		clearLongPress();
	};

	const handleClick = () => {
		if (suppressClickRef.current) {
			suppressClickRef.current = false;
			return;
		}
		onSelect();
	};

	return (
		<div
			onClick={handleClick}
			onContextMenu={(e) => {
				e.preventDefault();
				onOpenMenu({ clientX: e.clientX, clientY: e.clientY }, conv);
			}}
			onTouchStart={handleTouchStart}
			onTouchMove={handleTouchMove}
			onTouchEnd={handleTouchEnd}
			className="flex items-center gap-3 rounded-2xl p-2.5 cursor-pointer transition-all border hover:bg-zinc-900/30 text-zinc-300 border-transparent select-none"
		>
			<div className="relative shrink-0">
				<UserAvatar
					src={partner.profilePic?.url}
					alt={partner.fullName}
					perkRing={!!(partner as any).waitlistPerk}
					className="h-9 w-9 rounded-full object-cover border border-zinc-800"
				/>
				{presence === "online" && (
					<span className="absolute bottom-0 right-0 h-3 w-3 rounded-full bg-green-500 border-2 border-zinc-950 shadow-md" />
				)}
			</div>

			<div className="flex-1 min-w-0 text-left">
				<div className="flex justify-between items-start gap-1">
					<span className="flex items-center gap-1 min-w-0">
						<span className="text-[12px] font-black leading-tight truncate min-w-0 text-zinc-100 uppercase tracking-wide">
							{isSelfChat ? "Message yourself" : partner.fullName}
						</span>
						{!isSelfChat && (partner as any).waitlistPerk && <DayOneFlair />}
					</span>
					<div className="flex items-center gap-1 shrink-0 mt-0.5">
						{isMuted && (
							<BellOff
								className="h-3 w-3 text-zinc-500"
								aria-label="Chat muted"
							/>
						)}
						{conv.lastMessage && (
							<span className="text-[8.5px] font-mono text-zinc-500">
								{formatMessageTime(conv.lastMessage.createdAt)}
							</span>
						)}
					</div>
				</div>
				<div className="flex justify-between items-center gap-2 mt-1">
					<p className="text-[11px] truncate leading-tight flex-1 text-zinc-400">
						<ConversationLastMessage
							lastMessage={conv.lastMessage}
							lastAction={conv.lastAction}
							currentUserId={user._id}
						/>
					</p>
					{hasMissedCall && (
						<span
							title="Missed call"
							aria-label="Missed call"
							className="h-4.5 w-4.5 rounded-full bg-red-500 text-white flex items-center justify-center shadow-sm border border-red-400/60 shrink-0">
							<PhoneMissed className="h-2.5 w-2.5" strokeWidth={3} />
						</span>
					)}
					{unread > 0 && (
						<span className="h-4.5 min-w-4.5 px-1 rounded-full bg-white text-[9px] font-extrabold text-black flex items-center justify-center shadow-sm border border-zinc-200 shrink-0">
							{unread}
						</span>
					)}
				</div>
			</div>
		</div>
	);
}

// swipe left reveals delete button; swipe right to archive

// search bar filters conversations by participant name
