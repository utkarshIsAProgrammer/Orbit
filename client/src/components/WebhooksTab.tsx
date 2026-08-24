/**
 * FUTURE CONCERN: This feature is deferred.
 * The UI entry points were removed (Settings tab + share menu); the backend
 * and this component are retained intact so the feature can be re-enabled
 * without rework. Do not delete without the owner's explicit go-ahead.
 */
import { useState, useEffect } from "react";
import {
	Webhook as WebhookIcon,
	Plus,
	Loader2,
	Copy,
	Check,
	Trash2,
	Send,
	EyeOff,
	Link2,
	ShieldCheck,
	AlertTriangle,
} from "lucide-react";
import { apiFetch } from "../utils/api";
import { logger } from "../utils/logger";
import GlassCard from "./GlassCard";

interface WebhookItem {
	_id: string;
	url: string;
	events: string[];
	isActive: boolean;
	lastTriggeredAt?: string | null;
	failureCount?: number;
	createdAt: string;
}

const WEBHOOK_EVENTS: { id: string; label: string }[] = [
	{ id: "post.created", label: "Post created" },
	{ id: "post.liked", label: "Post liked" },
	{ id: "post.commented", label: "Post commented" },
	{ id: "comment.created", label: "Comment created" },
	{ id: "user.followed", label: "User followed" },
];

/**
 * Webhook endpoints — the management UI for the (previously headless)
 * webhook backend. Lets users register an HTTPS endpoint, subscribe to the
 * events that matter to them, test-fire a payload, and revoke endpoints.
 * The signing secret is shown exactly once at creation.
 */
