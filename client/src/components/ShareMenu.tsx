import React, { useRef, useState, useEffect, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { Send, Link2, FolderPlus } from "lucide-react";

interface ShareMenuProps {
	/** Called when the user picks "Forward". */
	onForward: () => void;
	/** Fired when the menu is opened (used to count a view). */
	onOpen?: () => void;
	/** Called when the user picks "Copy link". */
	onCopyLink: () => void;
	/** When provided, adds a "Save to collection" item to the menu. */
	onSaveToCollection?: () => void;
	/** Content for the trigger button (typically a Share2 icon). */
	triggerContent: React.ReactNode;
	triggerClassName?: string;
	ariaLabel?: string;
	/** Which edge of the trigger the menu aligns to. */
	align?: "left" | "right";
	/** Menu width in px (used for viewport clamping). */
	menuWidth?: number;
}

/**
 * A compact share dropdown (Forward / Copy link) used on posts, comments and
 * profiles. The menu is portal-rendered with position:fixed and flips above
 * the trigger when there isn't room below, so it can never be clipped by a
 * card's overflow-hidden (GlassCard) or a scroll container. Repositions on
 * scroll/resize and closes on outside click or Escape.
 */	export default function ShareMenu({
	onForward,
	onOpen,
	onCopyLink,
	onSaveToCollection,
	triggerContent,
	triggerClassName = "",
	ariaLabel = "Share",
	align = "right",
	menuWidth = 176,
}: ShareMenuProps) {
	const [open, setOpen] = useState(false);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const menuRef = useRef<HTMLDivElement>(null);
	// Starts null so the menu NEVER mounts at a default top-left corner
	// (8,8) — it only renders once compute() has measured the trigger and
	// set the real position (useLayoutEffect, before the browser paints).
	// Otherwise the first open of the session can flash the menu at the
	// screen's top-left before the correction lands.
	const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

	const compute = () => {
		const btn = triggerRef.current;
		if (!btn) return;
		const rect = btn.getBoundingClientRect();
		const vw = window.innerWidth;
		const vh = window.innerHeight;
		const GAP = 6;
		// Measure the actual rendered menu so optional extra items
		// (Save to collection) never flip/clamp incorrectly.
		const menuH = menuRef.current?.offsetHeight || 92;
		let x = align === "right" ? rect.right - menuWidth : rect.left;
		x = Math.min(Math.max(GAP, x), Math.max(GAP, vw - menuWidth - GAP));
		// Flip above when there's more room up top.
		const roomBelow = vh - rect.bottom - GAP;
		const up = roomBelow < menuH && rect.top > menuH;
		const y = up ? rect.top - menuH - GAP : rect.bottom + GAP;
		setPos({
			x,
			y: Math.min(Math.max(GAP, y), Math.max(GAP, vh - menuH - GAP)),
		});
	};

	useLayoutEffect(() => {
		if (open) compute();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [open]);

	useEffect(() => {
		if (!open) return;
		compute();
		const onViewportChange = () => compute();
		let raf = 0;
		const onScroll = () => {
			if (raf) return;
			raf = requestAnimationFrame(() => {
				raf = 0;
				compute();
			});
		};
		window.addEventListener("resize", onViewportChange);
		window.addEventListener("orientationchange", onViewportChange);
		window.addEventListener("scroll", onScroll, {
			capture: true,
			passive: true,
		});
		return () => {
			window.removeEventListener("resize", onViewportChange);
			window.removeEventListener("orientationchange", onViewportChange);
			window.removeEventListener("scroll", onScroll, { capture: true });
			if (raf) cancelAnimationFrame(raf);
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [open, align, menuWidth]);

	useEffect(() => {
		if (!open) return;
		const handleOutside = (e: MouseEvent | TouchEvent) => {
			const t = e.target as Node;
			if (triggerRef.current?.contains(t)) return;
			if (menuRef.current?.contains(t)) return;
			setOpen(false);
		};
		const handleKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") setOpen(false);
		};
		document.addEventListener("mousedown", handleOutside);
		document.addEventListener("touchstart", handleOutside);
		document.addEventListener("keydown", handleKey);
		return () => {
			document.removeEventListener("mousedown", handleOutside);
			document.removeEventListener("touchstart", handleOutside);
			document.removeEventListener("keydown", handleKey);
		};
	}, [open]);

	return (
		<>
			<button
				ref={triggerRef}
				type="button"
				onClick={(e) => {
					e.stopPropagation();
					const next = !open;
					setOpen(next);
					if (next) onOpen?.();
				}}
				onContextMenu={(e) => e.stopPropagation()}
				className={triggerClassName}
				aria-label={ariaLabel}
				aria-haspopup="menu"
				aria-expanded={open}>
				{triggerContent}
			</button>
			{typeof document !== "undefined" &&
				open &&
				pos &&
				createPortal(
					<div
						ref={menuRef}
						role="menu"
						className="fixed z-[400] overflow-hidden rounded-xl border border-white/10 bg-zinc-900 shadow-[0_20px_55px_-15px_rgba(0,0,0,0.9)]"
						style={{ left: pos.x, top: pos.y, width: menuWidth }}
						onClick={(e) => e.stopPropagation()}>
						{/* Orbit signature: 1px glass edge-light along the top */}
						<div className="pointer-events-none absolute inset-x-0 top-0 h-[1px] bg-linear-to-r from-transparent via-white/20 to-transparent" />
						<button
							type="button"
							onClick={(e) => {
								e.stopPropagation();
								setOpen(false);
								onForward();
							}}
							className="w-full flex items-center gap-2.5 px-4 py-2.5 text-xs text-zinc-300 hover:bg-zinc-800 hover:text-white transition-colors text-left cursor-pointer">
							<Send className="h-3.5 w-3.5 text-zinc-400" />
							Forward
						</button>
						<button
							type="button"
							onClick={(e) => {
								e.stopPropagation();
								setOpen(false);
								onCopyLink();
							}}
							className="w-full flex items-center gap-2.5 px-4 py-2.5 text-xs text-zinc-300 hover:bg-zinc-800 hover:text-white transition-colors text-left cursor-pointer">
							<Link2 className="h-3.5 w-3.5 text-zinc-400" />
							Copy link
						</button>
						{onSaveToCollection && (
							<button
								type="button"
								onClick={(e) => {
									e.stopPropagation();
									setOpen(false);
									onSaveToCollection();
								}}
								className="w-full flex items-center gap-2.5 px-4 py-2.5 text-xs text-zinc-300 hover:bg-zinc-800 hover:text-white transition-colors text-left cursor-pointer">
								<FolderPlus className="h-3.5 w-3.5 text-zinc-400" />
								Save to collection
							</button>
						)}
					</div>,
					document.body,
				)}

		</>
	);
}

// copy deep link to clipboard; show toast confirmation

// use navigator.share for mobile; fallback to clipboard on desktop
