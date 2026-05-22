import { useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "motion/react";
import {
	Bell,
	Camera,
	Mic,
	ShieldCheck,
	Loader2,
	Check,
	X,
	ArrowRight,
	Ban,
	HelpCircle,
} from "lucide-react";
import {
	requestNotificationPermission,
	type NotificationPermissionState,
} from "../utils/notifications";
import {
	requestCameraPermission,
	requestMicrophonePermission,
	saveDevicePermissions,
	type DevicePermissionState,
} from "../utils/permissions";
import { logger } from "../utils/logger";

interface PermissionOnboardingProps {
	open: boolean;
	/** Called when the user finishes (or skips) the one-time setup. */
	onComplete: () => void;
}

interface PermCard {
	key: "notifications" | "camera" | "microphone";
	title: string;
	description: string;
	icon: React.ComponentType<{ className?: string }>;
	request: () => Promise<DevicePermissionState | NotificationPermissionState>;
}

/**
 * First-run device-permission onboarding — shown once right after signup
 * (and to existing users who never completed it, on their next login).
 *
 * The browser shows each permission prompt only ONCE per site and remembers
 * the answer permanently, so this screen is the user's single chance to
 * grant everything up front instead of being surprised later when a call or
 * voice note suddenly asks for camera/mic. Choices are persisted server-side
 * (follow the account) and the screen never appears again — even if the user
 * skips, because Settings → Permissions is always available to enable more.
 */
export default function PermissionOnboarding({
	open,
	onComplete,
}: PermissionOnboardingProps) {
	const [busy, setBusy] = useState<string | null>(null);
	const [results, setResults] = useState<Record<string, DevicePermissionState>>({});
	const [saving, setSaving] = useState(false);
	const [done, setDone] = useState(false);

	const CARDS: PermCard[] = [
		{
			key: "notifications",
			title: "Notifications",
			description:
				"Get notified when someone likes, comments, follows or messages you — even when the app is closed.",
			icon: Bell,
			request: requestNotificationPermission,
		},
		{
			key: "camera",
			title: "Camera",
			description:
				"Make video calls and share what you see. Only used when you start a call.",
			icon: Camera,
			request: requestCameraPermission,
		},
		{
			key: "microphone",
			title: "Microphone",
			description:
				"Talk on calls and record voice notes. Only used while you're actively talking or recording.",
			icon: Mic,
			request: requestMicrophonePermission,
		},
	];

	const handleRequest = async (card: PermCard) => {
		if (busy) return;
		setBusy(card.key);
		try {
			const state = await card.request();
			const normalized = state as DevicePermissionState;
			setResults((prev) => ({ ...prev, [card.key]: normalized }));
			// Persist immediately so a partial completion survives reload.
			await saveDevicePermissions({ [card.key]: normalized });
		} catch (err) {
			logger.error(`Failed to request ${card.key} permission`, err);
			setResults((prev) => ({ ...prev, [card.key]: "denied" }));
		} finally {
			setBusy(null);
		}
	};

	const handleFinish = async () => {
		if (saving) return;
		setSaving(true);
		await saveDevicePermissions({}, true); // onboardingCompleted = true
		setSaving(false);
		setDone(true);
		// Small delay so the checkmark animation reads before unmount.
		setTimeout(onComplete, 400);
	};

	const grantedCount = Object.values(results).filter((s) => s === "granted").length;

	return createPortal(
		<AnimatePresence>
			{open && !done && (
				<motion.div
					initial={{ opacity: 0 }}
					animate={{ opacity: 1 }}
					exit={{ opacity: 0 }}
					className="fixed inset-0 z-[500] flex items-center justify-center p-4"
					role="dialog"
					aria-modal="true"
				>
					<div className="absolute inset-0 bg-black/80 backdrop-blur-sm" />
					<motion.div
						initial={{ opacity: 0, scale: 0.96, y: 24 }}
						animate={{ opacity: 1, scale: 1, y: 0 }}
						exit={{ opacity: 0, scale: 0.96, y: 24 }}
						transition={{ duration: 0.25, ease: "easeOut" }}
						className="relative z-[510] flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden rounded-3xl border border-white/10 bg-zinc-950 shadow-2xl"
					>
						{/* Header */}
						<div className="border-b border-white/5 px-6 pt-6 pb-5">
							<div className="flex items-center gap-2.5">
								<span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-amber-500/10 text-amber-400">
									<ShieldCheck className="h-5 w-5" />
								</span>
								<div>
									<h2 className="text-base font-black text-white">
										Make Orbit feel at home
									</h2>
									<p className="text-[11px] text-zinc-500">
										One-time setup — these are saved permanently. You can change
										them anytime in Settings.
									</p>
								</div>
							</div>
							<div className="mt-4 h-1 w-full rounded-full bg-zinc-800 overflow-hidden">
								<div
									className="h-full rounded-full bg-gradient-to-r from-amber-500 to-orange-400 transition-all duration-500"
									style={{
										width: `${(grantedCount / CARDS.length) * 100}%`,
									}}
								/>
							</div>
							<p className="mt-1.5 text-right text-[10px] text-zinc-600">
								{grantedCount}/{CARDS.length} enabled
							</p>
						</div>

						{/* Permission cards */}
						<div className="flex-1 space-y-2.5 overflow-y-auto px-6 py-4">
							{CARDS.map((card) => {
								const Icon = card.icon;
								const state = results[card.key];
								const isBusy = busy === card.key;
								const granted = state === "granted";
								const denied = state === "denied";
								const unsupported = state === "unsupported";
								return (
									<div
										key={card.key}
										className={`flex items-center gap-3 rounded-2xl border p-3.5 transition-all ${
											granted
												? "border-emerald-500/30 bg-emerald-500/5"
												: denied
													? "border-red-500/20 bg-red-500/5"
													: "border-zinc-800/70 bg-zinc-900/30"
										}`}
									>
										<span
											className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
												granted
													? "bg-emerald-500/10 text-emerald-400"
													: "bg-zinc-800 text-zinc-300"
											}`}
										>
											<Icon className="h-4.5 w-4.5" />
										</span>
										<div className="min-w-0 flex-1">
											<p className="text-[13px] font-bold text-white">
												{card.title}
											</p>
											<p className="text-[10px] text-zinc-500 leading-relaxed">
												{card.description}
											</p>
										</div>
										{isBusy ? (
											<Loader2 className="h-4 w-4 shrink-0 animate-spin text-zinc-400" />
										) : granted ? (
											<span className="flex shrink-0 items-center gap-1 rounded-full bg-emerald-500/15 px-2.5 py-1 text-[9px] font-bold text-emerald-400">
												<Check className="h-3 w-3" /> Enabled
											</span>
										) : denied ? (
											<span className="flex shrink-0 items-center gap-1 rounded-full bg-red-500/10 px-2.5 py-1 text-[9px] font-bold text-red-400">
												<Ban className="h-3 w-3" /> Denied
											</span>
										) : unsupported ? (
											<span className="flex shrink-0 items-center gap-1 rounded-full bg-zinc-800 px-2.5 py-1 text-[9px] font-bold text-zinc-500">
												<HelpCircle className="h-3 w-3" /> N/A
											</span>
										) : (
											<button
												onClick={() => void handleRequest(card)}
												disabled={!!busy}
												className="shrink-0 rounded-full bg-aurora px-3 py-1.5 text-[10px] font-bold text-white border border-white/10 shadow-aurora hover:opacity-90 disabled:opacity-40 transition-all cursor-pointer"
											>
												Enable
											</button>
										)}
									</div>
								);
							})}

							<p className="px-1 pt-1 text-[10px] leading-relaxed text-zinc-600">
								<HelpCircle className="mr-1 inline h-3 w-3" />
								Your browser shows each prompt once and remembers your choice.
								If you skip now, you can enable everything later from{" "}
								<span className="text-zinc-400">Settings → Permissions</span>.
							</p>
						</div>

						{/* Footer */}
						<div className="flex items-center gap-2 border-t border-white/5 px-6 py-4">
							<button
								onClick={() => void handleFinish()}
								disabled={saving}
								className="flex flex-1 items-center justify-center gap-1.5 rounded-full bg-aurora py-2.5 text-[11px] font-bold text-white border border-white/10 shadow-aurora hover:opacity-90 disabled:opacity-50 transition-all cursor-pointer"
							>
								{saving ? (
									<Loader2 className="h-3.5 w-3.5 animate-spin" />
								) : (
									<>
										Finish setup
										<ArrowRight className="h-3.5 w-3.5" />
									</>
								)}
							</button>
							<button
								onClick={() => void handleFinish()}
								disabled={saving}
								className="flex items-center gap-1 rounded-full border border-zinc-800 px-4 py-2.5 text-[11px] font-bold text-zinc-400 hover:bg-zinc-900 disabled:opacity-50 transition-all cursor-pointer"
								title="Skip — you can enable later in Settings"
							>
								<X className="h-3.5 w-3.5" />
								Skip
							</button>
						</div>
					</motion.div>
				</motion.div>
			)}
		</AnimatePresence>,
		document.body,
	);
}

// step-by-step wizard: profile pic, follow 3 people, create first post
