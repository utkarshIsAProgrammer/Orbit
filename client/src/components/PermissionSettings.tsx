import { useState, useEffect } from "react";
import {
	Bell,
	Camera,
	Mic,
	ShieldCheck,
	Loader2,
	Check,
	Ban,
	HelpCircle,
	ExternalLink,
	RefreshCw,
} from "lucide-react";
import { apiFetch } from "../utils/api";
import { requestNotificationPermission } from "../utils/notifications";
import {
	getDevicePermissions,
	saveDevicePermissions,
	requestCameraPermission,
	requestMicrophonePermission,
	type DevicePermissions,
} from "../utils/permissions";
import { logger } from "../utils/logger";
import GlassCard from "./GlassCard";

interface PermItem {
	key: keyof DevicePermissions;
	label: string;
	description: string;
	icon: React.ComponentType<{ className?: string }>;
	request: () => Promise<DevicePermissionState>;
}

type DevicePermissionState = "default" | "granted" | "denied" | "unsupported";

const STATUS_META: Record<DevicePermissionState, { label: string; cls: string; dot: string }> = {
	granted: { label: "Enabled", cls: "text-emerald-400", dot: "bg-emerald-400" },
	denied: { label: "Blocked", cls: "text-red-400", dot: "bg-red-400" },
	default: { label: "Not asked", cls: "text-zinc-400", dot: "bg-zinc-500" },
	unsupported: { label: "Not available", cls: "text-zinc-600", dot: "bg-zinc-700" },
};

/**
 * Permanent device-permission control center (Settings → Permissions).
 *
 * Shows the CURRENT state of notifications / camera / microphone, lets the
 * user re-request any permission that's still "default", and — for ones the
 * browser has locked (denied) — explains that the browser remembers the
 * answer and points to the browser's own site-permission settings. This is
 * the persistent home of the one-time onboarding choices.
 */
