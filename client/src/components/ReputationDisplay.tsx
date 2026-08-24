import { useState, useEffect } from "react";
import { Award, Loader2 } from "lucide-react";
import { apiFetch } from "../utils/api";
import { logger } from "../utils/logger";
import { BADGE_MAP } from "../utils/badgeCatalog";

interface ReputationInfo {
  totalXP: number;
  level: number;
  badges: string[];
  nextLevelXP: number;
  currentLevelXP: number;
  levelMinXP: number;
}

interface ReputationDisplayProps {
  userId?: string;
  compact?: boolean;
}

export default function ReputationDisplay({ userId, compact = false }: ReputationDisplayProps) {
  const [repInfo, setRepInfo] = useState<ReputationInfo | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchRep = async () => {
      try {
        const endpoint = userId ? `/api/xp/${userId}` : "/api/xp";
        const res = await apiFetch(endpoint);
        const data = await res.json();
        if (res.ok && data.success) {
          setRepInfo({
            totalXP: data.totalXP ?? 0,
            level: data.level ?? 1,
            badges: data.badges ?? [],
            nextLevelXP: data.nextLevelXP ?? 100,
            currentLevelXP: data.currentLevelXP ?? 0,
            levelMinXP: data.levelMinXP ?? 0,
          });
        }
      } catch (err) {
        logger.error("Failed to fetch reputation info", err);
      } finally {
        setLoading(false);
      }
    };
    fetchRep();
  }, [userId]);

  const getLevelLabel = (level: number): string => {
    if (level === 1) return "Newcomer";
    if (level === 2) return "Explorer";
    if (level === 3) return "Regular";
    if (level === 4) return "Contributor";
    if (level === 5) return "Influencer";
    if (level >= 6 && level <= 9) return "Icon";
    if (level >= 10 && level <= 14) return "Legend";
    if (level >= 15) return "Orbit Elite";
    return `Level ${level}`;
  };

  if (loading) {
    return (
      <div className="flex items-center gap-1.5 text-xs text-zinc-500">
        <Loader2 className="h-3 w-3 animate-spin" />
        XP...
      </div>
    );
  }

  if (!repInfo) return null;

  const progress = repInfo.nextLevelXP > repInfo.levelMinXP
    ? Math.min(100, Math.round(((repInfo.totalXP - repInfo.levelMinXP) / (repInfo.nextLevelXP - repInfo.levelMinXP)) * 100))
    : 100;

  if (compact) {
    return (
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-1.5 text-xs text-zinc-400">
          <Award className="h-3.5 w-3.5 text-amber-400" />
          <span className="font-bold text-zinc-300">{getLevelLabel(repInfo.level)}</span>
          <span className="text-zinc-600">{repInfo.totalXP.toLocaleString()} XP</span>
          {repInfo.badges.length > 0 && (
            <span className="ml-1 flex items-center gap-1">
              {repInfo.badges.slice(0, 3).map((badge) => {
                const entry = BADGE_MAP[badge];
                const Icon = entry?.Icon;
                if (!Icon) return null;
                return (
                  <span
                    key={badge}
                    className="flex h-4 w-4 items-center justify-center rounded-full bg-amber-500/10 text-amber-400"
                    title={entry ? `${entry.label} — ${entry.description}` : badge}
                  >
                    <Icon className="h-2.5 w-2.5" />
                  </span>
                );
              })}
              {repInfo.badges.length > 3 && (
                <span className="text-[8px] text-zinc-500">+{repInfo.badges.length - 3}</span>
              )}
            </span>
          )}
        </div>
        {/* Thin progress bar */}
        <div className="h-1 w-full max-w-[200px] rounded-full bg-zinc-800 overflow-hidden">
          <div
            className="h-full rounded-full bg-gradient-to-r from-amber-500 to-orange-400 transition-all duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>
        <span className="text-[9px] text-zinc-500">
          {repInfo.totalXP.toLocaleString()} / {repInfo.nextLevelXP.toLocaleString()} XP
        </span>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-zinc-800/50 bg-zinc-900/30 p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <Award className="h-4 w-4 text-amber-400" />
          <span className="text-sm font-bold text-white">{getLevelLabel(repInfo.level)}</span>
        </div>
        <span className="text-[11px] text-zinc-400">
          {repInfo.totalXP.toLocaleString()} XP
        </span>
      </div>
      {/* Progress bar */}
      <div className="h-1.5 w-full rounded-full bg-zinc-800 overflow-hidden">
        <div
          className="h-full rounded-full bg-gradient-to-r from-amber-500 to-orange-400 transition-all duration-500"
          style={{ width: `${progress}%` }}
        />
      </div>
      <div className="flex justify-between mt-1">          <span className="text-[9px] text-zinc-500">
            {repInfo.totalXP.toLocaleString()} XP
          </span>
          <span className="text-[9px] text-zinc-500">
            {repInfo.nextLevelXP.toLocaleString()} XP
          </span>
      </div>
      {repInfo.badges.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {repInfo.badges.map((badge) => (
            <span
              key={badge}
              title={BADGE_MAP[badge]?.description}
              className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[9px] font-bold text-amber-400"
            >
              {BADGE_MAP[badge]?.label || badge.replace(/_/g, " ")}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
