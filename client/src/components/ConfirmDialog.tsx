import { useEffect, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { AlertTriangle, X } from "lucide-react";

interface ConfirmDialogProps {
	isOpen: boolean;
	title: string;
	message: string;
	confirmLabel?: string;
	cancelLabel?: string;
	variant?: "danger" | "default";
	onConfirm: () => void;
	onCancel: () => void;
}

export default function ConfirmDialog({
	isOpen,
	title,
	message,
	confirmLabel = "Confirm",
	cancelLabel = "Cancel",
	variant = "default",
	onConfirm,
	onCancel,
}: ConfirmDialogProps) {
	// Focus trap ref + Escape key handler for accessibility
	const dialogRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!isOpen) return;

		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				e.stopPropagation();
				onCancel();
				return;
			}
			// Focus trap: keep Tab cycling within the dialog
			if (e.key === "Tab" && dialogRef.current) {
				const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
					'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
				);
				if (focusable.length === 0) return;
				const first = focusable[0];
				const last = focusable[focusable.length - 1];
				if (e.shiftKey && document.activeElement === first) {
					e.preventDefault();
					last.focus();
				} else if (!e.shiftKey && document.activeElement === last) {
					e.preventDefault();
					first.focus();
				}
			}
		};

		// Focus the first focusable element on open
		requestAnimationFrame(() => {
			const first = dialogRef.current?.querySelector<HTMLElement>(
				'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
			);
			first?.focus();
		});

		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [isOpen, onCancel]);

	return (
		<AnimatePresence>
			{isOpen && (
				<div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="confirm-dialog-title" className="fixed inset-0 z-[320] flex items-center justify-center p-4">
					<motion.div
						initial={{ opacity: 0 }}
						animate={{ opacity: 1 }}
						exit={{ opacity: 0 }}
						transition={{ duration: 0.15 }}
						onClick={onCancel}
						className="absolute inset-0 bg-black/70"
					/>
					<motion.div
						initial={{ opacity: 0, scale: 0.96 }}
						animate={{ opacity: 1, scale: 1 }}
						exit={{ opacity: 0, scale: 0.96 }}
						transition={{ duration: 0.15, ease: "easeOut" }}
						className="relative w-full max-w-sm rounded-3xl border border-zinc-800/50 bg-zinc-950/95 backdrop-blur-2xl p-6 shadow-2xl">
						<div className="flex items-start gap-4">
							<div
								className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${
									variant === "danger"
										? "bg-red-500/15 text-red-400"
										: "bg-zinc-800 text-zinc-400"
								}`}>
								<AlertTriangle className="h-5 w-5" />
							</div>
							<div className="flex-1 min-w-0">
								<h3 id="confirm-dialog-title" className="text-label text-base font-semibold text-white">
									{title}
								</h3>
								<p className="mt-1.5 text-xs text-zinc-400 leading-relaxed">
									{message}
								</p>
							</div>
							<button
								onClick={onCancel}
								aria-label="Close dialog"
								className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full hover:bg-zinc-800 text-zinc-500 hover:text-white transition-colors">
								<X className="h-3.5 w-3.5" />
							</button>
						</div>
						<div className="mt-5 flex items-center justify-end gap-2.5">
							<button
								onClick={onCancel}
								className="rounded-full border border-zinc-800 px-4 py-2 text-[12px] md:text-sm font-bold text-zinc-400 hover:bg-zinc-800 hover:text-white transition-all">
								{cancelLabel}
							</button>
							<button
								onClick={onConfirm}
								className={`rounded-full px-4 py-2 text-[12px] md:text-sm font-bold text-white transition-all ${
									variant === "danger"
										? "bg-red-500 hover:bg-red-400 shadow-md shadow-red-500/20"
										: "bg-aurora text-white border border-white/10 shadow-aurora hover:opacity-90"
								}`}>
								{confirmLabel}
							</button>
						</div>
					</motion.div>
				</div>
			)}
		</AnimatePresence>
	);
}
