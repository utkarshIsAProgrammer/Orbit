import { logger } from "./logger";
import { apiFetch } from "./api";
import { getNotificationPermission } from "./notifications";

export type DevicePermissionState = "default" | "granted" | "denied" | "unsupported";

export interface DevicePermissions {
	notifications: DevicePermissionState;
	camera: DevicePermissionState;
	microphone: DevicePermissionState;
}

/**
 * Read the current camera permission from the Permissions API when
 * available (falls back to "default" — the only accurate check is a probe).
 */
async function getCameraState(): Promise<DevicePermissionState> {
	if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
		return "unsupported";
	}
	try {
		if (navigator.permissions?.query) {
			const status = await navigator.permissions.query({ name: "camera" as PermissionName });
			return (status.state as DevicePermissionState) || "default";
		}
	} catch {
		// Fall through to a default — the probe below is authoritative anyway.
	}
	return "default";
}

/** Same as getCameraState but for the microphone. */
async function getMicrophoneState(): Promise<DevicePermissionState> {
	if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
		return "unsupported";
	}
	try {
		if (navigator.permissions?.query) {
			const status = await navigator.permissions.query({ name: "microphone" as PermissionName });
			return (status.state as DevicePermissionState) || "default";
		}
	} catch {
		// Fall through.
	}
	return "default";
}

/**
 * Probe camera access: requesting a stream triggers the browser's one-time
 * permission prompt; we stop the tracks immediately after so nothing stays
 * live. Returns the resulting state.
 */
export async function requestCameraPermission(): Promise<DevicePermissionState> {
	if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
		return "unsupported";
	}
	let stream: MediaStream | null = null;
	try {
		stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
		return "granted";
	} catch (err: any) {
		// NotAllowedError = user denied; NotFoundError = no camera hardware.
		if (err?.name === "NotFoundError" || err?.name === "OverconstrainedError") {
			return "unsupported";
		}
		return "denied";
	} finally {
		stream?.getTracks().forEach((t) => t.stop());
	}
}

/** Probe microphone access — same pattern as requestCameraPermission. */
export async function requestMicrophonePermission(): Promise<DevicePermissionState> {
	if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
		return "unsupported";
	}
	let stream: MediaStream | null = null;
	try {
		stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
		return "granted";
	} catch (err: any) {
		if (err?.name === "NotFoundError") {
			return "unsupported";
		}
		return "denied";
	} finally {
		stream?.getTracks().forEach((t) => t.stop());
	}
}

/**
 * Read the current state of ALL device permissions without prompting
 * (notification state comes straight from the browser; camera/mic use the
 * Permissions API when present).
 */
export async function getDevicePermissions(): Promise<DevicePermissions> {
	const [camera, microphone] = await Promise.all([
		getCameraState(),
		getMicrophoneState(),
	]);
	return {
		notifications: getNotificationPermission() as DevicePermissionState,
		camera,
		microphone,
	};
}

/** Persist permission choices server-side (they follow the account). */
export async function saveDevicePermissions(
	permissions: Partial<DevicePermissions>,
	onboardingCompleted?: boolean,
): Promise<void> {
	try {
		const body: any = {};
		if (permissions && Object.keys(permissions).length > 0) {
			body.permissions = permissions;
		}
		if (onboardingCompleted !== undefined) {
			body.onboardingCompleted = onboardingCompleted;
		}
		if (Object.keys(body).length === 0) return;
		await apiFetch("/api/permissions", {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		});
	} catch (err) {
		logger.error("Failed to save device permissions", err);
	}
}
