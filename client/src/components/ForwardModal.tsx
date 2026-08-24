import React, { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "motion/react";
import { X, Loader2, Search, Hash, UserPlus } from "lucide-react";
import { Conversation } from "../types";
import { apiFetch } from "../utils/api";
import { logger } from "../utils/logger";

export interface ForwardPartner {
	_id: string;
	fullName?: string;
	username?: string;
	profilePic?: { url?: string };
	/** "community" when this target is a community chat, not a DM partner. */
	type?: "user" | "community";
}

interface ForwardModalProps {
	open: boolean;
	onClose: () => void;
	/** e.g. "Forward post" / "Forward comment" / "Forward profile" */
	title: string;
	/** Small preview line under the title (post title, comment content…). */
	subtitle?: React.ReactNode;
	/** Current user id — used to find the partner in each conversation. */
	myUserId?: string;
	/**
	 * When true, also lists the user's communities as forward targets
	 * (posts → community chat). The parent decides what each `type` means.
	 */
	includeCommunities?: boolean;
	/**
	 * Called with every selected partner. The parent is responsible for the
	 * actual sends and the success/error toasts. Return true to close the
	 * modal; return false to keep it open (e.g. everything failed).
	 */
	onForward: (partners: ForwardPartner[]) => Promise<boolean>;
}

/**
 * Reusable "forward to a chat" people picker used by posts, comments and
 * profiles — mirrors the message-forward UX exactly: multi-select checkbox
 * rows (max 5), a content preview, and a white "Send (N/5)" confirm button.
 * Mobile gets a slide-up bottom sheet; larger screens get a centered modal.
 * Portal-rendered with fixed positioning so it can never be clipped.
 */
export default function ForwardModal({
	open,
	onClose,
	title,
	subtitle,
	myUserId,
	includeCommunities = false,
	onForward,
}: ForwardModalProps) {
	const [conversations, setConversations] = useState<Conversation[]>([]);
	const [communities, setCommunities] = useState<ForwardPartner[]>([]);
	// Any-user search (WhatsApp/Instagram style): lets you forward to people
	// you've never chatted with — the server creates the conversation on send.
	const [userResults, setUserResults] = useState<ForwardPartner[]>([]);
	const [searchingUsers, setSearchingUsers] = useState(false);
	const [loading, setLoading] = useState(false);
	const [sending, setSending] = useState(false);
	const [search, setSearch] = useState("");
	const [selectedIds, setSelectedIds] = useState<string[]>([]);
	const [isMobile, setIsMobile] = useState(() => window.innerWidth < 614);

	useEffect(() => {
		const handleResize = () => setIsMobile(window.innerWidth < 614);
		window.addEventListener("resize", handleResize);
		return () => window.removeEventListener("resize", handleResize);
	}, []);

	useEffect(() => {
		if (!open) return;
		setConversations([]);
		setCommunities([]);
		setUserResults([]);
		setSearch("");
		setSelectedIds([]);
		setLoading(true);
		Promise.all([
			apiFetch("/api/chats/conversations").then((res) => res.json()),
			includeCommunities
				? apiFetch("/api/communities/mine").then((res) => res.json())
				: Promise.resolve(null),
		])
			.then(([chatData, commData]) => {
				if (chatData?.success) {
					setConversations(chatData.conversations || []);
				}
				if (includeCommunities && commData?.success) {
					setCommunities(
						(commData.communities || []).map((c: any) => ({
							_id: c._id,
							fullName: c.name,
							username: c.name,
							// Community avatar can be a plain string URL or a
							// CloudinaryImage object — normalize both.
							profilePic: c.image
								? typeof c.image === "string"
									? { url: c.image }
									: { url: c.image?.url }
								: undefined,
							type: "community" as const,
						})),
					);
				}
			})
			.catch((e) => logger.error("Failed to load forward targets", e))
			.finally(() => setLoading(false));
	}, [open, includeCommunities]);

	const getPartner = (conv: Conversation): ForwardPartner | undefined =>
		conv.participants?.find((p) => p && p._id !== myUserId);

	const filtered = conversations.filter((conv) => {
		const q = search.trim().toLowerCase();
		if (!q) return true;
		const partner = getPartner(conv);
		return (
			(partner?.fullName || "").toLowerCase().includes(q) ||
			(partner?.username || "").toLowerCase().includes(q)
		);
	});

	// Live user search — lets you forward to ANY user, not just people you
	// already have a conversation with. Results already covered by an existing
	// conversation (or already in the results) are de-duplicated.
	useEffect(() => {
		if (!open) return;
		const q = search.trim();
		if (q.length < 2) {
			setUserResults([]);
			return;
		}
		let cancelled = false;
		const timer = setTimeout(() => {
			setSearchingUsers(true);
			apiFetch(`/api/search/users?q=${encodeURIComponent(q)}`)
				.then((res) => res.json())
				.then((data) => {
					if (cancelled) return;
					const knownIds = new Set(
						conversations
							.map((c) => getPartner(c)?._id)
							.filter(Boolean) as string[],
					);
					const seen = new Set<string>();
					setUserResults(
						(data.users || [])
							.map((u: any) => ({
								_id: u._id,
								fullName: u.fullName || u.username,
								username: u.username,
								profilePic: u.profilePic
									? {
											url:
												typeof u.profilePic === "string"
													? u.profilePic
													: u.profilePic?.url,
									  }
									: undefined,
								type: "user" as const,
							}))
							.filter((u: ForwardPartner) => {
								if (!u._id || knownIds.has(u._id) || seen.has(u._id)) {
									return false;
								}
								seen.add(u._id);
								return true;
							}),
					);
				})
				.catch(() => {
					if (!cancelled) setUserResults([]);
				})
				.finally(() => {
					if (!cancelled) setSearchingUsers(false);
				});
		}, 300);
		return () => {
			cancelled = true;
			clearTimeout(timer);
		};
		// conversations in deps so already-known partners are correctly
		// excluded even if the user types before the list finishes loading.
	}, [open, search, conversations]);

	const filteredCommunities = communities.filter((c) => {
		const q = search.trim().toLowerCase();
		if (!q) return true;
		return (c.fullName || "").toLowerCase().includes(q);
	});

	const handleToggle = (convId: string) => {
		setSelectedIds((prev) => {
			if (prev.includes(convId)) {
				return prev.filter((id) => id !== convId);
			}
			if (prev.length >= 5) {
				window.dispatchEvent(
					new CustomEvent("showToast", {
						detail: {
							message:
								"You can forward to a maximum of 5 conversations.",
							type: "warning",
						},
					}),
				);
				return prev;
			}
			return [...prev, convId];
		});
	};

	const handleSend = async () => {
		if (sending || selectedIds.length === 0) return;
		const chatPartners = conversations
			.filter((c) => selectedIds.includes(c._id))
			.map((c) => getPartner(c))
			.filter((p): p is ForwardPartner => !!p?._id);
		const communityPartners = communities.filter((c) =>
			selectedIds.includes(c._id),
		);
		const userPartners = userResults.filter((u) =>
			selectedIds.includes(u._id),
		);
		const partners = [
			...chatPartners,
			...communityPartners,
			...userPartners,
		];
		if (partners.length === 0) return;
		setSending(true);
		try {
			const ok = await onForward(partners);
			if (ok) {
				onClose();
				setSelectedIds([]);
			}
		} finally {
			setSending(false);
		}
	};

	const closeAndReset = () => {
		onClose();
		setSelectedIds([]);
	};

	if (!open) return null;

	const renderHeader = () => (
		<>
			{/* Header */}
			<div className="flex items-center justify-between mb-3">
				<h4 className="text-label-sm font-semibold text-zinc-200">
					{title}
				</h4>
				<button
					onClick={closeAndReset}
					className="p-1 rounded-full hover:bg-zinc-800 transition-colors cursor-pointer"
					aria-label="Close">
					<X className="h-3 w-3 text-zinc-500 hover:text-white" />
				</button>
			</div>

			{/* Content preview */}
			{subtitle && (
				<div className="mb-3 p-2.5 rounded-xl bg-zinc-800/50 border border-zinc-700 max-h-24 overflow-y-auto">
					<p className="text-[10px] text-zinc-300 leading-relaxed break-words">
						{subtitle}
					</p>
				</div>
			)}

			{/* Search */}
			<div className="mb-3">
				<div className="relative">
					<Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-500" />
					<input
						value={search}
						onChange={(e) => setSearch(e.target.value)}
						placeholder="Search chats..."
						className="w-full rounded-full border border-zinc-800 bg-black/40 py-2 pl-9 pr-4 text-xs font-bold text-white placeholder-zinc-500 outline-none focus:border-white/40 focus:bg-zinc-900/60 transition-all"
					/>
				</div>
			</div>
		</>
	);

	const renderList = () => (
		<div className="space-y-1 pr-0.5">
			{loading ? (
				<div className="flex items-center justify-center gap-2 py-8 text-[10px] text-zinc-500">
					<Loader2 className="h-4 w-4 animate-spin" />
					Loading conversations...
				</div>
			) : conversations.length === 0 &&
			  filteredCommunities.length === 0 &&
			  userResults.length === 0 ? (
				<p className="text-center text-[9px] text-zinc-500 font-mono uppercase py-3">
					No conversations yet
				</p>
			) : (
				<>
					{filtered.length === 0 ? (
						<p className="text-center text-[9px] text-zinc-500 font-mono uppercase py-2">
							No matching chats
						</p>
					) : (
						filtered.map((conv) => {
							const partner = getPartner(conv);
							const isSelected = selectedIds.includes(conv._id);
							return (
								<button
									key={conv._id}
									onClick={() => handleToggle(conv._id)}
									className={`w-full flex items-center gap-2.5 p-2 rounded-xl transition-all border text-left ${
										isSelected
											? "bg-white/10 border-white/30"
											: "hover:bg-zinc-800/60 border-transparent"
									}`}>
									{partner?.profilePic?.url ? (
										<img
											src={partner.profilePic.url}
											alt={partner.fullName}
											className="h-7 w-7 rounded-full object-cover border border-zinc-800 shrink-0"
										/>
									) : (
										<div className="flex h-7 w-7 items-center justify-center rounded-full border border-zinc-800 bg-zinc-800 shrink-0">
											<span className="text-[10px] font-bold text-zinc-400">
												{partner?.fullName
													?.charAt(0)
													?.toUpperCase() || "?"}
												</span>
										</div>
									)}
									<div className="min-w-0 flex-1">
										<p className="text-[11px] font-bold text-zinc-200 truncate">
											{partner?.fullName || "Unknown"}
										</p>
										<p className="text-[8px] text-zinc-500 font-bold truncate">
											@{partner?.username || ""}
										</p>
									</div>
									<div
										className={`h-4 w-4 rounded-full border flex items-center justify-center shrink-0 ml-auto transition-all ${
											isSelected
												? "bg-white border-transparent text-black"
												: "border-zinc-700 text-transparent"
										}`}>
										{isSelected && (
											<svg
												className="h-2.5 w-2.5"
												fill="none"
												stroke="currentColor"
												viewBox="0 0 24 24"
												strokeWidth="3">
												<path
													strokeLinecap="round"
													strokeLinejoin="round"
													d="M4.5 12.75l6 6 9-13.5"
												/>
											</svg>
										)}
									</div>
								</button>
							);
						})
					)}

					{/* Any-user results — people you haven't chatted with yet.
					    The server creates the conversation when you send. */}
					{userResults.length > 0 && (
						<>
							<p className="pt-2 pb-1 text-[8px] font-black uppercase tracking-widest text-zinc-500 flex items-center gap-1.5">
								<UserPlus className="h-3 w-3" /> People
								{searchingUsers && (
									<Loader2 className="h-3 w-3 animate-spin" />
								)}
							</p>
							{userResults.map((user) => {
								const isSelected = selectedIds.includes(user._id);
								return (
									<button
										key={user._id}
										onClick={() => handleToggle(user._id)}
										className={`w-full flex items-center gap-2.5 p-2 rounded-xl transition-all border text-left ${
											isSelected
												? "bg-white/10 border-white/30"
												: "hover:bg-zinc-800/60 border-transparent"
										}`}>
										{user.profilePic?.url ? (
											<img
												src={user.profilePic.url}
												alt={user.fullName}
												className="h-7 w-7 rounded-full object-cover border border-zinc-800 shrink-0"
											/>
										) : (
											<div className="flex h-7 w-7 items-center justify-center rounded-full border border-zinc-800 bg-zinc-800 shrink-0">
												<span className="text-[10px] font-bold text-zinc-400">
													{user.fullName
														?.charAt(0)
														?.toUpperCase() || "?"}
													</span>
												</div>
											)}
										<div className="min-w-0 flex-1">
											<p className="text-[11px] font-bold text-zinc-200 truncate">
												{user.fullName || "Unknown"}
											</p>
											<p className="text-[8px] text-zinc-500 font-bold truncate">
												@{user.username || ""}
											</p>
										</div>
										<div
											className={`h-4 w-4 rounded-full border flex items-center justify-center shrink-0 ml-auto transition-all ${
												isSelected
													? "bg-white border-transparent text-black"
													: "border-zinc-700 text-transparent"
											}`}>
											{isSelected && (
												<svg
													className="h-2.5 w-2.5"
													fill="none"
													stroke="currentColor"
													viewBox="0 0 24 24"
													strokeWidth="3">
													<path
														strokeLinecap="round"
														strokeLinejoin="round"
														d="M4.5 12.75l6 6 9-13.5"
													/>
												</svg>
											)}
										</div>
									</button>
								);
							})}
						</>
					)}

					{includeCommunities && filteredCommunities.length > 0 && (
						<>
							<p className="pt-2 pb-1 text-[8px] font-black uppercase tracking-widest text-zinc-500 flex items-center gap-1.5">
								<Hash className="h-3 w-3" /> Communities
							</p>
							{filteredCommunities.map((community) => {
								const isSelected = selectedIds.includes(community._id);
								return (
									<button
										key={community._id}
										onClick={() => handleToggle(community._id)}
										className={`w-full flex items-center gap-2.5 p-2 rounded-xl transition-all border text-left ${
											isSelected
												? "bg-white/10 border-white/30"
												: "hover:bg-zinc-800/60 border-transparent"
										}`}>
										{community.profilePic?.url ? (
											<img
												src={community.profilePic.url}
												alt={community.fullName}
												className="h-7 w-7 rounded-full object-cover border border-zinc-800 shrink-0"
											/>
										) : (
											<div className="flex h-7 w-7 items-center justify-center rounded-full border border-zinc-800 bg-zinc-800 shrink-0">
												<Hash className="h-3.5 w-3.5 text-zinc-400" />
											</div>
										)}
										<div className="min-w-0 flex-1">
											<p className="text-[11px] font-bold text-zinc-200 truncate">
												{community.fullName}
											</p>
											<p className="text-[8px] text-zinc-500 font-bold truncate">
												Community
											</p>
										</div>
										<div
											className={`h-4 w-4 rounded-full border flex items-center justify-center shrink-0 ml-auto transition-all ${
												isSelected
													? "bg-white border-transparent text-black"
													: "border-zinc-700 text-transparent"
											}`}>
											{isSelected && (
												<svg
													className="h-2.5 w-2.5"
													fill="none"
													stroke="currentColor"
													viewBox="0 0 24 24"
													strokeWidth="3">
													<path
														strokeLinecap="round"
														strokeLinejoin="round"
														d="M4.5 12.75l6 6 9-13.5"
													/>
												</svg>
											)}
										</div>
									</button>
								);
							})}
						</>
					)}
				</>
			)}
		</div>
	);

	const renderSendButton = () => (
		<button
			onClick={handleSend}
			disabled={selectedIds.length === 0 || sending}
			className="w-full mt-3 py-2.5 bg-white hover:bg-zinc-200 text-[10px] font-black uppercase tracking-wider text-black rounded-xl disabled:opacity-40 disabled:hover:bg-white transition-all cursor-pointer shadow-md shrink-0">
			{sending
				? "Sending..."
				: `Send (${selectedIds.length}/5)`}
		</button>
	);

	return createPortal(
		<AnimatePresence>
			{isMobile ? (
				<>
					{/* Mobile Backdrop */}
					<motion.div
						initial={{ opacity: 0 }}
						animate={{ opacity: 1 }}
						exit={{ opacity: 0 }}
						className="fixed inset-0 bg-black/70 z-[300]"
						onClick={closeAndReset}
					/>
					{/* Mobile Bottom Sheet */}
					<motion.div
						initial={{ y: "100%" }}
						animate={{ y: 0 }}
						exit={{ y: "100%" }}
						transition={{
							type: "spring",
							damping: 25,
							stiffness: 250,
						}}
						className="fixed bottom-0 inset-x-0 bg-zinc-900/95 backdrop-blur-xl border-t border-zinc-800 rounded-t-3xl shadow-[0_-10px_40px_rgba(0,0,0,0.5)] z-[310] overflow-hidden pb-8 max-w-md mx-auto pointer-events-auto max-h-[85vh] flex flex-col"
						onClick={(e) => e.stopPropagation()}>
						{/* Drag Handle */}
						<div className="w-12 h-1 bg-zinc-700 rounded-full mx-auto my-3" />
						<div className="px-6">{renderHeader()}</div>
						<div className="flex-1 overflow-y-auto px-6">
							{renderList()}
						</div>
						<div className="px-6">{renderSendButton()}</div>
					</motion.div>
				</>
			) : (
				<>
					{/* Desktop Backdrop */}
					<motion.div
						initial={{ opacity: 0 }}
						animate={{ opacity: 1 }}
						exit={{ opacity: 0 }}
						className="fixed inset-0 z-[300] bg-black/50 flex items-center justify-center p-4"
						onClick={closeAndReset}>
						<motion.div
							initial={{ scale: 0.9, y: 20 }}
							animate={{ scale: 1, y: 0 }}
							exit={{ scale: 0.9, y: 20 }}
							onClick={(e) => e.stopPropagation()}
							className="bg-zinc-900/95 backdrop-blur-xl border border-zinc-800 rounded-2xl p-4 w-full max-w-xs shadow-2xl max-h-[85vh] flex flex-col">
							{renderHeader()}
							<div className="flex-1 overflow-y-auto">
								{renderList()}
							</div>
							{renderSendButton()}
						</motion.div>
					</motion.div>
				</>
			)}
		</AnimatePresence>,
		document.body,
	);
}
