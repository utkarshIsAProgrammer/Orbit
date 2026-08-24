import { useState, useEffect, useRef } from "react";
import {
  Bell,
  Heart,
  MessageCircle,
  UserPlus,
  AtSign,
  MessageSquare,
  Repeat2,
  Bookmark,
  BarChart3,
  Sparkles,
  Users,
  Volume2,
  Loader2,
} from "lucide-react";
import { apiFetch } from "../utils/api";
import { evictCachedResponse } from "../utils/apiCache";
import { logger } from "../utils/logger";

interface NotificationPrefs {
  likes: boolean;
  comments: boolean;
  follows: boolean;
  mentions: boolean;
  messages: boolean;
  reposts: boolean;
  saves: boolean;
  polls: boolean;
  glances: boolean;
  collabs: boolean;
}

const DEFAULT_PREFS: NotificationPrefs = {
  likes: true,
  comments: true,
  follows: true,
  mentions: true,
  messages: true,
  reposts: true,
  saves: true,
  polls: true,
  glances: true,
  collabs: true,
};

const CATEGORIES: {
  key: keyof NotificationPrefs;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  { key: "likes", label: "Likes", description: "Someone likes your post or comment", icon: Heart },
  { key: "comments", label: "Comments", description: "Someone comments or replies to your post", icon: MessageCircle },
  { key: "follows", label: "Follows", description: "Someone follows you or accepts your request", icon: UserPlus },
  { key: "mentions", label: "Mentions", description: "Someone mentions you in a post", icon: AtSign },
  { key: "messages", label: "Messages", description: "Direct and community chat messages, replies & reactions", icon: MessageSquare },
  { key: "reposts", label: "Reposts & Shares", description: "Reposts, shares and forwards of your content", icon: Repeat2 },
  { key: "saves", label: "Saves", description: "Someone saves your post", icon: Bookmark },
  { key: "polls", label: "Poll Votes", description: "Someone votes on your poll", icon: BarChart3 },
  { key: "glances", label: "Glances", description: "Replies and reactions to your glances", icon: Sparkles },
  { key: "collabs", label: "Collaborations", description: "Collaboration invites and requests", icon: Users },
];

