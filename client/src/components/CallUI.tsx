import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import {
	Mic,
	MicOff,
	PhoneOff,
	Phone,
	Video,
	VideoOff,
	Volume2,
	RefreshCw,
	Maximize2,
	Minimize2,
} from "lucide-react";
import type { Socket } from "socket.io-client";
import UserAvatar from "./UserAvatar";
import { logger } from "../utils/logger";
import { isMobileDevice } from "../utils/device";

interface CallUIProps {
	socket: Socket | null;
	user: { _id: string; fullName: string; profilePic?: { url?: string } };
	callState: {
		type: "audio" | "video";
		status: "outgoing" | "incoming" | "active";
		partnerId: string;
		partnerName: string;
		partnerAvatar?: string;
	};
	onEndCall: () => void;
	onAcceptCall: () => void;
	onRejectCall: () => void;
	localStreamRef: React.MutableRefObject<MediaStream | null>;
	peerConnectionRef: React.MutableRefObject<RTCPeerConnection | null>;
	remoteStreamRef: React.MutableRefObject<MediaStream | null>;
	iceConnectionState: RTCIceConnectionState | "new";
}

export default function CallUI({
	callState,
	user,
	onEndCall,
	onAcceptCall,
	onRejectCall,
	localStreamRef,
	peerConnectionRef,
	remoteStreamRef,
	iceConnectionState,
}: CallUIProps) {
	const [isMuted, setIsMuted] = useState(false);
	const [isVideoOff, setIsVideoOff] = useState(false);
	const [isSpeakerOn, setIsSpeakerOn] = useState(() => callState.type === "video");
	const [facingMode, setFacingMode] = useState<"user" | "environment">(
		"user",
	);
	const [hasMultipleCameras, setHasMultipleCameras] = useState(false);
	const [callDuration, setCallDuration] = useState(0);
	const [micLevel, setMicLevel] = useState(0); // 0–100 for the volume meter
	const [poorNetwork, setPoorNetwork] = useState(false);
	// Draggable local-video PiP: null = default bottom-right corner
	// (right:20/bottom:96); set = user's chosen left/top in px.
	const [pipPos, setPipPos] = useState<{ x: number; y: number } | null>(null);
	const pipDragRef = useRef<{
		startX: number;
		startY: number;
		origX: number;
		origY: number;
	} | null>(null);
	// PiP dimensions (w-28 h-44) — used to clamp the drag inside the viewport.
	const PIP_WIDTH = 112;
	const PIP_HEIGHT = 176;
	const PIP_MARGIN = 6;

	// ─── Fullscreen toggle (browser Fullscreen API) ──────────────────
	// The call overlay already fills the app, but the browser UI (address
	// bar / tabs) still surrounds it. This lets the user go true-fullscreen
	// so the call stage uses the entire device screen — the standard for
	// video calls. iOS Safari only supports requestFullscreen on <video>,
	// so there the button degrades gracefully (stays inactive).
	const stageRef = useRef<HTMLDivElement>(null);
	const [isFullscreen, setIsFullscreen] = useState(false);

	useEffect(() => {
		const onFsChange = () => {
			setIsFullscreen(!!document.fullscreenElement);
		};
		document.addEventListener("fullscreenchange", onFsChange);
		return () => {
			document.removeEventListener("fullscreenchange", onFsChange);
			// Leaving the call should never leave the browser stuck fullscreen.
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

	// ─── Draggable PiP handlers ────────────────────────────────────
	// Pointer events unify mouse + touch. setPointerCapture keeps the drag
	// alive even when the finger/mouse moves outside the PiP; touch-none
	// stops the browser from hijacking the gesture for scrolling.
	const onPipPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
		e.stopPropagation();
		const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
		pipDragRef.current = {
			startX: e.clientX,
			startY: e.clientY,
			origX: rect.left,
			origY: rect.top,
		};
		(e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
	};

	const onPipPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
		if (!pipDragRef.current) return;
		const dx = e.clientX - pipDragRef.current.startX;
		const dy = e.clientY - pipDragRef.current.startY;
		const maxX = Math.max(PIP_MARGIN, window.innerWidth - PIP_WIDTH - PIP_MARGIN);
		const maxY = Math.max(PIP_MARGIN, window.innerHeight - PIP_HEIGHT - PIP_MARGIN);
		const x = Math.min(
			Math.max(pipDragRef.current.origX + dx, PIP_MARGIN),
			maxX,
		);
		const y = Math.min(
			Math.max(pipDragRef.current.origY + dy, PIP_MARGIN),
			maxY,
		);
		setPipPos({ x, y });
	};

	const onPipPointerUp = () => {
		pipDragRef.current = null;
	};

	// Listens for the adaptive bitrate monitor's quality reports (dispatched
	// from App.tsx). Shows a subtle "reducing quality" banner while the call
	// is congestion-limited, so users understand why the picture softened.
	useEffect(() => {
		const handleQuality = (e: Event) => {
			const detail = (e as CustomEvent<{ poor: boolean }>).detail;
			setPoorNetwork(!!detail?.poor);
		};
		window.addEventListener("callNetworkQuality", handleQuality as EventListener);
		return () => {
			window.removeEventListener("callNetworkQuality", handleQuality as EventListener);
		};
	}, []);
	const localVideoRef = useRef<HTMLVideoElement>(null);
	const remoteVideoRef = useRef<HTMLVideoElement>(null);
	const remoteAudioRef = useRef<HTMLAudioElement>(null);
	const durationTimerRef = useRef<NodeJS.Timeout | null>(null);
	const audioContextRef = useRef<AudioContext | null>(null);
	const analyserRef = useRef<AnalyserNode | null>(null);
	const animationFrameRef = useRef<number | null>(null);
	// Ringtone refs
	const ringtoneCtxRef = useRef<AudioContext | null>(null);
	const ringtoneOsc1Ref = useRef<OscillatorNode | null>(null);
	const ringtoneOsc2Ref = useRef<OscillatorNode | null>(null);
	const ringtoneGainRef = useRef<GainNode | null>(null);
	const ringtoneTimerRef = useRef<NodeJS.Timeout | null>(null);
	const vibrationIntervalRef = useRef<NodeJS.Timeout | null>(null);

	// ─── Ringtone + Vibration for Incoming Calls ───────────────
	// Generates a pleasant melodic ringtone using Web Audio API.
	// Uses two triangle-wave oscillators playing a short ascending
	// four-note phrase (440→523→587→440 Hz) in a repeating pattern,
	// with a soft attack/release envelope.
	const startRingtone = () => {
		try {
			const ctx = new AudioContext();
			ringtoneCtxRef.current = ctx;

			// Two triangle-wave oscillators — triangle is warmer/softer than sine
			const osc1 = ctx.createOscillator();
			osc1.type = "triangle";
			osc1.frequency.value = 440;

			const osc2 = ctx.createOscillator();
			osc2.type = "triangle";
			osc2.frequency.value = 523;

			const gain = ctx.createGain();
			gain.gain.value = 0;

			osc1.connect(gain);
			osc2.connect(gain);
			gain.connect(ctx.destination);

			osc1.start();
			osc2.start();

			ringtoneOsc1Ref.current = osc1;
			ringtoneOsc2Ref.current = osc2;
			ringtoneGainRef.current = gain;

			// Attempt to resume AudioContext
			ctx.resume().catch(() => {});

			// ── Musical ring pattern ──
			// A repeating 4-note ascending phrase: 440→523→587→440 Hz
			// Each note rings for ~250ms with a 50ms gap between notes.
			// After the 4-note phrase, there's a ~600ms silence, then repeat.
			const notes = [
				{ freq1: 440, freq2: 523, dur: 0.25 },
				{ freq1: 523, freq2: 587, dur: 0.25 },
				{ freq1: 587, freq2: 659, dur: 0.25 },
				{ freq1: 440, freq2: 523, dur: 0.35 }, // slightly longer final note
			];
			const noteGap = 0.05; // 50ms gap between notes
			const phrasePause = 0.6; // 600ms pause before repeating
			const phraseDuration =
				notes.reduce((acc, n) => acc + n.dur + noteGap, 0) +
				phrasePause;

			const schedulePhrase = () => {
				const ctxAlive = ringtoneCtxRef.current;
				if (!ctxAlive || ctxAlive.state === "closed") return;

				const baseTime = ctxAlive.currentTime;

				// Schedule each note in the phrase
				let noteTime = baseTime;
				notes.forEach((note) => {
					// Attack: ramp up to volume
					gain.gain.setValueAtTime(0, noteTime);
					gain.gain.linearRampToValueAtTime(0.25, noteTime + 0.02);

					// Set frequencies for this note
					osc1.frequency.setValueAtTime(note.freq1, noteTime);
					osc2.frequency.setValueAtTime(note.freq2, noteTime);

					// Release: fade out before next note
					const noteEnd = noteTime + note.dur;
					gain.gain.setValueAtTime(0.25, noteEnd - 0.02);
					gain.gain.linearRampToValueAtTime(0, noteEnd);

					noteTime = noteEnd + noteGap;
				});
			};

			// Schedule the first phrase immediately
			schedulePhrase();
			// Repeat the phrase
			ringtoneTimerRef.current = setInterval(
				schedulePhrase,
				phraseDuration * 1000,
			);
		} catch (err) {
			logger.warn("Ringtone unavailable:", err);
		}
	};

	const stopRingtone = () => {
		if (ringtoneTimerRef.current) {
			clearInterval(ringtoneTimerRef.current);
			ringtoneTimerRef.current = null;
		}
		if (ringtoneOsc1Ref.current) {
			try {
				ringtoneOsc1Ref.current.stop();
			} catch {
				/* already stopped */
			}
			ringtoneOsc1Ref.current = null;
		}
		if (ringtoneOsc2Ref.current) {
			try {
				ringtoneOsc2Ref.current.stop();
			} catch {
				/* already stopped */
			}
			ringtoneOsc2Ref.current = null;
		}
		if (ringtoneCtxRef.current) {
			ringtoneCtxRef.current.close().catch(() => {});
			ringtoneCtxRef.current = null;
		}
		ringtoneGainRef.current = null;
	};

	const startVibration = () => {
		if (!("vibrate" in navigator)) return;
		// Pattern: vibrate 400ms, pause 200ms — matches ringtone rhythm
		const pattern: VibratePattern = [400, 200];
		// First vibrate immediately
		navigator.vibrate(pattern);
		// Repeat every 600ms to create a continuous loop
		vibrationIntervalRef.current = setInterval(() => {
			navigator.vibrate(pattern);
		}, 600);
	};

	const stopVibration = () => {
		if (vibrationIntervalRef.current) {
			clearInterval(vibrationIntervalRef.current);
			vibrationIntervalRef.current = null;
		}
		if ("vibrate" in navigator) {
			navigator.vibrate(0); // Cancel any ongoing vibration
		}
	};

	// Manage ringtone + vibration based on call status
	useEffect(() => {
		if (callState.status === "incoming") {
			startRingtone();
			startVibration();
		} else {
			stopRingtone();
			stopVibration();
		}
		return () => {
			stopRingtone();
			stopVibration();
		};
	}, [callState.status]);

	// Wire local stream to local video element when call becomes active
	useEffect(() => {
		if (localVideoRef.current && localStreamRef.current) {
			localVideoRef.current.srcObject = localStreamRef.current;
		}
	}, [callState.status]);

	// ─── Direct remote stream wiring (watch remoteStreamRef for changes) ───
	// This effect watches remoteStreamRef for any incoming media stream and
	// wires audio/video tracks directly to the appropriate elements.
	// Using a ref observer pattern ensures we catch tracks regardless of
	// timing — whether they arrive before or after CallUI mounts.
	useEffect(() => {
		const wireStream = (stream: MediaStream) => {
			if (!stream) return;
			logger.info("CallUI: Wiring remote stream", {
				audioTracks: stream.getAudioTracks().length,
				videoTracks: stream.getVideoTracks().length,
			});

			// Wire audio tracks
			const audioTrack = stream.getAudioTracks()[0];
			if (audioTrack && remoteAudioRef.current) {
				const existing = remoteAudioRef.current.srcObject as MediaStream | null;
				if (existing && existing.getAudioTracks().includes(audioTrack)) return;
				const audioStream = new MediaStream([audioTrack]);
				remoteAudioRef.current.srcObject = audioStream;
				remoteAudioRef.current?.play()?.catch(() => {});
			}

			// Wire video tracks
			const videoTrack = stream.getVideoTracks()[0];
			if (videoTrack && remoteVideoRef.current) {
				const existing = remoteVideoRef.current.srcObject as MediaStream | null;
				if (existing && existing.getVideoTracks().includes(videoTrack)) return;
				const videoStream = new MediaStream([videoTrack]);
				remoteVideoRef.current.srcObject = videoStream;
			}
		};

		// Wire immediately if stream already exists
		if (remoteStreamRef.current) {
			wireStream(remoteStreamRef.current);
		}

		// Check pc.getReceivers() for already-negotiated tracks
		// (ontrack is managed by App.tsx which stores the stream in remoteStreamRef)
		const pc = peerConnectionRef.current;
		if (pc) {
			pc.getReceivers().forEach((receiver) => {
				if (receiver.track.kind === "audio" && remoteAudioRef.current) {
					const existing = remoteAudioRef.current.srcObject as MediaStream | null;
					if (existing && existing.getAudioTracks().includes(receiver.track)) return;
					const audioStream = new MediaStream([receiver.track]);
					remoteAudioRef.current.srcObject = audioStream;
					remoteAudioRef.current?.play()?.catch(() => {});
				} else if (receiver.track.kind === "video" && remoteVideoRef.current) {
					const existing = remoteVideoRef.current.srcObject as MediaStream | null;
					if (existing && existing.getVideoTracks().includes(receiver.track)) return;
					const videoStream = new MediaStream([receiver.track]);
					remoteVideoRef.current.srcObject = videoStream;
				}
			});
		}

		// Poll remoteStreamRef for tracks that arrive late (fallback)
		// Unbounded: keeps polling while the call is active, stops only
		// when tracks arrive or the call ends.
		const pollInterval = setInterval(() => {
			// Stop polling when call is no longer active
			if (callState.status !== "active") {
				clearInterval(pollInterval);
				return;
			}
			const stream = remoteStreamRef.current;
			if (stream) {
				wireStream(stream);
				// Stop polling once we found tracks
				if (
					stream.getAudioTracks().length > 0 ||
					stream.getVideoTracks().length > 0
				) {
					clearInterval(pollInterval);
				}
			}
		}, 200);

		return () => {
			clearInterval(pollInterval);
		};
	}, [callState.status, callState.type]);

	// ─── Speaker / Earpiece Toggle ─────────────────────────────────────
	// Switches audio output between loudspeaker (speakerphone mode) and earpiece/receiver.
	// Uses the modern audio.setSinkId() API when available (Chrome, Edge, Samsung Internet).
	// On mobile phones:
	//   - "default" routes to the earpiece (proximity-aware handset speaker)
	//   - The loudspeaker is a separate audio output device that must be found by label
	//   - Falls back to first non-default audio output if no labeled speaker is found
	//   - On browsers that don't support setSinkId (Firefox, Safari), we show the button
	//     but it acts as an informative indicator only.
	// Apply speaker output routing whenever the call becomes active or speaker setting changes
	useEffect(() => {
		if (callState.status !== "active") return;

		const applySpeakerSettings = async () => {
			const audioEl = remoteAudioRef.current;
			if (!audioEl) return;

			if (
				"setSinkId" in audioEl &&
				typeof (audioEl as any).setSinkId === "function"
			) {
				try {
					const devices = await navigator.mediaDevices.enumerateDevices();
					const audioOutputs = devices.filter(
						(d) => d.kind === "audiooutput",
					);

					if (isSpeakerOn) {
						// Speakerphone mode: find the loudspeaker device
						const speaker = audioOutputs.find(
							(d) =>
								d.deviceId !== "default" &&
								(d.label.toLowerCase().includes("speaker") ||
									d.label.toLowerCase().includes("loudspeaker") ||
									d.label.toLowerCase().includes("speakerphone") ||
									d.label.toLowerCase().includes("loud") ||
									d.label.toLowerCase().includes("headphone") ||
									d.label.includes("🔊")),
						);
						if (speaker) {
							await (audioEl as any).setSinkId(speaker.deviceId);
						} else {
							// No labeled speaker found — try first non-default audio output
							const nonDefault = audioOutputs.find(
								(d) => d.deviceId !== "default" && d.deviceId !== "communications",
							);
							if (nonDefault) {
								await (audioEl as any).setSinkId(nonDefault.deviceId);
							} else {
								// Only one device available — use the communications device if present
								const comms = audioOutputs.find(
									(d) => d.deviceId === "communications",
								);
								await (audioEl as any).setSinkId(comms?.deviceId || "");
							}
						}
					} else {
						// Earpiece: explicitly use the default audio output (handset earpiece on phones)
						await (audioEl as any).setSinkId("default");
					}
				} catch (err) {
					logger.warn("Speaker apply settings failed:", err);
				}
			}
		};

		applySpeakerSettings();
	}, [callState.status, isSpeakerOn]);

	const toggleSpeaker = () => {
		setIsSpeakerOn((prev) => !prev);
	};

	// ─── Camera Switch (Front / Back) ───────────────────────────────────
	// Toggles between front-facing (user) and rear-facing (environment) cameras.
	// Stops the current video track, gets a new one with the opposite facingMode,
	// and replaces it on the peer connection via replaceTrack().
	const switchCamera = async () => {
		const newFacingMode = facingMode === "user" ? "environment" : "user";

		const pc = peerConnectionRef.current;
		const localStream = localStreamRef.current;
		if (!pc || !localStream) return;

		try {
			// Request the new camera FIRST (before stopping the old track) so
			// that if getUserMedia fails, the current video keeps working
			// instead of being left permanently dead.
			const newStream = await navigator.mediaDevices.getUserMedia({
				audio: false,
				video: {
					facingMode: newFacingMode,
					// Match the call-setup constraints — mobile stays at 480p@24
					// so switching cameras doesn't suddenly starve cellular
					// upload and freeze the call.
					...(isMobileDevice()
						? {
								width: { ideal: 640 },
								height: { ideal: 480 },
								frameRate: { ideal: 24 },
						  }
						: {
								width: { ideal: 1280 },
								height: { ideal: 720 },
								frameRate: { ideal: 30 },
						  }),
				},
			});

			const newVideoTrack = newStream.getVideoTracks()[0];
			if (!newVideoTrack) {
				newStream.getTracks().forEach((t) => t.stop());
				return;
			}

			// Stop old video tracks only after the new camera is acquired
			localStream.getVideoTracks().forEach((t) => t.stop());

			// Remove old video tracks from local stream
			localStream
				.getVideoTracks()
				.forEach((t) => localStream.removeTrack(t));

			// Add new video track to local stream
			localStream.addTrack(newVideoTrack);

			// Replace track on peer connection
			const sender = pc
				.getSenders()
				.find((s) => s.track?.kind === "video");
			if (sender) {
				await sender.replaceTrack(newVideoTrack);
			}

			// Update local video preview
			if (localVideoRef.current) {
				localVideoRef.current.srcObject = localStream;
			}

			setFacingMode(newFacingMode);
		} catch (err) {
			logger.warn("Failed to switch camera:", err);
			// Revert facing mode on failure
			setFacingMode(facingMode);
		}
	};

	// Detect available cameras on mount — only show switch button if multiple cameras exist
	useEffect(() => {
		if (callState.type !== "video") return;
		navigator.mediaDevices
			.enumerateDevices()
			.then((devices) => {
				const videoInputs = devices.filter(
					(d) => d.kind === "videoinput",
				);
				setHasMultipleCameras(videoInputs.length > 1);
			})
			.catch(() => {
				setHasMultipleCameras(false);
			});
	}, [callState.type]);

	// ─── Microphone Volume Meter ───────────────────────────────────
	// Uses Web Audio API's AnalyserNode to compute RMS volume from the local
	// microphone stream and updates a 0–100 level state on every animation frame.
	useEffect(() => {
		const stream = localStreamRef.current;
		if (!stream || callState.status !== "active") return;

		try {
			const audioCtx = new AudioContext();
			audioContextRef.current = audioCtx;
			const source = audioCtx.createMediaStreamSource(stream);
			const analyser = audioCtx.createAnalyser();
			analyser.fftSize = 256;
			source.connect(analyser);
			analyserRef.current = analyser;

			const dataArray = new Uint8Array(analyser.frequencyBinCount);

			const tick = () => {
				if (!analyserRef.current) return;
				analyserRef.current.getByteTimeDomainData(dataArray);

				// Compute RMS (root mean square) — a good proxy for perceived loudness
				let sum = 0;
				for (let i = 0; i < dataArray.length; i++) {
					const val = (dataArray[i] - 128) / 128; // Normalize to [-1, 1]
					sum += val * val;
				}
				const rms = Math.sqrt(sum / dataArray.length);
				// Scale to 0–100 with a sensitivity boost for quieter speech
				const level = Math.min(100, Math.round(rms * 180));
				setMicLevel(level);

				animationFrameRef.current = requestAnimationFrame(tick);
			};

			tick();
		} catch (err) {
			// AudioContext may fail on insecure origins or older browsers
			logger.warn("Mic meter unavailable:", err);
		}

		return () => {
			if (animationFrameRef.current) {
				cancelAnimationFrame(animationFrameRef.current);
				animationFrameRef.current = null;
			}
			if (audioContextRef.current) {
				audioContextRef.current.close();
				audioContextRef.current = null;
			}
			setMicLevel(0);
		};
	}, [callState.status]);

	// Start call duration timer when active; also trigger remote audio playback
	// (iOS Safari blocks autoplay but the user's Accept tap establishes a gesture chain)
	useEffect(() => {
		if (callState.status === "active") {
			setCallDuration(0);
			durationTimerRef.current = setInterval(() => {
				setCallDuration((prev) => prev + 1);
			}, 1000);

			// Retry playback on the remote audio element now that we're in a user gesture context
			if (remoteAudioRef.current) {
				remoteAudioRef.current?.play()?.catch(() => {
					// Silently ignore — audio will be played on first user tap
				});
			}
			// Stop ringtone now that call is active (status-change effect already
			// handles this, but this is a safety net for edge cases)
		}
		return () => {
			if (durationTimerRef.current) {
				clearInterval(durationTimerRef.current);
				durationTimerRef.current = null;
			}
		};
	}, [callState.status]);

	// Fallback: tap anywhere during the call to unlock iOS Safari audio
	const handleCallTap = () => {
		if (remoteAudioRef.current && callState.status === "active") {
			remoteAudioRef.current?.play()?.catch(() => {});
		}
	};

	const formatDuration = (s: number) => {
		const m = Math.floor(s / 60);
		const sec = s % 60;
		return `${m.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`;
	};

	const toggleMute = () => {
		if (localStreamRef.current) {
			localStreamRef.current.getAudioTracks().forEach((track) => {
				track.enabled = isMuted;
			});
			setIsMuted(!isMuted);
		}
	};

	const toggleVideo = () => {
		if (localStreamRef.current) {
			localStreamRef.current.getVideoTracks().forEach((track) => {
				track.enabled = isVideoOff;
			});
			setIsVideoOff(!isVideoOff);
		}
	};

	return (
		<motion.div
			initial={{ opacity: 0 }}
			animate={{ opacity: 1 }}
			exit={{ opacity: 0 }}
		onClick={handleCallTap}
		ref={stageRef}
		className="fixed inset-0 z-[340] flex flex-col bg-zinc-950/95 backdrop-blur-2xl">
			{/* Glassmorphism edge-light sheen */}
			<div className="absolute inset-x-0 top-0 h-[1.5px] bg-linear-to-r from-transparent via-white/30 to-transparent pointer-events-none z-20" />
			<div className="absolute inset-x-0 bottom-0 h-[1.5px] bg-linear-to-r from-transparent via-white/15 to-transparent pointer-events-none z-20" />
			<div className="absolute inset-y-0 left-0 w-[1px] bg-linear-to-b from-transparent via-white/10 to-transparent pointer-events-none z-20" />
			<div className="absolute inset-y-0 right-0 w-[1px] bg-linear-to-b from-transparent via-white/10 to-transparent pointer-events-none z-20" />

			{/* Top ambient glare */}
			<div className="absolute inset-x-0 top-0 h-[30%] bg-linear-to-b from-white/[0.06] to-transparent pointer-events-none z-10" />

			{/* Remote video (full background for video calls) */}
			{callState.type === "video" && (
				<video
					ref={remoteVideoRef}
					autoPlay
					playsInline
					className="absolute inset-0 w-full h-full object-cover"
				/>
			)}

			{/* Hidden remote audio element */}
			<audio ref={remoteAudioRef} autoPlay playsInline />

			{/* Dim overlay — audio calls + ringing states only. On an ACTIVE video
			    call the remote video is the star: dimming it 40% + stacking the
			    centered avatar on top made the call look broken/washed out. */}
			{!(callState.type === "video" && callState.status === "active") && (
				<div className="absolute inset-0 bg-zinc-950/40" />
			)}

			{/* Header — same shell as the group-call floor */}
			<div className="relative z-10 flex items-center justify-between px-4 py-3 border-b border-zinc-800/50 shrink-0">
				<div className="flex items-center gap-2">
					<span className="h-2.5 w-2.5 rounded-full bg-emerald-500 animate-pulse" />
					<span className="text-xs font-black text-zinc-300 uppercase tracking-widest">
						{callState.status === "incoming"
							? "Incoming Call"
							: callState.status === "outgoing"
								? "Calling..."
								: callState.type === "video"
									? "Video Call"
									: "Audio Call"}
					</span>
				</div>
				<div className="flex items-center gap-3">
					{callState.status === "active" && (
						<span className="text-[11px] font-bold text-zinc-400 font-mono">
							{formatDuration(callDuration)}
						</span>
					)}
					{callState.status === "active" && (
						<button
							onClick={(e) => {
								e.stopPropagation();
								toggleFullscreen();
							}}
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
						onClick={
							callState.status === "incoming" ? onRejectCall : onEndCall
						}
						className="flex h-7 px-2.5 items-center gap-1.5 rounded-full bg-red-500/90 hover:bg-red-500 text-white transition-all cursor-pointer shadow-sm text-[11px] font-bold uppercase tracking-wider"
						title={
							callState.status === "incoming" ? "Decline call" : "Leave call"
						}
						aria-label={
							callState.status === "incoming" ? "Decline call" : "Leave call"
						}
					>
						<PhoneOff className="h-3.5 w-3.5" />
						{callState.status === "incoming" ? "Decline" : "Leave"}
					</button>
				</div>
			</div>

			{/* Main stage */}
			<div className="relative z-10 flex-1 min-h-0">
				{callState.type === "video" && callState.status === "active" ? (
					/* ACTIVE video call — the remote video fills the whole stage
					   unobstructed. Only small overlays: partner name chip (top),
					   compact mic meter (bottom-center) + network status chips. */
					<>
						<div className="absolute top-3 left-1/2 -translate-x-1/2 max-w-[70%] truncate rounded-full bg-black/50 px-3 py-1 text-xs font-bold text-white/90 backdrop-blur-sm">
							{callState.partnerName}
						</div>
						{(iceConnectionState === "disconnected" ||
							iceConnectionState === "failed") && (
							<motion.div
								initial={{ opacity: 0, y: -5 }}
								animate={{ opacity: 1, y: 0 }}
								className="absolute top-3 left-1/2 -translate-x-1/2 mt-8 flex items-center justify-center gap-2 rounded-full bg-black/50 px-3 py-1 backdrop-blur-sm">
								<span className="h-2 w-2 rounded-full bg-amber-400 animate-pulse" />
								<span className="text-[10px] font-black text-amber-400 uppercase tracking-[0.12em]">
									Reconnecting...
								</span>
							</motion.div>
						)}
						{poorNetwork && (
							<motion.div
								initial={{ opacity: 0, y: -5 }}
								animate={{ opacity: 1, y: 0 }}
								className="absolute top-3 left-1/2 -translate-x-1/2 mt-8 flex items-center justify-center gap-2 rounded-full bg-black/50 px-3 py-1 backdrop-blur-sm">
								<span className="h-2 w-2 rounded-full bg-orange-400 animate-pulse" />
								<span className="text-[10px] font-black text-orange-300 uppercase tracking-[0.12em]">
									Poor connection — reducing quality
								</span>
							</motion.div>
						)}
						{/* Compact mic meter — subtle bottom-center chip */}
						<div className="absolute bottom-24 left-1/2 -translate-x-1/2 flex items-center justify-center gap-[3px] h-8 px-4 rounded-full bg-black/40 backdrop-blur-sm">
							{Array.from({ length: 24 }).map((_, i) => {
								const threshold = ((i + 1) / 24) * 100;
								const active = micLevel >= threshold && !isMuted;
								const height = 2 + (i / 24) * 14;
								return (
									<span
										key={i}
										className="w-[3px] rounded-full transition-all duration-75"
										style={{
											height: `${height}px`,
											backgroundColor: active
												? threshold > 70
													? "rgb(239 68 68)"
													: threshold > 40
														? "rgb(251 191 36)"
														: "rgb(52 211 153)"
												: "rgba(255,255,255,0.10)",
										}}
									/>
								);
							})}
						</div>
					</>
				) : (
					/* Audio call / incoming / outgoing — centered partner info */
					<div className="h-full flex flex-col items-center justify-center gap-6 min-h-0 px-6">
						{/* Partner info */}
						<div className="text-center">
							<div className="relative inline-flex">
								<div className="relative rounded-full p-[3px] bg-linear-to-br from-violet-400/60 via-fuchsia-300/40 to-amber-300/50 shadow-[0_0_30px_-5px_rgba(139,92,246,0.3)]">
									<UserAvatar
										src={callState.partnerAvatar}
										alt={callState.partnerName}
										className="rounded-full object-cover border-2 border-zinc-950 h-28 w-28"
									/>
								</div>
								{callState.status === "outgoing" && (
									<motion.div
										animate={{ scale: [1, 1.2, 1] }}
										transition={{ repeat: Infinity, duration: 1.5 }}
										className="absolute -bottom-1 -right-1 h-5 w-5 rounded-full bg-emerald-500 border-[3px] border-zinc-950 shadow-lg shadow-emerald-500/30"
									/>
								)}
							</div>
							<h3 className="text-display-xs text-white mt-5">
								{callState.partnerName}
							</h3>
							<p className="text-sm text-zinc-400 mt-1.5 font-medium tracking-wide">
								{callState.status === "active" && "On call"}
							</p>
							{callState.status === "active" &&
								(iceConnectionState === "disconnected" ||
									iceConnectionState === "failed") && (
									<motion.div
										initial={{ opacity: 0, y: -5 }}
										animate={{ opacity: 1, y: 0 }}
										className="flex items-center justify-center gap-2 mt-4">
										<span className="h-2 w-2 rounded-full bg-amber-400 animate-pulse" />
										<span className="text-[11px] font-black text-amber-400 uppercase tracking-[0.12em]">
											Reconnecting...
										</span>
									</motion.div>
								)}
							{callState.status === "active" && poorNetwork && (
								<motion.div
									initial={{ opacity: 0, y: -5 }}
									animate={{ opacity: 1, y: 0 }}
									className="flex items-center justify-center gap-2 mt-4">
									<span className="h-2 w-2 rounded-full bg-orange-400 animate-pulse" />
									<span className="text-[11px] font-black text-orange-300 uppercase tracking-[0.12em]">
										Poor connection — reducing video quality
									</span>
								</motion.div>
							)}
						</div>

						{/* Microphone volume meter */}
						{callState.status === "active" && (
							<div className="flex items-center justify-center gap-[3px] h-10 w-full max-w-[160px]">
								{Array.from({ length: 24 }).map((_, i) => {
									const threshold = ((i + 1) / 24) * 100;
									const active = micLevel >= threshold && !isMuted;
									const height = 3 + (i / 24) * 28;
									return (
										<span
											key={i}
											className="w-[4px] rounded-full transition-all duration-75"
											style={{
												height: `${height}px`,
												backgroundColor: active
													? threshold > 70
														? "rgb(239 68 68)"
														: threshold > 40
															? "rgb(251 191 36)"
															: "rgb(52 211 153)"
													: "rgba(255,255,255,0.08)",
											}}
										/>
									);
								})}
							</div>
						)}
					</div>
				)}

				{/* Local video preview (picture-in-picture, bottom-right corner) */}
				{callState.type === "video" && (
					<div
						className="absolute z-20 w-28 h-44 rounded-2xl overflow-hidden border border-white/15 shadow-2xl shadow-black/50 bg-zinc-900 cursor-grab active:cursor-grabbing touch-none"
						style={
							pipPos
								? { left: pipPos.x, top: pipPos.y }
								: { right: 20, bottom: 96 }
						}
						onPointerDown={onPipPointerDown}
						onPointerMove={onPipPointerMove}
						onPointerUp={onPipPointerUp}
						onPointerCancel={onPipPointerUp}
						onClick={(e) => {
							// Taps on the PiP never bubble to the call stage's tap
							// handler — but still run the iOS audio-unlock fallback.
							e.stopPropagation();
							handleCallTap();
						}}
					>
						<video
							ref={localVideoRef}
							autoPlay
							playsInline
							muted
							className={`w-full h-full object-cover ${isVideoOff ? "opacity-0" : ""}`}
						/>
						{/* Edge-light sheen on PiP */}
						<div className="absolute inset-x-0 top-0 h-[1px] bg-linear-to-r from-transparent via-white/30 to-transparent pointer-events-none z-10" />
						{/* Avatar overlay when local video is hidden */}
						{isVideoOff && (
							<div className="absolute inset-0 flex items-center justify-center bg-zinc-900">
								<UserAvatar
									src={user.profilePic?.url}
									alt={user.fullName}
									className="h-12 w-12 rounded-full object-cover border-2 border-zinc-700 opacity-60"
								/>
							</div>
						)}
					</div>
				)}
			</div>

			{/* Controls bar — same shell as the group-call floor */}
			<div className="relative z-10 flex items-center justify-center gap-4 py-4 px-4 border-t border-zinc-800/50 shrink-0">
				{/* Speaker toggle */}
				{callState.status === "active" && (
					<button
						onClick={toggleSpeaker}
						className={`h-12 w-12 rounded-2xl flex items-center justify-center transition-all cursor-pointer backdrop-blur-md ${
							isSpeakerOn
								? "bg-violet-500/15 text-violet-400 border border-violet-500/25 shadow-sm shadow-violet-500/10"
								: "bg-zinc-800/90 text-zinc-200 hover:bg-zinc-700/90 border border-zinc-700/50 shadow-sm"
						}`}
						title={isSpeakerOn ? "Switch to earpiece" : "Switch to speaker"}
						aria-label={isSpeakerOn ? "Switch to earpiece" : "Switch to speaker"}>
						<Volume2 className="h-4.5 w-4.5" />
					</button>
				)}

				{/* Camera switch */}
				{callState.type === "video" &&
					callState.status === "active" &&
					hasMultipleCameras && (
						<button
							onClick={switchCamera}
							className="h-12 w-12 rounded-2xl bg-zinc-800/90 text-zinc-200 hover:bg-zinc-700/90 border border-zinc-700/50 flex items-center justify-center transition-all cursor-pointer backdrop-blur-md shadow-sm"
							title="Switch camera"
							aria-label="Switch camera">
							<RefreshCw className="h-4.5 w-4.5" />
						</button>
					)}

				{/* Mute button */}
				<button
					onClick={toggleMute}
					className={`h-12 w-12 rounded-2xl flex items-center justify-center transition-all cursor-pointer backdrop-blur-md shadow-sm ${
						isMuted
							? "bg-red-500/15 text-red-400 border border-red-500/25 shadow-red-500/10"
							: "bg-zinc-800/90 text-zinc-200 hover:bg-zinc-700/90 border border-zinc-700/50"
					}`}>
					{isMuted ? (
						<MicOff className="h-5 w-5" />
					) : (
						<Mic className="h-5 w-5" />
					)}
				</button>

				{/* Video toggle */}
				{callState.type === "video" &&
					callState.status === "active" && (
						<button
							onClick={toggleVideo}
							className={`h-12 w-12 rounded-2xl flex items-center justify-center transition-all cursor-pointer backdrop-blur-md shadow-sm ${
								isVideoOff
									? "bg-red-500/15 text-red-400 border border-red-500/25 shadow-red-500/10"
									: "bg-zinc-800/90 text-zinc-200 hover:bg-zinc-700/90 border border-zinc-700/50"
							}`}>
							{isVideoOff ? (
								<VideoOff className="h-5 w-5" />
							) : (
								<Video className="h-5 w-5" />
							)}
						</button>
					)}

					{/* End / Reject call */}
					<button
						onClick={
							callState.status === "incoming"
								? onRejectCall
								: onEndCall
						}
						className="h-12 w-12 rounded-2xl bg-red-500/90 text-white hover:bg-red-500 flex items-center justify-center transition-all cursor-pointer shadow-lg shadow-red-500/25 border border-red-400/30 backdrop-blur-md">
						<PhoneOff className="h-5 w-5" />
					</button>

					{/* Accept call (incoming only) */}
					{callState.status === "incoming" && (
						<button
							onClick={onAcceptCall}
							className="h-12 w-12 rounded-2xl bg-emerald-500/90 text-white hover:bg-emerald-500 flex items-center justify-center transition-all cursor-pointer shadow-lg shadow-emerald-500/25 border border-emerald-400/30 animate-pulse backdrop-blur-md">
							<Phone className="h-5 w-5" />
						</button>
					)}
			</div>
		</motion.div>
	);
}