export default function PermissionSettings() {
	const [perms, setPerms] = useState<DevicePermissions>({
		notifications: "default",
		camera: "default",
		microphone: "default",
	});
	const [loading, setLoading] = useState(true);
	const [busy, setBusy] = useState<string | null>(null);

	const refresh = async () => {
		setLoading(true);
		try {
			// Read the LIVE browser state (authoritative for what's actually
			// granted on this device), then overlay the persisted server prefs
			// for anything the Permissions API can't report.
			const live = await getDevicePermissions();
			setPerms((prev) => ({ ...prev, ...live }));
			try {
				const res = await apiFetch("/api/permissions", { bypassCache: true });
				const data = await res.json();
				if (res.ok && data.success) {
					const saved = data.permissions || {};
					setPerms({
						notifications: live.notifications !== "default" ? live.notifications : saved.notifications || "default",
						camera: live.camera !== "default" ? live.camera : saved.camera || "default",
						microphone: live.microphone !== "default" ? live.microphone : saved.microphone || "default",
					});
				}
			} catch {
				// Keep live state only.
			}
		} catch (err) {
			logger.error("Failed to load permission states", err);
		} finally {
			setLoading(false);
		}
	};

	useEffect(() => {
		void refresh();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	const handleRequest = async (item: PermItem) => {
		if (busy) return;
		setBusy(item.key);
		try {
			const state = await item.request();
			setPerms((prev) => ({ ...prev, [item.key]: state }));
			await saveDevicePermissions({ [item.key]: state });
			window.dispatchEvent(
				new CustomEvent("showToast", {
					detail: {
						message:
							state === "granted"
								? `${item.label} enabled`
								: state === "denied"
									? `${item.label} is blocked by your browser`
									: `${item.label} is not available on this device`,
						type: state === "granted" ? "success" : "error",
					},
				}),
			);
		} catch (err) {
			logger.error(`Failed to request ${item.key}`, err);
		} finally {
			setBusy(null);
		}
	};

	const ITEMS: PermItem[] = [
		{
			key: "notifications",
			label: "Notifications",
			description: "Likes, comments, follows, messages — even when the app is closed.",
			icon: Bell,
			request: async () =>
				(await requestNotificationPermission()) as DevicePermissionState,
		},
		{
			key: "camera",
			label: "Camera",
			description: "Video calls and camera access. Used only while you're on a call.",
			icon: Camera,
			request: requestCameraPermission,
		},
		{
			key: "microphone",
			label: "Microphone",
			description: "Voice calls and voice notes. Used only while you're talking or recording.",
			icon: Mic,
			request: requestMicrophonePermission,
		},
	];

	return (
		<GlassCard className="p-5 rounded-3xl border border-zinc-800/40 max-w-lg mx-auto">
			<div className="flex items-center gap-2 mb-1">
				<ShieldCheck className="h-4 w-4 text-amber-400" />
				<h3 className="text-sm font-bold text-white">Device Permissions</h3>
			</div>
			<p className="text-[11px] text-zinc-500 leading-relaxed mb-4">
				Your browser shows each permission prompt once and remembers the answer.
				Enable what you want here — changes are saved to your account and never
				re-asked on this device.
			</p>

			{loading ? (
				<div className="flex items-center justify-center py-8">
					<Loader2 className="h-5 w-5 animate-spin text-zinc-500" />
				</div>
			) : (
				<div className="space-y-2.5">
					{ITEMS.map((item) => {
						const Icon = item.icon;
						const state = perms[item.key];
						const meta = STATUS_META[state] || STATUS_META.default;
						const isBusy = busy === item.key;
						const isDefault = state === "default";
						const isDenied = state === "denied";
						return (
							<div
								key={item.key}
								className="flex items-center gap-3 rounded-2xl border border-zinc-800/70 bg-zinc-900/30 p-3.5"
							>
								<span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-zinc-800 text-zinc-300">
									<Icon className="h-4.5 w-4.5" />
								</span>
								<div className="min-w-0 flex-1">
									<p className="text-[13px] font-bold text-white flex items-center gap-1.5">
										{item.label}
										<span className="flex items-center gap-1 text-[10px] font-semibold">
											<span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
											<span className={meta.cls}>{meta.label}</span>
										</span>
									</p>
									<p className="text-[10px] text-zinc-500 leading-relaxed">
										{item.description}
									</p>
									{isDenied && (
										<p className="mt-1 text-[9px] text-zinc-600">
											Blocked by the browser — re-enable it in your browser's site
											permissions (e.g. the padlock icon in the address bar).
										</p>
									)}
								</div>
								{isBusy ? (
									<Loader2 className="h-4 w-4 shrink-0 animate-spin text-zinc-400" />
								) : isDefault ? (
									<button
										onClick={() => void handleRequest(item)}
										disabled={!!busy}
										className="shrink-0 rounded-full bg-aurora px-3 py-1.5 text-[10px] font-bold text-white border border-white/10 shadow-aurora hover:opacity-90 disabled:opacity-40 transition-all cursor-pointer"
									>
										Enable
									</button>
								) : (
									<span
										className={`flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[9px] font-bold ${
											state === "granted"
												? "bg-emerald-500/10 text-emerald-400"
												: state === "denied"
													? "bg-red-500/10 text-red-400"
													: "bg-zinc-800 text-zinc-500"
										}`}
									>
										{state === "granted" ? (
											<Check className="h-3 w-3" />
										) : state === "denied" ? (
											<Ban className="h-3 w-3" />
										) : (
											<HelpCircle className="h-3 w-3" />
										)}
										{meta.label}
									</span>
								)}
							</div>
						);
					})}
				</div>
			)}

			<div className="mt-4 flex items-center justify-between border-t border-white/5 pt-3">
				<p className="flex items-center gap-1.5 text-[10px] text-zinc-600">
					<ExternalLink className="h-3 w-3" />
					Permission prompts are controlled by your browser, not the app.
				</p>
				<button
					onClick={() => void refresh()}
					disabled={loading}
					className="flex items-center gap-1 rounded-full border border-zinc-800 px-3 py-1.5 text-[10px] font-bold text-zinc-400 hover:bg-zinc-900 disabled:opacity-40 transition-all cursor-pointer"
				>
					<RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
					Refresh
				</button>
			</div>
		</GlassCard>
	);
}
