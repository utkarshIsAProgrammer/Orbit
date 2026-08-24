import React from "react";
import { Phone, Video, PhoneMissed, PhoneOff } from "lucide-react";
import { formatCallDuration } from "../utils/format";

interface CallSystemMessageProps {
	system: "call_started" | "call_ended" | "call_missed";
	callType?: "audio" | "video" | null;
	callDuration?: number;
	createdAt: string;
	/** First name / username of the message sender (used in communities). */
	actorName?: string;
	/** Whether the sender is the current user (1:1 chats say "You called"). */
	isMe?: boolean;
	showDateSeparator?: boolean;
	dateSeparatorText?: string;
	formatMessageTime?: (t: string) => string;
}

/**
 * Centered system chip for call events ("Voice call started", "Call ended
 * (12m 30s)", "Missed video call") — the WhatsApp-style line that sits in
 * the timeline instead of a message bubble.
 */
const CallSystemMessage = React.memo(function CallSystemMessage({
	system,
	callType,
	callDuration,
	createdAt,
	actorName,
	isMe,
	showDateSeparator = false,
	dateSeparatorText = "",
	formatMessageTime,
}: CallSystemMessageProps) {
	const isVideo = callType === "video";

	const Icon =
		system === "call_missed"
			? PhoneMissed
			: system === "call_ended"
				? PhoneOff
				: isVideo
					? Video
					: Phone;

	const title = (() => {
		if (system === "call_ended") {
			return `${isVideo ? "Video" : "Voice"} call ended`;
		}
		if (system === "call_started") {
			// "You started a voice call" (self) · "Alex started a voice call"
			// (communities) · 1:1: "You called" / "Incoming call".
			if (isMe) {
				return actorName
					? `You started a ${isVideo ? "video" : "voice"} call`
					: "You called";
			}
			if (actorName) {
				return `${actorName} started a ${isVideo ? "video" : "voice"} call`;
			}
			return "Incoming call";
		}
		return `${isVideo ? "Video" : "Voice"} call missed`;
	})();

	const time = formatMessageTime
		? formatMessageTime(createdAt)
		: new Date(createdAt).toLocaleTimeString([], {
				hour: "2-digit",
				minute: "2-digit",
			});

	return (
		<div className="w-full flex flex-col items-center select-none">
			{showDateSeparator && (
				<div className="flex justify-center my-3.5 select-none">
					<span className="bg-zinc-900/60 border border-zinc-800/80 text-zinc-400 text-[10px] px-2.5 py-0.5 rounded-full font-bold shadow-sm uppercase tracking-wide">
						{dateSeparatorText}
					</span>
				</div>
			)}

			<div className="flex items-center gap-1.5 my-1.5 px-3 py-1.5 rounded-full bg-zinc-900/60 border border-zinc-800/80 max-w-[85%]">
				<Icon className="h-3.5 w-3.5 text-zinc-400 shrink-0" />
				<span className="text-[11px] font-semibold text-zinc-400">
					{title}
					{system === "call_ended" &&
						callDuration !== undefined &&
						callDuration > 0 &&
						` (${formatCallDuration(callDuration)})`}
				</span>
				<span className="text-[9px] text-zinc-600 font-mono shrink-0">
					{time}
				</span>
			</div>
		</div>
	);
});

export default CallSystemMessage;
