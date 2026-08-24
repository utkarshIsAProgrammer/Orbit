/**
 * FUTURE CONCERN: This feature is deferred.
 * The UI entry points were removed (Settings tab + share menu); the backend
 * and this component are retained intact so the feature can be re-enabled
 * without rework. Do not delete without the owner's explicit go-ahead.
 */
import { useState, useEffect } from "react";
import {
	KeyRound,
	Plus,
	Loader2,
	Copy,
	Check,
	Trash2,
	ShieldCheck,
	EyeOff,
	Code2,
} from "lucide-react";
import { apiFetch } from "../utils/api";
import { logger } from "../utils/logger";
import GlassCard from "./GlassCard";

interface ApiKeyItem {
	_id: string;
	name: string;
	keyPrefix: string;
	permissions: string[];
	isActive: boolean;
	lastUsedAt?: string | null;
	createdAt: string;
}

/**
 * Developer API keys — the client half of the (previously zombie) backend
 * feature. Lets users mint scoped keys (read / write), copy the raw key the
 * one time it's shown, list their keys with the prefix + last-used info, and
 * revoke them. Keys mirror the owner's own permissions; "admin" is never
 * offerable (privilege escalation guard lives server-side too).
 */
export default function ApiKeysTab() {
	const [keys, setKeys] = useState<ApiKeyItem[]>([]);
	const [loading, setLoading] = useState(true);
	const [creating, setCreating] = useState(false);
	const [revokingId, setRevokingId] = useState<string | null>(null);

	const [newName, setNewName] = useState("");
	const [newPerms, setNewPerms] = useState<string[]>(["read"]);
	const [freshKey, setFreshKey] = useState<{ rawKey: string; name: string } | null>(null);
	const [showFreshKey, setShowFreshKey] = useState(false);
	const [copied, setCopied] = useState(false);

	const fetchKeys = async () => {
		try {
			const res = await apiFetch("/api/developer/keys", { bypassCache: true });
			const data = await res.json();
			if (res.ok && data.success) setKeys(data.keys || []);
		} catch (err) {
			logger.error("Failed to load API keys", err);
		} finally {
			setLoading(false);
		}
	};

	useEffect(() => {
		fetchKeys();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	const togglePerm = (perm: string) => {
		setNewPerms((prev) => {
			if (prev.includes(perm)) return prev.filter((p) => p !== perm);
			// Keep at least one permission
			if (prev.length === 1) return prev;
			return [...prev, perm];
		});
	};

	const handleCreate = async () => {
		if (!newName.trim() || creating) return;
		setCreating(true);
		try {
			const res = await apiFetch("/api/developer/keys", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ name: newName.trim(), permissions: newPerms }),
			});
			const data = await res.json();
			if (res.ok && data.success) {
				setFreshKey({ rawKey: data.apiKey.rawKey, name: data.apiKey.name });
				setShowFreshKey(true);
				setCopied(false);
				setNewName("");
				setNewPerms(["read"]);
				await fetchKeys();
			} else {
				window.dispatchEvent(
					new CustomEvent("showToast", {
						detail: { message: data?.message || "Could not create key.", type: "error" },
					}),
				);
			}
		} catch (err) {
			logger.error("Failed to create API key", err);
			window.dispatchEvent(
				new CustomEvent("showToast", {
					detail: { message: "Could not create key.", type: "error" },
				}),
			);
		} finally {
			setCreating(false);
		}
	};

	const handleRevoke = async (keyId: string) => {
		if (revokingId) return;
		setRevokingId(keyId);
		try {
			const res = await apiFetch(`/api/developer/keys/${keyId}`, {
				method: "DELETE",
			});
			if (res.ok) {
				setKeys((prev) => prev.filter((k) => k._id !== keyId));
				window.dispatchEvent(
					new CustomEvent("showToast", {
						detail: { message: "API key revoked.", type: "success" },
					}),
				);
			}
		} catch (err) {
			logger.error("Failed to revoke API key", err);
		} finally {
			setRevokingId(null);
		}
	};

	const copyKey = async () => {
		if (!freshKey) return;
		try {
			await navigator.clipboard.writeText(freshKey.rawKey);
			setCopied(true);
			setTimeout(() => setCopied(false), 2000);
		} catch {
			window.dispatchEvent(
				new CustomEvent("showToast", {
					detail: { message: "Copy failed — select the key manually.", type: "error" },
				}),
			);
		}
	};

	return (
		<div className="space-y-4 max-w-lg mx-auto">
			<GlassCard className="p-5 rounded-3xl border border-zinc-800/40">
				<div className="flex items-center gap-2 mb-1">
					<Code2 className="h-4 w-4 text-amber-400" />
					<h3 className="text-sm font-bold text-white">Developer API Keys</h3>
				</div>
				<p className="text-[11px] text-zinc-500 leading-relaxed">
					Create scoped API keys to build with the Orbit API. Keys carry{" "}
					<span className="text-zinc-300">read</span> and/or{" "}
					<span className="text-zinc-300">write</span> permissions mirroring
					your own account access. Store keys securely — the full key is only
					shown once at creation.
				</p>

				{/* Create form */}
				<div className="mt-4 space-y-3 rounded-2xl border border-zinc-800/60 bg-zinc-950/50 p-3">
					<input
						value={newName}
						onChange={(e) => setNewName(e.target.value)}
						placeholder="Key name (e.g. my-app)"
						maxLength={60}
						className="w-full rounded-xl border border-zinc-800 bg-zinc-900/60 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 outline-none focus:border-zinc-600"
					/>
					<div className="flex items-center gap-2">
						<span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
							Permissions
						</span>
						{["read", "write"].map((perm) => (
							<button
								key={perm}
								type="button"
								onClick={() => togglePerm(perm)}
								className={`rounded-full border px-3 py-1 text-[10px] font-bold capitalize transition-all cursor-pointer ${
									newPerms.includes(perm)
										? "border-amber-500/40 bg-amber-500/10 text-amber-400"
										: "border-zinc-800 text-zinc-500 hover:text-zinc-300"
								}`}
							>
								{perm}
							</button>
						))}
					</div>
					<button
						onClick={() => void handleCreate()}
						disabled={!newName.trim() || creating}
						className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-aurora py-2 text-[11px] font-bold text-white border border-white/10 shadow-aurora hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-all cursor-pointer"
					>
						{creating ? (
							<Loader2 className="h-3.5 w-3.5 animate-spin" />
						) : (
							<Plus className="h-3.5 w-3.5" />
						)}
						Create API key
					</button>
				</div>

				{/* Fresh key reveal — one-time only */}
				{freshKey && showFreshKey && (
					<div className="mt-3 rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-3">
						<div className="flex items-center justify-between">
							<p className="text-[11px] font-bold text-emerald-400">
								Key created — copy it now, it won't be shown again.
							</p>
							<div className="flex items-center gap-1">
								<button
									onClick={() => setShowFreshKey(false)}
									className="rounded-full p-1.5 text-zinc-500 hover:text-zinc-300 transition-colors cursor-pointer"
									title="Hide"
								>
									<EyeOff className="h-3.5 w-3.5" />
								</button>
								<button
									onClick={() => setShowFreshKey(false)}
									className="rounded-full p-1.5 text-zinc-500 hover:text-zinc-300 transition-colors cursor-pointer"
									title="Dismiss"
								>
									<Check className="h-3.5 w-3.5" />
								</button>
							</div>
						</div>
						<div className="mt-2 flex items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-950/80 px-3 py-2">
							<code className="min-w-0 flex-1 break-all text-[11px] text-zinc-200">
								{freshKey.rawKey}
							</code>
							<button
								onClick={() => void copyKey()}
								className="shrink-0 rounded-full bg-white/10 p-1.5 text-zinc-300 hover:bg-white/20 transition-colors cursor-pointer"
								title="Copy key"
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

			{/* Key list */}
			<GlassCard className="p-5 rounded-3xl border border-zinc-800/40">
				<div className="flex items-center gap-2 mb-3">
					<KeyRound className="h-4 w-4 text-zinc-400" />
					<h3 className="text-sm font-bold text-white">Your Keys</h3>
					<span className="ml-auto text-[10px] text-zinc-500">
						{keys.length} active
					</span>
				</div>

				{loading ? (
					<div className="flex items-center justify-center py-8">
						<Loader2 className="h-5 w-5 animate-spin text-zinc-500" />
					</div>
				) : keys.length === 0 ? (
					<p className="py-6 text-center text-[11px] text-zinc-600">
						No API keys yet — create one above.
					</p>
				) : (
					<div className="space-y-2">
						{keys.map((k) => (
							<div
								key={k._id}
								className="flex items-center gap-3 rounded-xl border border-zinc-800/60 bg-zinc-950/50 px-3 py-2.5"
							>
								<span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-zinc-900 text-zinc-400">
									<ShieldCheck className="h-4 w-4" />
								</span>
								<div className="min-w-0 flex-1">
									<p className="truncate text-[12px] font-bold text-white">
										{k.name}
									</p>
									<p className="truncate text-[9px] text-zinc-500 font-mono">
										{k.keyPrefix}•••••••• · {k.permissions.join(", ")}
										{k.lastUsedAt
											? ` · last used ${new Date(k.lastUsedAt).toLocaleDateString()}`
											: " · never used"}
									</p>
								</div>
								<button
									onClick={() => void handleRevoke(k._id)}
									disabled={revokingId === k._id}
									className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-zinc-500 hover:bg-red-500/10 hover:text-red-400 disabled:opacity-40 transition-all cursor-pointer"
									title="Revoke key"
								>
									{revokingId === k._id ? (
										<Loader2 className="h-3.5 w-3.5 animate-spin" />
									) : (
										<Trash2 className="h-3.5 w-3.5" />
									)}
								</button>
							</div>
						))}
					</div>
				)}
			</GlassCard>
		</div>
	);
}
