import React, { useState } from "react";
import { User } from "../types";
import {
	Home,
	Compass,
	Bell,
	Bookmark,
	Feather,
	Repeat,
	MessageSquare,
	Settings,
	Hash,
	Shield,
} from "lucide-react";
import UserAvatar from "./UserAvatar";
import GlassCard from "./GlassCard";
import { warmCache, getEndpointsForTab } from "../utils/api";
import { prefetchTabChunk } from "../utils/tabChunks";

// Compose modal is heavy-ish and only used when the user clicks "New Post" —
// lazy so it loads on demand, matching App.tsx's own lazy PostModal instance.
const PostModal = React.lazy(() => import("./PostModal"));

interface LeftSidebarProps {
	user: User | null;
	currentTab: string;
	setTab: (tab: string) => void;
	setSelectedUserUsername: (username: string) => void;
	badgeCount: number;
	chatBadgeCount: number;
}

export default React.memo(function LeftSidebar({
	user,
	currentTab,
	setTab,
	setSelectedUserUsername,
	badgeCount,
	chatBadgeCount,
}: LeftSidebarProps) {
	const [postModalOpen, setPostModalOpen] = useState(false);

	const tabs = [
		{ id: "home", label: "Home", icon: Home },
		{ id: "explore", label: "Explore", icon: Compass },
		{
			id: "notifications",
			label: "Notifications",
			icon: Bell,
			badge: badgeCount,
		},
		{
			id: "chat",
			label: "Messages",
			icon: MessageSquare,
			badge: chatBadgeCount,
		},
		{ id: "communities", label: "Communities", icon: Hash },
		{ id: "saved", label: "Saved", icon: Bookmark },
		{ id: "reposts", label: "Reposts", icon: Repeat },
		{ id: "settings", label: "Settings", icon: Settings },
		...(user?.isAdmin
			? [{ id: "admin" as const, label: "Admin", icon: Shield }]
			: []),
	];

	return (
		<>
			<div className="flex flex-col h-full min-h-0">
				<GlassCard
					animate={true}
					contentClassName="flex flex-col"
					className="flex-1 flex flex-col justify-between h-full px-2 md:px-3 pt-4 pb-0 lg:px-4 xl:px-5 xl:pt-5">
					<div className="space-y-5 pb-5">
						{/* Logo — script wordmark, always visible */}
						<div
							className="cursor-pointer pt-1 group flex justify-start"
							onClick={() => setTab("home")}>
							<div className="flex flex-col items-start">
								<h1 className="text-logo text-gradient-aurora text-left">
									Orbit
								</h1>
								<p className="font-display-italic text-[12px] text-zinc-400 dark:text-zinc-400 tracking-wide">
									your inner circle
								</p>
							</div>
						</div>

						{/* Navigation Options — icon + label always visible */}
						<nav
							className="space-y-1 sm:space-y-3 pt-3 flex flex-col"
							aria-label="Main navigation">
							{tabs.map((tab) => {
								const active = currentTab === tab.id;
								const Icon = tab.icon;
								return (
								<button
									key={tab.id}
									onClick={() => setTab(tab.id)}
								onMouseEnter={() => {
									// Fetch this tab's JS chunk on hover so clicking it is instant
									prefetchTabChunk(tab.id);
									// Warm cache for this tab on hover — data loads instantly when user clicks
									const endpoints = getEndpointsForTab(tab.id);
									if (endpoints.length > 0) {
										warmCache(endpoints);
									}
								}}
										aria-label={tab.label}
										aria-current={
											active ? "page" : undefined
										}
										className={`flex w-full items-center justify-start gap-2.5 rounded-2xl px-3 py-2.5 text-[12px] md:text-sm font-semibold transition-all cursor-pointer ${
											active
												? "pill-active shadow-[0_8px_24px_-10px_var(--aurora-glow-soft)]"
												: "text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
										}`}>
										<div className="relative">												<Icon
													className={`h-5.5 w-5.5 lg:h-4.5 lg:w-4.5 ${active ? "opacity-100" : "opacity-70"}`}
													aria-hidden="true"
												/>
											{tab.badge ? (
												<span
													className="absolute -right-1 -top-1 flex h-4 w-4 aspect-square shrink-0 items-center justify-center rounded-[50%] bg-aurora text-[9px] font-semibold text-white border border-white/10 shadow-aurora [background-clip:padding-box]"
													aria-label={`${tab.badge} new ${tab.label}`}>
													{tab.badge > 99
														? "99"
														: tab.badge}
												</span>
											) : null}
										</div>
										<span className="truncate min-w-0">
											{tab.label}
										</span>
									</button>
								);
							})}
						</nav>

						{/* Create Post Action — pill button, always with label */}
						<button
							onClick={() => setPostModalOpen(true)}
							aria-label="Create new post"
							className="w-full bg-aurora text-white font-semibold text-sm rounded-full py-2.5 px-4 flex items-center justify-center gap-2.5 transition-all shadow-aurora active:scale-95 cursor-pointer hover:opacity-90 hover:shadow-aurora border border-white/10 [background-clip:padding-box]">
							<Feather
								className="h-4 w-4 shrink-0"
								aria-hidden="true"
							/>							<span>Post</span>
						</button>

						{/* Profile — directly below the Post button, same card style */}
						<div className="pt-5 border-t border-white/10">
							<button
								onClick={() => {
									setSelectedUserUsername(user?.username || "");
									setTab("profile");
								}}
								aria-label="View your profile"
								className="flex w-full items-center justify-start gap-3 rounded-2xl p-3 transition-all group hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer">
								<UserAvatar
									src={user?.profilePic?.url}
									alt={`${user?.fullName || "User"} profile picture`}
									className="h-9 w-9 aspect-square shrink-0 rounded-[50%] object-cover border border-zinc-800"
								/>
								<div className="flex-1 min-w-0 flex flex-col items-start overflow-hidden text-left">
									<span className="text-sm font-semibold text-slate-900 dark:text-zinc-100 line-clamp-1">
										{user?.fullName}
									</span>
									<span className="text-xs text-zinc-500 line-clamp-1">
										@{user?.username}
									</span>
								</div>
							</button>
						</div>
					</div>
				</GlassCard>
			</div>

			{postModalOpen && (
				<React.Suspense fallback={null}>
					<PostModal
						isOpen={postModalOpen}
						onClose={() => setPostModalOpen(false)}
						onPostCreated={() => {
							setPostModalOpen(false);
							setTab("home");
							window.dispatchEvent(new Event("forceFeedRefresh"));
						}}
					/>
				</React.Suspense>
			)}
		</>
	);
});

// badge count fetched from unread-count endpoint on mount and via socket

// overflow-x-hidden to prevent accidental horizontal scroll on touch

// listen for unreadCount socket event to update badge instantly
