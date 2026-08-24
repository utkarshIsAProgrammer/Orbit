import { useState, useRef, useEffect } from "react";
import { Flag, Loader2, Check, AlertCircle, X } from "lucide-react";
import { motion } from "motion/react";
import { createPortal } from "react-dom";
import { apiFetch } from "../utils/api";
import { logger } from "../utils/logger";
import { useAutoGrow } from "../hooks/useAutoGrow";

interface ReportButtonProps {
	contentType: "post" | "comment" | "user" | "message";
	contentId: string;
	className?: string;
	iconOnly?: boolean;
	/** When true, opens the modal automatically on mount (used by menus). */
	initialOpen?: boolean;
	/** Called when the modal closes (X, outside click, cancel). */
	onClose?: () => void;
}

const REPORT_REASONS = [
	{ value: "spam", label: "Spam", description: "Unsolicited or repetitive content" },
	{ value: "harassment", label: "Harassment", description: "Bullying, threats, or hateful content" },
	{ value: "nudity", label: "Nudity / Sexual content", description: "Inappropriate or explicit content" },
	{ value: "violence", label: "Violence", description: "Threats or glorification of violence" },
	{ value: "hate_speech", label: "Hate speech", description: "Discrimination based on identity" },
	{ value: "misinformation", label: "Misinformation", description: "False or misleading information" },
	{ value: "copyright", label: "Copyright violation", description: "Unauthorized use of copyrighted material" },
	{ value: "other", label: "Other", description: "Something else not listed" },
];	export default function ReportButton({
	contentType,
	contentId,
	className = "",
	iconOnly = false,
	initialOpen = false,
	onClose,
}: ReportButtonProps) {
	const [showModal, setShowModal] = useState(initialOpen);
	const closeModal = () => {
		setShowModal(false);
		onClose?.();
	};
	const [selectedReason, setSelectedReason] = useState("");
	const [description, setDescription] = useState("");
	const descriptionRef = useAutoGrow<HTMLTextAreaElement>(description);
	const [submitting, setSubmitting] = useState(false);
	const [submitted, setSubmitted] = useState(false);
	const [error, setError] = useState("");
	const modalRef = useRef<HTMLDivElement>(null);

	// Close on click outside
	useEffect(() => {
		if (!showModal) return;
		const handleClick = (e: MouseEvent) => {
			if (modalRef.current && !modalRef.current.contains(e.target as Node)) {
				closeModal();
			}
		};
		document.addEventListener("mousedown", handleClick);
		return () => document.removeEventListener("mousedown", handleClick);
	}, [showModal]);

	// Re-open when the initialOpen flag flips true (e.g. a menu triggers it
	// after the component was already mounted with initialOpen=false).
	useEffect(() => {
		if (initialOpen && !showModal) setShowModal(true);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [initialOpen]);

	const handleSubmit = async () => {
		if (!selectedReason) {
			setError("Please select a reason");
			return;
		}
		setSubmitting(true);
		setError("");

		try {
			const res = await apiFetch("/api/reports", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					contentType,
					contentId,
					reason: selectedReason,
					description: description.trim(),
				}),
			});

			const data = await res.json();
			if (res.ok && data.success) {
				setSubmitted(true);
				setTimeout(() => {
					setShowModal(false);
					setSubmitted(false);
					setSelectedReason("");
					setDescription("");
					// Tell the parent to clear its id so the same content can be
					// reported again later (modal remounts fresh on reopen).
					onClose?.();
				}, 2000);
			} else {
				setError(data.message || "Failed to submit report");
			}
		} catch (err) {
			logger.error("Failed to submit report", err);
			setError("Network error. Please try again.");
		} finally {
			setSubmitting(false);
		}
	};

	return (
		<>
			<button
				type="button"								onClick={(e) => {
									e.stopPropagation();
									setShowModal(true);
								}}
				className={`flex items-center gap-1.5 text-zinc-500 hover:text-amber-400 transition-colors cursor-pointer ${
					iconOnly ? "p-1" : "px-2 py-1 text-[10px] font-bold"
				} ${className}`}
				aria-label="Report"
				title="Report this content"
			>
				<Flag className="h-3.5 w-3.5" />
				{!iconOnly && <span>Report</span>}
			</button>

			{showModal && createPortal(
				<motion.div
					initial={{ opacity: 0 }}
					animate={{ opacity: 1 }}
					exit={{ opacity: 0 }}
					className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
				>
					<motion.div
						ref={modalRef}
						initial={{ scale: 0.95, opacity: 0, y: 20 }}
						animate={{ scale: 1, opacity: 1, y: 0 }}
						transition={{ type: "spring", stiffness: 300, damping: 25 }}
						className="w-full max-w-md rounded-3xl border border-zinc-800 bg-zinc-950 p-5 shadow-2xl"
					>
						{submitted ? (
							<div className="flex flex-col items-center gap-3 py-8">
								<div className="h-12 w-12 rounded-full bg-emerald-500/20 flex items-center justify-center">
									<Check className="h-6 w-6 text-emerald-400" />
								</div>
								<p className="text-sm font-bold text-white">Report Submitted</p>
								<p className="text-[11px] text-zinc-400 text-center">
									Thanks for helping keep Orbit safe. Our team will review this report.
								</p>
							</div>
						) : (
							<>
								<div className="flex items-center justify-between mb-4">
									<div className="flex items-center gap-2">
										<Flag className="h-4 w-4 text-amber-400" />
										<h3 className="text-sm font-bold text-white">Report Content</h3>
									</div>
									<button
										type="button"
										onClick={closeModal}
										className="h-6 w-6 rounded-full bg-zinc-800 hover:bg-zinc-700 flex items-center justify-center cursor-pointer transition-colors"
									>
										<X className="h-3 w-3 text-zinc-400" />
									</button>
								</div>

								<p className="text-[11px] text-zinc-400 mb-4">
									Why are you reporting this {contentType}?
								</p>

								<div className="space-y-1 max-h-52 overflow-y-auto mb-4">
									{REPORT_REASONS.map((reason) => (
										<button
											key={reason.value}
											type="button"
											onClick={() => {
												setSelectedReason(reason.value);
												setError("");
											}}
											className={`w-full text-left px-3 py-2.5 rounded-xl text-[12px] transition-all cursor-pointer ${
												selectedReason === reason.value
													? "bg-amber-500/15 border border-amber-500/30"
													: "bg-zinc-900/50 border border-transparent hover:bg-zinc-800/50"
											}`}
										>
											<span className="font-bold text-white block">{reason.label}</span>
											<span className="text-[10px] text-zinc-500">{reason.description}</span>
										</button>
									))}
								</div>

								<textarea
									value={description}
									onChange={(e) => setDescription(e.target.value)}
									ref={descriptionRef} placeholder="Additional details (optional)..."
									maxLength={500}
									rows={2}
									className="w-full bg-zinc-900/50 border border-zinc-800 !rounded-lg px-3 py-2 text-[11px] text-zinc-300 placeholder-zinc-600 resize-none outline-none focus:border-zinc-600 transition-colors"
								/>

								{error && (
									<div className="mt-2 flex items-center gap-1.5 text-[10px] text-red-400">
										<AlertCircle className="h-3 w-3" />
										<span>{error}</span>
									</div>
								)}

								<div className="mt-4 flex gap-2">
									<button
										type="button"
										onClick={closeModal}
										className="flex-1 rounded-full bg-zinc-800 hover:bg-zinc-700 py-2.5 text-[11px] font-bold text-zinc-300 transition-all cursor-pointer"
									>
										Cancel
									</button>
									<button
										type="button"
										onClick={handleSubmit}
										disabled={!selectedReason || submitting}
										className="flex-1 rounded-full bg-amber-500 hover:bg-amber-600 py-2.5 text-[11px] font-bold text-white transition-all disabled:opacity-40 cursor-pointer flex items-center justify-center gap-1.5"
									>
										{submitting ? (
											<><Loader2 className="h-3 w-3 animate-spin" /> Submitting...</>
										) : (
											"Submit Report"
										)}
									</button>
								</div>
							</>
						)}
					</motion.div>
				</motion.div>,
				document.body
			)}
		</>
	);
}