export default function WebhooksTab() {
	const [webhooks, setWebhooks] = useState<WebhookItem[]>([]);
	const [loading, setLoading] = useState(true);
	const [creating, setCreating] = useState(false);
	const [testingId, setTestingId] = useState<string | null>(null);
	const [deletingId, setDeletingId] = useState<string | null>(null);

	const [newUrl, setNewUrl] = useState("");
	const [newEvents, setNewEvents] = useState<string[]>(["post.created"]);
	const [freshSecret, setFreshSecret] = useState<{ secret: string; url: string } | null>(null);
	const [showSecret, setShowSecret] = useState(false);
	const [copied, setCopied] = useState(false);

	const fetchWebhooks = async () => {
		try {
			const res = await apiFetch("/api/webhooks", { bypassCache: true });
			const data = await res.json();
			if (res.ok && data.success) setWebhooks(data.webhooks || []);
		} catch (err) {
			logger.error("Failed to load webhooks", err);
		} finally {
			setLoading(false);
		}
	};

	useEffect(() => {
		fetchWebhooks();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	const toggleEvent = (eventId: string) => {
		setNewEvents((prev) => {
			if (prev.includes(eventId)) {
				// Keep at least one event subscribed
				if (prev.length === 1) return prev;
				return prev.filter((e) => e !== eventId);
			}
			return [...prev, eventId];
		});
	};

	const handleCreate = async () => {
		const trimmed = newUrl.trim();
		if (!trimmed || newEvents.length === 0 || creating) return;
		setCreating(true);
		try {
			const res = await apiFetch("/api/webhooks", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ url: trimmed, events: newEvents }),
			});
			const data = await res.json();
			if (res.ok && data.success) {
				setFreshSecret({ secret: data.webhook.secret, url: data.webhook.url });
				setShowSecret(true);
				setCopied(false);
				setNewUrl("");
				setNewEvents(["post.created"]);
				await fetchWebhooks();
			} else {
				window.dispatchEvent(
					new CustomEvent("showToast", {
						detail: {
							message: data?.message || "Could not create webhook.",
							type: "error",
						},
					}),
				);
			}
		} catch (err) {
			logger.error("Failed to create webhook", err);
			window.dispatchEvent(
				new CustomEvent("showToast", {
					detail: { message: "Could not create webhook.", type: "error" },
				}),
			);
		} finally {
			setCreating(false);
		}
	};

	const handleTest = async (webhookId: string) => {
		if (testingId) return;
		setTestingId(webhookId);
		try {
			const res = await apiFetch(`/api/webhooks/${webhookId}/test`, {
				method: "POST",
			});
			const data = await res.json();
			window.dispatchEvent(
				new CustomEvent("showToast", {
					detail: {
						message: res.ok
							? "Test payload sent!"
							: data?.message || "Test failed.",
						type: res.ok ? "success" : "error",
					},
				}),
			);
		} catch (err) {
			logger.error("Failed to test webhook", err);
		} finally {
			setTestingId(null);
		}
	};

	const handleDelete = async (webhookId: string) => {
		if (deletingId) return;
		setDeletingId(webhookId);
		try {
			const res = await apiFetch(`/api/webhooks/${webhookId}`, {
				method: "DELETE",
			});
			if (res.ok) {
				setWebhooks((prev) => prev.filter((w) => w._id !== webhookId));
				window.dispatchEvent(
					new CustomEvent("showToast", {
						detail: { message: "Webhook deleted.", type: "success" },
					}),
				);
			}
		} catch (err) {
			logger.error("Failed to delete webhook", err);
		} finally {
			setDeletingId(null);
		}
	};

	const copySecret = async () => {
		if (!freshSecret) return;
		try {
			await navigator.clipboard.writeText(freshSecret.secret);
			setCopied(true);
			setTimeout(() => setCopied(false), 2000);
		} catch {
			window.dispatchEvent(
				new CustomEvent("showToast", {
					detail: {
						message: "Copy failed — select the secret manually.",
						type: "error",
					},
				}),
			);
		}
	};

	return (
		<div className="space-y-4 max-w-lg mx-auto">
			<GlassCard className="p-5 rounded-3xl border border-zinc-800/40">
				<div className="flex items-center gap-2 mb-1">
					<WebhookIcon className="h-4 w-4 text-amber-400" />
					<h3 className="text-sm font-bold text-white">Webhooks</h3>
				</div>
				<p className="text-[11px] text-zinc-500 leading-relaxed">
					Get realtime callbacks when things happen to your content. Each
					delivery is a signed <span className="text-zinc-300">POST</span>{" "}
					with an <span className="text-zinc-300">X-Webhook-Signature</span>{" "}
					header (HMAC-SHA256 of the body) — verify it with your secret to
					be sure the request came from Orbit. URLs must be public HTTPS
					endpoints.
				</p>

				{/* Create form */}
				<div className="mt-4 space-y-3 rounded-2xl border border-zinc-800/60 bg-zinc-950/50 p-3">
					<input
						value={newUrl}
						onChange={(e) => setNewUrl(e.target.value)}
						placeholder="https://your-app.com/webhooks/orbit"
						type="url"
						className="w-full rounded-xl border border-zinc-800 bg-zinc-900/60 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 outline-none focus:border-zinc-600"
					/>
					<div>
						<span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
							Events
						</span>
						<div className="mt-1.5 flex flex-wrap gap-1.5">
							{WEBHOOK_EVENTS.map((ev) => {
								const active = newEvents.includes(ev.id);
								return (
									<button
										key={ev.id}
										type="button"
										onClick={() => toggleEvent(ev.id)}
										className={`rounded-full border px-2.5 py-1 text-[10px] font-bold transition-all cursor-pointer ${
											active
												? "border-amber-500/40 bg-amber-500/10 text-amber-400"
												: "border-zinc-800 text-zinc-500 hover:text-zinc-300"
										}`}
									>
										{ev.label}
									</button>
								);
							})}
						</div>
					</div>
					<button
						onClick={() => void handleCreate()}
						disabled={!newUrl.trim() || newEvents.length === 0 || creating}
						className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-white py-2 text-[11px] font-bold text-black hover:bg-zinc-200 disabled:opacity-40 disabled:cursor-not-allowed transition-all cursor-pointer"
					>
						{creating ? (
							<Loader2 className="h-3.5 w-3.5 animate-spin" />
						) : (
							<Plus className="h-3.5 w-3.5" />
						)}
						Create webhook
					</button>
				</div>

				{/* Fresh secret reveal — one-time only */}
				{freshSecret && showSecret && (
					<div className="mt-3 rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-3">
						<div className="flex items-center justify-between gap-2">
							<p className="text-[11px] font-bold text-emerald-400">
								Webhook created — copy the secret now, it won't be
								shown again.
							</p>
							<div className="flex shrink-0 items-center gap-1">
								<button
									onClick={() => setShowSecret(false)}
									className="rounded-full p-1.5 text-zinc-500 hover:text-zinc-300 transition-colors cursor-pointer"
									title="Hide"
								>
									<EyeOff className="h-3.5 w-3.5" />
								</button>
								<button
									onClick={() => setShowSecret(false)}
									className="rounded-full p-1.5 text-zinc-500 hover:text-zinc-300 transition-colors cursor-pointer"
									title="Dismiss"
								>
									<Check className="h-3.5 w-3.5" />
								</button>
							</div>
						</div>
						<div className="mt-2 flex items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-950/80 px-3 py-2">
							<code className="min-w-0 flex-1 break-all text-[11px] text-zinc-200">
								{freshSecret.secret}
							</code>
							<button
								onClick={() => void copySecret()}
								className="shrink-0 rounded-full bg-white/10 p-1.5 text-zinc-300 hover:bg-white/20 transition-colors cursor-pointer"
								title="Copy secret"
							>
								{copied ? (
									<Check className="h-3.5 w-3.5 text-emerald-400" />
								) : (
									<Copy className="h-3.5 w-3.5" />
								)}
							</button>
						</div>
					</div>
				)}
			</GlassCard>

			{/* Webhook list */}
			<GlassCard className="p-5 rounded-3xl border border-zinc-800/40">
				<div className="flex items-center gap-2 mb-3">
					<Link2 className="h-4 w-4 text-zinc-400" />
					<h3 className="text-sm font-bold text-white">Your Endpoints</h3>
					<span className="ml-auto text-[10px] text-zinc-500">
						{webhooks.length} registered
					</span>
				</div>

				{loading ? (
					<div className="flex items-center justify-center py-8">
						<Loader2 className="h-5 w-5 animate-spin text-zinc-500" />
					</div>
				) : webhooks.length === 0 ? (
					<p className="py-6 text-center text-[11px] text-zinc-600">
						No webhooks yet — create one above.
					</p>
				) : (
					<div className="space-y-2">
						{webhooks.map((w) => (
							<div
								key={w._id}
								className="rounded-xl border border-zinc-800/60 bg-zinc-950/50 px-3 py-2.5"
							>
								<div className="flex items-center gap-3">
									<span
										className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
											w.isActive
												? "bg-zinc-900 text-emerald-400"
												: "bg-zinc-900/60 text-red-400"
										}`}
									>
										{w.isActive ? (
											<ShieldCheck className="h-4 w-4" />
										) : (
											<AlertTriangle className="h-4 w-4" />
										)}
									</span>
									<div className="min-w-0 flex-1">
										<p className="truncate text-[12px] font-bold text-white">
											{w.url}
										</p>
										<div className="mt-0.5 flex flex-wrap items-center gap-1">
											{w.events.map((ev) => (
												<span
													key={ev}
													className="rounded-full bg-zinc-800/80 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wide text-zinc-400"
												>
													{ev}
												</span>
											))}
										</div>
										<p className="mt-1 text-[9px] text-zinc-500">
											{w.isActive ? (
												<span className="text-emerald-500">
													Active
												</span>
											) : (
												<span className="text-red-400">
													Deactivated — too many failures
												</span>
											)}
											{w.lastTriggeredAt
												? ` · last fired ${new Date(
														w.lastTriggeredAt,
													).toLocaleString()}`
												: " · never fired"}
											{(w.failureCount || 0) > 0
												? ` · ${w.failureCount} failure${
														w.failureCount === 1 ? "" : "s"
												  }`
												: ""}
										</p>
									</div>
									<div className="flex shrink-0 items-center gap-1">
										<button
											onClick={() => void handleTest(w._id)}
											disabled={testingId === w._id || !w.isActive}
											className="flex h-7 w-7 items-center justify-center rounded-full text-zinc-500 hover:bg-white/10 hover:text-white disabled:opacity-40 transition-all cursor-pointer"
											title="Send test payload"
										>
											{testingId === w._id ? (
												<Loader2 className="h-3.5 w-3.5 animate-spin" />
											) : (
												<Send className="h-3.5 w-3.5" />
											)}
										</button>
										<button
											onClick={() => void handleDelete(w._id)}
											disabled={deletingId === w._id}
											className="flex h-7 w-7 items-center justify-center rounded-full text-zinc-500 hover:bg-red-500/10 hover:text-red-400 disabled:opacity-40 transition-all cursor-pointer"
											title="Delete webhook"
										>
											{deletingId === w._id ? (
												<Loader2 className="h-3.5 w-3.5 animate-spin" />
											) : (
												<Trash2 className="h-3.5 w-3.5" />
											)}
										</button>
									</div>
								</div>
							</div>
						))}
					</div>
				)}
			</GlassCard>
		</div>
	);
}
