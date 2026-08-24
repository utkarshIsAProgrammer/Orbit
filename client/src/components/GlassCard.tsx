import React from "react";
import { motion, type MotionProps } from "motion/react";

interface GlassCardProps {
	children: React.Key | React.ReactNode;
	className?: string;
	onClick?: () => void;
	id?: string;
	animate?: boolean;
	showMacControls?: boolean;
	flat?: boolean;
	key?: React.Key;
	initial?: MotionProps["initial"];
	whileInView?: MotionProps["whileInView"];
	viewport?: MotionProps["viewport"];
	transition?: MotionProps["transition"];
	whileHover?: MotionProps["whileHover"];
	/** Optional data-post-id marker so post cards are picked up by
	 *  usePostViewTracking (3s visibility → one view). */
	dataPostId?: string;
	/** Optional classes applied to the inner content wrapper (the
	 *  `relative z-10` div). Lets callers like the left sidebar make the
	 *  wrapper a flex column so `mt-auto` children pin to the bottom. */
	contentClassName?: string;
}	export default React.memo(function GlassCard({
	children,
	className = "",
	onClick,
	id,
	animate = true,
	flat = false,
	initial,
	whileInView,
	viewport,
	transition,
	whileHover,
	dataPostId,
	contentClassName = "",
}: GlassCardProps) {
	// Fluid, premium liquid glass class combinations for Dark Space macOS glass feel
	const baseClasses = `relative overflow-hidden ${
		flat
			? ""
			: "rounded-2xl sm:rounded-3xl border border-white/12 glass-card-surface backdrop-blur-none sm:backdrop-blur-xl sm:backdrop-saturate-150 px-4 py-4 sm:px-5 sm:py-5 shadow-[0_25px_65px_-15px_rgba(0,0,0,0.85)] hover:border-white/25 transition-all duration-300"
	} ${
		onClick ? "cursor-pointer" : ""
	} ${className}`;

	const GlassGlossOverlay = () => (
		<>
			{/* Edge-light sheen — aurora-tinted top edge (themed) */}
			<div className="absolute inset-x-0 top-0 h-[1px] bg-linear-to-r from-transparent via-white/40 to-transparent pointer-events-none z-20" />
			{/* Soft aurora bloom in the corner — themed violet/fuchsia or ember warmth */}
			<div className="glass-bloom absolute -top-16 -right-16 h-40 w-40 rounded-full blur-2xl pointer-events-none z-0" />
		</>
	);

	if (!animate) {
		return (
			<div
				id={id}
				data-post-id={dataPostId}
				className={baseClasses}
				onClick={onClick}
			>
				{!flat && <GlassGlossOverlay />}
				<div className={`relative z-10 ${contentClassName}`}>{children}</div>
			</div>
		);
	}

	return (
		<motion.div
			id={id}
			data-post-id={dataPostId}
			initial={initial || { opacity: 0, y: 4 }}
			whileInView={whileInView}
			viewport={viewport}
			whileHover={whileHover}
			animate={whileInView ? undefined : { opacity: 1, y: 0 }}
			exit={{ opacity: 0, y: -4 }}
			transition={
				transition || { duration: 0.1, ease: "easeOut" }
			}
			className={baseClasses}
			onClick={onClick}>
			{!flat && <GlassGlossOverlay />}
			<div className={`relative z-10 w-full h-full ${contentClassName}`}>{children}</div>
		</motion.div>
	);
});
