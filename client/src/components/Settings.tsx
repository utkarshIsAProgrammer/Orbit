import React, { useState, useEffect } from "react";
import { useKeyboardOpen } from "../hooks/useKeyboardOpen";
import {
	LogOut,
	CheckCircle,
	AlertCircle,
	Eye,
	EyeOff,
	UserCog,
	Lock,
	Users,
	Mail,
	Ban,
	Shield,
	Bell,
	Palette,
	CircleOff,
	Waves,
	Trophy,
	ShieldCheck,
} from "lucide-react";
import { User as UserType, type BgTheme, type ColorTheme } from "../types";
import GlassCard from "./GlassCard";
import ValidationMessage from "./ValidationMessage";
import BlockedUsersList from "./BlockedUsersList";
import CloseFriendsTab from "./CloseFriendsTab";
import InvitesTab from "./InvitesTab";
import PermissionSettings from "./PermissionSettings";
import AchievementsTab from "./AchievementsTab";
import NotificationSettings from "./NotificationSettings";
import PrivacySettings from "./PrivacySettings";
import { apiFetch } from "../utils/api";
import {
	validatePasswordChange,
	validateDeleteAccount,
} from "../utils/validation";

interface SettingsProps {
	user: UserType;
	onLogout: () => void;
	/** Active animated background theme (persisted in App). */
	bgTheme: BgTheme;
	/** Change the background theme (persisted in App). */
	onBgThemeChange: (theme: BgTheme) => void;
	/** Active color theme (persisted in App). */
	colorTheme: ColorTheme;
	/** Change the color theme (persisted in App). */
	onColorThemeChange: (theme: ColorTheme) => void;
	/** Color themes the user has earned via achievements (always >= ["xlite"]).
	 *  Locked themes are hidden entirely — they appear only when unlocked. */
	unlockedThemes?: string[];
	/** Sub-tab requested externally (e.g. perk CTA → Appearance). Applied on
	 *  mount so it works when Settings mounts after the request. */
	subTabRequest?: { tab: string; nonce: number } | null;
}
export default function Settings({
	user,
	onLogout,
	bgTheme,
	onBgThemeChange,
	colorTheme,
	onColorThemeChange,
	unlockedThemes = ["xlite"],
	subTabRequest,
}: SettingsProps) {
	// Background theme options (Settings → Appearance)
	const bgThemeOptions: {
		id: BgTheme;
		label: string;
		desc: string;
		icon: React.ComponentType<{ className?: string }>;
	}[] = [
		{
			id: "none",
			label: "Classic",
			desc: "Calm static dark — lightest on battery.",
			icon: CircleOff,
		},
		{
			id: "stellar",
			label: "Stellar",
			desc: "Flowing liquid-glass waves.",
			icon: Waves,
		},
	];

	// Color theme options (Settings → Appearance) — swaps the entire
	// palette via data-theme on <html>. Swatches are live gradients.
	const colorThemeOptions: {
		id: ColorTheme;
		label: string;
		desc: string;
		swatch: string;
	}[] = [
		{
			id: "xlite",
			label: "Eclipse",
			desc: "Total eclipse — pure black & white, crisp as moon shadow.",
			swatch: "linear-gradient(120deg, #fafafa 0%, #a1a1aa 50%, #27272a 110%)",
		},
		{
			id: "aurora",
			label: "Aurora",
			desc: "Cosmic midnight — violet & fuchsia on deep indigo.",
			swatch:
				"linear-gradient(120deg, #8b5cf6 0%, #d946ef 50%, #f59e0b 110%)",
		},
		{
			id: "ember",
			label: "Ember",
			desc: "Golden hour — coral, rose & amber on warm espresso.",
			swatch:
				"linear-gradient(120deg, #fb923c 0%, #f43f5e 50%, #f59e0b 110%)",
		},
		{
			id: "genesis",
			label: "Aurum",
			desc: "Warm black & gold — the landing page's signature. A Day One reward for waitlist members only.",
			swatch:
				"linear-gradient(120deg, #d4af37 0%, #f7e6bb 50%, #b7a272 110%)",
		},
	];

	// Apply an externally-requested sub-tab (e.g. achievement perk "Enable
	// Aurora now" → Appearance). Prop-driven so it works even when Settings
	// mounts AFTER the request is made (Settings is a lazy chunk).
	useEffect(() => {
		if (subTabRequest?.tab) {
			setActiveSubTab(subTabRequest.tab as any);
		}
	}, [subTabRequest?.nonce]);

	// Navigation Tabs for settings sections
	const [activeSubTab, setActiveSubTab] = useState<
		| "password"
		| "account"
		| "appearance"
		| "privacy"
		| "notifications"
		| "permissions"
		| "blocked"
		| "close-friends"
		| "invites"
		| "achievements"
		| "logout"
	>("password");

	const switchSubTab = (
		tab:
			| "password"
			| "account"
			| "appearance"
			| "privacy"
			| "notifications"
			| "permissions"
			| "blocked"
			| "close-friends"
			| "invites"
			| "achievements"
			| "logout",
	) => {
		setActiveSubTab(tab);
		setFieldErrors({});
	};

	// Shared settings navigation config — rendered as a desktop sidebar
	// (icon + label) and as a single horizontal pill row on non-desktop
	// devices (icons only, except the active section which also shows its
	// label so it's always obvious what's selected).
	const settingsNav: {
		id:
			| "password"
			| "account"
			| "appearance"
			| "privacy"
			| "notifications"
			| "permissions"
			| "blocked"
			| "close-friends"
			| "invites"
			| "achievements"
			| "logout";
		label: string;
		icon: React.ComponentType<{ className?: string }>;
	}[] = [
		{ id: "password", label: "Password", icon: Lock },
		{ id: "account", label: "Account", icon: UserCog },
		{ id: "appearance", label: "Appearance", icon: Palette },
		{ id: "privacy", label: "Privacy", icon: Shield },
		{ id: "notifications", label: "Notifications", icon: Bell },
		{ id: "permissions", label: "Permissions", icon: ShieldCheck },
		{ id: "close-friends", label: "Close Friends", icon: Users },
		{ id: "invites", label: "Invites", icon: Mail },
		{ id: "achievements", label: "Achievements", icon: Trophy },
		// FUTURE CONCERN: Developer (API keys + webhooks) tab removed from the
		// UI. Code retained in ApiKeysTab.tsx / WebhooksTab.tsx - re-enable
		// by re-adding the tab entries here. (Cross-posting / Connected
		// accounts was fully removed; not applicable anymore.)
		{ id: "blocked", label: "Blocked", icon: Ban },
		{ id: "logout", label: "Log Out", icon: LogOut },
	];

	// Field-level validation errors
	const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

	const clearFieldError = (field: string) => {
		setFieldErrors((prev) => {
			if (!prev[field]) return prev;
			const next = { ...prev };
			delete next[field];
			return next;
		});
	};

	// Password fields
	const [currentPassword, setCurrentPassword] = useState("");
	const [newPassword, setNewPassword] = useState("");
	const [confirmPassword, setConfirmPassword] = useState("");
	const [showCurrentPassword, setShowCurrentPassword] = useState(false);
	const [showNewPassword, setShowNewPassword] = useState(false);
	const [savingPassword, setSavingPassword] = useState(false);
	const [passwordError, setPasswordError] = useState<string | null>(null);
	const [passwordSuccess, setPasswordSuccess] = useState<string | null>(null);

	// Account actions
	const [deleteEmail, setDeleteEmail] = useState("");
	const [deletePassword, setDeletePassword] = useState("");
	const [showDeletePassword, setShowDeletePassword] = useState(false);
	const [deletingAccount, setDeletingAccount] = useState(false);
	const [deleteError, setDeleteError] = useState<string | null>(null);

	// Auto-clear error messages after 6 seconds
	useEffect(() => {
		if (!passwordError) return;
		const timer = setTimeout(() => setPasswordError(null), 6000);
		return () => clearTimeout(timer);
	}, [passwordError]);

	// A shared /invite/<code> deep link lands here — jump to the Invites tab.
	// Handles both the already-mounted event and a cold load via sessionStorage.
	useEffect(() => {
		const onInviteDeepLink = () => setActiveSubTab("invites");
		window.addEventListener("orbit:redeem-invite", onInviteDeepLink);
		try {
			if (sessionStorage.getItem("orbit_pending_invite")) {
				setActiveSubTab("invites");
			}
		} catch { /* private mode */ }
		return () => window.removeEventListener("orbit:redeem-invite", onInviteDeepLink);
	}, []);

	// Password Submit handler
	const handlePasswordSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		setPasswordError(null);
		setPasswordSuccess(null);

		const errs = validatePasswordChange({
			currentPassword,
			newPassword,
			confirmPassword,
		});
		if (Object.keys(errs).length > 0) {
			setFieldErrors(errs);
			setPasswordError(null);
			return;
		}
		setFieldErrors({});

		setSavingPassword(true);
		try {
			const res = await apiFetch("/api/users/update-password", {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					currentPassword,
					newPassword,
					confirmPassword,
					email: user.email,
				}),
			});

			const data = await res.json();
			if (!res.ok || !data.success) {
				throw new Error(data.message || "Could not update password.");
			}

			setPasswordSuccess("Password updated successfully.");
			setCurrentPassword("");
			setNewPassword("");
			setConfirmPassword("");
		} catch (err: any) {
			setPasswordError(
				err.message ||
					"Verification failed. Check your current password.",
			);
		} finally {
			setSavingPassword(false);
		}
	};

	// Delete Account handler
	const handleDeleteAccount = async () => {
		const errors = validateDeleteAccount({
			email: deleteEmail,
			password: deletePassword,
		});
		if (Object.keys(errors).length > 0) {
			setFieldErrors(errors);
			setDeleteError(null);
			return;
		}
		setFieldErrors({});

		setDeletingAccount(true);
		setDeleteError(null);

		try {
			const res = await apiFetch("/api/users/delete-account", {
				method: "DELETE",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					email: deleteEmail,
					password: deletePassword,
				}),
			});

			const data = await res.json();
			if (!res.ok || !data.success) {
				throw new Error(data.message || "Could not delete account.");
			}

			// Success, perform complete log out and cleanup
			onLogout();
		} catch (err: any) {
			setDeleteError(err.message || "Failed to delete account.");
			setDeletingAccount(false);
		}
	};

	const isKeyboardOpen = useKeyboardOpen();

	return (
		<>
		<div className="w-full px-1.5 pb-24 mt-2 leading-normal font-sans sm:px-4 sm:pb-28 sm:mt-4">
			{" "}
			{!isKeyboardOpen && (
				<div className="mb-6 flex flex-col gap-3 sm:mb-8 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
					<div>
						<h2 className="text-display-sm text-zinc-100">
							Account Settings
						</h2>
						<p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
							Manage your password, account, and app
							preferences.
						</p>
					</div>
				</div>
			)}
			<div className="flex flex-col lg:flex-row gap-6 w-full mx-auto lg:items-start lg:gap-6">

				{/* Desktop sidebar nav (lg+) — text only, sticky */}
				<nav
					className="hidden lg:flex lg:flex-col lg:gap-1 lg:w-48 lg:shrink-0 lg:sticky lg:top-24"
					aria-label="Settings sections">
					<div className="flex flex-col gap-1 rounded-2xl border border-zinc-800/60 bg-zinc-950/55 backdrop-blur-xl p-1.5 shadow-xl">
						{settingsNav.map((item) => {
							const active = activeSubTab === item.id;
							const ItemIcon = item.icon;
							return (
								<button
									key={item.id}
									type="button"
									onClick={() => switchSubTab(item.id)}
									aria-current={active ? "page" : undefined}
									className={`flex w-full items-center gap-2 rounded-xl px-3 py-2 text-[12.5px] font-semibold transition-all cursor-pointer ${
										active
											? item.id === "logout"
												? "bg-red-600 text-white shadow-md"
												: "pill-active"
											: item.id === "logout"
												? "text-red-500 dark:text-red-400 hover:bg-red-500/10 dark:hover:bg-red-500/10"
												: "text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-900/60"
									}`}>
									<ItemIcon className="h-4 w-4 shrink-0" />
									<span className="truncate">{item.label}</span>
								</button>
							);
						})}
					</div>
				</nav>

				{/* Content column — tablet tab bar + cards + mobile dock */}
				<div className="flex-1 min-w-0 w-full flex flex-col gap-6">					{/* Compact top nav — one horizontal line for all non-desktop
				    devices (mobile + tablet). Icons only — labels don't fit in a
				    single row of 11 options, so each button carries its label via
				    aria-label/title instead. Single line, no scroll, no wrap. */}
					<div className="lg:hidden -mx-1 px-1">
						<div className="flex items-center justify-between gap-0.5 rounded-full border border-zinc-800/60 bg-zinc-950/55 backdrop-blur-xl px-1 py-1 shadow-xl">
							{settingsNav.map((item) => {
								const active = activeSubTab === item.id;
								const ItemIcon = item.icon;
								return (
									<button
										key={item.id}
										type="button"
										onClick={() => switchSubTab(item.id)}
										aria-current={active ? "page" : undefined}
										aria-label={item.label}
										title={item.label}
										className={`flex min-w-0 flex-1 items-center justify-center gap-1 rounded-full px-1.5 py-1.5 text-[11px] font-semibold transition-all cursor-pointer sm:text-[12px] ${
											active
												? item.id === "logout"
													? "bg-red-600 text-white shadow-sm"
													: "pill-active"
												: item.id === "logout"
													? "text-red-500 dark:text-red-400 hover:bg-red-500/10 dark:hover:bg-red-500/10"
													: "text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100/60 dark:hover:bg-zinc-900/60"
										}`}>
										<ItemIcon className="h-4 w-4 shrink-0" />
									</button>
								);
							})}
						</div>
					</div>

					{/* Main interactive cards area */}
					<div className="w-full min-h-75">
					{activeSubTab === "password" && (
						<GlassCard
							animate={true}
							className={`transition-all duration-200 ${
								isKeyboardOpen ? "!p-4" : "!p-6"
							}`}>
							<h3
							className={`font-bold text-white uppercase tracking-wider mb-4 border-b border-zinc-900 pb-2 transition-all duration-200 ${
								isKeyboardOpen ? "text-[11px]" : "text-sm"
							}`}>
								Modify Password
							</h3>

							{passwordSuccess && (
								<div className="mb-4 flex items-start gap-2.5 rounded-3xl border border-white/20 bg-white/5 p-4 text-xs text-zinc-300">
									<CheckCircle className="h-4 w-4 shrink-0 text-white" />
									<span>{passwordSuccess}</span>
								</div>
							)}

							{passwordError && (
								<div className="mb-4 flex items-start gap-2.5 rounded-3xl border border-rose-500/20 bg-rose-500/5 p-4 text-xs text-rose-500">
									<AlertCircle className="h-4 w-4 shrink-0 text-rose-500" />
									<span>{passwordError}</span>
								</div>
							)}

							<form
								onSubmit={handlePasswordSubmit}
								noValidate
								className={`transition-all duration-200 ${
									isKeyboardOpen ? "space-y-3" : "space-y-4"
								}`}>
								<div className="space-y-1.5 text-left">
									<label
										htmlFor="settings-current-password"
										className="text-[12px] md:text-sm font-semibold text-zinc-300 pl-4">
										Current Password
									</label>
									<div className="relative">
										<input
											id="settings-current-password"
											type={
												showCurrentPassword
													? "text"
													: "password"
											}
											autoComplete="current-password"
											required
											value={currentPassword}
											onChange={(e) => {
												setCurrentPassword(
													e.target.value,
												);
												clearFieldError(
													"currentPassword",
												);
											}}
											className="w-full rounded-lg border border-zinc-800 bg-zinc-900/50 py-2.5 pl-4 pr-11 text-[12px] md:text-sm font-medium text-white focus:outline-none focus:border-white focus:bg-zinc-900 transition-all"
										/>
										<button
											type="button"
											onClick={() =>
												setShowCurrentPassword(
													!showCurrentPassword,
												)
											}
											className="absolute right-4 top-3 text-zinc-400 hover:text-zinc-600 cursor-pointer">
											{showCurrentPassword ? (
												<Eye className="h-4 w-4" />
											) : (
												<EyeOff className="h-4 w-4" />
											)}
										</button>
									</div>
									<ValidationMessage
										message={fieldErrors.currentPassword}
									/>
								</div>

								<div className="space-y-1.5 text-left">
									<label
										htmlFor="settings-new-password"
										className="text-[12px] md:text-sm font-semibold text-zinc-300 pl-4">
										New Password
									</label>
									<div className="relative">
										<input
											id="settings-new-password"
											type={
												showNewPassword
													? "text"
													: "password"
											}
											autoComplete="new-password"
											required
											value={newPassword}
											onChange={(e) => {
												setNewPassword(e.target.value);
												clearFieldError("newPassword");
											}}
											className="w-full rounded-lg border border-zinc-800 bg-zinc-900/50 py-2.5 pl-4 pr-11 text-[12px] md:text-sm font-medium text-white focus:outline-none focus:border-white focus:bg-zinc-900 transition-all"
										/>
										<button
											type="button"
											onClick={() =>
												setShowNewPassword(
													!showNewPassword,
												)
											}
											className="absolute right-4 top-3 text-zinc-400 hover:text-zinc-600 cursor-pointer">
											{showNewPassword ? (
												<Eye className="h-4 w-4" />
											) : (
												<EyeOff className="h-4 w-4" />
											)}
										</button>
									</div>
									<ValidationMessage
										message={fieldErrors.newPassword}
									/>
								</div>

								<div className="space-y-1.5 text-left">
									<label
										htmlFor="settings-confirm-password"
										className="text-[12px] md:text-sm font-semibold text-zinc-300 pl-4">
										Confirm New Password
									</label>
									<input
										id="settings-confirm-password"
										type="password"
										required
										value={confirmPassword}
										onChange={(e) => {
											setConfirmPassword(e.target.value);
											clearFieldError("confirmPassword");
										}}
										className="w-full rounded-full border border-zinc-800 bg-zinc-900/50 py-2.5 px-3.5 text-[12px] md:text-sm font-medium text-white focus:outline-none focus:border-white focus:bg-zinc-900 transition-all"
									/>
									<ValidationMessage
										message={fieldErrors.confirmPassword}
									/>
								</div>

								<button
									type="submit"
									disabled={savingPassword}
									className="w-full rounded-full bg-aurora py-3 text-[12px] md:text-sm font-bold tracking-widest uppercase text-white border border-white/10 shadow-aurora hover:opacity-90 font-sans transition-all disabled:opacity-40 cursor-pointer">
									{savingPassword
										? "Updating password..."
										: "Update Password"}
								</button>
							</form>
						</GlassCard>
					)}

					{activeSubTab === "account" && (
						<GlassCard
							animate={true}
							className={`border-rose-500/25 dark:border-rose-950/25 bg-red-950/10 dark:bg-red-950/10 shadow-none transition-all duration-200 ${
								isKeyboardOpen ? "!p-4" : "!p-6"
							}`}>
							<div className="flex items-center gap-2 mb-3 border-b border-rose-500/20 pb-2">
								<h3 className="text-sm font-bold text-rose-500 uppercase tracking-wider">
									Delete Account
								</h3>
							</div>

							<p className="text-xs text-zinc-500 dark:text-zinc-400 leading-snug">
								This process is completely{" "}
								<span className="font-bold text-rose-500 font-sans">
									irreversible
								</span>
								. Deleting your account will permanently delete
								your profile, comments, posts, and followers.
							</p>

							{deleteError && (
								<div className="my-4 flex items-start gap-2.5 rounded-3xl border border-rose-500/25 bg-rose-500/5 p-4 text-xs text-rose-500">
									<AlertCircle className="h-4 w-4 shrink-0" />
									<span>{deleteError}</span>
								</div>
							)}

							<div className="mt-5 space-y-4 text-left">
								<div className="space-y-1.5">
									<label
										htmlFor="settings-delete-email"
										className="text-[12px] md:text-sm font-semibold text-zinc-300 pl-4">
										To delete your account, enter your{" "}
										<span className="font-extrabold text-white">
											Email Address
										</span>
										:
									</label>
									<input
										id="settings-delete-email"
										type="text"
										inputMode="email"
										autoComplete="new-email"
										required
										placeholder="user@example.com"
										value={deleteEmail}
										onChange={(e) => {
											setDeleteEmail(e.target.value);
											clearFieldError("deleteEmail");
										}}
										className="w-full rounded-lg border border-zinc-800 bg-zinc-900/50 py-2.5 px-3.5 text-[12px] md:text-sm font-medium text-white focus:outline-none focus:border-rose-500 focus:bg-zinc-900 transition-all"
									/>
									<ValidationMessage
										message={fieldErrors.deleteEmail}
									/>
								</div>

								<div className="space-y-1.5 text-left">
									<label
										htmlFor="settings-delete-password"
										className="text-[12px] md:text-sm font-semibold text-zinc-300 pl-4">
										And your current{" "}
										<span className="font-extrabold text-white">
											Password
										</span>
										:
									</label>
									<div className="relative">
										<input
											id="settings-delete-password"
											type={
												showDeletePassword
													? "text"
													: "password"
											}
											autoComplete="new-password"
											required
											placeholder="Enter password"
											value={deletePassword}
											onChange={(e) => {
												setDeletePassword(
													e.target.value,
												);
												clearFieldError(
													"deletePassword",
												);
											}}
											className="w-full rounded-lg border border-zinc-800 bg-zinc-900/50 py-2.5 pl-4 pr-11 text-[12px] md:text-sm font-medium text-white focus:outline-none focus:border-rose-500 focus:bg-zinc-900 transition-all"
										/>
										<button
											type="button"
											onClick={() =>
												setShowDeletePassword(
													!showDeletePassword,
												)
											}
											className="absolute right-4 top-3 text-zinc-400 hover:text-zinc-600 cursor-pointer">
											{showDeletePassword ? (
												<Eye className="h-4 w-4" />
											) : (
												<EyeOff className="h-4 w-4" />
											)}
										</button>
									</div>
									<ValidationMessage
										message={fieldErrors.deletePassword}
									/>
								</div>

								<button
									type="button"
									onClick={handleDeleteAccount}
									disabled={
										deletingAccount ||
										!deleteEmail ||
										!deletePassword
									}
									className="w-full rounded-full bg-rose-600 hover:bg-rose-700 py-3 text-[12px] md:text-sm font-bold uppercase tracking-widest text-white transition-all disabled:opacity-30 disabled:hover:bg-rose-600">
									{deletingAccount
										? "Deleting account..."
										: "Permanently Delete Account"}
								</button>
							</div>
						</GlassCard>
					)}

					{activeSubTab === "appearance" && (
						<div className="space-y-5">
							<GlassCard
								animate={true}
								className={`transition-all duration-200 ${
									isKeyboardOpen ? "!p-4" : "!p-6"
								}`}>
								<h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
									<Palette className="h-4 w-4 text-zinc-300" />
									Background Theme
								</h3>
								<p className="text-xs text-zinc-400 leading-snug mt-1.5">
									Pick the living backdrop behind the app. None
									keeps it calm and battery-friendly — the
									static glow stays either way.
								</p>

								<div
									role="radiogroup"
									aria-label="Background theme"
									className="mt-4 grid gap-3 sm:grid-cols-3">
									{bgThemeOptions.map((theme) => {
										const active = bgTheme === theme.id;
										const ThemeIcon = theme.icon;
										return (
											<button
												key={theme.id}
												type="button"
												role="radio"
												aria-checked={active}
												onClick={() => onBgThemeChange(theme.id)}
												className={`flex flex-col items-start gap-1.5 rounded-2xl border p-3.5 text-left transition-all duration-200 cursor-pointer ${
													active
														? "border-white/70 bg-white/10 shadow-lg"
														: "border-zinc-800 bg-zinc-950/30 hover:border-zinc-500 hover:bg-zinc-900/40"
												}`}>
												<span
													className={`flex h-8 w-8 items-center justify-center rounded-full transition-colors ${
														active
															? "pill-active"
															: "bg-zinc-800/80 text-zinc-300"
														}`}>
													<ThemeIcon className="h-4 w-4" />
												</span>
												<span
													className={`text-[12.5px] font-bold uppercase tracking-wider ${
														active ? "text-white" : "text-zinc-300"
													}`}>
													{theme.label}
												</span>
												<span className="text-[11px] leading-snug text-zinc-400">
													{theme.desc}
												</span>												</button>
										);
									})}
								</div>
							</GlassCard>

							{/* Color Theme — swaps the entire palette (aurora/ember) */}
							<GlassCard
								animate={true}
								className={`transition-all duration-200 ${
									isKeyboardOpen ? "!p-4" : "!p-6"
								}`}>
								<h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
									<Palette className="h-4 w-4 text-zinc-300" />
									Color Theme
								</h3>
								<p className="text-xs text-zinc-400 leading-snug mt-1.5">
									Swap the whole look — surfaces, gradients and
									accents change instantly. Aurora is the cosmic
									default; Ember turns the app warm like golden
									hour.
								</p>

								<div
									role="radiogroup"
									aria-label="Color theme"
									className="mt-4 grid gap-3 sm:grid-cols-2">
									{colorThemeOptions.filter((t) => unlockedThemes.includes(t.id)).map((theme) => {
										const active = colorTheme === theme.id;
										return (
											<button
												key={theme.id}
												type="button"
												role="radio"
												aria-checked={active}
												onClick={() => onColorThemeChange(theme.id)}
												className={`flex flex-col items-start gap-1.5 rounded-2xl border p-3.5 text-left transition-all duration-200 cursor-pointer ${
													active
														? "border-white/70 bg-white/10 shadow-lg"
														: "border-zinc-800 bg-zinc-950/30 hover:border-zinc-500 hover:bg-zinc-900/40"
												}`}>
												<span
													className={`h-2 w-full rounded-full transition-colors ${
														active
															? "ring-2 ring-white/40 ring-offset-2 ring-offset-zinc-950"
															: "opacity-80"
														}`}
													style={{
														backgroundImage: theme.swatch,
													}}
												/>
												<span
													className={`text-[12.5px] font-bold uppercase tracking-wider ${
														active ? "text-white" : "text-zinc-300"
													}`}>
													{theme.label}
												</span>
												<span className="text-[11px] leading-snug text-zinc-400">
													{theme.desc}
												</span>
											</button>
										);
									})}
								</div>
								<div className="mt-3 flex items-start gap-2 rounded-xl border border-violet-500/20 bg-violet-500/5 px-3 py-2">
									<Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-violet-400" />
									<p className="text-[11px] leading-snug text-zinc-400">
									Aurora &amp; Ember unlock via themed
									achievements in <span className="font-bold text-white">Achievements</span>.
									Aurum is a <span className="font-bold text-white">Day One</span> waitlist
									reward — founding members only, never achievement-locked.
									</p>
								</div>
							</GlassCard>
						</div>
					)}

					{activeSubTab === "privacy" && (
						<PrivacySettings user={user} />
					)}

					{activeSubTab === "notifications" && (
						<NotificationSettings />
					)}

					{activeSubTab === "permissions" && (
						<PermissionSettings />
					)}

					{activeSubTab === "close-friends" && (
						<CloseFriendsTab user={user} />
					)}

					{activeSubTab === "invites" && (
						<InvitesTab />
					)}

					{activeSubTab === "achievements" && (
						<AchievementsTab />
					)}

					{activeSubTab === "blocked" && (
						<BlockedUsersList />
					)}


					{activeSubTab === "logout" && (
						<GlassCard
							animate={true}
							className="p-6 text-center space-y-5 max-w-sm mx-auto my-6 border-red-500/20 dark:border-red-900/40">
							<div className="mx-auto h-10 w-10 rounded-full bg-red-100 dark:bg-red-950/20 flex items-center justify-center text-red-600 dark:text-red-400 animate-pulse">
								<LogOut className="h-5 w-5" />
							</div>
							<div className="space-y-1.5">
								<h3 className="text-label font-semibold text-white">
									Sign Out of Orbit
								</h3>
								<p className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400 leading-normal max-w-xs mx-auto uppercase tracking-tight">
									Are you sure you want to sign out? You will
									need to sign back in to view your feeds and
									chat with friends.
								</p>
							</div>

							<div className="flex flex-col sm:flex-row gap-3 justify-center pt-1">
								<button
									type="button"
									onClick={() => switchSubTab("password")}
									className="rounded-full border border-zinc-800 bg-zinc-950/20 px-6 py-2.5 text-[12px] md:text-sm font-bold text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-all cursor-pointer uppercase tracking-wider">
									Cancel
								</button>
								<button
									type="button"
									onClick={onLogout}
									className="rounded-full bg-red-600 text-white hover:bg-red-500 dark:bg-red-700 dark:hover:bg-red-600 px-6 py-2.5 text-[12px] md:text-sm font-black uppercase tracking-widest transition-all hover:scale-105 active:scale-95 cursor-pointer shadow-lg shadow-red-500/15">
									Confirm Log Out
								</button>
							</div>
						</GlassCard>
					)}
				</div>
				</div>
			</div>
		</div>

	</>
	);
}
