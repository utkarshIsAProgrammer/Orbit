import { useState, useEffect, useCallback } from "react";
import { UserPlus, UserMinus, Users, Search, Loader2, Lock } from "lucide-react";
import { apiFetch } from "../utils/api";
import { evictCachedResponse } from "../utils/apiCache";
import { logger } from "../utils/logger";
import UserAvatar from "./UserAvatar";
import type { User } from "../types";

interface CloseFriendUser {
  _id: string;
  username: string;
  fullName: string;
  profilePic?: { url: string };
}

interface CloseFriendsTabProps {
  user: User;
}

export default function CloseFriendsTab({ user }: CloseFriendsTabProps) {
  const [closeFriends, setCloseFriends] = useState<CloseFriendUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<CloseFriendUser[]>([]);
  const [searching, setSearching] = useState(false);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const closeFriendIds = new Set(closeFriends.map((f) => f._id));

  const fetchCloseFriends = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch("/api/users/close-friends");
      const data = await res.json();
      if (res.ok && data.success) {
        setCloseFriends(data.closeFriends || []);
      } else {
        setError(data.message || "Failed to load close friends");
      }
    } catch (err) {
      logger.error("Failed to fetch close friends", err);
      setError("Network error while loading close friends");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCloseFriends();
  }, [fetchCloseFriends]);

  // Search for users to add
  useEffect(() => {
    const trimmed = searchQuery.trim();
    if (!trimmed) {
      setSearchResults([]);
      return;
    }
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const res = await apiFetch(
          `/api/search/users?q=${encodeURIComponent(trimmed)}&limit=8`,
        );
        const data = await res.json();
        if (res.ok && data.success) {
          setSearchResults((data.users || []).filter((u: any) => u._id !== user._id));
        }
      } catch (err) {
        logger.error("Failed to search users for close friends", err);
      } finally {
        setSearching(false);
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [searchQuery, user._id]);

  const addCloseFriend = async (userId: string) => {
    setBusyIds((prev) => new Set(prev).add(userId));
    try {
      const res = await apiFetch(`/api/users/close-friends/${userId}`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.message || "Failed to add close friend");
      }
      // apiFetch is cache-first (2 min default TTL) — the just-mutated
      // close-friends list must NOT be re-served from the stale cache, or the
      // newly-added friend stays invisible until the TTL expires.
      await evictCachedResponse("/api/users/close-friends");
      await fetchCloseFriends();
      const addedUser = searchResults.find((u) => u._id === userId);
      if (addedUser) {
        window.dispatchEvent(
          new CustomEvent("showToast", {
            detail: { message: `Added @${addedUser.username} to close friends`, type: "success" },
          }),
        );
      }
    } catch (err: any) {
      logger.error("Failed to add close friend", err);
      window.dispatchEvent(
        new CustomEvent("showToast", {
          detail: { message: err.message || "Failed to add close friend", type: "error" },
        }),
      );
    } finally {
      setBusyIds((prev) => {
        const next = new Set(prev);
        next.delete(userId);
        return next;
      });
    }
  };

  const removeCloseFriend = async (userId: string, username?: string) => {
    setBusyIds((prev) => new Set(prev).add(userId));
    try {
      const res = await apiFetch(`/api/users/close-friends/${userId}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.message || "Failed to remove close friend");
      }
      // Same cache-first concern as add: evict so the removal is reflected
      // immediately on the next fetch/mount.
      await evictCachedResponse("/api/users/close-friends");
      setCloseFriends((prev) => prev.filter((f) => f._id !== userId));
      window.dispatchEvent(
        new CustomEvent("showToast", {
          detail: {
            message: username
              ? `Removed @${username} from close friends`
              : "Removed from close friends",
            type: "success",
          },
        }),
      );
    } catch (err: any) {
      logger.error("Failed to remove close friend", err);
      window.dispatchEvent(
        new CustomEvent("showToast", {
          detail: { message: err.message || "Failed to remove close friend", type: "error" },
        }),
      );
    } finally {
      setBusyIds((prev) => {
        const next = new Set(prev);
        next.delete(userId);
        return next;
      });
    }
  };

  return (
    <div className="rounded-2xl border border-white/10 bg-zinc-950/95 backdrop-blur-none sm:bg-zinc-950/35 sm:backdrop-blur-xl sm:backdrop-saturate-150 p-5 sm:p-6 shadow-[0_15px_40px_-15px_rgba(0,0,0,0.7)]">
      <div className="flex items-center gap-2 mb-1">
        <Lock className="h-4 w-4 text-emerald-400/80" />
        <span className="text-sm font-bold text-white uppercase tracking-wider">
          Close Friends
        </span>
        <span className="ml-auto text-[11px] text-zinc-500">
          {closeFriends.length}{" "}
          {closeFriends.length === 1 ? "friend" : "friends"}
        </span>
      </div>
      <p className="text-[11px] text-zinc-500 mb-4">
        Close-friends-only posts &amp; glances are shared exclusively with this
        list. Add people to see their private posts and let them see yours.
      </p>

      {error && (
        <div className="mb-4 flex items-center justify-between rounded-xl border border-rose-500/20 bg-rose-500/5 px-4 py-3">
          <p className="text-xs text-rose-400">{error}</p>
          <button
            onClick={fetchCloseFriends}
            className="rounded-full bg-zinc-800 px-3 py-1 text-[10px] font-bold text-zinc-300 hover:bg-zinc-700 transition-colors cursor-pointer"
          >
            Retry
          </button>
        </div>
      )}

      {/* Search to add */}
      <div className="relative mb-5">
        <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-zinc-500">
          <Search className="h-3.5 w-3.5" />
        </span>
        <input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search people to add…"
          className="w-full rounded-xl border border-zinc-800 bg-zinc-950/60 py-2.5 pl-9 pr-4 text-[12px] font-medium text-white placeholder-zinc-500 focus:outline-none focus:border-emerald-500/30 focus:bg-zinc-900 transition-all"
        />
      </div>

      {searching && (
        <div className="mb-4 flex items-center gap-2 text-[11px] text-zinc-500">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Searching…
        </div>
      )}

      {searchQuery.trim() && !searching && (
        <div className="mb-5 space-y-1.5">
          {searchResults.length === 0 ? (
            <p className="py-2 text-center text-[11px] text-zinc-600">
              No people found
            </p>
          ) : (
            searchResults.map((result) => {
              const isBusy = busyIds.has(result._id);
              const alreadyAdded = closeFriendIds.has(result._id);
              return (
                <div
                  key={result._id}
                  className="flex items-center justify-between rounded-lg px-3 py-2 bg-zinc-800/20 hover:bg-zinc-800/40 transition-colors"
                >
                  <div className="flex items-center gap-2.5 min-w-0 flex-1">
                    <UserAvatar
                      src={result.profilePic?.url || ""}
                      alt={result.fullName}
                      className="h-8 w-8 rounded-full object-cover border border-zinc-700 shrink-0"
                    />
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-zinc-200 truncate">
                        {result.fullName}
                      </p>
                      <p className="text-[10px] text-zinc-500">
                        @{result.username}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() =>
                      alreadyAdded
                        ? removeCloseFriend(result._id, result.username)
                        : addCloseFriend(result._id)
                    }
                    disabled={isBusy}
                    className={`ml-2 shrink-0 flex items-center gap-1 rounded-full px-3 py-1.5 text-[10px] font-bold transition-all cursor-pointer disabled:opacity-50 ${
                      alreadyAdded
                        ? "bg-emerald-500/8 text-emerald-400/90 hover:bg-emerald-500/15 border border-emerald-500/25"
                        : "bg-zinc-800 text-zinc-200 hover:bg-zinc-700 border border-zinc-700"
                    }`}
                  >
                    {isBusy ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : alreadyAdded ? (
                      <UserMinus className="h-3 w-3" />
                    ) : (
                      <UserPlus className="h-3 w-3" />
                    )}
                    {alreadyAdded ? "Close Friend" : "Add"}
                  </button>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* Current close friends */}
      {loading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-zinc-500" />
        </div>
      ) : closeFriends.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <Users className="h-8 w-8 text-zinc-600 mb-2" />
          <p className="text-xs text-zinc-500">No close friends yet</p>
          <p className="text-[10px] text-zinc-600 mt-1">
            Search above to add people to your inner circle
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {closeFriends.map((friend) => {
            const isBusy = busyIds.has(friend._id);
            return (
              <div
                key={friend._id}
                className="flex items-center justify-between rounded-lg px-3 py-2.5 bg-zinc-800/20 hover:bg-zinc-800/40 transition-colors"
              >
                <div className="flex items-center gap-2.5 min-w-0 flex-1">
                  <div className="relative">
                    <UserAvatar
                      src={friend.profilePic?.url || ""}
                      alt={friend.fullName}
                      className="h-9 w-9 rounded-full object-cover border border-zinc-700 shrink-0"
                    />
                    <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full bg-emerald-500/70 border-2 border-zinc-950" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-zinc-100 truncate">
                      {friend.fullName}
                    </p>
                    <p className="text-[10px] text-zinc-500">
                      @{friend.username}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => removeCloseFriend(friend._id, friend.username)}
                  disabled={isBusy}
                  className="ml-2 shrink-0 flex items-center gap-1 rounded-full bg-zinc-800 px-3 py-1.5 text-[10px] font-bold text-zinc-300 hover:bg-red-500/20 hover:text-red-400 transition-colors cursor-pointer disabled:opacity-50"
                >
                  {isBusy ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <UserMinus className="h-3 w-3" />
                  )}
                  Remove
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
