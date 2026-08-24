import { useState, useRef } from "react";
import { Shield, Globe, Lock, Loader2 } from "lucide-react";
import { apiFetch } from "../utils/api";
import { logger } from "../utils/logger";
import type { User } from "../types";

interface PrivacySettingsProps {
  user: User;
}

export default function PrivacySettings({ user }: PrivacySettingsProps) {
  const [isPrivate, setIsPrivate] = useState(!!user.isPrivate);
  const [saving, setSaving] = useState(false);
  const pendingRef = useRef(false);

  const togglePrivate = async () => {
    if (pendingRef.current) return;
    const next = !isPrivate;
    // Optimistic flip — revert on failure.
    setIsPrivate(next);
    pendingRef.current = true;
    setSaving(true);
    try {
      const res = await apiFetch("/api/users/update-profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isPrivate: next }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.message || "Could not update privacy settings");
      }
      window.dispatchEvent(
        new CustomEvent("showToast", {
          detail: {
            message: next
              ? "Account is now private — new followers must be approved"
              : "Account is now public — anyone can follow you",
            type: "success",
          },
        }),
      );
    } catch (err: any) {
      logger.error("Failed to update privacy settings", err);
      setIsPrivate(!next);
      window.dispatchEvent(
        new CustomEvent("showToast", {
          detail: {
            message: err.message || "Failed to update privacy settings",
            type: "error",
          },
        }),
      );
    } finally {
      pendingRef.current = false;
      setSaving(false);
    }
  };

  return (
    <div className="overflow-hidden rounded-2xl border border-zinc-800/60 bg-zinc-900/30">
      <div className="border-b border-zinc-800/60 p-5 sm:p-6 pb-4">
        <div className="flex items-center gap-2 mb-1">
          <Shield className="h-4 w-4 text-zinc-300" />
          <span className="text-sm font-bold text-white uppercase tracking-wider">
            Privacy
          </span>
        </div>
        <p className="text-[11px] text-zinc-500">
          Control who can follow you and see your content.
        </p>
      </div>

      {/* Private account toggle */}
      <div className="flex items-center justify-between gap-3 px-5 py-4 sm:px-6">
        <div className="flex items-center gap-3 min-w-0">
          <div
            className={`h-8 w-8 shrink-0 rounded-full flex items-center justify-center ${
              isPrivate ? "bg-emerald-500/10" : "bg-zinc-800/60"
            }`}
          >
            {isPrivate ? (
              <Lock className="h-4 w-4 text-emerald-400" />
            ) : (
              <Globe className="h-4 w-4 text-zinc-300" />
            )}
          </div>
          <div className="min-w-0">
            <p className="text-xs font-semibold text-zinc-100">Private Account</p>
            <p className="text-[10px] text-zinc-500 leading-snug">
              {isPrivate
                ? "New followers must send a request that you approve"
                : "Anyone can follow you without approval"}
            </p>
          </div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={isPrivate}
          aria-label="Private account"
          disabled={saving}
          onClick={togglePrivate}
          className={`relative h-6 w-11 shrink-0 cursor-pointer rounded-full transition-colors duration-200 disabled:opacity-50 ${isPrivate ? "bg-green-500" : "bg-zinc-700"}`}
        >
          <span
            className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform duration-200 ease-out ${isPrivate ? "translate-x-5" : "translate-x-0"}`}
          />
        </button>
      </div>

      {saving && (
        <div className="flex items-center gap-2 border-t border-zinc-800/30 px-5 py-2.5 text-[10px] text-zinc-500">
          <Loader2 className="h-3 w-3 animate-spin" /> Saving…
        </div>
      )}

      <div className="border-t border-zinc-800/60 px-5 py-4 sm:px-6">
        <p className="text-[10px] text-zinc-600 leading-relaxed">
          When your account is private, people who want to follow you will be
          asked to send a follow request. You can approve or decline requests
          from your profile. Existing followers are not affected.
        </p>
      </div>
    </div>
  );
}
