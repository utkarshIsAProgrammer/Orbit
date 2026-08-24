/**
 * featureGates.ts — module-level feature-flag store.
 *
 * The admin's kill switches (posts_enabled, chats_enabled, …) are fetched
 * once per session and cached here, so ANY component can check a gate
 * synchronously without prop drilling or re-render plumbing.
 *
 * Default behavior: a missing/unknown key means the feature is ON (the app
 * must never silently break when flags aren't reachable).
 */

let gates: Record<string, boolean> = {};

export function setFeatureGates(next: Record<string, boolean>): void {
	gates = next || {};
}

/** True when a feature is enabled. Unknown/missing keys default to ON. */
export function isFeatureOn(key: string): boolean {
	return gates[key] !== false;
}

/** The inverse of isFeatureOn — for inverted switches like maintenance_mode. */
export function isFeatureOff(key: string): boolean {
	return gates[key] === false;
}
