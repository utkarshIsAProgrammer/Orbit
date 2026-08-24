import React, { useState, useEffect } from "react";
import {
  ArrowLeft,
  Users,
  Settings,
  Image,
  Video,
  Music,
  FileText,
  Hash,
  Loader2,
  Play,
  Languages,
  MoreVertical,
  Link2,
  ShieldPlus,
  ShieldMinus,
  ShieldCheck,
  UserMinus,
  Ban,
  Star,
} from "lucide-react";
import LinkPreviewCard from "./LinkPreviewCard";
import TranslateInline from "./TranslateInline";
import { extractFirstUrl } from "../utils/links";
import { renderLinkifiedText } from "../utils/linkify";
import type { Community, CommunityMessage } from "../types";
import { apiFetch } from "../utils/api";
import { optimizeImageUrl, videoPosterUrl } from "../utils/imageUrls";

interface CommunityProfileOverlayProps {
  community: Community;
  isAdmin: boolean;
  isModerator?: boolean;
  userRole?: string;
  onClose: () => void;
  onOpenSettings: () => void;
  onUserSelected?: (username: string) => void;
}

type MediaTab = "members" | "photos" | "videos" | "audio" | "docs" | "starred";

export default function CommunityProfileOverlay({
  community,
  isAdmin,
  isModerator,
  userRole,
  onClose,
  onOpenSettings,
  onUserSelected,
}: CommunityProfileOverlayProps) {
  const [activeTab, setActiveTab] = useState<MediaTab>("members");
  const [memberList, setMemberList] = useState<
    {
      user: {
        _id: string;
        username: string;
        fullName: string;
        profilePic?: { url: string; public_id?: string };
      };
      joinedAt: string;
      role: string;
    }[]
  >([]);
  const [loadingMembers, setLoadingMembers] = useState(false);
  // Per-member manage popover (promote/demote/kick) — managers only.
  const [manageMenu, setManageMenu] = useState<{
    x: number;
    y: number;
    memberId: string;
  } | null>(null);
  const [roleBusy, setRoleBusy] = useState<string | null>(null);
  // Quick invite — fetches the shareable code on demand and copies it.
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);

  // Role rank — mirrors the server's hierarchy for deciding which manage
  // actions to show (the server still hard-enforces everything).
  const ROLE_RANK: Record<string, number> = {
    member: 0,
    moderator: 1,
    admin: 2,
    creator: 3,
  };
  const myRank = ROLE_RANK[userRole || "member"] ?? 0;

  const loadInvite = async () => {
    if (inviteLoading) return;
    setInviteLoading(true);
    try {
      const res = await apiFetch(
        `/api/communities/${community._id}/invite`,
      );
      const data = await res.json();
      if (data.success) setInviteCode(data.code || null);
    } catch {
      /* non-critical */
    } finally {
      setInviteLoading(false);
    }
  };

  const handleCopyInvite = async () => {
    if (!inviteCode) return;
    const link = `${window.location.origin}/communities?invite=${inviteCode}`;
    try {
      await navigator.clipboard.writeText(link);
      window.dispatchEvent(
        new CustomEvent("showToast", {
          detail: { message: "Invite link copied!", type: "success" },
        }),
      );
    } catch {
      window.dispatchEvent(
        new CustomEvent("showToast", {
          detail: {
            message: "Couldn't copy invite link.",
            type: "error",
          },
        }),
      );
    }
  };

  const handleRoleChange = async (memberId: string, role: string) => {
    if (roleBusy) return;
    setRoleBusy(memberId);
    setManageMenu(null);
    try {
      const res = await apiFetch(
        `/api/communities/${community._id}/members/${memberId}/role`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ role }),
        },
      );
      const data = await res.json();
      if (res.ok && data.success) {
        setMemberList((prev) =>
          prev.map((m) =>
            m.user._id === memberId ? { ...m, role: data.role || role } : m,
          ),
        );
        window.dispatchEvent(
          new CustomEvent("showToast", {
            detail: { message: data.message || "Role updated!", type: "success" },
          }),
        );
      } else {
        window.dispatchEvent(
          new CustomEvent("showToast", {
            detail: {
              message: data.message || "Couldn't update role.",
              type: "error",
            },
          }),
        );
      }
    } catch {
      window.dispatchEvent(
        new CustomEvent("showToast", {
          detail: { message: "Couldn't update role.", type: "error" },
        }),
      );
    } finally {
      setRoleBusy(null);
    }
  };

  const handleKick = async (memberId: string) => {
    if (roleBusy) return;
    setRoleBusy(memberId);
    setManageMenu(null);
    try {
      const res = await apiFetch(
        `/api/communities/${community._id}/remove-member`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ memberId }),
        },
      );
      const data = await res.json();
      if (res.ok && data.success) {
        setMemberList((prev) => prev.filter((m) => m.user._id !== memberId));
        window.dispatchEvent(
          new CustomEvent("showToast", {
            detail: { message: "Member removed!", type: "success" },
          }),
        );
      } else {
        window.dispatchEvent(
          new CustomEvent("showToast", {
            detail: {
              message: data.message || "Couldn't remove member.",
              type: "error",
            },
          }),
        );
      }
    } catch {
      window.dispatchEvent(
        new CustomEvent("showToast", {
          detail: { message: "Couldn't remove member.", type: "error" },
        }),
      );
    } finally {
      setRoleBusy(null);
    }
  };

  // Ban — same role matrix as kick, but the member can't re-join until
  // unbanned (the server records the ban + audit log).
  const handleBan = async (memberId: string) => {
    if (roleBusy) return;
    setRoleBusy(memberId);
    setManageMenu(null);
    try {
      const res = await apiFetch(
        `/api/communities/${community._id}/ban`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ memberId }),
        },
      );
      const data = await res.json();
      if (res.ok && data.success) {
        setMemberList((prev) => prev.filter((m) => m.user._id !== memberId));
        window.dispatchEvent(
          new CustomEvent("showToast", {
            detail: { message: "Member banned!", type: "success" },
          }),
        );
      } else {
        window.dispatchEvent(
          new CustomEvent("showToast", {
            detail: {
              message: data.message || "Couldn't ban member.",
              type: "error",
            },
          }),
        );
      }
    } catch {
      window.dispatchEvent(
        new CustomEvent("showToast", {
          detail: { message: "Couldn't ban member.", type: "error" },
        }),
      );
    } finally {
      setRoleBusy(null);
    }
  };

  // Media data (fetched by type)
  const [mediaItems, setMediaItems] = useState<CommunityMessage[]>([]);
  const [loadingMedia, setLoadingMedia] = useState(false);
  const [onlineUsers, setOnlineUsers] = useState<Set<string>>(new Set());
  // Members-tab filter: "all" | "online" | "offline" (Discord-style).
  const [memberFilter, setMemberFilter] = useState<"all" | "online" | "offline">("all");


  // Parse online users from presence events
  useEffect(() => {
    const handlePresence = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.userId && detail?.status) {
        setOnlineUsers((prev) => {
          const next = new Set(prev);
          if (detail.status === "online") {
            next.add(detail.userId);
          } else {
            next.delete(detail.userId);
          }
          return next;
        });
      }
    };
    window.addEventListener("user:presence", handlePresence as EventListener);
    return () => {
      window.removeEventListener("user:presence", handlePresence as EventListener);
    };
  }, []);

  // Fetch members
  useEffect(() => {
    if (activeTab !== "members") return;
    setLoadingMembers(true);
    apiFetch(`/api/communities/${community._id}/members`)
      .then((res) => res.json())
      .then((data) => {
        if (data.success) {
          setMemberList(data.members || []);
        }
      })
      .catch(() => {})
      .finally(() => setLoadingMembers(false));
  }, [activeTab, community._id]);

  // Fetch media by type (starred messages come from their own endpoint)
  useEffect(() => {
    if (activeTab === "members") return;
    setLoadingMedia(true);
    const isStarred = activeTab === "starred";
    const url = isStarred
      ? `/api/communities/${community._id}/starred`
      : `/api/communities/${community._id}/media?type=${
          ({
            photos: "image",
            videos: "video",
            audio: "voice_note",
            docs: "file",
          } as Record<string, string>)[activeTab] || "image"
        }&limit=50`;
    apiFetch(url)
      .then((res) => res.json())
      .then((data) => {
        if (data.success) {
          setMediaItems(data.messages || []);
        }
      })
      .catch(() => {})
      .finally(() => setLoadingMedia(false));
  }, [activeTab, community._id]);

  const tabs: { key: MediaTab; label: string; icon: React.ReactNode }[] = [
    { key: "members", label: "Members", icon: <Users className="h-3 w-3" /> },
    { key: "photos", label: "Photos", icon: <Image className="h-3 w-3" /> },
    { key: "videos", label: "Videos", icon: <Video className="h-3 w-3" /> },
    { key: "audio", label: "Audio", icon: <Music className="h-3 w-3" /> },
    { key: "docs", label: "Docs", icon: <FileText className="h-3 w-3" /> },
    { key: "starred", label: "Starred", icon: <Star className="h-3 w-3" /> },
  ];

  return (
    <div className="h-full w-full flex flex-col bg-black/70 backdrop-blur-md">
      {/* Header with back button */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-zinc-800/50 shrink-0">
        <button
          onClick={onClose}
          className="h-8 w-8 rounded-full flex items-center justify-center hover:bg-zinc-800 transition-colors cursor-pointer"
        >
          <ArrowLeft className="h-4 w-4 text-zinc-400" />
        </button>
        <div className="h-9 w-9 rounded-full bg-zinc-800 flex items-center justify-center overflow-hidden border border-zinc-700/50 shrink-0">
          {community.image?.url ? (
            <img src={optimizeImageUrl(community.image.url, 96)} alt={community.name} className="h-full w-full rounded-full object-cover" loading="lazy" />
          ) : (
            <Hash className="h-5 w-5 text-zinc-500" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-bold text-white truncate">{community.name}</h3>
          <div className="flex items-center gap-1.5">
            <p className="text-[10px] text-zinc-500">
              {community.memberCount} member{community.memberCount !== 1 ? "s" : ""}
            </p>
            {isModerator && (
              <span className="inline-flex items-center rounded-full bg-zinc-800/80 px-1.5 py-px text-[8px] font-bold uppercase tracking-wider text-zinc-300">
                {userRole === "creator"
                  ? "Creator"
                  : userRole === "admin"
                    ? "Admin"
                    : "Moderator"}
              </span>
            )}
          </div>
        </div>
        {isAdmin && (
          <button
            onClick={() => {
              onOpenSettings();
            }}
            className="h-8 w-8 rounded-full flex items-center justify-center hover:bg-zinc-800 transition-colors cursor-pointer"
            title="Community settings"
          >
            <Settings className="h-4 w-4 text-zinc-400 hover:text-zinc-200" />
          </button>
        )}
      </div>

      {/* Tabs — icon + label, fits without scrolling */}
      <div className="flex border-b border-zinc-800/60 shrink-0 px-1">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex flex-1 items-center justify-center gap-1 px-1 py-2 text-[9px] font-bold uppercase tracking-wider transition-all cursor-pointer border-b-2 ${
              activeTab === tab.key
                ? "text-white border-white"
                : "text-zinc-500 hover:text-zinc-300 border-transparent"
            }`}
          >
            {tab.icon}
            <span className="truncate">{tab.label}</span>
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {/* About block — full description with rich link preview */}
        {community.description && (
          <div className="group mb-4 rounded-2xl border border-white/10 bg-zinc-950/95 backdrop-blur-none sm:bg-zinc-950/35 sm:backdrop-blur-xl sm:backdrop-saturate-150 p-3.5">
            <div className="flex items-center justify-between mb-1.5">
              <h4 className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                About
              </h4>
              {/* Translate — hover-revealed so the always-visible icon stays
                  hidden, but translation of the description stays reachable. */}
              <button
                type="button"
                onClick={() => {
                  window.dispatchEvent(
                    new CustomEvent("translate-inline:toggle", {
                      detail: { id: `community-desc-${community._id}` },
                    }),
                  );
                }}
                title="Translate description"
                aria-label="Translate community description"
                className="flex h-6 w-6 items-center justify-center rounded-full border border-white/10 bg-white/5 text-zinc-400 opacity-0 group-hover:opacity-100 hover:border-white/20 hover:text-white transition-all cursor-pointer"
              >
                <Languages className="h-3 w-3" />
              </button>
            </div>
            <TranslateInline
              text={community.description}
              eventId={`community-desc-${community._id}`}
              hideToggle
              className="!items-start"
              render={(t) => (
                <p className="text-xs text-zinc-300 leading-relaxed whitespace-pre-wrap break-words">
                  {renderLinkifiedText(t)}
                </p>
              )}
            />
            {extractFirstUrl(community.description) && (
              <div className="mt-2.5">
                <LinkPreviewCard
                  url={extractFirstUrl(community.description)!}
                  compact
                />
              </div>
            )}
          </div>
        )}
        {/* Members tab */}
        {activeTab === "members" && (
          <div className="space-y-1">
            {/* Quick invite — admins can copy the shareable join link right
                from the member list (Discord's "Invite People" pattern). */}
            {isAdmin && (
              <div className="mb-2 rounded-2xl border border-zinc-800 bg-zinc-950/40 p-2.5">
                {inviteOpen ? (
                  <div className="flex items-center gap-2">
                    {inviteLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin text-zinc-500" />
                    ) : inviteCode ? (
                      <>
                        <code className="flex-1 min-w-0 truncate rounded-lg bg-zinc-900 border border-zinc-800 px-2 py-1.5 text-[10px] font-mono text-zinc-300">
                          {window.location.origin}/communities?invite=
                          {inviteCode}
                        </code>
                        <button
                          onClick={handleCopyInvite}
                          className="shrink-0 rounded-full bg-aurora text-white px-2.5 py-1.5 text-[9.5px] font-bold hover:opacity-90 transition-opacity cursor-pointer inline-flex items-center gap-1"
                        >
                          <Link2 className="h-3 w-3" /> Copy
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={loadInvite}
                        className="text-[10px] font-semibold text-zinc-300 hover:text-white underline transition-colors cursor-pointer"
                      >
                        Generate invite link
                      </button>
                    )}
                  </div>
                ) : (
                  <button
                    onClick={() => {
                      setInviteOpen(true);
                      if (!inviteCode) loadInvite();
                    }}
                    className="w-full flex items-center gap-2 text-[11px] font-semibold text-zinc-300 hover:text-white transition-colors cursor-pointer"
                  >
                    <Link2 className="h-3.5 w-3.5 text-zinc-500" />
                    Invite people
                  </button>
                )}
              </div>
            )}
            <div className="flex items-center justify-between px-1 pb-1.5">
              <span className="text-[9px] font-bold uppercase tracking-wider text-zinc-500">
                {memberList.length} member{memberList.length !== 1 ? "s" : ""}
              </span>
              {roleBusy && (
                <Loader2 className="h-3 w-3 animate-spin text-zinc-500" />
              )}
            </div>
            {/* Online / offline filter — Discord-style. Presence is already
                tracked live in `onlineUsers` for the green dots; these chips
                just slice the list by it. */}
            <div className="flex gap-1.5 px-1 pb-2">
              {(["all", "online", "offline"] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setMemberFilter(f)}
                  className={`rounded-full px-2.5 py-1 text-[9px] font-bold uppercase tracking-wider transition-colors cursor-pointer ${
                    memberFilter === f
                      ? "bg-white/15 text-white"
                      : "text-zinc-500 hover:text-zinc-300 hover:bg-white/5"
                  }`}
                >
                  {f === "all"
                    ? `All (${memberList.length})`
                    : f === "online"
                      ? `Online (${memberList.filter((m) => onlineUsers.has(m.user._id)).length})`
                      : `Offline (${memberList.filter((m) => !onlineUsers.has(m.user._id)).length})`}
                </button>
              ))}
            </div>
            {loadingMembers ? (
              <div className="flex items-center justify-center py-10">
                <Loader2 className="h-5 w-5 text-zinc-500 animate-spin" />
              </div>
            ) : memberList.length === 0 ? (
              <p className="text-[11px] text-zinc-600 text-center py-8">No members data available</p>
            ) : (
              // Online/offline filter (if active), then sorted by role
              // (creator → admin → moderator → member) so the hierarchy is
              // visible at a glance, Discord-style.
              [...memberList]
                .filter((member) => {
                  if (memberFilter === "all") return true;
                  const online = onlineUsers.has(member.user._id);
                  return memberFilter === "online" ? online : !online;
                })
                .sort((a, b) => {
                  const rankDiff =
                    (ROLE_RANK[b.role] ?? 0) - (ROLE_RANK[a.role] ?? 0);
                  if (rankDiff !== 0) return rankDiff;
                  return (
                    new Date(a.joinedAt).getTime() -
                    new Date(b.joinedAt).getTime()
                  );
                })
                .map((member) => {
                  const isCreator = community.creator?._id === member.user._id;
                  const isOnline = onlineUsers.has(member.user._id);
                  const targetRank = ROLE_RANK[member.role] ?? 0;
                  // Manage actions visible when I outrank the member.
                  const canManage = myRank >= 1 && myRank > targetRank && !isCreator;
                  const roleLabel =
                    member.role === "creator"
                      ? { text: "Creator", cls: "text-amber-400 bg-amber-500/10" }
                      : member.role === "admin"
                        ? { text: "Admin", cls: "text-[#a78bfa] bg-[#a78bfa]/10" }
                        : member.role === "moderator"
                          ? { text: "Mod", cls: "text-[#38bdf8] bg-[#38bdf8]/10" }
                          : null;
                  return (
                    <div
                      key={member.user._id}
                      role="button"
                      tabIndex={0}
                      onClick={() => {
                        if (member.user.username && onUserSelected) {
                          onUserSelected(member.user.username);
                        }
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && member.user.username && onUserSelected) {
                          onUserSelected(member.user.username);
                        }
                      }}
                      className="w-full flex items-center gap-3 px-2.5 py-2 rounded-lg hover:bg-zinc-800/50 transition-colors cursor-pointer text-left group"
                    >
                      <div className="relative shrink-0">
                        <div className="h-8 w-8 rounded-full bg-zinc-800 flex items-center justify-center overflow-hidden">
                          {member.user.profilePic?.url ? (
                            <img
                              src={optimizeImageUrl(member.user.profilePic.url)}
                              alt={member.user.fullName}
                              className="h-full w-full object-cover cursor-pointer"
                              onClick={(e) => {
                                e.stopPropagation();
                                window.dispatchEvent(new CustomEvent("openImagePreview", { detail: { url: member.user.profilePic!.url, variant: "avatar" } }));
                              }}
                              onError={(e) => {
                                const target = e.target as HTMLImageElement;
                                target.style.display = 'none';
                                const fallback = document.createElement('span');
                                fallback.className = 'text-[10px] font-bold text-zinc-500';
                                fallback.textContent = member.user.fullName?.charAt(0) || '?';
                                target.parentElement?.appendChild(fallback);
                              }}
                            />
                          ) : (
                            <span className="text-[10px] font-bold text-zinc-500">
                              {member.user.fullName?.charAt(0) || "?"}
                            </span>
                          )}
                        </div>
                        {isOnline && (
                          <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-green-500 border-2 border-zinc-900" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[12px] font-semibold text-zinc-200 truncate group-hover:text-white transition-colors">
                            {member.user.fullName}
                          </span>
                          {roleLabel && (
                            <span
                              className={`text-[8px] font-bold px-1.5 py-0.5 rounded-full uppercase tracking-wider shrink-0 ${roleLabel.cls}`}
                            >
                              {roleLabel.text}
                            </span>
                          )}
                        </div>
                        <p className="text-[10px] text-zinc-500">
                          @{member.user.username}
                          {isOnline && (
                            <span className="text-green-500 ml-1.5">
                              • Online
                            </span>
                          )}
                        </p>
                      </div>
                      {canManage && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            const rect = e.currentTarget.getBoundingClientRect();
                            setManageMenu({
                              x: Math.min(
                                rect.right - 170,
                                window.innerWidth - 190,
                              ),
                              y: rect.bottom + 4,
                              memberId: member.user._id,
                            });
                          }}
                          className="shrink-0 h-6 w-6 rounded-full flex items-center justify-center text-zinc-500 hover:text-white hover:bg-zinc-800 transition-colors cursor-pointer opacity-0 group-hover:opacity-100"
                          title={`Manage ${member.user.fullName}`}
                        >
                          <MoreVertical className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  );
                })
            )}
          </div>
        )}

        {/* Media tabs (photos, videos, audio, docs) */}
        {activeTab !== "members" && (
          <div className="grid grid-cols-3 gap-2">
            {loadingMedia ? (
              <div className="col-span-3 flex items-center justify-center py-10">
                <Loader2 className="h-5 w-5 text-zinc-500 animate-spin" />
              </div>
            ) : mediaItems.length === 0 ? (
              <div className="col-span-3 flex flex-col items-center justify-center py-10 text-center">
                <div className="h-12 w-12 rounded-full bg-zinc-800 flex items-center justify-center mb-3">
                  {activeTab === "photos" && <Image className="h-5 w-5 text-zinc-600" />}
                  {activeTab === "videos" && <Video className="h-5 w-5 text-zinc-600" />}
                  {activeTab === "audio" && <Music className="h-5 w-5 text-zinc-600" />}
                  {activeTab === "docs" && <FileText className="h-5 w-5 text-zinc-600" />}
                  {activeTab === "starred" && <Star className="h-5 w-5 text-zinc-600" />}
                </div>
                <p className="text-[11px] text-zinc-600 font-medium">
                  {activeTab === "starred"
                    ? "No starred messages yet"
                    : `No ${activeTab} shared yet`}
                </p>
              </div>
            ) : (
              mediaItems.map((item) => {
                const attachment = item.attachments?.[0];
                if (!attachment) return null;

                // Photos: show image thumbnails — 300px (the grid tiles are
                // ~100px on mobile) + async decode so the grid paints fast.
                if (activeTab === "photos" && attachment.type === "image") {
                  return (
                    <div
                      key={item._id}
                      className="aspect-square rounded-lg overflow-hidden bg-zinc-800 border border-zinc-700/40"
                    >
                      <img
                        src={optimizeImageUrl(attachment.url, 300)}
                        alt=""
                        className="h-full w-full object-cover"
                        loading="lazy"
                        decoding="async"
                      />
                    </div>
                  );
                }

                // Videos: show a Cloudinary POSTER frame (a few-KB jpg) with
                // preload="none" — browsing the grid never downloads video
                // bytes until the user taps play. Previously every tile
                // fetched full-res video metadata over the network.
                if (activeTab === "videos" && attachment.type === "video") {
                  return (
                    <div
                      key={item._id}
                      className="aspect-square rounded-lg overflow-hidden bg-zinc-800 border border-zinc-700/40 flex items-center justify-center relative group"
                    >
                      {attachment.url ? (
                        <video
                          src={attachment.url}
                          poster={videoPosterUrl(attachment.url, 400)}
                          className="h-full w-full object-cover"
                          muted
                          playsInline
                          preload="none"
                        />
                      ) : (
                        <Video className="h-6 w-6 text-zinc-600" />
                      )}
                      <div className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Play className="h-6 w-6 text-white" />
                      </div>
                    </div>
                  );
                }

                // Audio: show audio items
                if (activeTab === "audio" && attachment.type === "voice_note") {
                  return (
                    <div
                      key={item._id}
                      className="col-span-3 flex items-center gap-3 p-3 rounded-lg bg-zinc-800/50 border border-zinc-700/40"
                    >
                      <div className="h-8 w-8 rounded-full bg-zinc-700 flex items-center justify-center shrink-0">
                        <Music className="h-4 w-4 text-zinc-400" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[11px] font-medium text-zinc-300 truncate">
                          Voice note by {typeof item.sender === "object" ? item.sender.fullName : "Unknown"}
                        </p>
                        <p className="text-[9px] text-zinc-600">
                          {attachment.duration ? `${attachment.duration}s` : ""} · {new Date(item.createdAt).toLocaleDateString()}
                        </p>
                      </div>
                      <audio src={attachment.url} controls className="h-8 w-32" preload="none" />
                    </div>
                  );
                }

                // Docs: show document items
                if (activeTab === "docs" && (attachment.type === "file" || attachment.type === "image")) {
                  return (
                    <div
                      key={item._id}
                      className="col-span-3 flex items-center gap-3 p-3 rounded-lg bg-zinc-800/50 border border-zinc-700/40"
                    >
                      <div className="h-8 w-8 rounded-full bg-zinc-700 flex items-center justify-center shrink-0">
                        <FileText className="h-4 w-4 text-zinc-400" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[11px] font-medium text-zinc-300 truncate">
                          {attachment.url?.split("/").pop() || "File"}
                        </p>
                        <p className="text-[9px] text-zinc-600">
                          {new Date(item.createdAt).toLocaleDateString()} · by{" "}
                          {typeof item.sender === "object" ? item.sender.fullName : "Unknown"}
                        </p>
                      </div>
                      <a
                        href={attachment.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[10px] font-bold text-zinc-400 hover:text-white transition-colors shrink-0"
                      >
                        Open
                      </a>
                    </div>
                  );
                }

                // Starred: mixed rows — text snippet + attachment label.
                if (activeTab === "starred") {
                  return (
                    <div
                      key={item._id}
                      className="col-span-3 flex items-center gap-3 p-3 rounded-lg bg-zinc-800/50 border border-zinc-700/40"
                    >
                      <div className="h-8 w-8 rounded-full bg-zinc-700 flex items-center justify-center shrink-0">
                        <Star className="h-4 w-4 text-amber-400" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[11px] font-medium text-zinc-300 truncate">
                          {item.text ||
                            (attachment?.type === "voice_note"
                              ? "Voice note"
                              : attachment?.type === "video"
                                ? "Video"
                                : attachment?.type === "image" ||
                                    attachment?.type === "gif"
                                  ? "Photo"
                                  : attachment?.name || "Attachment")}
                        </p>
                        <p className="text-[9px] text-zinc-600">
                          by{" "}
                          {typeof item.sender === "object"
                            ? item.sender.fullName || item.sender.username
                            : "Unknown"}{" "}
                          · {new Date(item.createdAt).toLocaleDateString()}
                        </p>
                      </div>
                      {attachment && (
                        <img
                          src={optimizeImageUrl(attachment.url, 96)}
                          alt=""
                          loading="lazy"
                          decoding="async"
                          className="h-9 w-9 rounded-lg object-cover bg-zinc-900 shrink-0"
                        />
                      )}
                    </div>
                  );
                }

                return null;
              })
            )}
          </div>
        )}
      </div>

      {/* Member management popover — promote/demote/kick (managers only).
          The server hard-enforces the permission matrix; this UI only shows
          actions the actor's rank legitimately allows. */}
      {manageMenu &&
        (() => {
          const member = memberList.find(
            (m) => m.user._id === manageMenu.memberId,
          );
          if (!member) return null;
          const targetRank = ROLE_RANK[member.role] ?? 0;
          const targetName =
            member.user.fullName || member.user.username;
          const itemCls =
            "w-full flex items-center gap-2.5 px-3.5 py-2.5 text-xs font-semibold text-zinc-200 hover:bg-white/10 transition-colors cursor-pointer text-left disabled:opacity-40 disabled:cursor-not-allowed";
          return (
            <>
              {/* Backdrop — click anywhere to dismiss */}
              <div
                className="fixed inset-0 z-[120]"
                onClick={() => setManageMenu(null)}
              />
              <div
                className="fixed z-[130] w-48 overflow-hidden rounded-xl border border-zinc-700/50 bg-zinc-900/95 backdrop-blur-xl shadow-2xl"
                style={{ left: manageMenu.x, top: manageMenu.y }}
              >
                <div className="px-3.5 py-2 border-b border-zinc-800">
                  <p className="text-[9px] font-black uppercase tracking-wider text-zinc-500 truncate">
                    {targetName}
                  </p>
                  <p className="text-[9px] text-zinc-600 font-bold capitalize">
                    {member.role}
                  </p>
                </div>
                {member.role === "member" && myRank >= 2 && (
                  <button
                    onClick={() =>
                      handleRoleChange(member.user._id, "moderator")
                    }
                    disabled={!!roleBusy}
                    className={itemCls}
                  >
                    <ShieldPlus className="h-3.5 w-3.5 text-zinc-400" />
                    Promote to Moderator
                  </button>
                )}
                {(member.role === "member" ||
                  member.role === "moderator") &&
                  userRole === "creator" && (
                    <button
                      onClick={() =>
                        handleRoleChange(member.user._id, "admin")
                      }
                      disabled={!!roleBusy}
                      className={itemCls}
                    >
                      <ShieldCheck className="h-3.5 w-3.5 text-[#a78bfa]" />
                      Promote to Admin
                    </button>
                  )}
                {member.role === "moderator" && myRank >= 2 && (
                  <button
                    onClick={() =>
                      handleRoleChange(member.user._id, "member")
                    }
                    disabled={!!roleBusy}
                    className={itemCls}
                  >
                    <ShieldMinus className="h-3.5 w-3.5 text-zinc-400" />
                    Demote to Member
                  </button>
                )}
                {member.role === "admin" && userRole === "creator" && (
                  <button
                    onClick={() =>
                      handleRoleChange(member.user._id, "moderator")
                    }
                    disabled={!!roleBusy}
                    className={itemCls}
                  >
                    <ShieldMinus className="h-3.5 w-3.5 text-zinc-400" />
                    Demote to Moderator
                  </button>
                )}
                {myRank >= 1 && myRank > targetRank && (
                  <button
                    onClick={() => handleKick(member.user._id)}
                    disabled={!!roleBusy}
                    className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-xs font-semibold text-red-400 hover:bg-red-500/10 transition-colors cursor-pointer text-left border-t border-zinc-800 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <UserMinus className="h-3.5 w-3.5" />
                    Remove from community
                  </button>
                )}
                {myRank >= 1 && myRank > targetRank && (
                  <button
                    onClick={() => handleBan(member.user._id)}
                    disabled={!!roleBusy}
                    className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-xs font-semibold text-red-400 hover:bg-red-500/10 transition-colors cursor-pointer text-left border-t border-zinc-800 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Ban className="h-3.5 w-3.5" />
                    Ban from community
                  </button>
                )}
              </div>
            </>
          );
        })()}

    </div>
  );
}
