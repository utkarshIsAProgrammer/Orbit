import React, { useState, useCallback } from "react";
import { createPortal } from "react-dom";
import Cropper from "react-easy-crop";
import { motion, AnimatePresence } from "motion/react";
import { Check, X } from "lucide-react";
import { logger } from "../utils/logger";

interface Point {
	x: number;
	y: number;
}
interface Area {
	width: number;
	height: number;
	x: number;
	y: number;
}

interface ImageCropModalProps {
	isOpen: boolean;
	onClose: () => void;
	imageSrc: string;
	aspectRatio?: number;
	onCropComplete: (croppedImageBlob: Blob) => void;
	title?: string;
	key?: React.Key;
}

export default function ImageCropModal({
	isOpen,
	onClose,
	imageSrc,
	aspectRatio,
	onCropComplete,
	title = "Crop Photo Layout",
}: ImageCropModalProps) {
	const [crop, setCrop] = useState<Point>({ x: 0, y: 0 });
	const [zoom, setZoom] = useState(1);
	const [rotation, setRotation] = useState(0);
	const [aspect, setAspect] = useState<number | undefined>(aspectRatio);
	const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(
		null,
	);

	// Escape key + focus trap
	const cropModalRef = React.useRef<HTMLDivElement>(null);

	React.useEffect(() => {
		if (!isOpen) return;
		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				onClose();
				return;
			}
			if (e.key === "Tab") {
				const modal = cropModalRef.current;
				if (!modal) return;
				const focusable = modal.querySelectorAll<HTMLElement>(
					'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
				);
				if (focusable.length === 0) return;
				const first = focusable[0];
				const last = focusable[focusable.length - 1];
				if (e.shiftKey) {
					if (document.activeElement === first) {
						e.preventDefault();
						last.focus();
					}
				} else {
					if (document.activeElement === last) {
						e.preventDefault();
						first.focus();
					}
				}
			}
		};
		window.addEventListener("keydown", handleKeyDown);
		// Focus first focusable element on open
		requestAnimationFrame(() => {
			const firstFocusable =
				cropModalRef.current?.querySelector<HTMLElement>(
					'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
				);
			firstFocusable?.focus();
		});
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [isOpen, onClose]);

	// Keep aspect local state in sync when prop changes
	React.useEffect(() => {
		setAspect(aspectRatio);
		setZoom(1);
		setRotation(0);
		setCrop({ x: 0, y: 0 });
	}, [aspectRatio, imageSrc]);

	const handleCropComplete = useCallback(
		(_croppedArea: Area, croppedAreaPixels: Area) => {
			setCroppedAreaPixels(croppedAreaPixels);
		},
		[],
	);

	const createCrop = async () => {
		if (!imageSrc || !croppedAreaPixels) return;

		try {
			const image = await createImage(imageSrc);
			const canvas = document.createElement("canvas");
			const ctx = canvas.getContext("2d");

			if (!ctx) return;

			// Ensure cropped dimensions are integers
			const { x, y, width, height } = croppedAreaPixels;
			// Downscale huge phone photos before upload — feeds render at most
			// a few hundred px wide and the server caps post images at 800px.
			// Capping the long side to 1600px (with auto quality on the server)
			// keeps uploads light without any visible quality loss.
			const MAX_DIM = 1600;
			const scale = Math.min(1, MAX_DIM / Math.max(width, height));
			const outW = Math.max(1, Math.round(width * scale));
			const outH = Math.max(1, Math.round(height * scale));

			canvas.width = outW;
			canvas.height = outH;

			// Handle translation for rotation if rotation is applied
			if (rotation) {
				ctx.translate(outW / 2, outH / 2);
				ctx.rotate((rotation * Math.PI) / 180);
				ctx.translate(-outW / 2, -outH / 2);
			}

			ctx.drawImage(image, x, y, width, height, 0, 0, outW, outH);

			canvas.toBlob(
				(blob) => {
					if (blob) {
						onCropComplete(blob);
						onClose();
					}
				},
				"image/jpeg",
				0.85,
			);
		} catch (e) {
			logger.error("Crop failed", e);
		}
	};

	if (!isOpen) return null;

	// Portal to document.body so the modal is positioned against the viewport,
	// not against transformed ancestors (GlassCard / motion wrappers) — a
	// transform or backdrop-filter on an ancestor turns it into the containing
	// block for `fixed` children, which would push the cropper down the page
	// and force the user to scroll to see the image.
	return createPortal(
		<AnimatePresence>
			<motion.div
				ref={cropModalRef}
				initial={{ opacity: 0 }}
				animate={{ opacity: 1 }}
				exit={{ opacity: 0 }}
				className="fixed inset-0 z-[320] flex items-center justify-center bg-black/90 backdrop-blur-md p-4 sm:p-6">
				<div className="relative flex h-full w-full max-w-2xl flex-col overflow-hidden rounded-3xl bg-zinc-950 border border-zinc-800 shadow-2xl">
					{/* Header */}
					<div className="flex items-center justify-between border-b border-zinc-800 bg-black p-4 relative z-10">
						<div className="text-left">
							<h3 className="text-label text-base font-semibold text-black dark:text-white">
								{title}
							</h3>
							<p className="text-[11px] text-zinc-500 font-bold">
								Drag to reposition, pinch/scroll to zoom
							</p>
						</div>
						<button
							onClick={onClose}
							className="flex h-8 w-8 items-center justify-center rounded-full bg-zinc-100 dark:bg-zinc-900 text-zinc-500 hover:text-black dark:hover:text-white transition-colors cursor-pointer">
							<X className="h-4 w-4" />
						</button>
					</div>

					{/* Cropper Container */}
					<div className="relative flex-1 bg-zinc-50 dark:bg-black/80">
						<Cropper
							image={imageSrc}
							crop={crop}
							zoom={zoom}
							rotation={rotation}
							aspect={aspect}
							onCropChange={setCrop}
							onCropComplete={handleCropComplete}
							onZoomChange={setZoom}
							onRotationChange={setRotation}
							onMediaLoaded={(_mediaSize) => {
								// aspect ratio is controlled by preset buttons
							}}
							objectFit="contain"
						/>
					</div>

					{/* Dimension Selector Bar */}
					<div className="flex flex-wrap items-center gap-2 border-t border-zinc-800 bg-zinc-900/60 p-3 relative z-10 justify-start">
						<span className="text-[11px] font-black uppercase tracking-wider text-zinc-400 dark:text-zinc-500 mr-2">
							Dimensions:
						</span>

						<button
							type="button"
							onClick={() => setAspect(1)}
							className={`px-3 py-1 rounded-full text-[12px] md:text-sm font-bold tracking-tight transition cursor-pointer ${
								aspect === 1
									? "pill-active"
									: "bg-zinc-900 border border-zinc-800 text-zinc-300 hover:bg-zinc-800"
							}`}>
							1:1 Square
						</button>

						<button
							type="button"
							onClick={() => setAspect(16 / 9)}
							className={`px-3 py-1 rounded-full text-[12px] md:text-sm font-bold tracking-tight transition cursor-pointer ${
								aspect === 16 / 9
									? "pill-active"
									: "bg-zinc-900 border border-zinc-800 text-zinc-300 hover:bg-zinc-800"
							}`}>
							16:9 Landscape
						</button>
					</div>

					{/* Controls Footer */}
					<div className="flex flex-col sm:flex-row items-center justify-between gap-4 border-t border-zinc-800 bg-black p-4 sm:p-6 relative z-10">
						<div className="flex flex-col w-full sm:w-1/2 gap-3">
							{/* Zoom slider */}
							<div className="flex items-center gap-4">
								<span className="text-sm font-semibold text-zinc-500 w-12 text-left">
									Zoom
								</span>
								<input
									type="range"
									value={zoom}
									min={1}
									max={3}
									step={0.05}
									aria-label="Zoom"
									onChange={(e) =>
										setZoom(Number(e.target.value))
									}
									className="h-1.5 w-full appearance-none rounded-full bg-zinc-200 dark:bg-zinc-700 outline-none
                  [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-black dark:[&::-webkit-slider-thumb]:bg-white"
								/>
							</div>
							{/* Rotate slider */}
							<div className="flex items-center gap-4">
								<span className="text-sm font-semibold text-zinc-500 w-12 text-left">
									Rotate
								</span>
								<input
									type="range"
									value={rotation}
									min={0}
									max={360}
									step={1}
									aria-label="Rotate"
									onChange={(e) =>
										setRotation(Number(e.target.value))
									}
									className="h-1.5 w-full appearance-none rounded-full bg-zinc-200 dark:bg-zinc-700 outline-none
                  [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-black dark:[&::-webkit-slider-thumb]:bg-white"
								/>
							</div>
						</div>
						<button
							onClick={createCrop}
							className="flex w-full sm:w-auto items-center justify-center gap-2 rounded-xl bg-aurora px-6 py-3 text-[12px] md:text-sm font-bold text-white border border-white/10 shadow-aurora hover:opacity-90 transition-transform cursor-pointer">
							Apply Crop <Check className="h-4 w-4" />
						</button>
					</div>
				</div>
			</motion.div>
		</AnimatePresence>,
		document.body,
	);
}

const createImage = (url: string): Promise<HTMLImageElement> =>
	new Promise((resolve, reject) => {
		const image = new Image();
		image.addEventListener("load", () => resolve(image));
		image.addEventListener("error", (error) => reject(error));
		image.src = url;
	});

// basic editing before upload: crop ratio, rotate 90deg, brightness slider
