/**
 * useOfflineSync.ts — React hook for offline-first state management.
 *
 * Provides:
 * - `isOnline` — reactive online/offline boolean
 * - `isSyncing` — whether we're currently processing the mutation queue
 * - `pendingMutations` — count of queued mutations waiting to sync
 * - `triggerSync` — manually trigger queue processing
 */

import { useState, useEffect, useCallback } from "react";
import {
	processSyncQueue,
	getQueueSize,
} from "../utils/syncQueue";
import { pruneOldData } from "../utils/offlineDB";
import { logger } from "../utils/logger";

export function useOfflineSync() {
	const [isOnline, setIsOnline] = useState(navigator.onLine);
	const [isSyncing, setIsSyncing] = useState(false);
	const [pendingMutations, setPendingMutations] = useState(0);

	// Refresh the pending mutation count
	const refreshPendingCount = useCallback(async () => {
		try {
			const count = await getQueueSize();
			setPendingMutations(count);
		} catch {
			// Dexie might not be available in SSR
		}
	}, []);

	// Prune stale data on mount (run once per session)
	useEffect(() => {
		pruneOldData(7).catch(() => {
			// Non-critical — Dexie might not be available in all contexts
		});
	}, []);

	// Listen for online/offline events
	useEffect(() => {
		const handleOnline = async () => {
			logger.info("useOfflineSync: Came online, processing queue");
			setIsOnline(true);
			setIsSyncing(true);
			try {
				await processSyncQueue();
			} catch (err) {
				logger.error("useOfflineSync: Sync error", err);
			} finally {
				setIsSyncing(false);
				await refreshPendingCount();
			}
		};

		const handleOffline = () => {
			logger.info("useOfflineSync: Went offline");
			setIsOnline(false);
		};

		window.addEventListener("online", handleOnline);
		window.addEventListener("offline", handleOffline);

		// Check initial state
		refreshPendingCount();

		return () => {
			window.removeEventListener("online", handleOnline);
			window.removeEventListener("offline", handleOffline);
		};
	}, [refreshPendingCount]);

	// Also refresh pending count when mutations may have been added
	const triggerSync = useCallback(async () => {
		if (!navigator.onLine) return;
		setIsSyncing(true);
		try {
			await processSyncQueue();
		} catch (err) {
			logger.error("useOfflineSync: Manual sync error", err);
		} finally {
			setIsSyncing(false);
			await refreshPendingCount();
		}
	}, [refreshPendingCount]);

	return {
		isOnline,
		isSyncing,
		pendingMutations,
		triggerSync,
	};
}
