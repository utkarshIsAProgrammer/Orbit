import { useState, useEffect } from "react";
import { CheckCircle2, Circle, Gift, Loader2, ListChecks } from "lucide-react";
import { apiFetch } from "../utils/api";
import { useCacheRefresh } from "../hooks/useCacheRefresh";
import { logger } from "../utils/logger";

// Stable RegExp for matching missions cache refresh events
// — module-level to prevent React effect re-attachment on every render.
const MATCHER_MISSIONS = /\/api\/missions\/today/;

interface Mission {
  type: string;
  current: number;
  target: number;
  completed: boolean;
  claimed: boolean;
}

interface MissionsData {
  date: string;
  missions: Mission[];
  allCompleted: boolean;
  allClaimed: boolean;
}

export default function MissionsPanel() {
  const [data, setData] = useState<MissionsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [claiming, setClaiming] = useState<string | null>(null);

  const fetchMissions = async () => {
    try {
      const res = await apiFetch("/api/missions/today");
      const json = await res.json();
      if (res.ok && json.success !== false) {
        setData({
          date: json.date,
          missions: json.missions,
          allCompleted: json.allCompleted,
          allClaimed: json.allClaimed,
        });
      }
    } catch (err) {
      logger.error("Failed to fetch missions", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMissions();
  }, []);

  // When the background cache timer refreshes the missions data (e.g. after
  // the user creates a post / likes / comments), re-fetch so progress bars
  // update in place without a page reload.
  useCacheRefresh(MATCHER_MISSIONS, () => fetchMissions());

  const handleClaim = async (type: string) => {
    setClaiming(type);
    try {
      const res = await apiFetch("/api/missions/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type }),
      });
      const json = await res.json();
      if (res.ok && json.success) {
        fetchMissions();
      } else {
        window.dispatchEvent(new CustomEvent("showToast", {
          detail: { message: json.message || "Failed to claim", type: "error" },
        }));
      }
    } catch (err) {
      logger.error("Failed to claim mission", err);
    } finally {
      setClaiming(null);
    }
  };

  if (loading) {
    return (
      <div className="rounded-xl border border-zinc-800/50 bg-zinc-900/30 p-4">
        <div className="flex items-center gap-2 mb-3">
          <ListChecks className="h-4 w-4 text-violet-400" />
          <span className="text-label-sm font-semibold text-zinc-300">Daily Missions</span>
        </div>
        <div className="flex items-center justify-center py-4">
          <Loader2 className="h-4 w-4 animate-spin text-zinc-500" />
        </div>
      </div>
    );
  }

  if (!data) return null;

  const claimedCount = data.missions.filter(m => m.claimed).length;
  const totalCount = data.missions.length;

  return (
    <div className="rounded-xl border border-zinc-800/50 bg-zinc-900/30 p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <ListChecks className="h-4 w-4 text-violet-400" />
          <span className="text-label-sm font-semibold text-zinc-300">Daily Missions</span>
        </div>
        <span className="text-[10px] text-zinc-500">
          {claimedCount}/{totalCount} claimed
        </span>
      </div>

      <div className="space-y-2">
        {data.missions.map((mission) => {
          const progress = Math.min(100, Math.round((mission.current / mission.target) * 100));
          const missionLabels: Record<string, string> = {
            post: "Create a post",
            comment: "Comment on 3 posts",
            like: "Like 5 posts",
            share: "Share a post",
            story: "Post a story",
            profile_view: "View 5 profiles",
          };

          return (
            <div
              key={mission.type}
              className={`flex items-center justify-between rounded-lg px-3 py-2 transition-colors ${
                mission.completed ? "bg-green-500/5" : "bg-zinc-800/20"
              }`}
            >
              <div className="flex items-center gap-2 min-w-0 flex-1">
                {mission.completed ? (
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-green-400" />
                ) : (
                  <Circle className="h-4 w-4 shrink-0 text-zinc-600" />
                )}
                <div className="min-w-0">
                  <p className={`text-xs font-medium truncate ${
                    mission.completed ? "text-green-300" : "text-zinc-300"
                  }`}>
                    {missionLabels[mission.type] || mission.type}
                  </p>
                  <div className="flex items-center gap-1.5 mt-1">
                    <div className="h-1 w-16 rounded-full bg-zinc-800 overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-300 ${
                          mission.completed ? "bg-green-500" : "bg-violet-500"
                        }`}
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                    <span className="text-[9px] text-zinc-500">
                      {mission.current}/{mission.target}
                    </span>
                  </div>
                </div>
              </div>
              {mission.completed && !mission.claimed && (
                <button
                  onClick={() => handleClaim(mission.type)}
                  disabled={claiming === mission.type}
                  className="ml-2 shrink-0 rounded-full bg-amber-500/10 px-2.5 py-1 text-[9px] font-bold text-amber-400 hover:bg-amber-500/20 transition-colors cursor-pointer disabled:opacity-50"
                >
                  {claiming === mission.type ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Gift className="h-3 w-3" />
                  )}
                </button>
              )}
              {mission.claimed && (
                <span className="ml-2 text-[9px] text-zinc-600 font-medium">Claimed</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
