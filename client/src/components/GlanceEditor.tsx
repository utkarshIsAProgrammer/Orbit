import { useState, useEffect, useRef, useMemo, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "motion/react";
import {
	X,
	Check,
	Loader2,
	Smartphone,
	Globe,
	Lock,
	Pencil,
	Type,
	Undo2,
	Trash2,
	Plus,
	ZoomIn,
	ZoomOut,
} from "lucide-react";
import { logger } from "../utils/logger";

type GlanceVisibility = "public" | "closeFriends";
type Tool = "draw" | "text" | null;

interface StrokePoint {
	x: number;
	y: number;
}

interface Stroke {
	points: StrokePoint[];
	color: string;
	width: number;
}

interface TextItem {
	id: string;
	text: string;
	x: number;
	y: number;
	color: string;
	size: number;
}

interface GlanceEditorProps {
	file: File;
	onClose: () => void;
	onApply: (blob: Blob, visibility: GlanceVisibility) => void;
}

const GLANCE_ASPECT = 9 / 16;
const MAX_ZOOM = 4;
// Stroke width + text size are normalized to the frame width so they scale
// identically in the on-screen preview and in the exported 720px canvas.
const DRAW_WIDTH = 0.014;
const TEXT_SIZE = 0.06;
const TEXT_MAX_LENGTH = 40;

// Black/white + the app's gold accent, then a few status-style colors.
const DRAW_COLORS = ["#ffffff", "#000000", "#f5c518", "#ef4444", "#10b981", "#38bdf8"];
const TEXT_COLORS = ["#ffffff", "#000000", "#f5c518", "#ef4444", "#10b981", "#38bdf8"];
const GLANCE_FONT = "'Playfair Display', serif";

const nextId = () =>
	`t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

// Fit the text font to the frame width. Long text scales DOWN so a 40-char
// string still fits inside the glance (preview + export share this formula).
const getTextFontSize = (text: string, baseW: number): number => {
	const base = Math.max(13, Math.round(baseW * TEXT_SIZE));
	const MAX_FIT_CHARS = 14;
	return text.length > MAX_FIT_CHARS
		? Math.max(11, Math.round((base * MAX_FIT_CHARS) / text.length))
		: base;
};

// Keep placed text inside the frame so it never clips at the edges.
const clampFrame = (v: number) => Math.min(0.85, Math.max(0.15, v));

/**
 * Pre-publish glance editor.
 * - Renders the image inside a strict 9:16 glance frame so users see exactly
 *   how it will look (whatsapp / instagram story style).
 * - A perfectly 9:16 media fills the whole frame edge-to-edge. Any other
 *   media is shown centered inside the frame and can be zoomed / dragged
 *   with pinch, mouse-wheel or the on-screen controls — the published
 *   glance is pixel-identical to the preview (letterbox bars included).
 * - TEXT + DRAWING: on photos you can type text and draw with your finger
 *   directly on the glance. Both are baked into the exported image.
 * - Emits the final image as a Blob via onApply.
 */
export default function GlanceEditor({ file, onClose, onApply }: GlanceEditorProps) {
	const [imageSrc, setImageSrc] = useState<string>("");
	const [applying, setApplying] = useState(false);
	// Public by default — tap the toggle to make it close-friends only.
	const [visibility, setVisibility] = useState<GlanceVisibility>("public");
	const modalRef = useRef<HTMLDivElement>(null);
	const frameRef = useRef<HTMLDivElement>(null);
	const drawingRef = useRef<HTMLCanvasElement>(null);
	const isVideo = file.type.startsWith("video/");

	// ── Text + drawing state ──────────────────────────────────────────
	const [tool, setTool] = useState<Tool>(null);
	const [drawColor, setDrawColor] = useState(DRAW_COLORS[0]);
	const [textColor, setTextColor] = useState(TEXT_COLORS[0]);
	const [strokes, setStrokes] = useState<Stroke[]>([]);
	const [currentStroke, setCurrentStroke] = useState<Stroke | null>(null);
	const [textItems, setTextItems] = useState<TextItem[]>([]);
	const [textInput, setTextInput] = useState("");
	const [draggingTextId, setDraggingTextId] = useState<string | null>(null);
	// When set, the text input bar edits this existing item live instead of
	// adding a new one (tap a placed text to edit it).
	const [editingTextId, setEditingTextId] = useState<string | null>(null);
	// Measured preview-frame size — used to size canvas + text live.
	const [frameSize, setFrameSize] = useState({ w: 0, h: 0 });

	// ── Media fit / zoom / pan ──────────────────────────────────────
	// Natural pixel size of the selected image (drives the fit + export crop).
	const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null);
	// Zoom (1 = the media fitted inside the frame) and pan, normalized to the
	// frame (0..1 across the width, 0..1 across the height).
	const [zoom, setZoom] = useState(1);
	const [pan, setPan] = useState({ x: 0, y: 0 });
	const zoomRef = useRef(1);
	const panRef = useRef({ x: 0, y: 0 });
	// Live pointer map + gesture state for pinch-zoom and drag-pan.
	const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
	const gestureRef = useRef<{
		mode: "pan" | "pinch";
		lastPoint?: { x: number; y: number };
		startDist?: number;
		startZoom?: number;
		startPan?: { x: number; y: number };
		midStart?: { x: number; y: number } | null;
	} | null>(null);

	// Create object URL for the selected file
	useEffect(() => {
		const url = URL.createObjectURL(file);
		setImageSrc(url);
		return () => URL.revokeObjectURL(url);
	}, [file]);

	// Read the natural image size so we can compute the fit + export crop.
	useEffect(() => {
		if (isVideo) {
			setNaturalSize(null);
			return;
		}
		let cancelled = false;
		const img = new Image();
		img.onload = () => {
			if (!cancelled && img.naturalWidth > 0 && img.naturalHeight > 0) {
				setNaturalSize({ w: img.naturalWidth, h: img.naturalHeight });
			}
		};
		img.src = imageSrc;
		return () => {
			cancelled = true;
		};
	}, [imageSrc, isVideo]);

	// Reset zoom/pan when a new file is picked.
	useEffect(() => {
		setZoom(1);
		zoomRef.current = 1;
		setPan({ x: 0, y: 0 });
		panRef.current = { x: 0, y: 0 };
		pointersRef.current.clear();
		gestureRef.current = null;
	}, [file]);

	// Escape key to close + focus trap (same pattern as ImageCropModal)
	useEffect(() => {
		if (!imageSrc) return;
		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				onClose();
				return;
			}
			if (e.key === "Tab") {
				const modal = modalRef.current;
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
		requestAnimationFrame(() => {
			const firstFocusable = modalRef.current?.querySelector<HTMLElement>(
				'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
			);
			firstFocusable?.focus();
		});
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [imageSrc, onClose]);

	// Track the preview-frame size so the drawing canvas and text scale with it.
	useEffect(() => {
		const frame = frameRef.current;
		if (!frame) return;
		const ro = new ResizeObserver((entries) => {
			const r = entries[0]?.contentRect;
			if (r && r.width > 0 && r.height > 0) {
				setFrameSize({ w: r.width, h: r.height });
			}
		});
		ro.observe(frame);
		return () => ro.disconnect();
	}, [imageSrc]);

	// Redraw all strokes on the preview canvas whenever they change or the
	// frame resizes. Coordinates are normalized (0..1) and scaled to the frame.
	useEffect(() => {
		const canvas = drawingRef.current;
		const frame = frameRef.current;
		if (!canvas || !frame) return;
		const rect = frame.getBoundingClientRect();
		if (rect.width === 0 || rect.height === 0) return;
		const dpr = Math.min(window.devicePixelRatio || 1, 2);
		canvas.width = Math.round(rect.width * dpr);
		canvas.height = Math.round(rect.height * dpr);
		const ctx = canvas.getContext("2d");
		if (!ctx) return;
		ctx.scale(dpr, dpr);
		ctx.lineCap = "round";
		ctx.lineJoin = "round";
		ctx.clearRect(0, 0, rect.width, rect.height);
		const w = rect.width;
		const h = rect.height;
		const drawStroke = (s: Stroke) => {
			const lineW = Math.max(1, s.width * w);
			if (s.points.length < 2) {
				ctx.beginPath();
				ctx.arc(
					s.points[0].x * w,
					s.points[0].y * h,
					lineW / 2,
					0,
					Math.PI * 2,
				);
				ctx.fillStyle = s.color;
				ctx.fill();
				return;
			}
			ctx.beginPath();
			ctx.strokeStyle = s.color;
			ctx.lineWidth = lineW;
			ctx.moveTo(s.points[0].x * w, s.points[0].y * h);
			for (let i = 1; i < s.points.length; i++) {
				ctx.lineTo(s.points[i].x * w, s.points[i].y * h);
			}
			ctx.stroke();
		};
		strokes.forEach(drawStroke);
		if (currentStroke) drawStroke(currentStroke);
	}, [strokes, currentStroke, frameSize]);

	const createImage = (url: string): Promise<HTMLImageElement> =>
		new Promise((resolve, reject) => {
			const image = new Image();
			image.addEventListener("load", () => resolve(image));
			image.addEventListener("error", (error) => reject(error));
			image.src = url;
		});

	// Normalize a pointer position to 0..1 within the preview frame.
	const getFramePoint = (
		e: ReactPointerEvent,
	): { x: number; y: number } | null => {
		const frame = frameRef.current;
		if (!frame) return null;
		const rect = frame.getBoundingClientRect();
		if (rect.width === 0 || rect.height === 0) return null;
		return {
			x: Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)),
			y: Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height)),
		};
	};

	// ── Media fit + zoom/pan math ───────────────────────────────────
	// Fit of the image inside the 9:16 frame, normalized to the frame (both
	// axes 0..1). zoom=1 shows the whole image centered — a perfectly 9:16
	// media fills the frame edge-to-edge with no bars.
	const fitN = useMemo(() => {
		if (!naturalSize || naturalSize.w <= 0 || naturalSize.h <= 0) return null;
		const s = Math.min(1 / naturalSize.w, 1 / naturalSize.h);
		return { w: naturalSize.w * s, h: naturalSize.h * s };
	}, [naturalSize]);

	const isExactRatio = !!(
		fitN &&
		Math.abs(fitN.w - GLANCE_ASPECT) < 0.012 &&
		Math.abs(fitN.h - 1) < 0.012
	);

	const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(1, z));

	const clampPan = (p: { x: number; y: number }, z: number) => {
		if (!fitN) return { x: 0, y: 0 };
		const mx = Math.max(0, (fitN.w * z - 1) / 2);
		const my = Math.max(0, (fitN.h * z - 1) / 2);
		return {
			x: Math.min(mx, Math.max(-mx, p.x)),
			y: Math.min(my, Math.max(-my, p.y)),
		};
	};

	const applyTransform = (next: { zoom?: number; pan?: { x: number; y: number } }) => {
		const z = next.zoom !== undefined ? clampZoom(next.zoom) : zoomRef.current;
		zoomRef.current = z;
		setZoom(z);
		const p = clampPan(next.pan ?? panRef.current, z);
		panRef.current = p;
		setPan(p);
	};

	// Convert pointer coords to normalized frame coords (0..1 on both axes).
	const getFramePointNorm = (e: { clientX: number; clientY: number }) => {
		const frame = frameRef.current;
		if (!frame) return null;
		const rect = frame.getBoundingClientRect();
		if (rect.width === 0 || rect.height === 0) return null;
		return {
			x: (e.clientX - rect.left) / rect.width,
			y: (e.clientY - rect.top) / rect.height,
		};
	};

	// Desktop: mouse-wheel zoom over the frame.
	useEffect(() => {
		const frame = frameRef.current;
		if (!frame) return;
		const onWheel = (e: WheelEvent) => {
			if (isVideo || isExactRatio) return;
			e.preventDefault();
			const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
			applyTransform({ zoom: zoomRef.current * factor });
		};
		frame.addEventListener("wheel", onWheel, { passive: false });
		return () => frame.removeEventListener("wheel", onWheel);
	}, [isVideo, isExactRatio, fitN]);

	const handleDoubleClick = () => {
		if (isVideo || tool !== null || isExactRatio) return;
		// No reset-zoom while the glance is publishing.
		if (applying) return;
		applyTransform({ zoom: 1, pan: { x: 0, y: 0 } });
	};

	// ── Drawing (finger gestures) ────────────────────────────────────
	const handleFramePointerDown = (e: ReactPointerEvent) => {
		if (isVideo) return;
		// Block all drawing / panning gestures while the glance is publishing.
		if (applying) return;
		if (tool === "draw") {
			e.preventDefault();
			const p = getFramePoint(e);
			if (!p) return;
			frameRef.current?.setPointerCapture?.(e.pointerId);
			setCurrentStroke({ points: [p], color: drawColor, width: DRAW_WIDTH });
		} else if (tool === "text" && textInput.trim()) {
			// Tap anywhere on the glance to place the typed text there.
			const p = getFramePoint(e);
			if (!p) return;
			addTextItem(p.x, p.y);
		} else if (
			tool === null &&
			!isExactRatio &&
			fitN &&
			(e.pointerType !== "mouse" || e.button === 0)
		) {
			// Zoom / pan gesture (media smaller or larger than the frame).
			pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
			frameRef.current?.setPointerCapture?.(e.pointerId);
			if (pointersRef.current.size === 1) {
				gestureRef.current = {
					mode: "pan",
					lastPoint: { x: e.clientX, y: e.clientY },
				};
			} else if (pointersRef.current.size === 2) {
				const [p1, p2] = [...pointersRef.current.values()];
				const mid = getFramePointNorm({
					clientX: (p1.x + p2.x) / 2,
					clientY: (p1.y + p2.y) / 2,
				});
				gestureRef.current = {
					mode: "pinch",
					startDist: Math.hypot(p1.x - p2.x, p1.y - p2.y),
					startZoom: zoomRef.current,
					startPan: { ...panRef.current },
					midStart: mid,
				};
			}
		}
	};

	const handleFramePointerMove = (e: ReactPointerEvent) => {
		if (isVideo) return;
		if (applying) return;
		if (tool === "draw") {
			e.preventDefault();
			const p = getFramePoint(e);
			if (!p) return;
			setCurrentStroke((prev) =>
				prev ? { ...prev, points: [...prev.points, p] } : prev,
			);
			return;
		}
		if (tool !== null || !gestureRef.current) return;
		if (!pointersRef.current.has(e.pointerId)) return;
		pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
		const g = gestureRef.current;
		if (g.mode === "pan") {
			const dx = e.clientX - (g.lastPoint?.x ?? e.clientX);
			const dy = e.clientY - (g.lastPoint?.y ?? e.clientY);
			g.lastPoint = { x: e.clientX, y: e.clientY };
			const prev = panRef.current;
			applyTransform({
				pan: {
					x: prev.x + dx / (frameSize.w || 1),
					y: prev.y + dy / (frameSize.h || 1),
				},
			});
		} else if (g.mode === "pinch" && pointersRef.current.size >= 2) {
			const [p1, p2] = [...pointersRef.current.values()];
			const dist = Math.hypot(p1.x - p2.x, p1.y - p2.y);
			if (dist <= 0 || !g.startDist || !g.startZoom) return;
			const newZoom = clampZoom(g.startZoom * (dist / g.startDist));
			const midNow = getFramePointNorm({
				clientX: (p1.x + p2.x) / 2,
				clientY: (p1.y + p2.y) / 2,
			});
			let nextPan = { ...g.startPan! };
			if (midNow && g.midStart && g.startPan) {
				// Keep the pinch midpoint anchored under the fingers. The CSS
				// transform is translate(pan) scale(zoom) about the element's
				// center (frame center + pan), so the center must be subtracted
				// before scaling the finger offset back to pan space.
				const c = 0.5;
				nextPan = {
					x:
						midNow.x -
						c -
						newZoom * ((g.midStart.x - c - g.startPan.x) / g.startZoom),
					y:
						midNow.y -
						c -
						newZoom * ((g.midStart.y - c - g.startPan.y) / g.startZoom),
				};
			}
			applyTransform({ zoom: newZoom, pan: nextPan });
		}
	};

	const handleFramePointerUp = (e: ReactPointerEvent) => {
		if (isVideo) return;
		if (tool === "draw") {
			if (!currentStroke) return;
			if (currentStroke.points.length > 0) {
				setStrokes((prev) => [...prev, currentStroke]);
			}
			setCurrentStroke(null);
			return;
		}
		if (tool !== null) return;
		pointersRef.current.delete(e.pointerId);
		const g = gestureRef.current;
		if (!g) return;
		if (pointersRef.current.size === 1) {
			const [p] = [...pointersRef.current.values()];
			g.mode = "pan";
			g.lastPoint = { x: p.x, y: p.y };
		} else if (pointersRef.current.size === 0) {
			gestureRef.current = null;
		}
	};

	// ── Text tool ────────────────────────────────────────────────────
	const addTextItem = (x = 0.5, y = 0.5) => {
		const text = textInput.trim();
		if (!text) return;
		// If an item is being edited, typing in the bar updates it live.
		if (editingTextId) {
			setTextItems((prev) =>
				prev.map((t) =>
					t.id === editingTextId
						? { ...t, text: textInput.trimEnd() }
						: t,
				),
			);
			return;
		}
		setTextItems((prev) => [
			...prev,
			{
				id: nextId(),
				text,
				x: clampFrame(x),
				y: clampFrame(y),
				color: textColor,
				size: TEXT_SIZE,
			},
		]);
		setTextInput("");
	};

	// Load an existing text item into the input bar so it can be edited live.
	const startEditingText = (item: TextItem) => {
		setEditingTextId(item.id);
		setTextInput(item.text);
		setTool("text");
	};

	// Live-update the item's text while the user types in the bar.
	const updateTextItem = (id: string, text: string) => {
		setTextItems((prev) =>
			prev.map((t) => (t.id === id ? { ...t, text } : t)),
		);
	};

	// Commit an in-progress edit when the user taps Add / presses Enter.
	const commitTextEdit = () => {
		if (editingTextId) {
			const text = textInput.trimEnd();
			if (!text) {
				// Empty text while editing — remove the item.
				removeTextItem(editingTextId);
			}
			setEditingTextId(null);
			setTextInput("");
		} else {
			addTextItem();
		}
	};

	const removeTextItem = (id: string) => {
		setTextItems((prev) => prev.filter((t) => t.id !== id));
	};

	const startTextDrag = (id: string, e: ReactPointerEvent) => {
		e.stopPropagation();
		const frame = frameRef.current;
		if (!frame) return;
		const rect = frame.getBoundingClientRect();
		if (rect.width === 0) return;
		const startX = e.clientX;
		const startY = e.clientY;
		const item = textItems.find((t) => t.id === id);
		if (!item) return;
		const baseX = item.x;
		const baseY = item.y;
		setDraggingTextId(id);
		const onMove = (ev: PointerEvent) => {
			const nx = Math.min(
				0.88,
				Math.max(0.12, baseX + (ev.clientX - startX) / rect.width),
			);
			const ny = Math.min(
				0.88,
				Math.max(0.12, baseY + (ev.clientY - startY) / rect.height),
			);
			setTextItems((prev) =>
				prev.map((t) => (t.id === id ? { ...t, x: nx, y: ny } : t)),
			);
		};
		const onUp = () => {
			window.removeEventListener("pointermove", onMove);
			window.removeEventListener("pointerup", onUp);
			setDraggingTextId(null);
		};
		window.addEventListener("pointermove", onMove);
		window.addEventListener("pointerup", onUp);
	};

	const undoLast = () => {
		if (currentStroke) return;
		if (strokes.length > 0) {
			setStrokes((prev) => prev.slice(0, -1));
			return;
		}
		if (textItems.length > 0) {
			setTextItems((prev) => prev.slice(0, -1));
		}
	};

	const clearAnnotations = () => {
		setStrokes([]);
		setTextItems([]);
		setCurrentStroke(null);
	};

	const toggleTool = (next: Tool) => {
		setTool((prev) => (prev === next ? null : next));
		// Leaving the Text tool drops any in-progress edit.
		if (next !== "text") {
			setEditingTextId(null);
			setTextInput("");
		}
	};

	// Bake the image + strokes + text into the final 9:16 canvas.
	const createCrop = async () => {
		if (!imageSrc) return;
		// Guard against a fast double-click before React re-renders disabled.
		if (applying) return;
		setApplying(true);

		// Videos pass through untouched — no client-side re-encode. Text and
		// drawing are only available on photos (baked at export).
		if (isVideo) {
			try {
				await onApply(file, visibility);
			} catch (e) {
				logger.error("Glance editor: publish failed", e);
			} finally {
				// Always release the lock so a failed upload can't leave the
				// editor permanently disabled.
				setApplying(false);
			}
			return;
		}

		try {
			const image = await createImage(imageSrc);
			const canvas = document.createElement("canvas");
			const ctx = canvas.getContext("2d");
			if (!ctx) return;

			// Fixed 9:16 output canvas. The visible region of the image is
			// derived from the on-screen zoom/pan so the published glance is
			// pixel-identical to the preview — matching media fills the frame
			// edge-to-edge, smaller media keeps its centered letterbox bars.
			const imgW = image.naturalWidth;
			const imgH = image.naturalHeight;
			const OUT_W = 720;
			const OUT_H = 1280;
			canvas.width = OUT_W;
			canvas.height = OUT_H;
			ctx.fillStyle = "#000";
			ctx.fillRect(0, 0, OUT_W, OUT_H);

			// Fit the whole image inside the 9:16 frame (normalized 0..1 coords).
			const fitScale = Math.min(1 / imgW, 1 / imgH);
			const fitW = imgW * fitScale;
			const fitH = imgH * fitScale;
			const z = zoomRef.current;
			const p = panRef.current;
			const cx = 0.5 + p.x;
			const cy = 0.5 + p.y;
			const x0d = cx - (fitW * z) / 2;
			const y0d = cy - (fitH * z) / 2;
			const x1d = x0d + fitW * z;
			const y1d = y0d + fitH * z;
			const visX0 = Math.max(0, Math.min(1, x0d));
			const visY0 = Math.max(0, Math.min(1, y0d));
			const visX1 = Math.max(0, Math.min(1, x1d));
			const visY1 = Math.max(0, Math.min(1, y1d));
			const visW = visX1 - visX0;
			const visH = visY1 - visY0;

			ctx.drawImage(
				image,
				(visX0 - x0d) / (fitScale * z),
				(visY0 - y0d) / (fitScale * z),
				visW / (fitScale * z),
				visH / (fitScale * z),
				visX0 * OUT_W,
				visY0 * OUT_H,
				visW * OUT_W,
				visH * OUT_H,
			);

			// Draw the finger strokes (normalized → canvas coords)
			ctx.lineCap = "round";
			ctx.lineJoin = "round";
			strokes.forEach((s) => {
				const lineW = Math.max(1, s.width * OUT_W);
				if (s.points.length < 2) {
					ctx.beginPath();
					ctx.arc(s.points[0].x * OUT_W, s.points[0].y * OUT_H, lineW / 2, 0, Math.PI * 2);
					ctx.fillStyle = s.color;
					ctx.fill();
					return;
				}
				ctx.beginPath();
				ctx.strokeStyle = s.color;
				ctx.lineWidth = lineW;
				ctx.moveTo(s.points[0].x * OUT_W, s.points[0].y * OUT_H);
				for (let i = 1; i < s.points.length; i++) {
					ctx.lineTo(s.points[i].x * OUT_W, s.points[i].y * OUT_H);
				}
				ctx.stroke();
			});

			// Draw the text (centered, with a soft dark outline for contrast)
			ctx.textAlign = "center";
			ctx.textBaseline = "middle";
			textItems.forEach((t) => {
				const fontSize = getTextFontSize(t.text, OUT_W);
				ctx.font = `600 ${fontSize}px ${GLANCE_FONT}`;
				ctx.lineWidth = Math.max(2, fontSize / 10);
				ctx.strokeStyle = "rgba(0,0,0,0.55)";
				ctx.strokeText(t.text, t.x * OUT_W, t.y * OUT_H);
				ctx.fillStyle = t.color;
				ctx.fillText(t.text, t.x * OUT_W, t.y * OUT_H);
			});

			canvas.toBlob(
				(blob) => {
					setApplying(false);
					if (blob) {
						onApply(blob, visibility);
					} else {
						logger.error("Glance editor: canvas.toBlob returned null");
					}
				},
				"image/jpeg",
				0.8,
			);
		} catch (e) {
			setApplying(false);
			logger.error("Glance editor: crop failed", e);
		}
	};

	return createPortal(
		<AnimatePresence>
			<motion.div
				ref={modalRef}
				initial={{ opacity: 0 }}
				animate={{ opacity: 1 }}
				exit={{ opacity: 0 }}
				className="fixed inset-0 z-[400] flex items-center justify-center bg-black/90 backdrop-blur-md p-3 sm:p-6">
				<div className="relative flex h-full w-full max-w-3xl flex-col overflow-x-hidden overflow-y-auto rounded-3xl bg-zinc-950 border border-zinc-800 shadow-2xl">
					{/* Header */}
					<div className="flex items-center justify-between border-b border-zinc-800 bg-black p-4 relative z-10">
						<div className="text-left">
							<h3 className="text-base font-semibold text-white">
								Edit Glance
							</h3>
							<p className="text-[11px] text-zinc-500 font-bold">
								{isVideo
									? "Preview your glance — max 1 minute"
									: "Draw & add text, then publish"}
							</p>
						</div>
						<button
							onClick={onClose}
							disabled={applying}
							className="flex h-8 w-8 items-center justify-center rounded-full bg-zinc-100 dark:bg-zinc-900 text-zinc-500 hover:text-black dark:hover:text-white transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed">
							<X className="h-4 w-4" />
						</button>
					</div>

					{/* Preview — fixed 9:16 frame, center-cropped exactly as it will publish */}
					<div className="relative flex-1 bg-black/90 flex items-center justify-center p-3 sm:p-4 min-h-0">
						<div
							ref={frameRef}
							className="relative h-full max-h-[62vh] w-auto overflow-hidden rounded-2xl border border-white/10 shadow-2xl select-none"
							style={{
								aspectRatio: "9 / 16",
								// Annotation tools and zoomable media capture all gestures;
								// perfectly-matching media lets the page scroll normally.
								touchAction: tool ? "none" : isExactRatio ? "pan-y" : "none",
							}}
							onPointerDown={handleFramePointerDown}
							onPointerMove={handleFramePointerMove}
							onPointerUp={handleFramePointerUp}
							onPointerCancel={handleFramePointerUp}
							onDoubleClick={handleDoubleClick}>
							{imageSrc &&
								(isVideo ? (
									<video
										src={imageSrc}
										controls
										autoPlay
										muted
										loop
										playsInline
										className="h-full w-full object-cover select-none"
									/>
							) : (
								<div className="absolute inset-0 flex items-center justify-center overflow-hidden">
									<div
										className="relative"
										style={{
											width: `${(fitN?.w ?? 0) * 100}%`,
											height: `${(fitN?.h ?? 0) * 100}%`,
											transform: `translate(${
												pan.x * (frameSize.w || 0)
											}px, ${pan.y * (frameSize.h || 0)}px) scale(${zoom})`,
											transformOrigin: "center center",
											willChange: "transform",
										}}>
										<img
											src={imageSrc}
											alt="Glance preview"
											draggable={false}
											className="h-full w-full object-contain select-none pointer-events-none"
										/>
									</div>
								</div>
							))}

							{/* Drawing layer — strokes render here (above the photo) */}
							{!isVideo && (
								<canvas
									ref={drawingRef}
									className="pointer-events-none absolute inset-0 h-full w-full"
								/>
							)}

							{/* Text layer — draggable text items */}
							{!isVideo &&
								textItems.map((item) => (
									<div
										key={item.id}
										onPointerDown={(e) => {
											if (tool === "draw") return;
											startTextDrag(item.id, e);
										}}
										className={`group absolute -translate-x-1/2 -translate-y-1/2 cursor-move ${
											tool === "draw" ? "pointer-events-none" : ""
										} ${
											draggingTextId === item.id ||
											editingTextId === item.id
												? "outline outline-2 outline-white/70 rounded-none"
												: tool === "text"
													? "outline outline-1 outline-dashed outline-white/25 rounded-none hover:outline-white/60"
													: ""
										}`}
										style={{
											left: `${item.x * 100}%`,
											top: `${item.y * 100}%`,
											touchAction: "none",
										}}>
										<span
											className="whitespace-nowrap"
											onClick={(e) => {
												e.stopPropagation();
												// Tap the text itself to edit it.
												if (tool === "text" || tool === null) {
													startEditingText(item);
												}
											}}
											style={{
												color: item.color,
												fontFamily: GLANCE_FONT,
												fontWeight: 600,													fontSize: getTextFontSize(
														item.text,
														frameSize.w,
													),
												lineHeight: 1.15,
												textShadow:
													"0 1px 3px rgba(0,0,0,0.7), 0 0 1px rgba(0,0,0,0.8)",
											}}>
											{item.text}
										</span>
										<button
											type="button"
												disabled={applying}
												onPointerDown={(e) => e.stopPropagation()}
												onClick={(e) => {
													e.stopPropagation();
													// Tap a placed text while the Text tool is active to edit it.
													if (!applying) startEditingText(item);
												}}
											className={`absolute -top-3 -right-2 flex h-5 w-5 items-center justify-center rounded-none border border-white/40 bg-zinc-900 text-zinc-200 shadow-md transition-colors cursor-pointer hover:bg-aurora hover:text-white disabled:opacity-40 disabled:cursor-not-allowed ${
												item.id === editingTextId ? "bg-aurora text-white" : "opacity-80"
											}`}
											aria-label={editingTextId === item.id ? "Editing text" : "Edit text"}
											title={editingTextId === item.id ? "Editing text — edit in the bar below" : "Edit text"}>
											<Pencil className="h-2.5 w-2.5" />
										</button>
										<button
											disabled={applying}
											onPointerDown={(e) => e.stopPropagation()}
											onClick={(e) => {
												e.stopPropagation();
												if (!applying) removeTextItem(item.id);
											}}
											className="absolute -top-2.5 -left-2.5 flex h-4 w-4 items-center justify-center rounded-none border border-red-400/50 bg-red-500 text-white shadow-md transition-colors cursor-pointer hover:bg-red-600 disabled:opacity-40 disabled:cursor-not-allowed"
											aria-label="Remove text"
											title="Remove text">
											<X className="h-2.5 w-2.5" />
										</button>
									</div>
								))}

							{/* Zoom/pan hint — only when the media can actually be moved */}
							{!isVideo && tool === null && fitN && !isExactRatio && (
								<div className="pointer-events-none absolute left-1/2 top-2 z-20 -translate-x-1/2">
									<span className="rounded-full border border-white/10 bg-black/70 px-3 py-1 text-[10px] font-bold text-zinc-200 backdrop-blur-sm">
										Pinch to zoom · drag to move
									</span>
								</div>
							)}
			{/* Zoom controls — always available for non-matching media */}
			{!isVideo && fitN && !isExactRatio && (
				<div
					onPointerDown={(e) => e.stopPropagation()}
					className="absolute bottom-2 right-2 z-20 flex items-center gap-0.5 rounded-full border border-white/10 bg-black/70 p-1 backdrop-blur-sm">									<button
										type="button"
										onClick={() =>
											applyTransform({ zoom: zoom / 1.25 })
										}
										disabled={applying || zoom <= 1}
										aria-label="Zoom out"
										className="flex h-6 w-6 items-center justify-center rounded-full text-white transition-colors hover:bg-white/10 disabled:opacity-30 cursor-pointer">
										<ZoomOut className="h-3.5 w-3.5" />
									</button>
									<button
										type="button"
										onClick={() =>
											applyTransform({ zoom: 1, pan: { x: 0, y: 0 } })
										}
										disabled={applying}
										aria-label="Reset zoom"
										className="rounded-full px-2 py-0.5 text-[10px] font-bold text-zinc-300 transition-colors hover:bg-white/10 hover:text-white cursor-pointer">
										1x
									</button>
									<button
										type="button"
										onClick={() => applyTransform({ zoom: zoom * 1.25 })}
										disabled={applying || zoom >= MAX_ZOOM}
										aria-label="Zoom in"
										className="flex h-6 w-6 items-center justify-center rounded-full text-white transition-colors hover:bg-white/10 disabled:opacity-30 cursor-pointer">
										<ZoomIn className="h-3.5 w-3.5" />
									</button>
								</div>
							)}
						</div>
					</div>

					{/* Text input bar — visible while the Text tool is active */}
					{!isVideo && (tool === "text" || editingTextId) && (
						<div className="flex items-center gap-2 border-t border-zinc-800 bg-zinc-950 px-3 py-2.5 relative z-10">
							<input
								value={textInput}
								onChange={(e) => {											const val = e.target.value;
											setTextInput(val);
											// Live-edit the selected item as the user types.
											if (editingTextId) updateTextItem(editingTextId, val);
										}}
										onKeyDown={(e) => {
											if (e.key === "Enter") {
												e.preventDefault();
												commitTextEdit();
											}
										}}
										disabled={applying}
										placeholder={
									editingTextId
										? "Edit the selected text…"
										: "Type your text, then tap the glance to place it…"
								}
								maxLength={TEXT_MAX_LENGTH}
								className="flex-1 rounded-full border border-zinc-800 bg-zinc-900 px-4 py-2 text-[12px] text-white placeholder-zinc-500 outline-none focus:border-white transition-all"
							/>
							<button
								type="button"
								onClick={() => commitTextEdit()}
								disabled={applying || !textInput.trim()}
								className="flex items-center gap-1 rounded-full bg-aurora px-3.5 py-2 text-[11px] font-bold text-white border border-white/10 shadow-aurora hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-all cursor-pointer">
								{editingTextId ? (
									<Check className="h-3.5 w-3.5" />
								) : (
									<Plus className="h-3.5 w-3.5" />
								)}
								{editingTextId ? "Done" : "Add"}
							</button>
						</div>
					)}

					{/* Tools bar — draw / text / colors / undo / clear (photos only) */}
					{isVideo && (
						<div className="flex items-center justify-center border-t border-zinc-800 bg-zinc-950 px-3 py-2.5 relative z-10">
							<span className="text-[10px] font-semibold text-zinc-500">
								Text &amp; drawing are available on photo glances
							</span>
						</div>
					)}
					{!isVideo && (
						<div className="flex items-center gap-2 border-t border-zinc-800 bg-zinc-950 px-3 py-2.5 relative z-10 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
						<button
							type="button"
							disabled={applying}
							onClick={() => toggleTool("draw")}
							className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-bold transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
									tool === "draw"												? "bg-aurora text-white"
												: "text-zinc-400 hover:text-white hover:bg-zinc-900"
								}`}>
								<Pencil className="h-3.5 w-3.5" />
								Draw
							</button>
							<button
								type="button"
								disabled={applying}
								onClick={() => toggleTool("text")}
								className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-bold transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
									tool === "text"												? "bg-aurora text-white"
												: "text-zinc-400 hover:text-white hover:bg-zinc-900"
								}`}>
								<Type className="h-3.5 w-3.5" />
								Text
							</button>

							{/* Color swatches for the active tool */}
							{tool && (
								<div className="flex items-center gap-1.5 pl-1 border-l border-zinc-800">
									{(tool === "draw" ? DRAW_COLORS : TEXT_COLORS).map(
										(color) => (
											<button
												key={color}
												type="button"
												disabled={applying}
												onClick={() =>
													tool === "draw"
														? setDrawColor(color)
														: setTextColor(color)
												}
												aria-label={`Pick color ${color}`}
												className={`h-5 w-5 rounded-full border transition-all cursor-pointer ${
													(tool === "draw"
														? drawColor
														: textColor) === color
														? "ring-2 ring-white border-black"
														: "border-zinc-600"
												}`}
												style={{ backgroundColor: color }}
											/>
										),
									)}
								</div>
							)}

							<div className="ml-auto flex items-center gap-1">
								<button
									type="button"
									onClick={undoLast}
									disabled={applying || (strokes.length === 0 && textItems.length === 0)}
									title="Undo last"
									aria-label="Undo last"
									className="flex h-7 w-7 items-center justify-center rounded-full text-zinc-400 hover:bg-zinc-900 hover:text-white disabled:opacity-30 transition-all cursor-pointer">
									<Undo2 className="h-3.5 w-3.5" />
								</button>
								<button
									type="button"
									onClick={clearAnnotations}
									disabled={applying || (strokes.length === 0 && textItems.length === 0)}
									title="Clear all"
									aria-label="Clear all annotations"
									className="flex h-7 w-7 items-center justify-center rounded-full text-zinc-400 hover:bg-red-500/10 hover:text-red-400 disabled:opacity-30 transition-all cursor-pointer">
									<Trash2 className="h-3.5 w-3.5" />
								</button>
							</div>
						</div>
					)}

					{/* Glance format indicator — always a fixed 9:16 frame */}
					<div className="flex items-center gap-2 border-t border-zinc-800 bg-zinc-900/60 p-3 relative z-10">
						<span className="flex items-center gap-1.5 rounded-full bg-aurora text-white px-3 py-1.5 text-[11px] font-bold">
							<Smartphone className="h-3.5 w-3.5" />
							{isVideo ? "Video Glance" : "9:16 Glance"}
						</span>
					</div>

					{/* Controls Footer */}
					<div className="flex items-center justify-between gap-3 border-t border-zinc-800 bg-black p-4 sm:p-5 relative z-10">
						{/* Audience toggle — public by default, tap for close friends only */}
						<div className="flex items-center gap-1 rounded-full border border-zinc-800 bg-zinc-900/60 p-1">
							<button
								type="button"
								disabled={applying}
								onClick={() => setVisibility("public")}
								className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-bold transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
									visibility === "public"												? "bg-aurora text-white"
												: "text-zinc-400 hover:text-white"
								}`}
							>
								<Globe className="h-3.5 w-3.5" />
								Public
							</button>
							<button
								type="button"
								disabled={applying}
								onClick={() => setVisibility("closeFriends")}
								className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-bold transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
									visibility === "closeFriends"
										? "bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-500/40"
										: "text-zinc-400 hover:text-white"
								}`}
							>
								<Lock className="h-3.5 w-3.5" />
								Close friends
							</button>
						</div>
						<div className="flex items-center gap-3">
						<button
							type="button"
							onClick={onClose}
							disabled={applying}
							className="rounded-full border border-zinc-700 px-5 py-2.5 text-[12px] font-bold text-zinc-300 hover:bg-zinc-900 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed">
							Cancel
						</button>
						<button
							onClick={createCrop}
							disabled={applying}
							className="flex items-center justify-center gap-2 rounded-xl bg-aurora px-6 py-2.5 text-[12px] md:text-sm font-bold text-white border border-white/10 shadow-aurora hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-all cursor-pointer">
							{applying ? (
								<Loader2 className="h-4 w-4 animate-spin" />
							) : (
								<>
									<Check className="h-4 w-4" />
									Post
								</>
							)}
						</button>
						</div>
					</div>
				</div>
			</motion.div>
		</AnimatePresence>,
		document.body,
	);
}
