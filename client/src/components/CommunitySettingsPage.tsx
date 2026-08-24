import React, { useState, useRef, useEffect, useCallback } from "react";
import { ArrowLeft, Hash, Loader2, Camera, Settings, Trash2, MessageSquare, Phone, Video, Bell, BellOff, X, Globe, Lock, Link2, Copy, Sparkles } from "lucide-react";
import ImageCropModal from "./ImageCropModal";
import { apiFetch } from "../utils/api";
import { logger } from "../utils/logger";
import { optimizeImageUrl } from "../utils/imageUrls";
import { downscaleImageFile } from "../utils/imageCompression";
import { useAutoGrow } from "../hooks/useAutoGrow";
import type { Community } from "../types";
import ConfirmDialog from "./ConfirmDialog";

interface CommunitySettingsPageProps {
  community: Community;
  // "creator" | "admin" | "moderator" | "member" — drives which settings,
  // moderation tools and member-management actions this user may use.
  userRole: string;
  onClose: () => void;
  onUpdated: (updated: Community) => void;
  onDeleted: (communityId: string) => void;
}

export default function CommunitySettingsPage({
  community,
  userRole,
  onClose,
  onUpdated,
  onDeleted,
}: CommunitySettingsPageProps) {
  // creator + admins can manage the community; moderators get moderation
  // tools (join requests, kick, delete messages) without full control.
  const isAdmin = userRole === "creator" || userRole === "admin";
  const isModerator = isAdmin || userRole === "moderator";
  const [name, setName] = useState(community.name);
  const [description, setDescription] = useState(community.description || "");
  const descriptionRef = useAutoGrow<HTMLTextAreaElement>(description);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [removeCurrentImage, setRemoveCurrentImage] = useState(false);
  const [cropModalOpen, setCropModalOpen] = useState(false);
  const [cropSrc, setCropSrc] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);
  const [clearing, setClearing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Guards the optimistic admin toggles against double-clicks / out-of-order
  // responses — one in-flight request per setting at a time.
  const pendingToggleRef = useRef<string | null>(null);

  // User notification settings — persisted server-side so the mute applies
  // to in-app + push notifications on every device. localStorage is only a
  // fast optimistic mirror; the server value is fetched on mount.
  const [muted, setMuted] = useState(() => {
    try {
      return localStorage.getItem(`orbit_community_muted_${community._id}`) === "true";
    } catch { return false; }
  });
  const [muting, setMuting] = useState(false);
  // Set once the user toggles locally — the mount-time GET /muted reconcile
  // must not overwrite a fast optimistic flip with the older server value.
  const mutedToggledRef = useRef(false);

  // Admin control local states
  const [localMessagingEnabled, setLocalMessagingEnabled] = useState(community.messagingEnabled !== false);
  const [localAudioCallsEnabled, setLocalAudioCallsEnabled] = useState(!!community.audioCallEnabled);
  const [localVideoCallsEnabled, setLocalVideoCallsEnabled] = useState(!!community.videoCallEnabled);
  // Welcome message shown to newly-joined members.
  const [welcomeMessage, setWelcomeMessage] = useState(
    community.welcomeMessage || "",
  );
  const [welcomeSaved, setWelcomeSaved] = useState(false);
  // Privacy — creator-only switch between public (anyone joins) and private
  // (invite link / approved join request).
  const [privacy, setPrivacy] = useState<"public" | "private">(
    community.privacy === "private" ? "private" : "public",
  );
  // Invite link (admins) — the code anyone can use to join the community.
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [inviteLoading, setInviteLoading] = useState(false);

  // Reset form when community changes
  useEffect(() => {
    setName(community.name);
    setDescription(community.description || "");
    setImageFile(null);
    setImagePreview(null);
    setRemoveCurrentImage(false);
    setError(null);
    setConfirmDeleteOpen(false);
    setDeleting(false);
    setLocalMessagingEnabled(community.messagingEnabled !== false);
    setLocalAudioCallsEnabled(!!community.audioCallEnabled);
    setLocalVideoCallsEnabled(!!community.videoCallEnabled);
    setWelcomeMessage(community.welcomeMessage || "");
    setPrivacy(community.privacy === "private" ? "private" : "public");
  }, [community._id, community.name, community.description, community.messagingEnabled, community.audioCallEnabled, community.videoCallEnabled, community.welcomeMessage]);

  // Load the community's invite code once (admins only) so the share section
  // can show a copyable link. Regenerating replaces the code server-side.
  useEffect(() => {
    if (!isAdmin) return;
    let alive = true;
    apiFetch(`/api/communities/${community._id}/invite`)
      .then((r) => r.json())
      .then((d) => {
        if (alive && d.success) setInviteCode(d.code || null);
      })
      .catch(() => {/* keep null — the Generate button creates one */});
    return () => {
      alive = false;
    };
  }, [community._id, isAdmin]);

  // Sync the real mute state from the server (survives device changes / cache)
  useEffect(() => {
    let alive = true;
    mutedToggledRef.current = false;
    apiFetch(`/api/communities/${community._id}/muted`)
      .then((r) => r.json())
      .then((d) => {
        if (!alive || !d.success) return;
        // If the user already toggled locally, the server response is stale
        // relative to their intent — don't stomp their optimistic flip.
        if (mutedToggledRef.current) return;
        setMuted(!!d.muted);
        try {
          localStorage.setItem(`orbit_community_muted_${community._id}`, d.muted ? "true" : "false");
        } catch {}
      })
      .catch(() => {/* keep the localStorage mirror on failure */});
    return () => {
      alive = false;
    };
  }, [community._id]);

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Only image files are allowed!");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError("Image size must be under 5MB!");
      return;
    }
    if (imagePreview) URL.revokeObjectURL(imagePreview);
    setCropSrc(URL.createObjectURL(file));
    setCropModalOpen(true);
    setRemoveCurrentImage(false);
    setError(null);
  };

  const handleCropComplete = useCallback((croppedBlob: Blob) => {
    const croppedFile = new File([croppedBlob], "community_avatar.jpg", { type: "image/jpeg" });
    setImageFile(croppedFile);
    setImagePreview(URL.createObjectURL(croppedBlob));
    setRemoveCurrentImage(false);
  }, []);

  const removeImage = () => {
    if (imagePreview) URL.revokeObjectURL(imagePreview);
    setImageFile(null);
    setImagePreview(null);
    setRemoveCurrentImage(true);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError("Community name is required!");
      return;
    }
    if (name.trim().length > 50) {
      setError("Community name cannot exceed 50 characters!");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append("name", name.trim());
      formData.append("description", description.trim());
      if (imageFile) {
        formData.append("image", await downscaleImageFile(imageFile, 800));
      }
      if (removeCurrentImage && !imageFile) {
        formData.append("removeImage", "true");
      }

      const res = await apiFetch(`/api/communities/${community._id}`, {
        method: "PUT",
        body: formData,
      });
      const data = await res.json();
      if (res.ok && data.success) {
        onUpdated(data.community);
        window.dispatchEvent(
          new CustomEvent("showToast", {
            detail: { message: "Community updated!", type: "success" },
          }),
        );
      } else {
        setError(data.message || "Failed to update community");
      }
    } catch (err: any) {
      logger.error("Failed to update community", err);
      setError("Failed to update community. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteCommunity = async () => {
    setDeleting(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/communities/${community._id}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setConfirmDeleteOpen(false);
        onDeleted(community._id);
        onClose();
      } else {
        setError(data.message || "Failed to delete community");
        setDeleting(false);
        setConfirmDeleteOpen(false);
      }
    } catch (err: any) {
      logger.error("Failed to delete community", err);
      setError("Failed to delete community. Please try again.");
      setDeleting(false);
      setConfirmDeleteOpen(false);
    }
  };

  const handleClearChat = async () => {
    if (!community || clearing) return;
    setClearing(true);
    try {
      const res = await apiFetch(`/api/communities/${community._id}/clear-chat`, {
        method: "POST",
      });
      const data = await res.json();
      if (res.ok && data.success) {
        // Chat cleared — the UI updates immediately, no toast needed
      }
    } catch {
      window.dispatchEvent(
        new CustomEvent("showToast", {
          detail: { message: "Failed to clear chat", type: "error" },
        })
      );
    } finally {
      setClearing(false);
      setConfirmClearOpen(false);
    }
  };

  const handleToggleMute = async () => {
    if (muting) return;
    const next = !muted;
    // Optimistic flip — instant, then reconciled with the server.
    setMuted(next);
    mutedToggledRef.current = true;
    setMuting(true);
    try {
      const res = await apiFetch(
        `/api/communities/${community._id}/${next ? "mute" : "unmute"}`,
        { method: "POST" }
      );
      const data = await res.json();
      if (res.ok && data.success) {
        try {
          localStorage.setItem(`orbit_community_muted_${community._id}`, next ? "true" : "false");
        } catch {}
        window.dispatchEvent(
          new CustomEvent("showToast", {
            detail: { message: next ? "Community notifications muted" : "Community notifications unmuted", type: "success" },
          })
        );
      } else {
        setMuted(!next);
        window.dispatchEvent(
          new CustomEvent("showToast", {
            detail: { message: data?.message || "Couldn't update mute setting.", type: "error" },
          })
        );
      }
    } catch (err: any) {
      logger.error("Failed to toggle community mute", err);
      setMuted(!next);
      window.dispatchEvent(
        new CustomEvent("showToast", {
          detail: { message: "Couldn't update mute setting. Try again.", type: "error" },
        })
      );
    } finally {
      setMuting(false);
    }
  };

  // Toggle the community between public and private (creator-only — the
  // server enforces this). Optimistic flip + reconcile + toast.
  const handleTogglePrivacy = async () => {
    if (pendingToggleRef.current === "privacy") return;
    pendingToggleRef.current = "privacy";
    const next = privacy === "public" ? "private" : "public";
    setPrivacy(next);
    try {
      const res = await apiFetch(`/api/communities/${community._id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ privacy: next }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        onUpdated(data.community);
        window.dispatchEvent(
          new CustomEvent("showToast", {
            detail: {
              message:
                next === "private"
                  ? "Community is now private"
                  : "Community is now public",
              type: "success",
            },
          }),
        );
      } else {
        setPrivacy(privacy);
        window.dispatchEvent(
          new CustomEvent("showToast", {
            detail: { message: data?.message || "Couldn't change privacy.", type: "error" },
          }),
        );
      }
    } catch (err: any) {
      logger.error("Failed to toggle privacy", err);
      setPrivacy(privacy);
      window.dispatchEvent(
        new CustomEvent("showToast", {
          detail: { message: "Couldn't change privacy. Try again.", type: "error" },
        }),
      );
    } finally {
      pendingToggleRef.current = null;
    }
  };

  // Save the community's welcome message (shown to new members).
  const handleSaveWelcomeMessage = async () => {
    try {
      const res = await apiFetch(`/api/communities/${community._id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ welcomeMessage }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setWelcomeSaved(true);
        setTimeout(() => setWelcomeSaved(false), 2000);
        onUpdated({ ...community, welcomeMessage } as Community);
      } else {
        window.dispatchEvent(
          new CustomEvent("showToast", {
            detail: { message: data?.message || "Couldn't save welcome message.", type: "error" },
          }),
        );
      }
    } catch (err: any) {
      logger.error("Failed to save welcome message", err);
      window.dispatchEvent(
        new CustomEvent("showToast", {
          detail: { message: "Couldn't save welcome message.", type: "error" },
        }),
      );
    }
  };

  // Generate (or regenerate) the community's invite code.
  const handleGenerateInvite = async () => {
    if (inviteLoading) return;
    setInviteLoading(true);
    try {
      const res = await apiFetch(`/api/communities/${community._id}/invite`, {
        method: "POST",
      });
      const data = await res.json();
      if (res.ok && data.success && data.code) {
        setInviteCode(data.code);
        window.dispatchEvent(
          new CustomEvent("showToast", {
            detail: { message: "Invite link generated!", type: "success" },
          }),
        );
      } else {
        window.dispatchEvent(
          new CustomEvent("showToast", {
            detail: { message: data?.message || "Couldn't generate invite link.", type: "error" },
          }),
        );
      }
    } catch (err: any) {
      logger.error("Failed to generate invite", err);
      window.dispatchEvent(
        new CustomEvent("showToast", {
          detail: { message: "Couldn't generate invite link.", type: "error" },
        }),
      );
    } finally {
      setInviteLoading(false);
    }
  };

  // Copy the shareable invite link (deep link that auto-joins the code).
  const handleCopyInvite = async () => {
    if (!inviteCode) return;
    const link = `${window.location.origin}/communities?invite=${inviteCode}`;
    try {
      await navigator.clipboard.writeText(link);
    } catch {
      // Fallback for older/in-app browsers without the async clipboard API
      const ta = document.createElement("textarea");
      ta.value = link;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    window.dispatchEvent(
      new CustomEvent("showToast", {
        detail: { message: "Invite link copied!", type: "success" },
      }),
    );
  };

  const currentImageUrl = removeCurrentImage
    ? null
    : imagePreview || community.image?.url || null;

  return (
    <div className="h-full w-full flex flex-col bg-black/70 backdrop-blur-md">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-zinc-800/50 shrink-0">
        <button
          onClick={onClose}
          className="h-8 w-8 rounded-full flex items-center justify-center hover:bg-zinc-800 transition-colors cursor-pointer"
        >
          <ArrowLeft className="h-4 w-4 text-zinc-400" />
        </button>
        <Settings className="h-4 w-4 text-zinc-400" />
        <h2 className="text-label text-lg font-semibold text-white">Settings</h2>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-5 sm:px-6 max-w-2xl mx-auto w-full">
        {/* Community info card */}
        <div className="flex items-center gap-4 mb-6 p-4 rounded-2xl border border-white/10 bg-zinc-950/95 backdrop-blur-none sm:bg-zinc-950/35 sm:backdrop-blur-xl sm:backdrop-saturate-150 shadow-[0_15px_40px_-15px_rgba(0,0,0,0.7)]">
          <div className="h-14 w-14 rounded-2xl bg-zinc-800 flex items-center justify-center border border-zinc-700/50 overflow-hidden shrink-0">
            {currentImageUrl ? (
              <img src={currentImageUrl} alt={community.name} className="h-full w-full object-cover" loading="lazy" />
            ) : community.image?.url ? (
              <img src={optimizeImageUrl(community.image.url, 96)} alt={community.name} className="h-full w-full object-cover" loading="lazy" />
            ) : (
              <Hash className="h-6 w-6 text-zinc-500" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-base font-bold text-white truncate">{name}</h3>
            <div className="flex items-center gap-2">
              <p className="text-[11px] text-zinc-500">{community.memberCount} member{community.memberCount !== 1 ? "s" : ""}</p>
              {/* Your role in this community */}
              <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider ${
                userRole === "creator"
                  ? "bg-amber-500/15 text-amber-400"
                  : userRole === "admin"
                    ? "bg-sky-500/15 text-sky-400"
                    : isModerator
                      ? "bg-violet-500/15 text-violet-400"
                      : "bg-zinc-800 text-zinc-400"
              }`}>
                {userRole === "creator"
                  ? "Creator"
                  : userRole === "admin"
                    ? "Admin"
                    : isModerator
                      ? "Moderator"
                      : "Member"}
              </span>
            </div>
          </div>
        </div>

        {/* User Settings Section */}
        <div className="mb-6">
          <h4 className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider mb-3">Notifications</h4>
          <div className="space-y-1">
            <button
              onClick={handleToggleMute}
              disabled={muting}
              className="w-full flex items-center justify-between px-4 py-3 rounded-xl hover:bg-zinc-900/80 transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"
            >
              <div className="flex items-center gap-3">
                {muted ? (
                  <BellOff className="h-4 w-4 text-zinc-400" />
                ) : (
                  <Bell className="h-4 w-4 text-zinc-400" />
                )}
                <div className="text-left">
                  <p className="text-xs font-semibold text-zinc-200">Mute Notifications</p>
                  <p className="text-[10px] text-zinc-500">
                    {muted ? "Notifications are muted" : "Receive notifications for this community"}
                  </p>
                </div>
              </div>
              <div className={`relative h-6 w-11 rounded-full transition-colors duration-200 ${muted ? "bg-green-500" : "bg-zinc-700"}`}>
                {/* Knob animates on transform (GPU-friendly), matching the admin toggles */}
                <span className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform duration-200 ease-out ${muted ? "translate-x-5" : "translate-x-0"}`} />
              </div>
            </button>
          </div>
        </div>

        {/* Admin Controls Section (only for creator) */}
        {isAdmin && (
          <div className="mb-6">
            <h4 className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider mb-3">Admin Controls</h4>
            <div className="space-y-1 rounded-2xl border border-zinc-800/50 overflow-hidden">
              {/* Messaging toggle */}
              <div className="flex items-center justify-between px-4 py-3 hover:bg-zinc-900/60 transition-colors">
                <div className="flex items-center gap-3">
                  <MessageSquare className="h-4 w-4 text-zinc-400" />
                  <div>
                    <p className="text-xs font-semibold text-zinc-200">Messaging</p>
                    <p className="text-[10px] text-zinc-500">
                      {localMessagingEnabled ? "Members can send messages" : "Messaging is disabled"}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={async () => {
                    if (pendingToggleRef.current === "messaging") return;
                    pendingToggleRef.current = "messaging";
                    // Optimistic flip — the knob moves INSTANTLY, then the
                    // server response reconciles it (revert + toast on failure).
                    const nextMessaging = !localMessagingEnabled;
                    setLocalMessagingEnabled(nextMessaging);
                    try {
                      const res = await apiFetch(`/api/communities/${community._id}/toggle-messaging`, { method: "POST" });
                      const data = await res.json();
                      if (res.ok && data.success) {
                        setLocalMessagingEnabled(data.messagingEnabled);
                        onUpdated({ ...community, messagingEnabled: data.messagingEnabled } as Community);
                      } else {
                        setLocalMessagingEnabled(!nextMessaging);
                        window.dispatchEvent(
                          new CustomEvent("showToast", {
                            detail: { message: data?.message || "Couldn't update setting.", type: "error" },
                          }),
                        );
                      }
                    } catch (err: any) {
                      logger.error("Failed to toggle messaging", err);
                      setLocalMessagingEnabled(!nextMessaging);
                      window.dispatchEvent(
                        new CustomEvent("showToast", {
                          detail: { message: "Couldn't update setting. Try again.", type: "error" },
                        }),
                      );
                    } finally {
                      pendingToggleRef.current = null;
                    }
                  }}
                  className={`relative h-6 w-11 shrink-0 cursor-pointer rounded-full transition-colors duration-200 ${localMessagingEnabled ? "bg-green-500" : "bg-zinc-700"}`}
                  aria-pressed={localMessagingEnabled}
                >
                  {/* Knob animates on transform (GPU-friendly) instead of `left` */}
                  <span className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform duration-200 ease-out ${localMessagingEnabled ? "translate-x-5" : "translate-x-0"}`} />
                </button>
              </div>

              {/* Audio calls toggle */}
              <div className="flex items-center justify-between px-4 py-3 hover:bg-zinc-900/60 transition-colors border-t border-zinc-800/30">
                <div className="flex items-center gap-3">
                  <Phone className="h-4 w-4 text-zinc-400" />
                  <div>
                    <p className="text-xs font-semibold text-zinc-200">Audio Calls</p>
                    <p className="text-[10px] text-zinc-500">
                      {localAudioCallsEnabled ? "Members can start audio calls" : "Audio calls disabled"}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={async () => {
                    if (pendingToggleRef.current === "audio-calls") return;
                    pendingToggleRef.current = "audio-calls";
                    // Optimistic flip — instant, then reconciled with the server.
                    const nextAudio = !localAudioCallsEnabled;
                    setLocalAudioCallsEnabled(nextAudio);
                    try {
                      const res = await apiFetch(`/api/communities/${community._id}/toggle-audio-calls`, { method: "POST" });
                      const data = await res.json();
                      if (res.ok && data.success) {
                        setLocalAudioCallsEnabled(data.audioCallEnabled);
                        onUpdated({ ...community, audioCallEnabled: data.audioCallEnabled } as Community);
                      } else {
                        setLocalAudioCallsEnabled(!nextAudio);
                        window.dispatchEvent(
                          new CustomEvent("showToast", {
                            detail: { message: data?.message || "Couldn't update setting.", type: "error" },
                          }),
                        );
                      }
                    } catch (err: any) {
                      logger.error("Failed to toggle audio calls", err);
                      setLocalAudioCallsEnabled(!nextAudio);
                      window.dispatchEvent(
                        new CustomEvent("showToast", {
                          detail: { message: "Couldn't update setting. Try again.", type: "error" },
                        }),
                      );
                    } finally {
                      pendingToggleRef.current = null;
                    }
                  }}
                  className={`relative h-6 w-11 shrink-0 cursor-pointer rounded-full transition-colors duration-200 ${localAudioCallsEnabled ? "bg-green-500" : "bg-zinc-700"}`}
                  aria-pressed={localAudioCallsEnabled}
                >
                  {/* Knob animates on transform (GPU-friendly) instead of `left` */}
                  <span className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform duration-200 ease-out ${localAudioCallsEnabled ? "translate-x-5" : "translate-x-0"}`} />
                </button>
              </div>

              {/* Video calls toggle */}
              <div className="flex items-center justify-between px-4 py-3 hover:bg-zinc-900/60 transition-colors border-t border-zinc-800/30">
                <div className="flex items-center gap-3">
                  <Video className="h-4 w-4 text-zinc-400" />
                  <div>
                    <p className="text-xs font-semibold text-zinc-200">Video Calls</p>
                    <p className="text-[10px] text-zinc-500">
                      {localVideoCallsEnabled ? "Members can start video calls" : "Video calls disabled"}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={async () => {
                    if (pendingToggleRef.current === "video-calls") return;
                    pendingToggleRef.current = "video-calls";
                    // Optimistic flip — instant, then reconciled with the server.
                    const nextVideo = !localVideoCallsEnabled;
                    setLocalVideoCallsEnabled(nextVideo);
                    try {
                      const res = await apiFetch(`/api/communities/${community._id}/toggle-video-calls`, { method: "POST" });
                      const data = await res.json();
                      if (res.ok && data.success) {
                        setLocalVideoCallsEnabled(data.videoCallEnabled);
                        onUpdated({ ...community, videoCallEnabled: data.videoCallEnabled } as Community);
                      } else {
                        setLocalVideoCallsEnabled(!nextVideo);
                        window.dispatchEvent(
                          new CustomEvent("showToast", {
                            detail: { message: data?.message || "Couldn't update setting.", type: "error" },
                          }),
                        );
                      }
                    } catch (err: any) {
                      logger.error("Failed to toggle video calls", err);
                      setLocalVideoCallsEnabled(!nextVideo);
                      window.dispatchEvent(
                        new CustomEvent("showToast", {
                          detail: { message: "Couldn't update setting. Try again.", type: "error" },
                        }),
                      );
                    } finally {
                      pendingToggleRef.current = null;
                    }
                  }}
                  className={`relative h-6 w-11 shrink-0 cursor-pointer rounded-full transition-colors duration-200 ${localVideoCallsEnabled ? "bg-green-500" : "bg-zinc-700"}`}
                  aria-pressed={localVideoCallsEnabled}
                >
                  {/* Knob animates on transform (GPU-friendly) instead of `left` */}
                  <span className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform duration-200 ease-out ${localVideoCallsEnabled ? "translate-x-5" : "translate-x-0"}`} />
                </button>
              </div>

              {/* Welcome message — shown to newly-joined members */}
              <div className="border-t border-zinc-800/30 px-4 py-3">
                <div className="flex items-center gap-3 mb-2">
                  <Sparkles className="h-4 w-4 text-zinc-400" />
                  <div>
                    <p className="text-xs font-semibold text-zinc-200">
                      Welcome Message
                    </p>
                    <p className="text-[10px] text-zinc-500">
                      Shown to new members as a card when they open the chat
                    </p>
                  </div>
                </div>
                <textarea
                  value={welcomeMessage}
                  onChange={(e) => setWelcomeMessage(e.target.value)}
                  placeholder="Welcome to the community! Please read the rules…"
                  maxLength={500}
                  rows={3}
                  className="w-full rounded-xl border border-zinc-800 bg-zinc-950/40 px-3 py-2.5 text-xs text-white placeholder-zinc-600 outline-none focus:border-white/40 focus:bg-zinc-900 transition-all resize-none"
                />
                <div className="flex items-center justify-end gap-2 mt-2">
                  {welcomeSaved && (
                    <span className="text-[10px] font-bold text-green-400">
                      Saved ✓
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={handleSaveWelcomeMessage}
                    className="rounded-full bg-aurora text-white border border-white/10 px-4 py-1.5 text-[10px] font-bold shadow-aurora hover:opacity-90 transition-all cursor-pointer"
                  >
                    Save welcome message
                  </button>
                </div>
              </div>

              {/* Privacy toggle (creator-only — the server enforces this) */}
              {userRole === "creator" && (
                <div className="flex items-center justify-between px-4 py-3 hover:bg-zinc-900/60 transition-colors border-t border-zinc-800/30">
                  <div className="flex items-center gap-3">
                    {privacy === "public" ? (
                      <Globe className="h-4 w-4 text-zinc-400" />
                    ) : (
                      <Lock className="h-4 w-4 text-zinc-400" />
                    )}
                    <div>
                      <p className="text-xs font-semibold text-zinc-200">Privacy</p>
                      <p className="text-[10px] text-zinc-500">
                        {privacy === "public"
                          ? "Public — anyone can join instantly"
                          : "Private — join via invite link or approval"}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={handleTogglePrivacy}
                    disabled={pendingToggleRef.current === "privacy"}
                    className={`relative h-6 w-11 shrink-0 cursor-pointer rounded-full transition-colors duration-200 ${privacy === "public" ? "bg-green-500" : "bg-zinc-700"}`}
                    aria-pressed={privacy === "public"}
                  >
                    <span className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform duration-200 ease-out ${privacy === "public" ? "translate-x-5" : "translate-x-0"}`} />
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Invite Link Section (admins) */}
        {isAdmin && (
          <div className="mb-6">
            <h4 className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider mb-3">Invite Link</h4>
            <div className="rounded-2xl border border-zinc-800/50 p-4 space-y-3">
              <p className="text-[10px] text-zinc-500 leading-relaxed">
                Share this link — anyone who opens it can join this community
                {privacy === "private" ? " (private communities need the invite to join)" : ""}.
              </p>
              {inviteCode ? (
                <div className="flex items-center gap-2">
                  <div className="flex-1 min-w-0 flex items-center gap-2 rounded-lg border border-zinc-800/60 bg-zinc-900/80 px-3 py-2.5">
                    <Link2 className="h-3.5 w-3.5 text-zinc-500 shrink-0" />
                    <span className="text-[11px] text-zinc-300 truncate select-all">
                      {window.location.origin}/communities?invite={inviteCode}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={handleCopyInvite}
                    className="flex items-center gap-1.5 shrink-0 rounded-lg bg-white hover:bg-zinc-200 px-3 py-2.5 text-[10px] font-bold text-black transition-all cursor-pointer"
                  >
                    <Copy className="h-3 w-3" /> Copy
                  </button>
                </div>
              ) : (
                <p className="text-[11px] text-zinc-500">No invite link yet.</p>
              )}
              <button
                type="button"
                onClick={handleGenerateInvite}
                disabled={inviteLoading}
                className="flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900/60 hover:bg-zinc-800 px-3 py-2 text-[10px] font-bold text-zinc-200 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {inviteLoading ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Link2 className="h-3 w-3" />
                )}
                {inviteCode ? "Regenerate link" : "Generate invite link"}
              </button>
            </div>
          </div>
        )}

        {/* Edit Community Info Section */}
        <div className="mb-6">
          <h4 className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider mb-3">Community Info</h4>
          <div className="rounded-2xl border border-zinc-800/50 p-4 space-y-4">
            {/* Avatar */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="h-12 w-12 rounded-xl bg-zinc-800 flex items-center justify-center border border-zinc-700/50 overflow-hidden shrink-0">
                  {currentImageUrl ? (
                    <img src={currentImageUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
                  ) : (
                    <Hash className="h-5 w-5 text-zinc-500" />
                  )}
                </div>
                <div>
                  <p className="text-xs font-semibold text-zinc-200">Community Avatar</p>
                  <p className="text-[10px] text-zinc-500">Tap to change</p>
                </div>
              </div>
              <div className="flex gap-1.5">
                {currentImageUrl && (
                  <button
                    type="button"
                    onClick={removeImage}
                    className="h-8 w-8 rounded-full bg-zinc-800 hover:bg-zinc-700 flex items-center justify-center transition-colors cursor-pointer"
                    title="Remove image"
                  >
                    <X className="h-3.5 w-3.5 text-zinc-400" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="h-8 w-8 rounded-full bg-zinc-800 hover:bg-zinc-700 flex items-center justify-center transition-colors cursor-pointer"
                  title="Upload image"
                >
                  <Camera className="h-3.5 w-3.5 text-zinc-400" />
                </button>
              </div>
              <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleImageSelect} />
            </div>

            {/* Name */}
            <div>
              <label className="block text-[11px] font-bold text-zinc-400 uppercase tracking-wider mb-1.5">Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Community name"
                maxLength={50}
                className="w-full bg-zinc-900/80 border border-zinc-800/60 rounded-lg px-3.5 py-2.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-white/20 focus:border-white/40 transition-all"
              />
              <p className="text-[10px] text-zinc-600 mt-1 text-right">{name.length}/50</p>
            </div>

            {/* Description */}
            <div>
              <label className="block text-[11px] font-bold text-zinc-400 uppercase tracking-wider mb-1.5">Description</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                ref={descriptionRef} placeholder="What's this community about?"
                maxLength={500}
                rows={3}
                className="w-full bg-zinc-900/80 border border-zinc-800/60 !rounded-lg px-3.5 py-2.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-white/20 focus:border-white/40 transition-all resize-none"
              />
              <p className="text-[10px] text-zinc-600 mt-1 text-right">{description.length}/500</p>
            </div>

            {error && (
              <p className="text-[11px] font-semibold text-red-400 bg-red-500/10 rounded-lg px-3 py-2 border border-red-500/20">{error}</p>
            )}

            <button
              type="button"
              onClick={handleSubmit}
              disabled={loading || !name.trim()}
              className="w-full rounded-xl bg-white hover:bg-zinc-200 disabled:bg-zinc-800 disabled:text-zinc-600 py-2.5 text-xs font-bold text-black transition-all cursor-pointer disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {loading ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving...</> : "Save Changes"}
            </button>
          </div>
        </div>

        {/* Danger Zone (admin only) */}
        {isAdmin && (
          <div className="mb-6">
            <h4 className="text-[10px] font-bold text-red-400 uppercase tracking-wider mb-3">Danger Zone</h4>
            <div className="space-y-2">
              <button
                type="button"
                onClick={() => setConfirmClearOpen(true)}
                disabled={clearing}
                className="w-full flex items-center justify-between px-4 py-3 rounded-xl border border-red-500/20 bg-red-500/5 hover:bg-red-500/10 transition-colors cursor-pointer"
              >
                <div className="flex items-center gap-3">
                  <Trash2 className="h-4 w-4 text-red-400" />
                  <div className="text-left">
                    <p className="text-xs font-semibold text-zinc-200">Clear All Messages</p>
                    <p className="text-[10px] text-zinc-500">Remove all messages in this community</p>
                  </div>
                </div>
                {clearing ? <Loader2 className="h-4 w-4 text-red-400 animate-spin" /> : null}
              </button>

              <button
                type="button"
                onClick={() => setConfirmDeleteOpen(true)}
                className="w-full flex items-center justify-between px-4 py-3 rounded-xl border border-red-500/30 bg-red-500/10 hover:bg-red-500/20 transition-colors cursor-pointer"
              >
                <div className="flex items-center gap-3">
                  <Trash2 className="h-4 w-4 text-red-400" />
                  <div className="text-left">
                    <p className="text-xs font-semibold text-zinc-200">Delete Community</p>
                    <p className="text-[10px] text-zinc-500">Permanently delete this community and all messages</p>
                  </div>
                </div>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Confirm dialogs */}
      <ConfirmDialog
        isOpen={confirmDeleteOpen}
        title="Delete community?"
        message={`This will permanently delete "${community.name}" and all its messages. This action cannot be undone.`}
        confirmLabel={deleting ? "Deleting..." : "Delete forever"}
        cancelLabel="Cancel"
        variant="danger"
        onConfirm={handleDeleteCommunity}
        onCancel={() => { if (!deleting) { setConfirmDeleteOpen(false); setError(null); } }}
      />

      <ConfirmDialog
        isOpen={confirmClearOpen}
        title="Clear all messages?"
        message="This will remove all messages in this community for everyone. This cannot be undone."
        confirmLabel={clearing ? "Clearing..." : "Clear all"}
        cancelLabel="Cancel"
        variant="danger"
        onConfirm={handleClearChat}
        onCancel={() => { if (!clearing) setConfirmClearOpen(false); }}
      />

      <ImageCropModal
        isOpen={cropModalOpen}
        onClose={() => { setCropModalOpen(false); if (cropSrc) URL.revokeObjectURL(cropSrc); }}
        imageSrc={cropSrc}
        title="Community Avatar Crop"
        onCropComplete={handleCropComplete}
      />
    </div>
  );
}