export default function NotificationSettings() {
  const [loading, setLoading] = useState(true);
  const [pushEnabled, setPushEnabled] = useState(true);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [prefs, setPrefs] = useState<NotificationPrefs>(DEFAULT_PREFS);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Serializes toggle requests — one in-flight update at a time so rapid
  // taps can't race and persist an out-of-order state.
  const pendingRef = useRef(false);

  const fetchPrefs = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch("/api/notifications/preferences");
      const data = await res.json();
      if (res.ok && data.success && data.preferences) {
        const p = data.preferences;
        setPushEnabled(p.pushNotifications !== false);
        setSoundEnabled(p.soundEnabled !== false);
        setPrefs({
          likes: p.notificationPrefs?.likes !== false,
          comments: p.notificationPrefs?.comments !== false,
          follows: p.notificationPrefs?.follows !== false,
          mentions: p.notificationPrefs?.mentions !== false,
          messages: p.notificationPrefs?.messages !== false,
          reposts: p.notificationPrefs?.reposts !== false,
          saves: p.notificationPrefs?.saves !== false,
          polls: p.notificationPrefs?.polls !== false,
          glances: p.notificationPrefs?.glances !== false,
          collabs: p.notificationPrefs?.collabs !== false,
        });
      }
    } catch (err) {
      logger.error("Failed to fetch notification preferences", err);
      setError("Could not load notification settings");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPrefs();
  }, []);

  const persist = async (nextPush: boolean, nextPrefs: NotificationPrefs, key: string) => {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setSavingKey(key);
    try {
      const res = await apiFetch("/api/notifications/preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pushNotifications: nextPush,
          notificationPrefs: nextPrefs,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.message || "Could not update preferences");
      }
      // apiFetch is cache-first — evict so a remount/refetch shows fresh prefs.
      await evictCachedResponse("/api/notifications/preferences");
    } catch (err: any) {
      logger.error("Failed to update notification preferences", err);
      window.dispatchEvent(
        new CustomEvent("showToast", {
          detail: { message: err.message || "Failed to update preferences", type: "error" },
        }),
      );
      // Revert to server state on failure
      await fetchPrefs();
    } finally {
      pendingRef.current = false;
      setSavingKey(null);
    }
  };

  const togglePush = async () => {
    const next = !pushEnabled;
    setPushEnabled(next);
    await persist(next, prefs, "push");
  };

  const toggleSound = async () => {
    const next = !soundEnabled;
    setSoundEnabled(next);
    if (pendingRef.current) return;
    pendingRef.current = true;
    setSavingKey("sound");
    try {
      const res = await apiFetch("/api/notifications/preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ soundEnabled: next }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.message || "Could not update preferences");
      }
      // Let App.tsx's chime logic read the latest value from localStorage
      try {
        localStorage.setItem("orbit_notif_sound", next ? "on" : "off");
      } catch { /* storage may be unavailable */ }
      await evictCachedResponse("/api/notifications/preferences");
    } catch (err: any) {
      logger.error("Failed to update sound preference", err);
      setSoundEnabled(!next);
      window.dispatchEvent(
        new CustomEvent("showToast", {
          detail: { message: err.message || "Failed to update preferences", type: "error" },
        }),
      );
    } finally {
      pendingRef.current = false;
      setSavingKey(null);
    }
  };

  const toggleCategory = async (key: keyof NotificationPrefs) => {
    const next = { ...prefs, [key]: !prefs[key] };
    setPrefs(next);
    await persist(pushEnabled, next, key);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center rounded-2xl border border-zinc-800/60 bg-zinc-900/30 p-10">
        <Loader2 className="h-5 w-5 animate-spin text-zinc-500" />
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-zinc-800/60 bg-zinc-900/30">
      <div className="border-b border-zinc-800/60 p-5 sm:p-6 pb-4">
        <div className="flex items-center gap-2 mb-1">
          <Bell className="h-4 w-4 text-zinc-300" />
          <span className="text-sm font-bold text-white uppercase tracking-wider">
            Notifications
          </span>
        </div>
        <p className="text-[11px] text-zinc-500">
          Choose which activities trigger in-app and on-device notifications for you.
        </p>
      </div>

      {error && (
        <div className="flex items-center justify-between gap-3 border-b border-zinc-800/60 px-5 py-3">
          <p className="text-xs text-rose-400">{error}</p>
          <button
            onClick={fetchPrefs}
            className="rounded-full bg-zinc-800 px-3 py-1 text-[10px] font-bold text-zinc-300 hover:bg-zinc-700 transition-colors cursor-pointer"
          >
            Retry
          </button>
        </div>
      )}

      {/* Master push toggle */}
      <div className="flex items-center justify-between gap-3 px-5 py-3.5 sm:px-6">
        <div className="flex items-center gap-3 min-w-0">
          <div className="h-8 w-8 shrink-0 rounded-full bg-zinc-800/60 flex items-center justify-center">
            <Bell className="h-4 w-4 text-zinc-300" />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-semibold text-zinc-100">Push Notifications</p>
            <p className="text-[10px] text-zinc-500">Master switch for on-device alerts</p>
          </div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={pushEnabled}
          aria-label="Push notifications"
          disabled={savingKey !== null}
          onClick={togglePush}
          className={`relative h-6 w-11 shrink-0 cursor-pointer rounded-full transition-colors duration-200 disabled:opacity-50 ${pushEnabled ? "bg-green-500" : "bg-zinc-700"}`}
        >
          <span className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform duration-200 ease-out ${pushEnabled ? "translate-x-5" : "translate-x-0"}`} />
        </button>
      </div>

      {/* In-app notification sound toggle */}
      <div className="flex items-center justify-between gap-3 px-5 py-3.5 sm:px-6">
        <div className="flex items-center gap-3 min-w-0">
          <div className="h-8 w-8 shrink-0 rounded-full bg-zinc-800/60 flex items-center justify-center">
            <Volume2 className={`h-4 w-4 ${soundEnabled ? "text-zinc-200" : "text-zinc-600"}`} />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-semibold text-zinc-100">Notification Sound</p>
            <p className="text-[10px] text-zinc-500 truncate">Play a chime for new notifications in-app</p>
          </div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={soundEnabled}
          aria-label="Notification sound"
          disabled={savingKey !== null}
          onClick={toggleSound}
          className={`relative h-6 w-11 shrink-0 cursor-pointer rounded-full transition-colors duration-200 disabled:opacity-50 ${soundEnabled ? "bg-green-500" : "bg-zinc-700"}`}
        >
          <span className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform duration-200 ease-out ${soundEnabled ? "translate-x-5" : "translate-x-0"}`} />
        </button>
      </div>

      {/* Per-category toggles */}
      <div className="border-t border-zinc-800/60">
        {CATEGORIES.map((cat, i) => {
          const enabled = prefs[cat.key];
          const CatIcon = cat.icon;
          return (
            <div
              key={cat.key}
              className={`flex items-center justify-between gap-3 px-5 py-3.5 sm:px-6 transition-colors hover:bg-zinc-900/50 ${i > 0 ? "border-t border-zinc-800/30" : ""}`}
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="h-8 w-8 shrink-0 rounded-full bg-zinc-800/60 flex items-center justify-center">
                  <CatIcon className={`h-4 w-4 ${enabled ? "text-zinc-200" : "text-zinc-600"}`} />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-zinc-100">{cat.label}</p>
                  <p className="text-[10px] text-zinc-500 truncate">{cat.description}</p>
                </div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={enabled}
                aria-label={cat.label}
                disabled={savingKey !== null}
                onClick={() => toggleCategory(cat.key)}
                className={`relative h-6 w-11 shrink-0 cursor-pointer rounded-full transition-colors duration-200 disabled:opacity-50 ${enabled ? "bg-green-500" : "bg-zinc-700"}`}
              >
                <span className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform duration-200 ease-out ${enabled ? "translate-x-5" : "translate-x-0"}`} />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
