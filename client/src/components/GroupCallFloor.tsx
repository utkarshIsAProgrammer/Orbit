import React, { useState, useEffect, useRef, useCallback } from "react";
import {
	LiveKitRoom,
	useGridLayout,
	useTracks,
	useLocalParticipant,
	useParticipantTile,
	useParticipantInfo,
	useIsSpeaking,
	ParticipantContextIfNeeded,
	VideoTrack,
	RoomAudioRenderer,
} from "@livekit/components-react";
import type {
	GridLayoutDefinition,
	TrackReferenceOrPlaceholder,
} from "@livekit/components-core";
import { Track, type LocalParticipant } from "livekit-client";
import { isMobileDevice } from "../utils/device";

/**
 * Grid layouts tuned for phones. LiveKit's defaults gate 2×2 behind
 * minWidth 560 and 3×3 behind 700 — on a portrait phone (≤400px wide)
 * 4+ participants collapsed to a 2-tile grid with pagination instead of
 * equal tiles. These layouts fit the same grid into narrow screens:
 * 2×2 works at any width, 3×3 from 320px, 4×4 from 560px, 5×5 from 800px.
 */
const PHONE_FRIENDLY_LAYOUTS: GridLayoutDefinition[] = [
	{ columns: 1, rows: 1 },
	{ columns: 1, rows: 2, orientation: "portrait" },
	{ columns: 2, rows: 1, orientation: "landscape" },
	{ columns: 2, rows: 2 },
	{ columns: 3, rows: 3, minWidth: 320 },
	{ columns: 4, rows: 4, minWidth: 560 },
	{ columns: 5, rows: 5, minWidth: 800 },
];

/**
 * Equal-parts participant grid.
 *
 * LiveKit's <GridLayout /> renders a `.lk-grid-layout` div that ONLY gets
 * its grid behavior from the @livekit/components-styles package — which
 * this app does not import — so its tiles actually stacked vertically
 * instead of dividing the screen equally. This replacement keeps LiveKit's
 * `useGridLayout` (orientation-aware, resize-observed layout selection)
 * but applies the grid rules with INLINE styles, so it works without the
 * missing stylesheet. Tiles are cloned with their trackRef, same contract
 * as the stock component.
 */
function OrbitGrid({
	tracks,
	children,
}: {
	tracks: TrackReferenceOrPlaceholder[];
	children: React.ReactElement;
}) {
	const gridRef = useRef<HTMLDivElement>(null);
	const { layout } = useGridLayout(
		gridRef as React.RefObject<HTMLDivElement>,
		tracks.length,
		{
			gridLayouts: PHONE_FRIENDLY_LAYOUTS,
		},
	);

	return (
		<div
			ref={gridRef}
			className="w-full h-full"
			style={{
				display: "grid",
				gridTemplateColumns: `repeat(${layout.columns}, minmax(0, 1fr))`,
				gridTemplateRows: `repeat(${layout.rows}, minmax(0, 1fr))`,
				// gap separates tiles so the emerald speaking ring is never
				// hidden behind a neighbouring tile (8px = the old gap-2).
				gap: 8,
			}}
		>
			{tracks.map((trackRef, i) =>
				React.cloneElement(
					children as React.ReactElement<{
						trackRef?: TrackReferenceOrPlaceholder;
					}>,
					{
						trackRef,
						key: `${trackRef.participant.identity}-${trackRef.source}-${i}`,
					},
				),
			)}
		</div>
	);
}
import { motion } from "motion/react";
import {
	Mic,
	MicOff,
	Video,
	VideoOff,
	PhoneOff,
	AudioWaveform,
	Maximize2,
	Minimize2,
} from "lucide-react";
import UserAvatar from "./UserAvatar";

/** Metadata shape the server embeds in the LiveKit token (see
 *  generateLiveKitToken in community.controllers.ts). */
interface ParticipantMeta {
	avatar?: string;
	username?: string;
}

function parseParticipantMeta(metadata?: string): ParticipantMeta {
	if (!metadata) return {};
	try {
		const parsed = JSON.parse(metadata) as ParticipantMeta;
		return parsed && typeof parsed === "object" ? parsed : {};
	} catch {
		return {};
	}
}

