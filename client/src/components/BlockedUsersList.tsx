import { useState, useEffect } from "react";
import { Shield, ShieldOff, Loader2, UserX } from "lucide-react";
import { apiFetch } from "../utils/api";
import { logger } from "../utils/logger";
import UserAvatar from "./UserAvatar";

interface BlockedUser {
  _id: string;
  username: string;
  fullName: string;
  profilePic?: { url: string };
}

export default function BlockedUsersList() {
  const [blockedUsers, setBlockedUsers] = useState<BlockedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [unblockingIds, setUnblockingIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const fetchBlockedUsers = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch("/api/blocks");
      const data = await res.json();
      if (res.ok && data.success) {
        // Server returns the list under `users` (primary) and `blockedUsers`
        // (backward compat) — accept either.
        setBlockedUsers(data.users || data.blockedUsers || []);
      } else {
        setError(data.message || "Failed to load blocked users");
      }
    } catch (err) {
      logger.error("Failed to fetch blocked users", err);
      setError("Network error while loading blocked users");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBlockedUsers();
  }, []);

  const handleUnblock = async (userId: string) => {
    setUnblockingIds((prev) => new Set(prev).add(userId));
    try {
      const res = await apiFetch(`/api/blocks/${userId}`, { method: "DELETE" });
      const data = await res.json();
      if (res.ok && data.success) {
        setBlockedUsers((prev) => prev.filter((u) => u._id !== userId));
      } else {
        throw new Error(data.message || "Failed to unblock");
      }
    } catch (err) {
      logger.error("Failed to unblock user", err);
      window.dispatchEvent(
        new CustomEvent("showToast", {
          detail: { message: "Failed to unblock user", type: "error" },
        }),
      );
    } finally {
      setUnblockingIds((prev) => {
        const next = new Set(prev);
        next.delete(userId);
        return next;
      });
    }
  };

  if (loading) {
    return (
      <div className="rounded-xl border border-white/10 bg-zinc-950/95 backdrop-blur-none sm:bg-zinc-950/35 sm:backdrop-blur-xl sm:backdrop-saturate-150 p-6 shadow-[0_15px_40px_-15px_rgba(0,0,0,0.7)]">
        <div className="flex items-center gap-2 mb-4">
          <Shield className="h-4 w-4 text-zinc-400" />
          <span className="text-sm font-bold text-white uppercase tracking-wider">
            Blocked Users
          </span>
        </div>
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-zinc-500" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-white/10 bg-zinc-950/95 backdrop-blur-none sm:bg-zinc-950/35 sm:backdrop-blur-xl sm:backdrop-saturate-150 p-6 shadow-[0_15px_40px_-15px_rgba(0,0,0,0.7)]">
        <div className="flex items-center gap-2 mb-4">
          <Shield className="h-4 w-4 text-zinc-400" />
          <span className="text-sm font-bold text-white uppercase tracking-wider">
            Blocked Users
          </span>
        </div>
        <p className="text-xs text-red-400">{error}</p>
        <button
          onClick={fetchBlockedUsers}
          className="mt-3 rounded-full bg-zinc-800 px-4 py-1.5 text-xs font-bold text-zinc-300 hover:bg-zinc-700 transition-colors cursor-pointer"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-white/10 bg-zinc-950/95 backdrop-blur-none sm:bg-zinc-950/35 sm:backdrop-blur-xl sm:backdrop-saturate-150 p-6 shadow-[0_15px_40px_-15px_rgba(0,0,0,0.7)]">
      <div className="flex items-center gap-2 mb-4">
        <Shield className="h-4 w-4 text-zinc-400" />
        <span className="text-sm font-bold text-white uppercase tracking-wider">
          Blocked Users
        </span>
        <span className="ml-auto text-[11px] text-zinc-500">
          {blockedUsers.length} {blockedUsers.length === 1 ? "user" : "users"}
        </span>
      </div>

      {blockedUsers.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <UserX className="h-8 w-8 text-zinc-600 mb-2" />
          <p className="text-xs text-zinc-500">No blocked users</p>
          <p className="text-[10px] text-zinc-600 mt-1">
            Blocked users won't be able to interact with you
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {blockedUsers.map((user) => {
            const isUnblocking = unblockingIds.has(user._id);
            return (
              <div
                key={user._id}
                className="flex items-center justify-between rounded-lg px-3 py-2.5 bg-zinc-800/20 hover:bg-zinc-800/40 transition-colors"
              >
                <div className="flex items-center gap-2.5 min-w-0 flex-1">
                  <UserAvatar
                    src={user.profilePic?.url || ""}
                    alt={user.fullName}
                    className="h-8 w-8 rounded-full object-cover border border-zinc-700 shrink-0"
                  />
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-zinc-200 truncate">
                      {user.fullName}
                    </p>
                    <p className="text-[10px] text-zinc-500">
                      @{user.username}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => handleUnblock(user._id)}
                  disabled={isUnblocking}
                  className="ml-2 shrink-0 flex items-center gap-1 rounded-full bg-red-500/10 px-3 py-1.5 text-[10px] font-bold text-red-400 hover:bg-red-500/20 transition-colors cursor-pointer disabled:opacity-50"
                >
                  {isUnblocking ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <ShieldOff className="h-3 w-3" />
                  )}
                  Unblock
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