// ─── Custom participant tile ────────────────────────────────────────
// The stock <ParticipantTile /> keeps the <video> element mounted even
// when the camera is turned off, which freezes on the last frame. This
// tile swaps in an avatar placeholder whenever the camera is off, muted,
// or has no video track at all — like the 1:1 call UI does.

function initialsFor(name: string): string {
	const parts = (name || "").trim().split(/\s+/).filter(Boolean);
	if (parts.length === 0) return "?";
	if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
	return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function OrbitParticipantTile({ trackRef }: { trackRef: TrackReferenceOrPlaceholder }) {
	const { elementProps } = useParticipantTile({ trackRef, htmlProps: {} });
	const { participant } = trackRef;
	const isSpeaking = useIsSpeaking(participant);
	// Avatar URL + username come from the token metadata the server embeds
	// (propagated to every participant in the room), so real profile pictures
	// show on every tile — not just the local one.
	const { metadata } = useParticipantInfo({ participant });
	const meta = parseParticipantMeta(metadata);

	// Camera is only "on" when the participant has it enabled AND the
	// publication exists AND it isn't muted (covers remote mute + local
	// toggling via setCameraEnabled(false)).
	const videoOn =
		participant.isCameraEnabled &&
		!!trackRef.publication &&
		!trackRef.publication.isMuted;
	const micMuted = !participant.isMicrophoneEnabled;
	const name = participant.name || "Participant";

	return (
		<ParticipantContextIfNeeded participant={participant}>
			<div
				{...elementProps}
				className={`relative w-full h-full overflow-hidden rounded-2xl border bg-zinc-900/80 transition-all duration-200 ${
					isSpeaking
						? "border-emerald-400/90 shadow-[0_0_24px_-4px_rgba(52,211,153,0.55)] ring-2 ring-emerald-400/40"
						: "border-zinc-800/60"
				}`}
			>
				{videoOn ? (
					<VideoTrack
						trackRef={trackRef}
						className="absolute inset-0 w-full h-full object-cover"
					/>
				) : (
					<div className="absolute inset-0 flex flex-col items-center justify-center gap-2.5">
						{meta.avatar ? (
							// Inert avatar — keep the call-tile click handlers (e.g.
							// speaking indicator / participant focus) working instead
							// of opening the full-screen image preview mid-call.
							<UserAvatar
								src={meta.avatar}
								alt={name}
								onClick={(e) => e.stopPropagation()}
								className="h-16 w-16 border-2 border-zinc-600/40 shadow-lg shadow-black/30"
							/>
						) : (
							<div className="flex h-16 w-16 items-center justify-center rounded-full bg-linear-to-br from-zinc-700 to-zinc-800 border border-zinc-600/40 text-lg font-black text-zinc-200 shadow-inner">
								{initialsFor(name)}
							</div>
						)}
						{micMuted && (
							<span className="flex items-center gap-1 rounded-full bg-red-500/15 border border-red-500/25 px-2 py-0.5 text-[9px] font-bold text-red-400">
								<MicOff className="h-3 w-3" /> Muted
							</span>
						)}
					</div>
				)}

				{/* Name badge (always visible, like Zoom/Meet) */}
				<span className="absolute bottom-2 left-2 max-w-[80%] truncate rounded-full bg-black/50 px-2 py-0.5 text-[10px] font-bold text-white/90 backdrop-blur-sm">
					{name}
					{participant.isLocal ? " (You)" : ""}
				</span>

				{/* Speaking indicator — emerald ring + equalizer badge */}
				{isSpeaking && (
					<span className="absolute top-2 left-2 flex items-center gap-1 rounded-full bg-emerald-500/15 border border-emerald-400/30 px-2 py-0.5 text-[9px] font-bold text-emerald-300 backdrop-blur-sm">
						<AudioWaveform className="h-3 w-3 animate-pulse" />
						Speaking
					</span>
				)}

				{/* Mic-off corner badge while video is on */}
				{videoOn && micMuted && (
					<span className="absolute top-2 right-2 flex h-6 w-6 items-center justify-center rounded-full bg-red-500/20 border border-red-500/30">
						<MicOff className="h-3 w-3 text-red-400" />
					</span>
				)}
			</div>
		</ParticipantContextIfNeeded>
	);
}

function ParticipantTileWrapper({ trackRef }: { trackRef?: TrackReferenceOrPlaceholder }) {
	// GridLayout clones its children and injects `trackRef` at runtime, so it
	// is only present while mounted inside the grid — guard for type safety.
	if (!trackRef) return null;
	return (
		<ParticipantContextIfNeeded participant={trackRef.participant}>
			<OrbitParticipantTile trackRef={trackRef} />
		</ParticipantContextIfNeeded>
	);
}

interface GroupCallFloorProps {
	livekitUrl: string;
	token: string;
	roomName: string;
	callType?: "audio" | "video";
	onLeave: () => void;
}

function CallParticipants() {
	// Only the camera source produces a tile. Requesting Camera + Microphone
	// yields one trackRef per (participant × source) — a ghost mic tile per
	// participant that would render as an empty video element. The mic state
	// is read from participant.isMicrophoneEnabled inside the tile instead.
	const tracks = useTracks(
		[{ source: Track.Source.Camera, withPlaceholder: true }],
		{ onlySubscribed: false },
	);

	return (
		<OrbitGrid tracks={tracks}>
			<ParticipantTileWrapper />
		</OrbitGrid>
	);
}

/**
 * Controls live inside <LiveKitRoom /> so useLocalParticipant() has access to
 * the room context. Mute/camera toggles call setMicrophoneEnabled /
 * setCameraEnabled directly (the audio/video props on LiveKitRoom are only
 * read at connect time and don't reliably toggle after that).
 */
function CallControls({
	callType,
	onLeave,
}: {
	callType: "audio" | "video";
	onLeave: () => void;
}) {
	const { localParticipant } = useLocalParticipant();
	const [isMuted, setIsMuted] = useState(false);
	const [isVideoOff, setIsVideoOff] = useState(callType !== "video");

	const toggleMute = () => {
		const next = !isMuted;
		setIsMuted(next);
		(localParticipant as LocalParticipant | undefined)?.setMicrophoneEnabled(!next);
	};

	const toggleVideo = () => {
		const next = !isVideoOff;
		setIsVideoOff(next);
		(localParticipant as LocalParticipant | undefined)?.setCameraEnabled(!next);
	};

	return (
		<div className="relative z-10 flex items-center justify-center gap-4 py-4 px-4 border-t border-zinc-800/50 shrink-0">
			{/* Mute toggle */}
			<button
				onClick={toggleMute}
				className={`h-12 w-12 rounded-2xl flex items-center justify-center transition-all cursor-pointer backdrop-blur-md ${
					isMuted
						? "bg-red-500/15 text-red-400 border border-red-500/25"
						: "bg-zinc-800/90 text-zinc-200 hover:bg-zinc-700/90 border border-zinc-700/50"
				}`}
				title={isMuted ? "Unmute" : "Mute"}
				aria-label={isMuted ? "Unmute microphone" : "Mute microphone"}
			>
				{isMuted ? (
					<MicOff className="h-5 w-5" />
				) : (
					<Mic className="h-5 w-5" />
				)}
			</button>

			{/* Video toggle (audio-only calls never start the camera) */}
			{callType === "video" && (
				<button
					onClick={toggleVideo}
					className={`h-12 w-12 rounded-2xl flex items-center justify-center transition-all cursor-pointer backdrop-blur-md ${
						isVideoOff
							? "bg-red-500/15 text-red-400 border border-red-500/25"
							: "bg-zinc-800/90 text-zinc-200 hover:bg-zinc-700/90 border border-zinc-700/50"
					}`}
					title={isVideoOff ? "Turn on camera" : "Turn off camera"}
					aria-label={isVideoOff ? "Enable camera" : "Disable camera"}
				>
					{isVideoOff ? (
						<VideoOff className="h-5 w-5" />
					) : (
						<Video className="h-5 w-5" />
					)}
				</button>
			)}

			{/* Leave call */}
			<button
				onClick={onLeave}
				className="h-12 w-12 rounded-2xl bg-red-500/90 text-white hover:bg-red-500 flex items-center justify-center transition-all cursor-pointer shadow-lg shadow-red-500/25 border border-red-400/30"
				title="Leave call"
				aria-label="Leave call"
			>
				<PhoneOff className="h-5 w-5" />
			</button>
		</div>
	);
}

export default function GroupCallFloor({
	livekitUrl,
	token,
	roomName,
	callType = "video",
	onLeave,
}: GroupCallFloorProps) {
	const [connectionState, setConnectionState] = useState<
		"connecting" | "connected" | "disconnected"
	>("connecting");
	const [callDuration, setCallDuration] = useState(0);
	const durationTimerRef = useRef<NodeJS.Timeout | null>(null);

	// ─── Fullscreen toggle (browser Fullscreen API) ──────────────────
	// Same as the 1:1 call: the overlay fills the app, but going true-
	// fullscreen hides the browser UI so the group grid uses the whole
	// device screen. iOS Safari only allows requestFullscreen on <video>,
	// so there the button degrades gracefully.
	const stageRef = useRef<HTMLDivElement>(null);
	const [isFullscreen, setIsFullscreen] = useState(false);

	useEffect(() => {
		const onFsChange = () => {
			setIsFullscreen(!!document.fullscreenElement);
		};
		document.addEventListener("fullscreenchange", onFsChange);
		return () => {
			document.removeEventListener("fullscreenchange", onFsChange);
			if (document.fullscreenElement) {
				document.exitFullscreen().catch(() => {});
			}
		};
	}, []);

	const toggleFullscreen = () => {
		const el = stageRef.current;
		if (!el) return;
		try {
			if (!document.fullscreenElement) {
				const request = (el.requestFullscreen ||
					(el as any).webkitRequestFullscreen)?.bind(el);
				request?.().catch(() => {
					// Unsupported (e.g. iOS Safari on a div) — ignore quietly.
				});
			} else {
				const exit = document.exitFullscreen ||
					(document as any).webkitExitFullscreen;
				exit?.call(document);
			}
		} catch {
			// Fullscreen API unavailable — the overlay is already full-app.
		}
	};

	// Track connection state and start duration timer when connected
	const handleConnected = useCallback(() => {
		// Clear the "connecting/reconnecting" overlay once LiveKit connects
		setConnectionState("connected");
		setCallDuration(0);
		if (durationTimerRef.current) {
			clearInterval(durationTimerRef.current);
		}
		durationTimerRef.current = setInterval(() => {
			setCallDuration((prev) => prev + 1);
		}, 1000);
	}, []);

	const handleDisconnected = useCallback(() => {
		setConnectionState("disconnected");
		if (durationTimerRef.current) {
			clearInterval(durationTimerRef.current);
			durationTimerRef.current = null;
		}
	}, []);

	useEffect(() => {
		return () => {
			if (durationTimerRef.current) {
				clearInterval(durationTimerRef.current);
				durationTimerRef.current = null;
			}
		};
	}, []);

	const formatDuration = (s: number) => {
		const m = Math.floor(s / 60);
		const sec = s % 60;
		return `${m.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`;
	};

	return (
		<motion.div
			initial={{ opacity: 0 }}
			animate={{ opacity: 1 }}
			exit={{ opacity: 0 }}
			ref={stageRef}
			className="fixed inset-0 z-[340] flex flex-col bg-zinc-950/95 backdrop-blur-2xl"
		>
			{/* Edge-light sheen */}
			<div className="absolute inset-x-0 top-0 h-[1.5px] bg-linear-to-r from-transparent via-white/30 to-transparent pointer-events-none z-20" />
			<div className="absolute inset-x-0 bottom-0 h-[1.5px] bg-linear-to-r from-transparent via-white/15 to-transparent pointer-events-none z-20" />

			{/* Connecting overlay */}
			{connectionState === "connecting" && (
				<div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-zinc-950/90">
					<div className="flex items-center gap-3 mb-4">
						<span className="h-3 w-3 rounded-full bg-emerald-500 animate-pulse" />
						<span className="text-sm font-bold text-zinc-300 uppercase tracking-widest">
							Connecting to group call...
						</span>
					</div>
					<p className="text-[11px] text-zinc-500 font-mono">
						Room: {roomName}
					</p>
				</div>
			)}

			{/* Reconnecting overlay */}
			{connectionState === "disconnected" && (
				<div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-zinc-950/90">
					<div className="flex items-center gap-3 mb-4">
						<span className="h-3 w-3 rounded-full bg-amber-400 animate-pulse" />
						<span className="text-sm font-bold text-amber-300 uppercase tracking-widest">
							Connection lost — reconnecting...
						</span>
					</div>
					<p className="text-[11px] text-zinc-500 font-mono">
						Room: {roomName}
					</p>
				</div>
			)}

			{/* Header */}
			<div className="relative z-10 flex items-center justify-between px-4 py-3 border-b border-zinc-800/50 shrink-0">
				<div className="flex items-center gap-3">
					<div className="flex items-center gap-2">
						<span className="h-2.5 w-2.5 rounded-full bg-emerald-500 animate-pulse" />
						<span className="text-xs font-black text-zinc-300 uppercase tracking-widest">
							{callType === "video" ? "Group Video Call" : "Group Audio Call"}
						</span>
					</div>
				</div>
				<div className="flex items-center gap-3">
					<span className="text-[11px] font-bold text-zinc-400 font-mono">
						{connectionState === "connected"
							? formatDuration(callDuration)
							: "00:00"}
					</span>
					{/* Fullscreen toggle — same as the 1:1 call, visible once connected */}
					{connectionState === "connected" && (
						<button
							onClick={toggleFullscreen}
							className="flex h-7 w-7 items-center justify-center rounded-full bg-zinc-800/90 hover:bg-zinc-700/90 text-zinc-200 border border-zinc-700/50 transition-all cursor-pointer shadow-sm"
							title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
							aria-label={
								isFullscreen ? "Exit fullscreen" : "Enter fullscreen"
							}
						>
							{isFullscreen ? (
								<Minimize2 className="h-3.5 w-3.5" />
							) : (
								<Maximize2 className="h-3.5 w-3.5" />
							)}
						</button>
					)}
					<button
						onClick={onLeave}
						className="flex h-7 px-2.5 items-center gap-1.5 rounded-full bg-red-500/90 hover:bg-red-500 text-white transition-all cursor-pointer shadow-sm text-[11px] font-bold uppercase tracking-wider"
						title="Leave call"
					>
						<PhoneOff className="h-3.5 w-3.5" />
						Leave
					</button>
				</div>
			</div>

			{/* LiveKit Room */}
			{token && livekitUrl && (
				<LiveKitRoom
					serverUrl={livekitUrl}
					token={token}
					connect={true}
					video={callType === "video"}
					audio={true}
					onConnected={handleConnected}
					onDisconnected={handleDisconnected}
					// Mobile-tuned LiveKit options — without these LiveKit defaults
					// to VP8 + 1080p capture, which software-encodes on phones and
					// floods cellular upload, freezing every participant's video.
					options={{
						// Only pull the video quality the on-screen tile needs —
						// a tiny grid tile doesn't need a 1080p stream, and a
						// hidden participant's video is paused entirely. This is
						// the biggest group-call bandwidth win on mobile.
						adaptiveStream: true,
						// Pause publishing video layers nobody is currently
						// consuming — cuts mobile upload/encode load dramatically.
						dynacast: true,
						videoCaptureDefaults: {
							resolution: isMobileDevice()
								? { width: 640, height: 480, frameRate: 24 }
								: { width: 1280, height: 720, frameRate: 30 },
						},
						publishDefaults: {
							// H.264 is hardware-encoded on every phone — VP8/VP9
							// fall back to software encode on most mobile CPUs,
							// wrecking quality and battery simultaneously.
							videoCodec: "h264",
							videoEncoding: {
								maxBitrate: isMobileDevice()
									? 800_000
									: 2_500_000,
								maxFramerate: isMobileDevice() ? 24 : 30,
							},
						},
					}}
					className="flex-1 flex flex-col min-h-0"
				>
					{/* Video grid area */}
					<div className="flex-1 p-2 min-h-0 overflow-hidden">
						<CallParticipants />
					</div>

					<RoomAudioRenderer />

					{/* Controls bar */}
					<CallControls callType={callType} onLeave={onLeave} />
				</LiveKitRoom>
			)}
		</motion.div>
	);
}
