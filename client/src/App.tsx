import React, {
    useState,
    useEffect,
    useRef,
    Suspense,
    useCallback,
} from "react";
// Logged-out screens (landing/auth) + desktop nav are lazy — they're only
// needed in specific states, so they stay out of the main bundle until then.
const LandingRoot = React.lazy(() => import("./landing/LandingRoot"));
const LeftSidebar = React.lazy(() => import("./components/LeftSidebar"));
import { motion, AnimatePresence } from "motion/react";
import { Toaster, toast } from "sonner";
// socket.io-client is intentionally NOT statically imported here — it's a
// ~40 KB gzip dependency that only matters once the user is logged in. It's
// dynamically imported inside connectSockets, so the logged-out landing (and
// the first paint of every visit) never downloads it.
import type { Socket } from "socket.io-client";
import {
    UserPlus,
    Check,
    ArrowRight,
    ArrowLeft,
    X,
    Wrench,
} from "lucide-react";
import type { User, Notification, Conversation, BgTheme, ColorTheme } from "./types";
import UserAvatar from "./components/UserAvatar";
import GlassCard from "./components/GlassCard";
import ErrorBoundary from "./components/ErrorBoundary";
import {
    apiFetch,
    warmCache,
    getEndpointsForTab,
    clearAllCaches,
    stopCacheRefreshTimer,
    resolveApiBase,
} from "./utils/api";
import { BADGE_MAP, THEME_UNLOCK_BADGES } from "./utils/badgeCatalog";
import {
    prependPostToCachedFeeds,
    getCachedResponse,
} from "./utils/apiCache";
import { getOfflineFallback } from "./utils/dexieBridge";
import { applyRealtimeEvent } from "./utils/realtimeSync";
import { getNotificationText } from "./utils/notificationText";
import { prefetchTabChunk, prefetchLikelyNextTabs } from "./utils/tabChunks";
import { primeOfflineCache } from "./utils/primeCache";
import { playNotificationChime } from "./utils/notificationChime";
import { logger } from "./utils/logger";
import { isMobileDevice } from "./utils/device";
import { useLenisScroll } from "./hooks/useLenisScroll";
import { useOfflineSync } from "./hooks/useOfflineSync";
import BroadcastBanner from "./components/BroadcastBanner";
import { setFeatureGates, isFeatureOn } from "./utils/featureGates";
import {
    ensurePushSubscription,
    showBrowserNotification,
} from "./utils/notifications";

// Lazy-loaded heavy components — only fetched when first rendered
const Feed = React.lazy(() => import("./components/Feed"));
const Explore = React.lazy(() => import("./components/Explore"));
const Notifications = React.lazy(() => import("./components/Notifications"));
const Profile = React.lazy(() => import("./components/Profile"));
const Settings = React.lazy(() => import("./components/Settings"));
const BackgroundGradients = React.lazy(
    () => import("./components/BackgroundGradients"),
);
const Chat = React.lazy(() => import("./components/Chat"));
const ImagePreviewRenderer = React.lazy(
    () => import("./components/ImagePreviewRenderer"),
);
const Dock = React.lazy(() => import("./components/Dock"));
const PostModal = React.lazy(() => import("./components/PostModal"));
const CallUI = React.lazy(() => import("./components/CallUI"));
const Communities = React.lazy(() => import("./components/Communities"));
const AdminDashboard = React.lazy(() => import("./components/AdminDashboard"));
const AchievementDetailModal = React.lazy(
    () => import("./components/AchievementDetailModal"),
);
const PermissionOnboarding = React.lazy(
    () => import("./components/PermissionOnboarding"),
);

// ─── WebRTC ICE/TURN server configuration ─────────────────────────────
// Configure VITE_ICE_SERVERS (JSON array of RTCIceServer) or
// VITE_TURN_URL / VITE_TURN_USERNAME / VITE_TURN_CREDENTIAL for
// production-grade relays. Falls back to public STUN + a free public
// TURN relay otherwise. Built once at module scope (not per render).
const buildIceServers = (): RTCIceServer[] => {
    const envServers = (import.meta.env.VITE_ICE_SERVERS as string)?.trim();
    if (envServers) {
        try {
            const parsed = JSON.parse(envServers) as RTCIceServer[];
            if (Array.isArray(parsed) && parsed.length > 0) return parsed;
        } catch {
            /* fall through to defaults */
        }
    }
    const turnUrl = (import.meta.env.VITE_TURN_URL as string)?.trim();
    const turnUser = (import.meta.env.VITE_TURN_USERNAME as string)?.trim();
    const turnPass = (import.meta.env.VITE_TURN_CREDENTIAL as string)?.trim();
    if (turnUrl && turnUser && turnPass) {
        return [
            { urls: "stun:stun.l.google.com:19302" },
            { urls: "stun:stun1.l.google.com:19302" },
            { urls: "stun:stun2.l.google.com:19302" },
            { urls: "stun:stun3.l.google.com:19302" },
            { urls: "stun:stun4.l.google.com:19302" },
            { urls: turnUrl, username: turnUser, credential: turnPass },
        ];
    }
    // Defaults — free TURN for NAT traversal on mobile/cellular networks
    return [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
        { urls: "stun:stun2.l.google.com:19302" },
        { urls: "stun:stun3.l.google.com:19302" },
        { urls: "stun:stun4.l.google.com:19302" },
        {
            urls: "turn:openrelay.metered.ca:80",
            username: "openrelayproject",
            credential: "openrelayproject",
        },
        {
            urls: "turn:openrelay.metered.ca:443",
            username: "openrelayproject",
            credential: "openrelayproject",
        },
    ];
};

// Built once at module scope — not per render.
const ICE_SERVERS: RTCIceServer[] = buildIceServers();

export default function App() {
    const [user, setUser] = useState<User | null>(null);
    const [sessionChecked, setSessionChecked] = useState(false);
    // Track consecutive 401s to avoid kicking the user out on transient
    // cold-start failures (Render free tier takes 30-60s to boot).
    const authExpiredCountRef = useRef(0);
    const [currentTab, setTabState] = useState(() => {
        // localStorage can throw SecurityError ("The operation is insecure")
        // when the browser blocks storage (strict tracking protection /
        // blocked cookies / private mode) — never let that crash first render.
        let saved: string | null = null;
        if (typeof window !== "undefined") {
            try {
                saved = localStorage.getItem("orbit_current_tab");
            } catch {
                saved = null;
            }
            const valid = [
                "home",
                "explore",
                "notifications",
                "chat",
                "profile",
                "settings",
                "communities",
                "admin",
            ];
            if (saved && valid.includes(saved)) {
                return saved;
            }
        }
        return "home";
    });
    // Keeps the active tab readable inside effects/callbacks without re-subscribing.
    const currentTabRef = useRef(currentTab);
    currentTabRef.current = currentTab;

    const setTab = useCallback(
        (updater: string | ((prev: string) => string)) => {
            setTabState((prev) => {
                const nextTab =
                    typeof updater === "function" ? updater(prev) : updater;
                if (nextTab !== "compose") {
                    try {
                        localStorage.setItem("orbit_current_tab", nextTab);
                    } catch {
                        /* storage blocked — in-memory tab state is fine */
                    }
                }
                return nextTab;
            });
        },
        [],
    );
    // Badge counts are hydrated from localStorage synchronously so a reload
    // restores them INSTANTLY (zero network), then reconciled with the server
    // in the background (stale-while-revalidate). Persisted in effects below.
    const [badgeCount, setBadgeCount] = useState(() => {
        if (typeof window === "undefined") return 0;
        try {
            const saved = parseInt(
                localStorage.getItem("orbit_notif_badge") || "0",
                10,
            );
            return Number.isFinite(saved) && saved > 0 ? saved : 0;
        } catch {
            return 0;
        }
    });
    const [chatBadgeCount, setChatBadgeCount] = useState(() => {
        if (typeof window === "undefined") return 0;
        try {
            const saved = parseInt(
                localStorage.getItem("orbit_chat_badge") || "0",
                10,
            );
            return Number.isFinite(saved) && saved > 0 ? saved : 0;
        } catch {
            return 0;
        }
    });
    // Tracks whether the conversations list has been fetched from the server at
    // least once — used to avoid clobbering the persisted chat badge with 0 while
    // the (slower) network response is still in flight after a reload.
    const conversationsFetchedRef = useRef(false);
    // Lazy chunks are fetched per-tab (React.lazy) + on hover/tap
    // (prefetchTabChunk). The idle scheduler below additionally preloads the
    // few most-likely next screens once a session exists (not ALL tabs — that
    // would defeat the per-tab code split). The Feed chunk (the landing tab)
    // renders immediately anyway, and warmCache (below) pre-warms the DATA for
    // all tabs once a session exists, so navigation stays instant either way.
    const prefetchCurrentTab = useCallback(() => {
        // Logged-out users only see the landing page — don't waste bandwidth on
        // the heavy app chunks (Feed etc.) until a session actually exists.
        if (!user) return;
        prefetchTabChunk(currentTabRef.current || "home");
    }, [user]);

    useEffect(() => {
        const schedulePreload = (): (() => void) | void => {
            if (
                typeof window !== "undefined" &&
                "requestIdleCallback" in window
            ) {
                (
                    window as Window & {
                        requestIdleCallback: (cb: () => void) => void;
                    }
                ).requestIdleCallback(() => {
                    prefetchCurrentTab();
                    // Idle time after the home screen renders: download the
                    // most-likely next screens (chat, notifications, explore,
                    // communities, profile + the composer) so the first tap on
                    // any of them is instant — no chunk download on tap.
                    // Skipped for logged-out users and on data-saver.
                    if (user) prefetchLikelyNextTabs();
                });
            } else {
                const preloadTimer = setTimeout(() => {
                    prefetchCurrentTab();
                    if (user) prefetchLikelyNextTabs();
                }, 1500);
                return () => clearTimeout(preloadTimer);
            }
        };

        return schedulePreload();
    }, [prefetchCurrentTab, user]);

    // After the user is known (fresh login OR session restored on reload), warm
    // the API cache for every major tab + user-specific data so navigation is
    // instant. This runs on BOTH paths — handleAuthSuccess only fires on a fresh
    // login, so without this a returning user who reloads the page would lose all
    // tab warming and the background-refresh registration until their first click.
    useEffect(() => {
        if (!user) return;
        const allEndpoints = [
            ...getEndpointsForTab("home"),
            ...getEndpointsForTab("explore"),
            ...getEndpointsForTab("notifications"),
            ...getEndpointsForTab("chat"),
            ...getEndpointsForTab("communities"),
            ...getEndpointsForTab("saved"),
            ...getEndpointsForTab("reposts"),
            ...(user.isAdmin ? getEndpointsForTab("admin") : []),
            "/api/chats/conversations",
            "/api/users/suggestions",
            `/api/users/username/${user.username}`,
            `/api/users/${user._id}/posts?limit=10`,
            // NOTE: the ?limit=10 query string MUST match what Profile.tsx actually
            // fetches — the client cache key includes the query string, so warming
            // "/api/saves" would never be hit by Profile's "/api/saves?limit=10".
            "/api/saves?limit=10",
            "/api/reposts?limit=10",
            "/api/posts/drafts",
        ];
        warmCache(allEndpoints);
    }, [user]);

    // ─── Achievement perks: theme unlocks + detail modal ─────────────────
    // Fetches the user's earned badges once per account so we know which color
    // themes are unlocked (aurora/ember need their badge). Also refreshes the
    // moment a badge is earned live, and falls back to the default theme if
    // the saved one is no longer unlocked.
    const refreshAchievementPerks = useCallback(async () => {
        if (!user?._id) {
            // Logged out — never leak the previous account's unlocked themes
            // or badges into the next session.
            setEarnedBadges([]);
            setUnlockedThemes(["xlite"]);
            return;
        }
        try {
            const res = await apiFetch("/api/xp/achievements");
            const json = await res.json();
            if (!res.ok || !json.success) return;
            const earned: string[] = Array.isArray(json.earned)
                ? json.earned
                : [];
            const unlocked = ["xlite"];
            for (const [theme, badgeId] of Object.entries(
                THEME_UNLOCK_BADGES,
            )) {
                if (earned.includes(badgeId)) unlocked.push(theme);
            }
            // Aurum (internal key "genesis") is not badge-gated — it's the
            // Day One waitlist perk: members get it free, everyone else can
            // never unlock it.
            if (user?.waitlistPerk) unlocked.push("genesis");
            setEarnedBadges(earned);
            setUnlockedThemes(unlocked);
            // Fall back to the default theme if the saved one is now locked.
            setColorTheme((prev) => {
                if (prev !== "xlite" && !unlocked.includes(prev)) {
                    try {
                        localStorage.setItem("orbit_color_theme", "xlite");
                    } catch {
                        // storage unavailable — non-critical
                    }
                    return "xlite";
                }
                return prev;
            });
        } catch (err) {
            logger.error("Failed to load achievement perks", err);
        }
    }, [user?._id, user?.waitlistPerk]);

    useEffect(() => {
        void refreshAchievementPerks();
    }, [refreshAchievementPerks]);

    // Re-check perks the instant a badge unlocks in realtime (socket
    // notification → achievementUnlocked event) so the new theme + celebration
    // state appear immediately without a reload.
    useEffect(() => {
        const onUnlock = () => void refreshAchievementPerks();
        window.addEventListener("achievementUnlocked", onUnlock);
        return () =>
            window.removeEventListener("achievementUnlocked", onUnlock);
    }, [refreshAchievementPerks]);

    // Achievement detail modal — opened from any badge tile / celebration via
    // a CustomEvent carrying { badgeId, progressText? }.
    useEffect(() => {
        const onDetail = (e: Event) => {
            const detail = (e as CustomEvent).detail;
            if (detail?.badgeId) {
                setDetailBadge({
                    badgeId: detail.badgeId,
                    progressText: detail.progressText,
                });
            }
        };
        window.addEventListener("achievementDetailRequested", onDetail);
        return () =>
            window.removeEventListener(
                "achievementDetailRequested",
                onDetail,
            );
    }, []);

    // WebRTC peer connection refs (shared between Chat initiation and CallUI display)
    const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
    const localStreamRef = useRef<MediaStream | null>(null);
    const remoteStreamRef = useRef<MediaStream | null>(null);
    // Candidates can arrive before an incoming call is accepted and its peer
    // connection has a remote description. Queue them instead of dropping them.
    const pendingIceCandidatesRef = useRef<RTCIceCandidateInit[]>([]);
    const pendingCallOfferRef = useRef<{
        sdp: RTCSessionDescriptionInit;
        type: "audio" | "video";
        partnerId: string;
        partnerName: string;
    } | null>(null);

    // Memoize socket connection to prevent unnecessary reconnections
    const socketRef = useRef<Socket | null>(null);
    const socketUserIdRef = useRef<string | null>(null);
    // True once the socket has completed at least ONE connection. The first
    // connect after login already triggers initial fetches; only REconnects
    // (socket was dead, mobile backgrounded) need the broadcast-list refetch
    // below — otherwise every login would double-fetch everything.
    const hasConnectedOnceRef = useRef(false);
    // ── Realtime backfill cursor ──
    // The ts of the last realtime event this client processed, sent to the
    // server on every (re)connect as `events:sync { since }`. Persisted so a
    // full reload also resumes from where the previous session left off.
    const lastRealtimeTsRef = useRef<number>(
        Number(localStorage.getItem("orbit:rt-since") || 0),
    );
    const [socket, setSocket] = useState<Socket | null>(null);
    const [conversations, setConversations] = useState<Conversation[]>([]);
    // True until the FIRST conversations fetch resolves (cache paint or
    // network) — lets Chat.tsx show a real loading skeleton instead of the
    // false "No conversations yet" empty state while the list is still
    // loading.
    const [conversationsLoading, setConversationsLoading] = useState(true);
    const [composeOpen, setComposeOpen] = useState(false);
    const [hasActiveConversation, setHasActiveConversation] = useState(false);
    const [hasCommunityChatOpen, setHasCommunityChatOpen] = useState(false);
    // Deep-link target for Communities — set by notification clicks (e.g.
    // community mention), consumed via the `openCommunityId` prop. Also synced
    // continuously with the open community so the URL reflects it.
    const [communityToOpen, setCommunityToOpen] = useState<string | null>(
        null,
    );
    // Open 1:1 chat conversation id — mirrors the thread open inside the Chat
    // tab so reloads / browser-back restore it (URL: /chats/<id>).
    const [activeConversationId, setActiveConversationId] = useState<
        string | null
    >(null);
    const [commentsOpen, setCommentsOpen] = useState(false);
    // User id requested to message via the profile "Message" button — the chat
    // tab opens this conversation (get-or-create) when it mounts.
    const [chatOpenWithUserId, setChatOpenWithUserId] = useState<string | null>(
        null,
    );

    // ─── Animated background theme (Settings → Appearance) ──────────────
    // "none" — no canvas at all, calm static dark. "stellar" renders the
    // liquid-glass WebGL waves, lazy-loaded so the initial bundle stays lean.
    // Persisted to localStorage under orbit_bg_theme (defaults to none so the
    // app never opens with a heavy background the user didn't choose).
    const [bgTheme, setBgTheme] = useState<BgTheme>(() => {
        if (typeof window === "undefined") return "none";
        try {
            const saved = localStorage.getItem("orbit_bg_theme");
            return saved === "stellar" ? "stellar" : "none";
        } catch {
            return "none";
        }
    });	const changeBgTheme = useCallback((theme: BgTheme) => {
        setBgTheme(theme);
        try {
            localStorage.setItem("orbit_bg_theme", theme);
        } catch {
            // storage unavailable (private mode) — in-memory state is fine
        }
    }, []);

    // ─── Color theme (Settings → Appearance) ───────────────────────────
    // "xlite" — Eclipse, pure black & white (default). "aurora" — cool
    // cosmic midnight. "ember" — warm golden-hour. Swaps the palette via
    // data-theme on <html>; persisted under orbit_color_theme.
    const [colorTheme, setColorTheme] = useState<ColorTheme>(() => {
        if (typeof window === "undefined") return "xlite";
        try {
            const saved = localStorage.getItem("orbit_color_theme");
            return saved === "ember"
                ? "ember"
                : saved === "aurora"
                  ? "aurora"
                  : saved === "genesis"
                    ? "genesis"
                    : "xlite";
        } catch {
            return "xlite";
        }
    });
    // Achievements → perks: color themes unlock via badges (THEME_UNLOCK_BADGES).
    // Only "xlite" is available until its badge is earned — Settings hides the
    // locked themes entirely. Earned badges also drive the perk preview +
    // celebration modals below.
    const [unlockedThemes, setUnlockedThemes] = useState<string[]>(() => [
        "xlite",
    ]);
    const [earnedBadges, setEarnedBadges] = useState<string[]>([]);
    const [detailBadge, setDetailBadge] = useState<{
        badgeId: string;
        progressText?: string;
    } | null>(null);
    // Appearance sub-tab requested from a perk CTA — Settings applies it on
    // mount. Prop-driven (not an event) so it works even though Settings is a
    // lazy chunk that may mount AFTER the request is made.
    const [settingsSubTabRequest, setSettingsSubTabRequest] = useState<{
        tab: string;
        nonce: number;
    } | null>(null);
    const changeColorTheme = useCallback(
        (theme: ColorTheme) => {
            if (theme !== "xlite" && !unlockedThemes.includes(theme)) {
                // Locked theme — Settings only shows unlocked ones, but guard
                // anyway (stale deep-links, race before perks load, etc.).
                window.dispatchEvent(
                    new CustomEvent("showToast", {
                        detail: {
                            message:
                                "This theme is locked — complete its achievement to unlock it.",
                            type: "info",
                        },
                    }),
                );
                return;
            }
            setColorTheme(theme);
            try {
                localStorage.setItem("orbit_color_theme", theme);
            } catch {
                // storage unavailable (private mode) — in-memory state is fine
            }
        },
        [unlockedThemes],
    );

    // Smooth scrolling (Lenis) on the main content column — covers the feed,
    // explore, notifications, profile, settings and admin on both desktop and
    // mobile. Re-attached on tab/login changes so the scroll limit stays fresh.
    const mainColumnRef = useRef<HTMLDivElement | null>(null);
    useLenisScroll(mainColumnRef, {}, [currentTab, !!user]);

    useEffect(() => {
        const handleShowToast = (e: any) => {
            const { message, type } = e.detail;
            if (type === "error") {
                // Errors need more reading time than success toasts
                toast.error(message, { duration: 4000 });
            } else if (type === "info") {
                toast.info(message, { duration: 2600 });
            } else {
                toast.success(message, { duration: 2200 });
            }
        };
        const handleAuthExpired = () => {
            // If we have no user session yet (boot / reload), a 401 is expected
            // during backend cold start — don't kick to landing page.
            setUser((prev) => {
                if (!prev) return prev; // no session to expire
                // First 401 on a logged-in user: might be a cold-start blip.
                // Only actually expire after 3 consecutive 401s (~15s of retries).
                authExpiredCountRef.current++;
                if (authExpiredCountRef.current < 3) {
                    logger.warn("auth:expired — possible cold-start blip, keeping session", {
                        count: authExpiredCountRef.current,
                    });
                    return prev;
                }
                // Genuinely expired — clear everything.
                authExpiredCountRef.current = 0;
                setTab("home");
                setBadgeCount(0);
                setChatBadgeCount(0);
                setConversations([]);
                setRequestedFollows({});
                setSelectedUserUsername("");
                setSinglePostSlug(null);
                setAutoOpenComments(false);
                setActiveConversationId(null);
                setCommunityToOpen(null);
                conversationsFetchedRef.current = false;
                teardownActiveCall();
                if (socketRef.current) {
                    socketRef.current.disconnect();
                    socketRef.current = null;
                }
                setSocket(null);
                socketUserIdRef.current = null;
                stopCacheRefreshTimer();
                return null;
            });
            // NOTE: deliberately do NOT clearAllCaches() here. This handler can fire
            // on a transient failure (e.g. free-tier backend cold start), and wiping
            // CacheStorage + IndexedDB would erase all the offline-first data that
            // makes reloads instant. Caches are only cleared on an explicit logout.
        };
        window.addEventListener("showToast", handleShowToast as EventListener);
        window.addEventListener("auth:expired", handleAuthExpired);
        return () => {
            window.removeEventListener(
                "showToast",
                handleShowToast as EventListener,
            );
            window.removeEventListener("auth:expired", handleAuthExpired);
        };
    }, []);

    // ─── Offline-first: initialise sync engine ─────────────────────
    useOfflineSync();	// ─── Dark mode only + color theme ─────────────────────────────
    // The app is dark-only by design — always apply the dark class on mount.
    // Initial theme application happens synchronously in main.tsx (pre-
    // mount boot) to avoid a flash; this effect keeps the attribute in
    // sync when the user switches themes at runtime.
    useEffect(() => {
        document.documentElement.classList.add("dark");
    }, []);
    useEffect(() => {
        document.documentElement.setAttribute("data-theme", colorTheme);
    }, [colorTheme]);

    // NOTE: keyboard shortcuts were removed by design — the app is
    // gesture-first. See docs/GESTURES.md for the full interaction guide.

    // Hashtag tap → open the Explore tab and search that hashtag. Fired by
    // the shared renderHashtagTags utility (posts, comments, chat messages)
    // and the trending-hashtag chips in Explore.
    useEffect(() => {
        const handleSearchHashtag = (e: Event) => {
            const tag = (e as CustomEvent)?.detail?.hashtag as string | undefined;
            if (!tag) return;
            setExploreSearch((prev) => ({
                query: `#${tag.startsWith("#") ? tag.slice(1) : tag}`,
                nonce: prev.nonce + 1,
            }));
            setTab("explore");
        };
        window.addEventListener("searchHashtag", handleSearchHashtag);
        return () => window.removeEventListener("searchHashtag", handleSearchHashtag);
    }, []);

    // Inject shimmer animation keyframes for suggestion skeletons
    // The shimmer sweep (background-position) is on each .shimmer-bg child,
    // while the stagger delay is passed via a CSS custom property from the parent row.
    useEffect(() => {
        const styleId = "shimmer-skeleton-style";
        if (!document.getElementById(styleId)) {
            const style = document.createElement("style");
            style.id = styleId;
            style.textContent = `
				@keyframes shimmer {
					0% { background-position: 200% 0; opacity: 0.6; }
					50% { opacity: 1; }
					100% { background-position: -200% 0; opacity: 0.6; }
				}
				.shimmer-bg {
					background: linear-gradient(
						90deg,
						rgba(39, 39, 42, 0.6) 0%,
						rgba(63, 63, 70, 0.6) 40%,
						rgba(82, 82, 91, 0.3) 50%,
						rgba(63, 63, 70, 0.6) 60%,
						rgba(39, 39, 42, 0.6) 100%
					);
					background-size: 200% 100%;
					animation: shimmer 1.5s ease-in-out infinite;
					animation-delay: var(--shimmer-delay, 0s);
				}
			`;
            document.head.appendChild(style);
        }
    }, []);

    // Dynamic page title based on current tab — improves UX and browser history
    useEffect(() => {
        const tabTitles: Record<string, string> = {
            home: "Home Feed",
            explore: "Explore",
            notifications: "Notifications",
            chat: "Messages",
            communities: "Communities",
            profile: "Profile",
            settings: "Settings",
            saved: "Saved Posts",
            reposts: "Your Reposts",
        };
        const tabName = tabTitles[currentTab] || "Home Feed";
        document.title = user
            ? `ORBIT | ${tabName} — @${user.username}`
            : currentTab === "home"
              ? "ORBIT | Your Inner Circle"
              : `ORBIT | ${tabName}`;
    }, [currentTab, user]);

    // Calculate total unread chat messages.
    // Gated on conversationsFetchedRef so the persisted badge value survives the
    // brief window after a reload where `conversations` is still empty (network
    // not yet returned). Once the server responds, this recomputes the true value.
    // `wasLoggedInRef` guards the initial mount: on a fresh reload `user` is null
    // until checkSession resolves, so we must NOT zero the restored badge then.
    const wasLoggedInRef = useRef(false);
    useEffect(() => {
        if (!user) {
            // Only zero when this is a genuine logout (previously logged in), not on
            // the very first render before the session check resolves.
            if (wasLoggedInRef.current) setChatBadgeCount(0);
            return;
        }
        wasLoggedInRef.current = true;
        if (!conversationsFetchedRef.current) return;
        const total = conversations.reduce((sum, conv) => {
            return sum + (conv.unreadCounts?.[user._id] || 0);
        }, 0);
        setChatBadgeCount(total);
    }, [conversations, user]);

    // Persist badge counts so a reload (or hard reload) restores them instantly.
    // localStorage is synchronous — no network, no flash of zero.
    useEffect(() => {
        try {
            localStorage.setItem("orbit_notif_badge", String(badgeCount));
        } catch {
            /* storage unavailable — non-critical */
        }
    }, [badgeCount]);

    useEffect(() => {
        try {
            localStorage.setItem("orbit_chat_badge", String(chatBadgeCount));
        } catch {
            /* storage unavailable — non-critical */
        }
    }, [chatBadgeCount]);

    // Deep-link states — the app has no URL slugs, so these start empty and
    // are driven purely by in-app navigation.
    const [selectedUserUsername, setSelectedUserUsername] = useState("");
    const [singlePostSlug, setSinglePostSlug] = useState<string | null>(
        null,
    );
    const [autoOpenComments, setAutoOpenComments] = useState(false);

    // Security Form View Controller
    const [forgotPasswordOpen, setForgotPasswordOpen] = useState(false);
	const [featureFlags, setFeatureFlags] = useState<Record<string, boolean>>({});

    // Signup-first mode (from Get Started / Enter Social Hub)
    const [showSignupForm, setShowSignupForm] = useState(false);
    // First-run device-permission onboarding — shown once per account
    const [showPermissionOnboarding, setShowPermissionOnboarding] =
        useState(false);
    // Public read-only feed mode (from Explore Public Feed)
    const [publicFeedMode, setPublicFeedMode] = useState(false);

    // Suggestion parameters
    const [suggestions, setSuggestions] = useState<User[]>([]);
    const [followingStates, setFollowingStates] = useState<
        Record<string, boolean>
    >({});
    const [loadingSuggestions, setLoadingSuggestions] = useState(false);

    // Call State (WebRTC audio/video calls)
    const [callState, setCallState] = useState<{
        type: "audio" | "video";
        status: "outgoing" | "incoming" | "active";
        partnerId: string;
        partnerName: string;
        partnerAvatar?: string;
        callerId?: string;
        calleeId?: string;
    } | null>(null);

    // ICE connection state for monitoring network handoffs (WiFi → cellular, etc.)
    const [iceConnectionState, setIceConnectionState] = useState<
        RTCIceConnectionState | "new"
    >("new");

    // Ref to track call partner ID for ICE restart signaling
    const callPartnerIdRef = useRef<string | null>(null);
    // Ring timeout ref — fires when the callee doesn't answer in time
    const callRingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    // Tracks whether the current call was answered (clears the ring timeout)
    const callAnsweredRef = useRef(false);
    // Live mirror of callState for event handlers (avoids stale closures
    // when checking whether the user is already in a call). Kept in sync
    // via useEffect — avoids ref writes during render.
    const callStateRef = useRef(callState);
    useEffect(() => {
        callStateRef.current = callState;
    }, [callState]);
    // Refs for async call acceptance (prevents stale closure issues)
    const callAcceptDataRef = useRef<{
        partnerId: string;
        type: "audio" | "video";
    } | null>(null);
    // Timer ref for delayed ICE restart on temporary disconnects
    const iceRestartTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    // Timer ref for debounced suggestions fetch after follow/unfollow
    const followFetchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

    // ─── Shared call teardown ──────────────────────────────────────────
    // Releases every call resource: ring timeout, ICE-restart timer,
    // peer connection (incl. bitrate monitor), media tracks, and call state.
    // Used by logout, session-expiry, and call-end paths.
    const teardownActiveCall = () => {
        if (callRingTimeoutRef.current) {
            clearTimeout(callRingTimeoutRef.current);
            callRingTimeoutRef.current = null;
        }
        if (iceRestartTimeoutRef.current) {
            clearTimeout(iceRestartTimeoutRef.current);
            iceRestartTimeoutRef.current = null;
        }
        if (peerConnectionRef.current) {
            try {
                const cleanup = (peerConnectionRef.current as any)
                    .__bitrateMonitorCleanup;
                if (typeof cleanup === "function") cleanup();
            } catch {
                /* best-effort */
            }
            try {
                peerConnectionRef.current.close();
            } catch {
                /* already closed */
            }
            peerConnectionRef.current = null;
        }
        if (localStreamRef.current) {
            localStreamRef.current.getTracks().forEach((t) => t.stop());
            localStreamRef.current = null;
        }
        remoteStreamRef.current = null;
        pendingCallOfferRef.current = null;
        pendingIceCandidatesRef.current = [];
        callPartnerIdRef.current = null;
        callAnsweredRef.current = false;
        setIceConnectionState("closed");
        setCallState(null);
    };

    // ── Browser-history navigation (back/forward support) ───────────────
    // The app is an SPA with pure state-based navigation. Without history
    // entries the browser/OS back button exits the app instead of stepping
    // back through tabs/profiles/posts. Every navigation-state change pushes
    // a snapshot onto the history stack; `popstate` restores it. The in-app
    // back arrow routes through history.back() so both stacks stay in sync;
    // pressing back past the root entry exits the app (expected behavior).
    //
    // navStackRef mirrors the pushed snapshots in order; navPos is the depth
    // (1 = only the root entry). Pushing truncates any stale forward entries
    // (browser-forward past a re-navigation would otherwise re-apply a view
    // the user already left). lastPushedKeyRef holds the key of the snapshot
    // currently represented by the browser history top — the sync effect
    // skips when state matches it, which also prevents popstate-restored
    // snapshots from being re-pushed (feedback loop).
    const navStackRef = useRef<
        Array<{
            tab: string;
            slug: string | null;
            user: string;
            conv: string | null;
            community: string | null;
        }>
    >([]);
    const navPosRef = useRef(0);
    const [navPos, setNavPos] = useState(0);
    const lastPushedKeyRef = useRef<string | null>(null);
    const navReadyRef = useRef(false);
    // The tab the app boots into (from localStorage) — the root entry.
    const rootTabRef = useRef(currentTab);

    // Keep the history stack in sync with the navigation state. The first run
    // records the root snapshot WITHOUT pushing (the page's own entry is the
    // root); every subsequent real change pushes a new entry.
    useEffect(() => {
        const snap = {
            tab: currentTab,
            slug: singlePostSlug,
            user: selectedUserUsername,
            // Conversation/community sub-views — gated to their tab so a back
            // press inside a chat/community closes the thread (not the app).
            conv: currentTab === "chat" ? activeConversationId : null,
            community:
                currentTab === "communities" ? communityToOpen : null,
        };
        const key = JSON.stringify(snap);
        if (!navReadyRef.current) {
            navReadyRef.current = true;
            navStackRef.current = [snap];
            navPosRef.current = 1;
            lastPushedKeyRef.current = key;
            setNavPos(1);
            return;
        }
        if (key === lastPushedKeyRef.current) return; // no real change
        // Drop any forward entries, then append this snapshot.
        navStackRef.current = [
            ...navStackRef.current.slice(0, navPosRef.current),
            snap,
        ];
        navPosRef.current = navStackRef.current.length;
        lastPushedKeyRef.current = key;
        setNavPos(navPosRef.current);
        window.history.pushState({ orbitNav: true, ...snap }, "");
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
        currentTab,
        singlePostSlug,
        selectedUserUsername,
        activeConversationId,
        communityToOpen,
    ]);

    // Restore the app's view when the user presses browser/OS back (or
    // forward). Snapshots pushed by this app carry `orbitNav: true`; the
    // page's own root entry has no marker — popping to it resets to the boot
    // tab and the NEXT back press exits the app.
    useEffect(() => {
        const onPopState = (e: PopStateEvent) => {
            const s = e.state as any;
            if (s && s.orbitNav) {
                const snap = {
                    tab: typeof s.tab === "string" ? s.tab : "home",
                    slug: typeof s.slug === "string" ? s.slug : null,
                    user: typeof s.user === "string" ? s.user : "",
                    conv: typeof s.conv === "string" ? s.conv : null,
                    community:
                        typeof s.community === "string" ? s.community : null,
                };
                const key = JSON.stringify(snap);
                const idx = navStackRef.current.findIndex(
                    (x) => JSON.stringify(x) === key,
                );
                navPosRef.current = idx >= 0 ? idx + 1 : Math.max(1, navPosRef.current - 1);
                lastPushedKeyRef.current = key; // restored state is now the "current" one
                setNavPos(navPosRef.current);
                setTab(snap.tab);
                setSinglePostSlug(snap.slug);
                setSelectedUserUsername(snap.user);
                setActiveConversationId(snap.conv);
                setCommunityToOpen(snap.community);
                if (!snap.slug) setAutoOpenComments(false);
            } else {
                // Root entry — reset to the boot tab; the next back exits.
                const rootSnap = {
                    tab: rootTabRef.current,
                    slug: null,
                    user: "",
                    conv: null,
                    community: null,
                };
                lastPushedKeyRef.current = JSON.stringify(rootSnap);
                navPosRef.current = 0;
                setNavPos(0);
                setTab(rootTabRef.current);
                setSinglePostSlug(null);
                setSelectedUserUsername("");
                setActiveConversationId(null);
                setCommunityToOpen(null);
                setAutoOpenComments(false);
            }
        };
        window.addEventListener("popstate", onPopState);
        return () => window.removeEventListener("popstate", onPopState);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Hashtag tapped anywhere → Explore searches it (driven by the
    // `searchHashtag` window event dispatched from renderHashtagTags).
    // A nonce increments on EVERY tap so tapping the same hashtag twice (or
    // after the user manually changed the Explore search) still re-searches.
    const [exploreSearch, setExploreSearch] = useState<{
        query: string;
        nonce: number;
    }>({ query: "", nonce: 0 });

    // Admin kill-switch gate for whole tabs/features — when a feature is
    // switched off platform-wide, navigation to it bounces back to home with
    // a toast (admins are exempt so the god can always verify the switch).
    const GATED_TABS: Record<string, string> = {
        chat: "chats_enabled",
        glances: "glances_enabled",
        communities: "communities_enabled",
        compose: "posts_enabled",
    };

    const navigateToTab = useCallback(
        (newTab: string) => {
            const gate = GATED_TABS[newTab];
            if (gate && !isFeatureOn(gate) && !user?.isAdmin) {
                toast("This feature is temporarily disabled", {
                    description: "The admin has turned it off for now.",
                });
                return;
            }
            // Tab changes are mirrored onto the browser history by the nav
            // sync effect (back/forward support) — no manual stack needed.
            setTab(newTab);
            // Only refresh suggestions when navigating to tabs that display them
            if (newTab === "home" || newTab === "explore") {
                fetchSuggestions();
            }
        },
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [user?.isAdmin],
    );

    // Callback for Profile to sync followingStates from server data
    const handleProfileLoaded = (profileId: string, followingByMe: boolean) => {
        setFollowingStates((prev) => ({
            ...prev,
            [profileId]: followingByMe,
        }));
    };

    // Auto session checker on mount.
    // Stale-while-revalidate: paint the conversation list from the local cache
    // (CacheStorage, then Dexie — primed at login and kept warm every 30s) the
    // moment a session exists, so returning users see their chats INSTANTLY on
    // reload — no waiting on the network for data already on-device. The server
    // is always reconciled right after (fresh unread counts + last messages
    // replace the cached copy when the response lands). `bypass` skips the
    // cached paint entirely (used after a cache wipe, e.g. block/unblock).
    const fetchConversations = async (bypass: boolean = false) => {
        try {
            if (!bypass) {
                // 1) Instant paint from local cache — no network round-trip.
                let cached: {
                    success: boolean;
                    conversations?: Conversation[];
                } | null = null;
                try {
                    cached = await getCachedResponse(
                        "/api/chats/conversations",
                    );
                    if (!cached?.conversations) {
                        // CacheStorage missed → try the Dexie structured layer
                        // (same shape: { success, conversations }).
                        cached = (await getOfflineFallback(
                            "/api/chats/conversations",
                        )) as { success: boolean; conversations?: Conversation[] } | null;
                    }
                } catch {
                    /* cache read failures are non-critical */
                }
                if (cached?.conversations) {
                    setConversations(cached.conversations);
                    setConversationsLoading(false);
                    conversationsFetchedRef.current = true;
                    // 2) Reconcile with the server in the background — fresh
                    // copy replaces the cached one when it lands.
                    void (async () => {
                        try {
                            const res = await apiFetch(
                                "/api/chats/conversations",
                                { bypassCache: true },
                            );
                            const data = await res.json();
                            if (res.ok && data.success) {
                                setConversations(data.conversations || []);
                                conversationsFetchedRef.current = true;
                            }
                        } catch (e) {
                            logger.error(
                                "Failed to reconcile conversations",
                                e,
                            );
                        }
                    })();
                    return;
                }
            }

            // No cached copy (or explicit bypass) → normal network fetch,
            // which also writes CacheStorage + Dexie for next time.
            const res = await apiFetch(
                "/api/chats/conversations",
                { bypassCache: true },
            );
            const data = await res.json();
            if (res.ok && data.success) {
                setConversations(data.conversations || []);
                // Mark as fetched so the derived chat badge uses server data
                // (not the persisted value) from now on.
                conversationsFetchedRef.current = true;
            }
            setConversationsLoading(false);
        } catch (err) {
            logger.error("Failed to load conversations", err);
            setConversationsLoading(false);
        }
    };

    // A forward to a user creates/updates a 1:1 conversation on the server —
    // refresh the conversation list so the new chat appears immediately (the
    // recipient also gets it via socket `chat:notification`).
    useEffect(() => {
        const handleConversationsRefresh = () => {
            fetchConversations(true);
        };
        window.addEventListener(
            "chatConversationsRefresh",
            handleConversationsRefresh,
        );
        return () =>
            window.removeEventListener(
                "chatConversationsRefresh",
                handleConversationsRefresh,
            );
    }, []);

    const fetchFeatureFlags = async () => {
		try {
			const res = await apiFetch(`/api/admin/flags/mine`);
			const data = await res.json();
			if (res.ok && data.success) {
				setFeatureFlags(data.flags || {});
				setFeatureGates(data.flags || {});
			}
		} catch (err) {
			logger.warn("Failed to fetch feature flags", err);
		}
	};    const checkSession = async () => {
		try {
            // Cache-first on purpose: an offline reload must still restore the
            // session from the cached user (the app is offline-first). The cache
            // is kept honest by evictAffectedCaches — /api/auth/me is evicted
            // whenever permissions or the profile change, so the reload after a
            // completed onboarding never serves the stale pre-onboarding flag.
            const res = await apiFetch("/api/auth/me");
            const data = await res.json();
            if (res.ok && data.success && data.user) {
                setUser(data.user);
                authExpiredCountRef.current = 0; // session valid — reset 401 counter
                // Pass the JWT explicitly: the socket connects straight to the
                // backend origin (Render) — cross-origin from the Vercel app —
                // where the httpOnly vercel.app cookie never travels. Without
                // auth.token the socket handshake is UNAUTHENTICATED, which
                // silently kills presence, seen-ticks and realtime messages.
                connectSockets(data.user._id, data.token || "");
                // fetchBadgeCounts bypasses so fresh counts replace the persisted
                // (possibly stale) values; fetchConversations is cache-first
                // (stale-while-revalidate) so the chat list paints INSTANTLY
                // from local cache on reload, then reconciles with the server.
                fetchBadgeCounts(true); // fetch initial badge counts
                fetchConversations();				fetchFollowing(data.user._id);
				void fetchFeatureFlags();
				// Re-prime the offline caches on session restore too (delayed, so
                // the critical fetches above win) — keeps CacheStorage + Dexie
                // fresh with the returning user's latest data.
                setTimeout(() => void primeOfflineCache(data.user._id), 2500);
                // Re-sync the device push subscription on reload (no prompt — only
                // acts if permission was already granted), so returning users keep
                // receiving real on-device notifications.
                ensurePushSubscription();
                // Existing users who never completed the one-time permission
                // onboarding get it on their next session restore (once ever).
                if (!data.user?.permissionOnboardingCompleted) {
                    setShowPermissionOnboarding(true);
                }

                // Background reconcile — the apiFetch above is cache-first
                // (instant boot from CacheStorage/Dexie, even offline), so an
                // admin promoting/verifying/muting this account on another
                // device changes isAdmin etc. server-side but the STALE cached
                // user keeps being served on every reload — the Admin tab,
                // verified badge, muted notices would only appear after the
                // 30s refresh cycle happened to update the cache AND another
                // reload read it. Re-fetch the authoritative user from the
                // network right after boot and apply it, so admin changes land
                // on the next app open without waiting out the client cache.
                void (async () => {
                    try {
                        const freshRes = await apiFetch("/api/auth/me", {
                            bypassCache: true,
                        });
                        const freshData = await freshRes.json();
                        if (
                            freshRes.ok &&
                            freshData.success &&
                            freshData.user
                        ) {
                            setUser(freshData.user);
                        }
                    } catch (e) {
                        // Offline — the cached session stands until
                        // connectivity returns.
                        logger.warn(
                            "Session reconcile failed (offline?)",
                            e,
                        );
                    }
                })();
            }
        } catch (e) {
            logger.warn("Session check failed", e);
        } finally {
        }
    };

    // Fetch user's following list
    const fetchFollowing = async (userId: string) => {
        try {
            const res = await apiFetch(
                `/api/follows/${userId}/following?limit=100`,
            );
            const data = await res.json();
            if (res.ok && data.success) {
                const states: Record<string, boolean> = {};
                (data.following || []).forEach(
                    (f: { following?: { _id: string }; _id?: string }) => {
                        const followedUser = f.following || f;
                        if (followedUser._id) states[followedUser._id] = true;
                    },
                );
                // MERGE (never replace): the server list is authoritative for the
                // users it contains, but replacing the whole map would wipe
                // optimistic/known states for everyone else (and drop anyone beyond
                // the first 100), making Follow buttons flip back until a refetch.
                setFollowingStates((prev) => ({ ...prev, ...states }));
            }
        } catch (err) {
            logger.warn("Failed retrieving following list", err);
        }
    };

    const fetchSuggestions = async () => {
        setLoadingSuggestions(true);
        try {
            const res = await apiFetch("/api/users/suggestions");
            const data = await res.json();
            if (res.ok && data.success) {
                setSuggestions(data.users || []);
                // Update following states if any are already followed
                const states: Record<string, boolean> = {};
                (data.users || []).forEach((u: User) => {
                    states[u._id] = false;
                });
                setFollowingStates((prev) => ({
                    ...states,
                    ...prev,
                }));
            }
        } catch (err) {
            logger.warn("Failed retrieving suggestions vectors", err);
        } finally {
            setLoadingSuggestions(false);
        }
    };

    // Follow requests sent to PRIVATE accounts (pending owner approval).
    // Kept separate from followingStates so buttons can show "Requested"
    // instead of lying with a "Following" state the server never accepted.
    const [requestedFollows, setRequestedFollows] = useState<
        Record<string, boolean>
    >({});

    // Toggle follow. Resolves with { requested: true } when the target is a
    // private account and a follow REQUEST was sent instead of a follow, so
    // callers (Profile) can roll back their optimistic local state.
    const onToggleFollow = async (
        userId: string,
    ): Promise<void | { requested: boolean }> => {
        const isCurrentlyFollowing = !!followingStates[userId];

        // 1. Optimistic Update: Toggle state immediately
        setFollowingStates((prev) => ({
            ...prev,
            [userId]: !isCurrentlyFollowing,
        }));
        setUser((prev) =>
            prev
                ? {
                      ...prev,
                      followingCount: !isCurrentlyFollowing
                          ? (prev.followingCount || 0) + 1
                          : Math.max(0, (prev.followingCount || 0) - 1),
                  }
                : null,
        );

        try {
            const res = await apiFetch(`/api/follows/${userId}`, {
                method: "POST",
            });
            const data = await res.json();
            if (res.ok && data.success) {
                // PRIVATE account → the server created a follow REQUEST, not a
                // follow. Undo the optimistic follow + followingCount and mark the
                // user as "requested" so the button shows that state. Clicking
                // "Requested" again CANCELS the request (data.requested === false).
                if (data.isPrivate) {
                    setFollowingStates((prev) => ({
                        ...prev,
                        [userId]: false,
                    }));
                    setRequestedFollows((prev) => ({
                        ...prev,
                        [userId]: !!data.requested,
                    }));
                    setUser((prev) =>
                        prev
                            ? {
                                  ...prev,
                                  followingCount: Math.max(
                                      0,
                                      (prev.followingCount || 0) - 1,
                                  ),
                              }
                            : null,
                    );
                    window.dispatchEvent(
                        new CustomEvent("showToast", {
                            detail: {
                                message: data.message || "Follow request sent",
                                type: "success",
                            },
                        }),
                    );
                    return { requested: !!data.requested };
                }

                // 2. Synchronize with backend response. NOTE: followingCount
                // is NOT adjusted here — the optimistic update above already
                // flipped it by ±1, and applying another ±1 against the
                // already-updated value double-counts (follow → +2 in-session,
                // which then "resets" on reload when /api/auth/me serves the
                // evicted-fresh count). The optimistic value is authoritative
                // for the success case; failure/private paths handle their own
                // rollbacks below.
                setFollowingStates((prev) => ({
                    ...prev,
                    [userId]: data.following,
                }));
                setRequestedFollows((prev) => ({ ...prev, [userId]: false }));
                // Following/unfollowing changes what the user's feed contains
                // (posts from newly followed users appear; posts from
                // unfollowed users disappear) — nudge the mounted feed to
                // refetch immediately instead of waiting for a cache TTL.
                window.dispatchEvent(new CustomEvent("forceFeedRefresh"));
            } else {
                throw new Error(
                    data.message || "Failed to update follow status",
                );
            }
        } catch (err: any) {
            logger.error("Failed to toggle follow", err);

            // 3. Rollback on failure
            setFollowingStates((prev) => ({
                ...prev,
                [userId]: isCurrentlyFollowing,
            }));
            setUser((prev) =>
                prev
                    ? {
                          ...prev,
                          followingCount: isCurrentlyFollowing
                              ? (prev.followingCount || 0) + 1
                              : Math.max(0, (prev.followingCount || 0) - 1),
                      }
                    : null,
            );

            // 4. Dispatch showToast event
            window.dispatchEvent(
                new CustomEvent("showToast", {
                    detail: {
                        message:
                            err.message ||
                            "Follow request failed. Please try again.",
                        type: "error",
                    },
                }),
            );
            throw err;
        }
    };

    // Get unread notification count from dedicated endpoint (cached server-side)
    // `bypass` forces a network fetch — used after reload/login so the persisted
    // badge is reconciled with the server's authoritative count immediately.
    const fetchBadgeCounts = async (bypass: boolean = false) => {
        try {
            const res = await apiFetch(
                "/api/notifications/unread-count",
                bypass ? { bypassCache: true } : undefined,
            );
            const data = await res.json();
            if (res.ok && data.success) {
                setBadgeCount(data.unreadCount);
            }
        } catch (e) {
            logger.error(e);
        }
    };

    // Track previous user value to detect actual login/logout (not incremental followingCount changes)
    const prevUserRef = useRef(user);

    // Handle OAuth callback redirect (Google Sign-In)
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const oauthCode = params.get("oauth_code");
        const oauthSuccess = params.get("oauth_success");
        const oauthError = params.get("oauth_error");

        // Community invite deep link (?invite=<code>): open the Communities
        // tab so its mount effect picks up the code and auto-joins.
        if (params.get("invite")) {
            setTab("communities");
        }

        // Preferred completion path: the callback redirects here with a
        // one-time code (no reliance on the redirect-set cookies, which
        // mobile browsers drop). Exchange it via a normal XHR — the exact
        // channel /api/auth/login uses — so the JWT cookie lands reliably
        // on every device, then log in with the returned user + token.
        if (oauthCode) {
            (async () => {
                try {
                    const res = await apiFetch("/api/auth/oauth-exchange", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ code: oauthCode }),
                    });
                    const data = await res.json();
                    if (res.ok && data.success) {
                        handleAuthSuccess(data.user, data.token);
                    } else {
                        // Code invalid/expired. The callback may still have
                        // set cookies on desktop (where redirect cookies
                        // survive) — fall back to a session check.
                        window.dispatchEvent(
                            new CustomEvent("showToast", {
                                detail: {
                                    message:
                                        data.message ||
                                        "Google Sign-In failed. Please try again.",
                                    type: "error",
                                },
                            }),
                        );
                        checkSession().finally(() => setSessionChecked(true));
                    }
                } catch (e) {
                    // Network hiccup — a session check will pick up the
                    // cookie if the callback set one.
                    checkSession().finally(() => setSessionChecked(true));
                } finally {
                    // Clean up URL query params without full page reload
                    window.history.replaceState(
                        {},
                        document.title,
                        window.location.pathname,
                    );
                }
            })();
            return;
        }

        if (oauthSuccess === "true") {
            // Legacy path: JWT cookie was already set by the backend on
            // redirect — re-check session.
            checkSession().finally(() => setSessionChecked(true));
            // Clean up URL query params without full page reload
            window.history.replaceState(
                {},
                document.title,
                window.location.pathname,
            );
            return;
        }

        if (oauthError === "true") {
            window.dispatchEvent(
                new CustomEvent("showToast", {
                    detail: {
                        message: "Google Sign-In failed. Please try again.",
                        type: "error",
                    },
                }),
            );
            window.history.replaceState(
                {},
                document.title,
                window.location.pathname,
            );
        }
    }, []);

    useEffect(() => {
        checkSession().finally(() => setSessionChecked(true));
        return () => {
            if (socketRef.current?.connected) {
                socketRef.current.disconnect();
                socketRef.current = null;
                setSocket(null);
            }
        };
    }, []);

    // Records the user id whose private data currently lives in the client
    // caches (CacheStorage + IndexedDB). Client caches are keyed by URL only,
    // NOT by account — so when a session dies (auth:expired) without an explicit
    // logout and a DIFFERENT account signs in, the new account must not read the
    // previous account's cached saves/notifications/chats/feed.
    const lastCachedUserIdRef = useRef<string | null>(null);

    useEffect(() => {
        const prevUser = prevUserRef.current;
        // Update ref AFTER comparison so it holds the previous value during next render
        prevUserRef.current = user;

        // Only fetch on actual login/logout transitions, not incremental followingCount changes
        if (prevUser && !user) {
            // User logged out
            setSuggestions([]);
        } else if (user && !prevUser) {
            // User logged in — fetch suggestions
            fetchSuggestions();
        }

        if (user) {
            const uid = String(user._id);
            // Clear whenever a DIFFERENT account's data may be cached. On the very
            // first hydration lastCachedUserIdRef is null, so nothing is wiped —
            // this preserves the offline-first reload behavior (caches survive
            // transient cold-start 401s). After an auth:expired the previous
            // account's id is still recorded, so the next DIFFERENT account wipes
            // it before any of its data can be served from cache.
            if (
                lastCachedUserIdRef.current !== null &&
                lastCachedUserIdRef.current !== uid
            ) {
                clearAllCaches().catch(() => {});
            }
            lastCachedUserIdRef.current = uid;
        }
    }, [user]);

    // Set up socket connections
    const connectSockets = async (userId: string, token: string = "") => {
        // Prevent multiple socket connections for the SAME user
        if (
            socketRef.current?.connected &&
            socketUserIdRef.current === userId
        ) {
            logger.info(
                "Socket already connected for this user, skipping reconnection",
            );
            return;
        }

        // Disconnect existing socket if any
        if (socketRef.current) {
            socketRef.current.disconnect();
            socketRef.current = null;
            setSocket(null);
        }

        socketUserIdRef.current = userId;

        // In production, connect directly to the backend server
        // In dev, connect to current host origin (which Vite dev server proxies for websocket)
        // resolveApiBase() strips a trailing "/api" so the socket connects to the
        // server root (where /socket.io/ lives), not ".../api/socket.io/...".
        const socketUrl = import.meta.env.PROD
            ? import.meta.env.VITE_SOCKET_URL ||
              (import.meta.env.VITE_API_URL ? resolveApiBase() : "")
            : window.location.origin;

        // Warm the connection to the realtime origin (Render) before the
        // socket handshake — preconnect resolves DNS + TLS in parallel with
        // the app's first paint, so the chat/call/notification socket comes
        // up noticeably faster on cold starts.
        if (socketUrl && typeof document !== "undefined") {
            try {
                const origin = new URL(socketUrl).origin;
                if (origin !== window.location.origin) {
                    const link = document.createElement("link");
                    link.rel = "preconnect";
                    link.href = origin;
                    link.crossOrigin = "anonymous";
                    document.head.appendChild(link);
                }
            } catch {
                /* invalid URL — skip preconnect */
            }
        }

        // Skip socket connection if no socket URL configured (e.g. frontend-only Vercel deploy)
        if (!socketUrl) {
            logger.warn(
                "[ORBIT SOCKET] No VITE_SOCKET_URL or VITE_API_URL configured — skipping connection. Real-time features disabled.",
            );
            return;
        }

        logger.info("[ORBIT SOCKET] Connecting to:", { socketUrl });

        // Load the socket client lazily — keeps ~40 KB gzip out of the initial
        // bundle (the landing page and logged-out users never need it).
        const { io } = await import("socket.io-client");

        const socket = io(socketUrl, {
            auth: token ? { token } : undefined,
            transports: ["polling", "websocket"],
            withCredentials: true,
            reconnection: true,
            reconnectionAttempts: Infinity,
            reconnectionDelay: 1000,
            reconnectionDelayMax: 30000,
        });

        socketRef.current = socket;
        setSocket(socket);
        // ── Universal realtime persistence ──
        // Every socket event (live or replayed by events:sync) is funneled
        // through applyRealtimeEvent, which upserts the entity into Dexie
        // and evicts the affected CacheStorage URLs. This is what makes
        // realtime data survive reloads and show up in every view.
        socket.onAny((event, payload) => {
            // Track the cursor for the next events:sync.
            lastRealtimeTsRef.current = Date.now();
            try {
                localStorage.setItem(
                    "orbit:rt-since",
                    String(lastRealtimeTsRef.current),
                );
            } catch {
                // Storage full/blocked — cursor still works in-session.
            }
            void applyRealtimeEvent(event, payload);
        });

        socket.on("connect", () => {
            logger.info("[ORBIT SOCKET] Connected successfully", {
                socketId: socket.id,
                userId,
            });

            // ── Reconnect backfill: request everything we missed ──
            // The server logs user-scoped realtime events (messages,
            // notifications, follows, community changes) per user. On every
            // (re)connect we send the ts of the last event we processed and
            // the server re-emits everything newer through this socket — the
            // SAME handlers below run, so nothing needs a reload to appear.
            // Without this, an event emitted while the socket was dead
            // (phone backgrounded) was lost until 10-20 manual reloads.
            socket.emit("events:sync", {
                since: lastRealtimeTsRef.current,
            });

            // ── Reconnect list-refetch (broadcast backfill) ──
            // events:sync replays USER-SCOPED events (messages, notifications,
            // follows, community changes), but BROADCAST events (post:created,
            // post:comment, public community:created) are not per-user logged.
            // On every reconnect, refetch the key lists so broadcast content
            // missed while the socket was dead appears too — no reload needed.
            if (hasConnectedOnceRef.current) {
                logger.info("[ORBIT SOCKET] Reconnect — refetching broadcast lists");
                // Conversations + badges: user-scoped but the list embeds
                // lastMessage/unread state that events:sync may have missed.
                void fetchConversations(true);
                void fetchBadgeCounts(true);
                // Feed: catches post:created / post:updated / post:comment.
                window.dispatchEvent(new Event("forceFeedRefresh"));
                // Communities: catches public community:created / updated.
                window.dispatchEvent(
                    new CustomEvent("orbit:communities-refresh"),
                );
            } else {
                hasConnectedOnceRef.current = true;
            }

            // If we were in a call with a broken ICE connection, re-attempt ICE restart now
            // that the signaling channel is restored (network handoff recovery).
            // Read state directly from refs/PC to avoid stale closure captures.
            const currentPc = peerConnectionRef.current;
            const currentPartnerId = callPartnerIdRef.current;
            const pcIceState = currentPc?.iceConnectionState;
            if (
                currentPc &&
                currentPartnerId &&
                (pcIceState === "disconnected" || pcIceState === "failed")
            ) {
                logger.info(
                    "Socket reconnected during call with broken ICE — initiating ICE restart",
                );
                if (iceRestartTimeoutRef.current) {
                    clearTimeout(iceRestartTimeoutRef.current);
                    iceRestartTimeoutRef.current = null;
                }
                initiateIceRestart(currentPc, currentPartnerId);
            }

            // Mobile: when user returns to tab after phone was locked / app was backgrounded,
            // the WebSocket may have been killed. Visibility change forces proactive reconnect.
            const handleVisibility = () => {
                if (
                    document.visibilityState === "visible" &&
                    socketRef.current &&
                    !socketRef.current.connected
                ) {
                    logger.info(
                        "[ORBIT SOCKET] Tab became visible — reconnecting socket",
                    );
                    socketRef.current.connect();
                }
            };
            document.addEventListener("visibilitychange", handleVisibility);

            // Periodically send presence heartbeat so the server knows we're still online.
            // Without this, a brief network blip (e.g. mobile backgrounding) can cause the
            // user to fall out of the server's `onlineUsers` set, making them appear offline
            // to chat partners until a full page refresh.
            const presenceHeartbeatInterval = setInterval(() => {
                socket.emit("presence:heartbeat");
            }, 25000);

            // Clean up the listener and interval when socket disconnects
            socket.once("disconnect", () => {
                document.removeEventListener(
                    "visibilitychange",
                    handleVisibility,
                );
                clearInterval(presenceHeartbeatInterval);
            });
        });

        socket.on("disconnect", (reason) => {
            logger.warn("[ORBIT SOCKET] Disconnected:", { reason, userId });
        });

        socket.on("reconnect_attempt", (attempt) => {
            logger.warn("[ORBIT SOCKET] Reconnection attempt #" + attempt, {
                userId,
            });
        });

        socket.on("connect_error", (error) => {
            logger.error("[ORBIT SOCKET] Connection error:", error.message);
        });

        // Listen for message deletions from other users (or own action via personal room)
        // This handler lives in App.tsx (not just Chat.tsx) because Chat.tsx unmounts when
        // navigating away from the chat tab — without this handler, the conversations list
        // would not update until a page reload.
        socket.on("message:delete", ({ messageId }: { messageId: string }) => {
            logger.info("App: Received message:delete event", { messageId });
            setConversations((prev) =>
                prev.map((c) => {
                    if (c.lastMessage?._id === messageId) {
                        return {
                            ...c,
                            lastMessage: {
                                ...c.lastMessage,
                                isDeleted: true,
                                text: "This message was deleted",
                                attachments: [],
                            },
                        };
                    }
                    return c;
                }),
            );
        });

        // ── Realtime message updates when Chat.tsx is not mounted ──
        // Keeps conversations list sorted with latest message even when user is on another tab.
        // Unread counts are managed by the `chat:notification` event (server-authoritative)
        // and by Chat.tsx (active conversation → zero). Incrementing unreadCounts here
        // would race with those handlers, causing badge counts to desync from the server
        // and reappear on page refresh.
        socket.on("message:new", (message: any) => {
            logger.info("Received message:new in App.tsx", {
                messageId: message._id,
                conversationId: message.conversation,
            });
            setConversations((prev) => {
                const existing = prev.find(
                    (c) => c._id === message.conversation,
                );
                if (!existing) return prev;
                return prev
                    .map((c) => {
                        if (c._id === message.conversation) {
                            return {
                                ...c,
                                lastMessage: message,
                                // A fresh message supersedes any stale "reacted" preview
                                lastAction: null,
                                // Missed-call system messages set the red badge on
                                // the callee's chat list (WhatsApp-style).
                                missedCall:
                                    message.system === "call_missed"
                                        ? {
                                              for: message.recipient,
                                              by: message.sender?._id || "",
                                              callType: message.callType,
                                              createdAt: message.createdAt,
                                          }
                                        : c.missedCall,
                            };
                        }
                        return c;
                    })
                    .sort(
                        (a, b) =>
                            new Date(
                                b.lastMessage?.createdAt || b.updatedAt,
                            ).getTime() -
                            new Date(
                                a.lastMessage?.createdAt || a.updatedAt,
                            ).getTime(),
                    );
            });
        });

        // ── Realtime message reactions → update the chat list preview ──
        // When someone reacts to a message, the conversations list should show
        // the ACTION ("reacted ❤️ to your message") instead of the stale last
        // message. This handler lives in App.tsx because Chat.tsx unmounts when
        // navigating away — without it, the list would only update on reload.
        socket.on(
            "message:reaction",
            (payload: {
                messageId: string;
                reaction: any;
                type: "add" | "remove";
            }) => {
                logger.info("App: Received message:reaction event", {
                    messageId: payload.messageId,
                    type: payload.type,
                });
                setConversations((prev) => {
                    let changed = false;
                    const next = prev.map((c) => {
                        if (c.lastMessage?._id !== payload.messageId) return c;
                        changed = true;
                        // Only reactions ADDED to the newest message become the preview;
                        // removing one reverts to the last message preview naturally.
                        if (payload.type !== "add" || !payload.reaction) {
                            return { ...c, lastAction: null };
                        }
                        const sender = payload.reaction.sender;
                        const actor =
                            typeof sender === "string"
                                ? { _id: sender }
                                : {
                                      _id: sender?._id || "",
                                      fullName: sender?.fullName || "",
                                      username: sender?.username || "",
                                  };
                        return {
                            ...c,
                            lastAction: {
                                type: "reaction" as const,
                                emoji: payload.reaction.emoji || "",
                                messageId: payload.messageId,
                                messageSenderId:
                                    c.lastMessage.sender?._id || "",
                                actor,
                                createdAt: new Date().toISOString(),
                            },
                        };
                    });
                    if (!changed) return prev;
                    // Bubble the reacted conversation to the top like any recent activity
                    return [...next].sort(
                        (a, b) =>
                            new Date(
                                b.lastAction?.createdAt ||
                                    b.lastMessage?.createdAt ||
                                    b.updatedAt,
                            ).getTime() -
                            new Date(
                                a.lastAction?.createdAt ||
                                    a.lastMessage?.createdAt ||
                                    a.updatedAt,
                            ).getTime(),
                    );
                });
            },
        );

        // Helper to show native OS notification
        const showNativeNotif = (title: string, body: string) => {
            if (!("Notification" in window)) return;
            if (Notification.permission === "granted") {
                new Notification(title, {
                    body,
                    icon: "/icon-192.png",
                    badge: "/icon-192.png",
                });
            }
        };

        // ── Realtime user presence status changes ──
        socket.on(
            "user:presence",
            ({
                userId: presenceUserId,
                status,
            }: {
                userId: string;
                status: "online" | "offline";
            }) => {
                logger.info("[ORBIT DIAG] user:presence received", {
                    presenceUserId,
                    status,
                    uid,
                });
                setConversations((prev) =>
                    prev.map((c) => {
                        const other = c.participants.find(
                            (p) => p && p._id === presenceUserId,
                        );
                        if (other) {
                            return {
                                ...c,
                                presence: status as "online" | "offline",
                            };
                        }
                        return c;
                    }),
                );
            },
        );

        // ── Realtime chat notifications & badge increments ──
        socket.on(
            "chat:notification",
            (payload: {
                conversationId: string;
                message: any;
                unreadCount: number;
                conversation?: any;
            }) => {
                logger.info("Received chat:notification event", payload);
                setConversations((prev) => {
                    const existing = prev.find(
                        (c) => c._id === payload.conversationId,
                    );
                    // If the conversation doesn't exist yet, add it from the payload data
                    if (!existing && payload.conversation) {
                        const newConv = {
                            ...payload.conversation,
                            presence: "offline" as const,
                            unreadCounts: { [userId]: payload.unreadCount },
                            lastMessage: payload.message,
                            lastAction: null,
                        };
                        return [newConv, ...prev].sort(
                            (a, b) =>
                                new Date(
                                    b.lastMessage?.createdAt || b.updatedAt,
                                ).getTime() -
                                new Date(
                                    a.lastMessage?.createdAt || a.updatedAt,
                                ).getTime(),
                        );
                    }
                    const updated = prev.map((c) => {
                        if (c._id === payload.conversationId) {
                            return {
                                ...c,
                                lastMessage: payload.message,
                                lastAction: null,
                                unreadCounts: {
                                    ...c.unreadCounts,
                                    [userId]: payload.unreadCount,
                                },
                            };
                        }
                        return c;
                    });
                    return updated.sort(
                        (a, b) =>
                            new Date(
                                b.lastMessage?.createdAt || b.updatedAt,
                            ).getTime() -
                            new Date(
                                a.lastMessage?.createdAt || a.updatedAt,
                            ).getTime(),
                    );
                });
            },
        );

        // Listen for WebSocket events from server
        socket.on("admin:broadcast", (payload: any) => {
            window.dispatchEvent(
                new CustomEvent("orbit:broadcast", { detail: payload }),
            );
        });
        socket.on("admin:broadcast:clear", (payload: any) => {
            window.dispatchEvent(new CustomEvent("orbit:broadcast:clear", { detail: payload }));
        });
        // An admin changed THIS account on another device (isAdmin / verified
        // / muted / banned) — re-fetch the authoritative user so the UI
        // reflects it in real time: the Admin tab appears, the verified badge
        // updates, the muted notice shows — no reload needed.
        socket.on("user:updated", () => {
            void (async () => {
                try {
                    const res = await apiFetch("/api/auth/me", {
                        bypassCache: true,
                    });
                    const data = await res.json();
                    if (res.ok && data.success && data.user) {
                        setUser(data.user);
                    }
                } catch (e) {
                    logger.warn(
                        "Failed to refresh user after user:updated",
                        e,
                    );
                }
            })();
        });
        socket.on("notification", (payload: Notification) => {
            logger.info("Received notification event", payload);
            // 1. Increment inbox badge counter instantly
            setBadgeCount((prev) => prev + 1);

            // 1b. Play the in-app chime when sound is enabled (respects the
            //     NotificationSettings toggle mirrored in localStorage).
            //     Achievement unlocks and call events stay silent — the user
            //     is already inside the call UI when call notifications land,
            //     so ringing over the live call would be jarring.
            if (
                payload.type !== "badge_unlocked" &&
                !payload.type.startsWith("call_")
            ) {
                playNotificationChime();
            }

            // 2. Show native OS notification only when the tab is backgrounded
            //    (matches Instagram's approach — no in-app popups, only system notifications)
            if (document.hidden) {
                showNativeNotif(
                    payload.sender?.fullName || "Someone",
                    getNotificationText(
                        payload.type,
                        payload.sender?.fullName || payload.sender?.username,
                    ),
                );
            }

            // 2b. Achievement badges — quiet in-app toast only (no full-screen
            //     celebration, no chime). The event still fires so unlocked
            //     perks (themes etc.) apply immediately.
            if (payload.type === "badge_unlocked" && payload.badge) {
                const label = BADGE_MAP[payload.badge]?.label || payload.badge;
                window.dispatchEvent(
                    new CustomEvent("showToast", {
                        detail: {
                            message: `Achievement unlocked: ${label}!`,
                            type: "success",
                        },
                    }),
                );
                window.dispatchEvent(
                    new CustomEvent("achievementUnlocked", {
                        detail: { badge: payload.badge },
                    }),
                );
            }

            // 3. Refresh unread count from server to ensure accuracy.
            //    MUST bypass the cache — a stale cached { unreadCount: 0 } (e.g. from
            //    a pre-login warm fetch) would otherwise overwrite the badge we just
            //    incremented, making the bell badge appear to never update.
            fetchBadgeCounts(true);
        });

        // ── Realtime missed-call badge clear ──
        // When the callee opens a conversation on ANY device, the server
        // clears the missed-call marker and broadcasts so the red badge
        // disappears here too (not just on the device that opened it).
        socket.on(
            "conversation:missed-call-cleared",
            ({ conversationId }: { conversationId: string }) => {
                logger.info("Missed-call badge cleared", { conversationId });
                setConversations((prev) =>
                    prev.map((c) =>
                        c._id === conversationId
                            ? { ...c, missedCall: null }
                            : c,
                    ),
                );
            },
        );

        // ── Realtime block/unblock sync ──
        // A blocked user must stop existing for the blocker (and vice versa)
        // immediately — not after a cache TTL or a reload. When either user
        // blocks or unblocks, wipe the local CacheStorage + IndexedDB caches
        // and refetch everything so the other user's content vanishes (or
        // reappears) instantly across feed, search, notifications, chats, etc.
        const handleBlockStateChange = async () => {
            try {
                await clearAllCaches();
            } catch (e) {
                logger.error("Failed to clear caches on block state change", e);
            }
            // Refetch all user-specific data so UI reflects the new reality.
            // Bypass cache (it was just wiped) to guarantee fresh server data.
            fetchConversations(true);
            fetchSuggestions();
            fetchFollowing(userId);
            fetchBadgeCounts(true);
            // Force already-mounted views (Feed, Glances, Notifications) to
            // re-fetch immediately — a cache wipe alone doesn't clear React
            // state, so the blocked user's content would stay visible until
            // the next navigation or reload without this signal.
            window.dispatchEvent(new CustomEvent("forceFeedRefresh"));
            window.dispatchEvent(new CustomEvent("glimpsesRefresh"));
            window.dispatchEvent(new CustomEvent("notificationsRefresh"));
        };
        socket.on(
            "user:blocked",
            ({ targetUserId }: { targetUserId: string }) => {
                logger.info("Received user:blocked event", { targetUserId });
                void handleBlockStateChange();
            },
        );
        socket.on(
            "user:unblocked",
            ({ targetUserId }: { targetUserId: string }) => {
                logger.info("Received user:unblocked event", { targetUserId });
                void handleBlockStateChange();
            },
        );

        // ── Realtime post interaction sync (likes, saves, reposts) ──
        // Dispatch with source="socket" and the absolute count from server so listeners can use exact values
        // Use the `userId` parameter (stable in closure) instead of `user` state (stale at setup time)
        const uid = userId;
        const dispatchSocketInteraction = (
            postId: string,
            type: string,
            value: boolean,
            count?: number,
        ) => {
            logger.info("Dispatching socket interaction", {
                postId,
                type,
                value,
                count,
            });
            window.dispatchEvent(
                new CustomEvent("postInteractionChanged", {
                    detail: { postId, type, value, count, source: "socket" },
                }),
            );
        };

        socket.on(
            "post:like",
            (data: { postId: string; userId: string; likesCount: number }) => {
                logger.info("Received post:like event", data);
                if (data.userId === uid) return; // own action, already handled via optimistic + local dispatch
                dispatchSocketInteraction(
                    data.postId,
                    "like",
                    true,
                    data.likesCount,
                );
            },
        );
        socket.on(
            "post:unlike",
            (data: { postId: string; userId: string; likesCount: number }) => {
                logger.info("Received post:unlike event", data);
                if (data.userId === uid) return;
                dispatchSocketInteraction(
                    data.postId,
                    "like",
                    false,
                    data.likesCount,
                );
            },
        );

        socket.on(
            "post:save",
            (data: { postId: string; userId: string; savesCount: number }) => {
                logger.info("Received post:save event", data);
                if (data.userId === uid) return;
                dispatchSocketInteraction(
                    data.postId,
                    "save",
                    true,
                    data.savesCount,
                );
            },
        );
        socket.on(
            "post:unsave",
            (data: { postId: string; userId: string; savesCount: number }) => {
                logger.info("Received post:unsave event", data);
                if (data.userId === uid) return;
                dispatchSocketInteraction(
                    data.postId,
                    "save",
                    false,
                    data.savesCount,
                );
            },
        );

        socket.on(
            "post:repost",
            (data: {
                postId: string;
                userId: string;
                repostsCount: number;
            }) => {
                logger.info("Received post:repost event", data);
                if (data.userId === uid) return;
                dispatchSocketInteraction(
                    data.postId,
                    "repost",
                    true,
                    data.repostsCount,
                );
            },
        );
        socket.on(
            "post:unrepost",
            (data: {
                postId: string;
                userId: string;
                repostsCount: number;
            }) => {
                logger.info("Received post:unrepost event", data);
                if (data.userId === uid) return;
                dispatchSocketInteraction(
                    data.postId,
                    "repost",
                    false,
                    data.repostsCount,
                );
            },
        );

        // ── Realtime share count sync (use absolute count from server) ──
        socket.on(
            "post:share",
            (data: { postId: string; sharesCount: number }) => {
                logger.info("Received post:share event", data);
                window.dispatchEvent(
                    new CustomEvent("postInteractionChanged", {
                        detail: {
                            postId: data.postId,
                            type: "share",
                            value: true,
                            count: data.sharesCount,
                            source: "socket",
                        },
                    }),
                );
            },
        );

        // ── Realtime post emoji reactions ──
        // Any user's reaction (add/remove) updates the reaction pills on mounted
        // post cards instantly — PostReactionPill listens for this window event.
        socket.on(
            "post:reaction",
            (payload: {
                postId: string;
                reaction: any;
                type: "add" | "remove";
            }) => {
                logger.info("Received post:reaction event", payload);
                window.dispatchEvent(
                    new CustomEvent("postReactionChanged", { detail: payload }),
                );
            },
        );

        // ── Realtime follow/unfollow sync ──
        // The payload carries BOTH the target's new followersCount and the
        // follower's new followingCount (authoritative server values). Each
        // client updates whichever side it cares about: any profile being
        // viewed refreshes its count via userFollowersCountChanged, and the
        // current user's own counts are corrected here (the optimistic ±1
        // from onToggleFollow may race other tabs / devices).
        const handleFollowSocketEvent = (
            eventName: "user:follow" | "user:unfollow",
            data: {
                targetUserId: string;
                followerId: string;
                followersCount: number;
                followerFollowingCount?: number;
            },
        ) => {
            logger.info(`Received ${eventName} event`, data);
            if (data.followerId === uid) {
                setFollowingStates((prev) => ({
                    ...prev,
                    [data.targetUserId]: eventName === "user:follow",
                }));
                if (typeof data.followerFollowingCount === "number") {
                    setUser((prev) =>
                        prev
                            ? {
                                  ...prev,
                                  followingCount:
                                      data.followerFollowingCount as number,
                              }
                            : prev,
                    );
                }
            }
            if (data.targetUserId === uid) {
                setUser((prev) =>
                    prev
                        ? {
                              ...prev,
                              followersCount: data.followersCount,
                          }
                        : prev,
                );
            }
            window.dispatchEvent(
                new CustomEvent("userFollowersCountChanged", {
                    detail: data,
                }),
            );
        };
        socket.on("user:follow", (data: any) =>
            handleFollowSocketEvent("user:follow", data),
        );
        socket.on("user:unfollow", (data: any) =>
            handleFollowSocketEvent("user:unfollow", data),
        );

        // ── Realtime new posts in feed (prepend to home feed) ──
        // Dispatch for ALL posts including the current user's OWN posts. Manually
        // created posts are also dispatched locally by PostModal, but Feed.tsx
        // dedupes by _id so the duplicate event is harmless. The own-post case
        // is essential for SCHEDULED posts: they're published by the server
        // scheduler minutes/hours after creation, so the author's client has no
        // local copy and would otherwise never see the post without a reload.
        socket.on("post:created", (post: any) => {
            logger.info("[ORBIT DIAG] post:created received", {
                postId: post._id,
                authorId: post.author?._id,
                uid,
            });
            // Seed the client-side feed cache so the post also survives navigation:
            // if the user is on another tab when a SCHEDULED post auto-publishes,
            // Feed.tsx reads the cached /api/posts list on mount — without this
            // seed it would show a stale list without the new post.
            void prependPostToCachedFeeds(post);
            window.dispatchEvent(
                new CustomEvent("newPostCreated", { detail: { post } }),
            );
        });

        // ── Realtime comment count sync & comment addition ──
        // Skip own comments (already incremented locally via the comment drawer)
        socket.on(
            "post:comment",
            (data: {
                postId: string;
                comment: any;
                userId: string;
                commentsCount: number;
            }) => {
                logger.info("Received post:comment event", data);
                if (data.userId === uid) return;
                window.dispatchEvent(
                    new CustomEvent("postCommentAdded", {
                        detail: {
                            postId: data.postId,
                            commentsCount: data.commentsCount,
                            comment: data.comment,
                        },
                    }),
                );
            },
        );

        // ── Realtime post deletion ──
        // Remove the post from all views when it's deleted by its author
        socket.on("post:deleted", (postId: string) => {
            logger.info("Received post:deleted event", postId);
            window.dispatchEvent(
                new CustomEvent("postDeleted", { detail: { postId } }),
            );
        });

        // ── Realtime post edits ──
        // Update post content/title in all views when author edits it
        socket.on("post:updated", (post: any) => {
            logger.info("Received post:updated event", post);
            window.dispatchEvent(
                new CustomEvent("postUpdated", { detail: { post } }),
            );
        });

        // ── Realtime poll vote sync ──
        // When anyone votes, broadcast the updated (count-only) poll so every
        // viewer sees the bars move instantly. Each viewer keeps their own
        // myVote locally — the event only carries aggregate counts.
        socket.on("poll:updated", (data: { postId: string; poll: any }) => {
            logger.info("Received poll:updated event", data);
            window.dispatchEvent(
                new CustomEvent("postPollUpdated", { detail: data }),
            );
        });

        // ── Realtime comment reply sync ──
        // When someone replies to a comment, the post's commentsCount goes up too
        socket.on(
            "comment:reply",
            (data: {
                postId: string;
                commentId: string;
                reply: any;
                userId: string;
                commentsCount: number;
                repliesCount: number;
            }) => {
                logger.info("Received comment:reply event", data);
                if (data.userId === uid) return; // own reply, already handled locally
                window.dispatchEvent(
                    new CustomEvent("postCommentAdded", {
                        detail: {
                            postId: data.postId,
                            commentsCount: data.commentsCount,
                            comment: data.reply,
                            parentCommentId: data.commentId,
                        },
                    }),
                );
            },
        );

        // ── Realtime comment edit sync ──
        socket.on("comment:updated", (comment: any) => {
            logger.info("Received comment:updated event", comment);
            window.dispatchEvent(
                new CustomEvent("commentUpdated", { detail: { comment } }),
            );
        });

        // ── Realtime comment deletion sync ──
        // When a comment is deleted, update the post's commentsCount
        socket.on(
            "comment:deleted",
            (data: {
                postId: string;
                commentId: string;
                commentsCount: number;
            }) => {
                logger.info("Received comment:deleted event", data);
                window.dispatchEvent(
                    new CustomEvent("postCommentDeleted", {
                        detail: {
                            postId: data.postId,
                            commentsCount: data.commentsCount,
                        },
                    }),
                );
                window.dispatchEvent(
                    new CustomEvent("commentDeleted", {
                        detail: { commentId: data.commentId },
                    }),
                );
            },
        );

        // ── Realtime comment emoji reactions ──
        socket.on(
            "comment:reaction",
            (data: {
                commentId: string;
                reaction: any;
                type: "add" | "remove";
            }) => {
                logger.info("Received comment:reaction event", data);
                window.dispatchEvent(
                    new CustomEvent("commentReactionChanged", { detail: data }),
                );
            },
        );

        // ── Realtime comment like/unlike sync ──
        socket.on(
            "comment:like",
            (data: {
                commentId: string;
                userId: string;
                likesCount: number;
            }) => {
                logger.info("Received comment:like event", data);
                if (data.userId === uid) return;
                window.dispatchEvent(
                    new CustomEvent("postCommentLikeChanged", {
                        detail: {
                            commentId: data.commentId,
                            likesCount: data.likesCount,
                        },
                    }),
                );
            },
        );
        socket.on(
            "comment:unlike",
            (data: {
                commentId: string;
                userId: string;
                likesCount: number;
            }) => {
                logger.info("Received comment:unlike event", data);
                if (data.userId === uid) return;
                window.dispatchEvent(
                    new CustomEvent("postCommentLikeChanged", {
                        detail: {
                            commentId: data.commentId,
                            likesCount: data.likesCount,
                        },
                    }),
                );
            },
        );

        // ── Realtime post view sync ──
        socket.on(
            "post:view",
            (data: { postId: string; viewsCount: number }) => {
                logger.info("Received post:view event", data);
                window.dispatchEvent(
                    new CustomEvent("postViewUpdated", {
                        detail: {
                            postId: data.postId,
                            viewsCount: data.viewsCount,
                        },
                    }),
                );
            },
        );

        // ── Realtime user profile view sync ──
        socket.on(
            "user:view",
            (data: { userId: string; viewsCount: number }) => {
                logger.info("Received user:view event", data);
                window.dispatchEvent(
                    new CustomEvent("userViewUpdated", {
                        detail: {
                            userId: data.userId,
                            viewsCount: data.viewsCount,
                        },
                    }),
                );
            },
        );

        // ── Realtime post pin sync ──
        socket.on("post:pin", (data: { postId: string; userId: string }) => {
            logger.info("Received post:pin event", data);
            window.dispatchEvent(
                new CustomEvent("postPinned", {
                    detail: { postId: data.postId, userId: data.userId },
                }),
            );
        });

        socket.on("post:unpin", (data: { postId: string; userId: string }) => {
            logger.info("Received post:unpin event", data);
            window.dispatchEvent(
                new CustomEvent("postUnpinned", {
                    detail: { postId: data.postId, userId: data.userId },
                }),
            );
        });

        // ── Realtime own-profile updates ──
        // When the user edits their profile (including the privacy/private-account
        // toggle in Settings) from any device, update the global user state so
        // Settings + Profile reflect it instantly without a reload.
        socket.on("user:updated", (updatedUser: Partial<User>) => {
            logger.info("Received user:updated event", updatedUser);
            if (!updatedUser || updatedUser._id !== userId) return;
            setUser((prev) => (prev ? { ...prev, ...updatedUser } : prev));
        });

        // ── WebRTC Call Signaling ────────────────────────────────────────
        socket.on(
            "call:offer",
            (data: { callerId: string; sdp: any; type: "audio" | "video" }) => {
                logger.info("Received call:offer", data);

                // If the user is already in an active OR outgoing call, politely
                // reject the new incoming call instead of hijacking the UI and
                // stranding the existing peer connection.
                if (
                    callStateRef.current?.status === "active" ||
                    callStateRef.current?.status === "outgoing"
                ) {
                    logger.info("Busy — rejecting incoming call", {
                        from: data.callerId,
                        status: callStateRef.current.status,
                    });
                    socket.emit("call:end", {
                        targetUserId: data.callerId,
                    });
                    return;
                }

                // Store the offer SDP for when the user accepts the call
                if (data.sdp) {
                    pendingCallOfferRef.current = {
                        sdp: data.sdp,
                        type: data.type,
                        partnerId: data.callerId,
                        partnerName: "Calling...",
                    };
                }
                // Store call accept data in a ref so the async onAcceptCall handler
                // can access it without stale closure issues.
                callAcceptDataRef.current = {
                    partnerId: data.callerId,
                    type: data.type,
                };
                setCallState({
                    type: data.type,
                    status: "incoming",
                    partnerId: data.callerId,
                    partnerName: "Calling...",
                });
                // Fire a REAL device notification when the tab is backgrounded
                // so the user knows about the call (the in-app ring only works
                // when the app is in the foreground).
                if (typeof document !== "undefined" && document.hidden) {
                    showNativeNotif(
                        data.type === "video"
                            ? "Incoming video call"
                            : "Incoming call",
                        data.type === "video"
                            ? "Someone is video calling you"
                            : "Someone is calling you",
                    );
                }
                // Auto-cancel the incoming ring if the caller never gets an answer
                scheduleCallRingTimeout(data.callerId, "callee");
            },
        );

        socket.on(
            "call:answer",
            async (data: { calleeId: string; sdp: any }) => {
                logger.info("Received call:answer", data);
                // Call was answered — cancel the outgoing ring timeout
                callAnsweredRef.current = true;
                clearCallRingTimeout();
                const pc = peerConnectionRef.current;
                if (pc && data.sdp) {
                    try {
                        // safeSetRemoteDescription retries once with a
                        // sanitized SDP on codec-parse failures (mobile).
                        await safeSetRemoteDescription(pc, data.sdp);
                        for (const candidate of pendingIceCandidatesRef.current.splice(
                            0,
                        )) {
                            await pc.addIceCandidate(
                                new RTCIceCandidate(candidate),
                            );
                        }
                    } catch (err) {
                        logger.error(
                            "Failed to set remote description from answer",
                            err,
                        );
                    }
                }
                setCallState((prev) =>
                    prev ? { ...prev, status: "active" } : prev,
                );
            },
        );

        socket.on(
            "call:ice-candidate",
            async (data: { senderId: string; candidate: any }) => {
                logger.info("Received call:ice-candidate", data);
                const pc = peerConnectionRef.current;
                if (!data.candidate) return;
                if (!pc || !pc.remoteDescription) {
                    pendingIceCandidatesRef.current.push(data.candidate);
                    return;
                }
                if (pc) {
                    try {
                        await pc.addIceCandidate(
                            new RTCIceCandidate(data.candidate),
                        );
                    } catch (err) {
                        logger.error("Failed to add ICE candidate", err);
                    }
                }
            },
        );

        // Handle ICE restart offer from the remote peer (network handoff recovery)
        socket.on(
            "call:ice-restart",
            async (data: { senderId: string; sdp: any }) => {
                logger.info("Received call:ice-restart", data);
                const pc = peerConnectionRef.current;
                if (!pc || !data.sdp) return;
                try {
                    await safeSetRemoteDescription(pc, data.sdp);
                    const answer = await pc.createAnswer();
                    await pc.setLocalDescription(answer);
                    socket.emit("call:answer", {
                        targetUserId: data.senderId,
                        sdp: pc.localDescription,
                    });
                    logger.info("ICE restart: sent answer back");
                } catch (err) {
                    logger.error(
                        "ICE restart: failed to handle remote offer",
                        err,
                    );
                }
            },
        );
        socket.on("call:end", (data: { endedBy: string }) => {
            logger.info("Received call:end", data);
            // Cancel any pending ring timeout
            clearCallRingTimeout();
            // Clean up bitrate monitor first (stops polling before PC is closed)
            cleanupBitrateMonitor(peerConnectionRef.current);
            // Clean up peer connection and local stream
            if (peerConnectionRef.current) {
                peerConnectionRef.current.close();
                peerConnectionRef.current = null;
            }
            if (localStreamRef.current) {
                localStreamRef.current.getTracks().forEach((t) => t.stop());
                localStreamRef.current = null;
            }
            pendingCallOfferRef.current = null;
            pendingIceCandidatesRef.current = [];
            remoteStreamRef.current = null;
            callPartnerIdRef.current = null;
            if (iceRestartTimeoutRef.current) {
                clearTimeout(iceRestartTimeoutRef.current);
                iceRestartTimeoutRef.current = null;
            }
            setIceConnectionState("closed");
            setCallState(null);
        });

        // ── Realtime glimpse events (ephemeral stories) ──
        socket.on("glimpse:created", (glimpse: any) => {
            logger.info("Received glimpse:created", {
                glimpseId: glimpse._id,
                authorId: glimpse.author?._id,
            });
            window.dispatchEvent(
                new CustomEvent("glimpse:created", { detail: glimpse }),
            );
        });

        socket.on(
            "glimpse:viewed",
            (data: {
                glimpseId: string;
                viewerId: string;
                remainingViews: number;
                viewers: any[];
            }) => {
                logger.info("Received glimpse:viewed", data);
                window.dispatchEvent(
                    new CustomEvent("glimpse:viewed", { detail: data }),
                );
            },
        );

        socket.on(
            "glimpse:one-view-left",
            (data: {
                glimpseId: string;
                authorId: string;
                remainingViews: number;
            }) => {
                logger.info("Received glimpse:one-view-left", data);
                window.dispatchEvent(
                    new CustomEvent("glimpse:one-view-left", { detail: data }),
                );
            },
        );

        socket.on(
            "glimpse:reacted",
            (data: {
                glimpseId: string;
                userId: string;
                emoji: string;
                action: string;
                reactionsCount: number;
            }) => {
                logger.info("Received glimpse:reacted", data);
                window.dispatchEvent(
                    new CustomEvent("glimpse:reacted", { detail: data }),
                );
            },
        );

        socket.on("glimpse:expired", (data: { glimpseId: string }) => {
            logger.info("Received glimpse:expired", data);
            window.dispatchEvent(
                new CustomEvent("glimpse:expired", { detail: data }),
            );
        });

        socket.on("call:missed", (data: { callerId: string }) => {
            logger.info("Received call:missed", data);
            // Cancel any pending ring timeout
            clearCallRingTimeout();
            pendingCallOfferRef.current = null;
            setCallState(null);
            // No toast here — the ring timeout already surfaced the outcome
            // ("No answer" for the caller, "Missed call" for the callee).
            // This prevents double notifications when both sides time out.
        });
    };

    const handleAuthSuccess = useCallback((authUser: User, token?: string) => {
        setUser(authUser);
        // Same as the session-restore path: the socket is cross-origin (Render),
        // so it must carry the JWT in auth.token — the cookie never crosses.
        connectSockets(authUser._id, token || "");
        // Fresh authoritative badge + unread counts right after login.
        // fetchConversations is cache-first (SWR): paints instantly from any
        // local copy, then reconciles — so chats appear without a network wait.
        fetchBadgeCounts(true);
        fetchConversations();		fetchFollowing(authUser._id);
		void fetchFeatureFlags();
		// Prime the offline caches the moment someone joins: fire-and-forget
        // (delayed so the critical fetches above + socket connect win), filling
        // CacheStorage + Dexie with their feed, chats, notifications, etc. so
        // the app is fully offline-capable from the very first session.
        setTimeout(() => void primeOfflineCache(authUser._id), 1500);
        setTab("home");
        // Fresh login — clear any URL-restored sub-selection from a previous
        // account/session so the post-login screen is the clean home feed.
        setSelectedUserUsername("");
        setSinglePostSlug(null);
        setAutoOpenComments(false);
        setActiveConversationId(null);
        setCommunityToOpen(null);

        // First-run device-permission onboarding: shown ONCE to new signups and
        // to existing users who never completed it. The browser only shows each
        // permission prompt once per site, so this screen is the single place to
        // grant notifications + camera + microphone up front instead of being
        // surprised later during a call. After it completes we never ask again
        // (Settings → Permissions is the permanent control center).
        const prefs = (authUser as any)?.permissionPrefs;
        const alreadyDone = (authUser as any)?.permissionOnboardingCompleted;
        if (!alreadyDone && !prefs?.onboardingCompleted) {
            // Don't prompt for anything yet — let the onboarding screen drive all
            // permission requests within explicit user gestures.
            setShowPermissionOnboarding(true);
        } else {
            // Returning user who already decided: silently re-sync the push
            // subscription (no prompt — only acts when already granted).
            // Also reset the flag defensively — a stale `true` from a previous
            // incomplete session must never re-show the onboarding.
            setShowPermissionOnboarding(false);
            ensurePushSubscription();
        }

        // NOTE: cache warming (all tabs + user-specific data) happens in the
        // user-change effect below — it runs for BOTH fresh logins and session
        // restores on reload, so it isn't duplicated here.
    }, []);

    // ─── OPUS Bitrate SDP Helper (Cross-Browser) ──────────────────────────
    // Overrides OPUS codec parameters in the SDP to request 64kbps mono voice.
    // Instead of hardcoding payload type 111 (Chrome), this looks up the OPUS
    // payload type number from the rtpmap line so it works on all browsers.
    const setOpusBitrate = (sdp: string): string => {
        // Find OPUS payload type from rtpmap (e.g. "a=rtpmap:111 opus/48000/2")
        const opusMatch = sdp.match(/a=rtpmap:(\d+) opus\/48000/i);
        if (!opusMatch) return sdp; // No OPUS codec — return unmodified
        const pt = opusMatch[1];
        // Replace the fmtp line for that specific payload type.
        // 64kbps mono + inband FEC + DTX (discontinuous transmission = silence
        // suppression). DTX stops sending packets during silence, saving
        // upload bandwidth and making calls feel snappier on mobile networks.
        const regex = new RegExp(`a=fmtp:${pt} .*`, "g");
        return sdp.replace(
            regex,
            `a=fmtp:${pt} maxaveragebitrate=64000;useinbandfec=1;usedtx=1`,
        );
    };

    // ─── Video Codec & SVC Helpers ────────────────────────────────────
    // NOTE on codec preferences: we deliberately do NOT call
    // setCodecPreferences() anywhere. Passing a filtered subset of
    // getCapabilities() codecs (e.g. [VP9, H.264, VP8]) is a documented
    // Chromium bug class that produces offers with DUPLICATE payload types
    // ("a=rtpmap:100 rtx/90000 Duplicate payload type", H.264 entries whose
    // payload type collides with rtx/ulpfec/red). The CALLEE's
    // setRemoteDescription then throws "Failed to parse SessionDescription
    // ... Failed to parse codecs correctly" and the call cannot be accepted
    // — this was the exact production error on mobile. The bug is triggered
    // on the CALLER side, so it broke calls regardless of which device
    // accepted (my earlier fix only skipped it on mobile callers, but a
    // DESKTOP caller still produced a broken offer). Browsers negotiate a
    // valid common codec natively without preferences: iOS Safari defaults
    // to H.264, Chrome Android to VP8/VP9, Chrome desktop to VP9 — all
    // hardware-accelerated on modern devices — and tryConfigureVideoSvc
    // below still enables VP9 SVC (L3T3) whenever VP9 is negotiated.

    // Reusable cleanup helper for bitrate monitor stored on peer connections.
    // Called before closing a PC to prevent the getStats polling interval from leaking.
    const cleanupBitrateMonitor = (pc: RTCPeerConnection | null) => {
        if (!pc) return;
        try {
            const cleanup = (pc as any).__bitrateMonitorCleanup;
            if (typeof cleanup === "function") {
                cleanup();
            }
            delete (pc as any).__bitrateMonitorCleanup;
        } catch {
            /* best-effort cleanup */
        }
    };

    // Attempts to configure VP9 SVC (scalabilityMode L3T3) on the video sender.
    // L3T3 = 3 temporal layers — allows the browser to drop frame rate
    // gracefully when network bandwidth drops, avoiding complete freeze.
    // Only applies when VP9 was actually negotiated (H.264/VP8 don't support
    // SVC). Falls back silently on browsers/codecs that don't support it.
    const tryConfigureVideoSvc = async (pc: RTCPeerConnection) => {
        const videoSender = pc
            .getSenders()
            .find((s) => s.track?.kind === "video");
        if (!videoSender) return;

        try {
            // Only VP9 supports SVC. Determine the ACTUALLY negotiated codec by
            // checking both the sender and the receiver side (some browsers
            // return the configured preference list from the sender only).
            // Case-insensitive: Safari/Firefox may report "video/VP9" vs
            // "video/vp9".
            const senderCodec =
                videoSender.getParameters().codecs?.[0]?.mimeType;
            const receiverCodec = pc
                .getTransceivers()
                .find((t) => t.receiver.track?.kind === "video")
                ?.receiver.getParameters()?.codecs?.[0]?.mimeType;
            const negotiatedCodec = senderCodec || receiverCodec || "";
            if (!negotiatedCodec.toLowerCase().includes("vp9")) {
                logger.info(
                    "[SVC] Skipped — negotiated video codec is not VP9",
                    {
                        senderCodec,
                        receiverCodec,
                    },
                );
                return;
            }
            const params = videoSender.getParameters();
            if (!params.encodings || params.encodings.length === 0) {
                params.encodings = [{}];
            }
            // Note: enabling scalabilityMode post-negotiation requires a
            // renegotiation in some browsers (Chrome). This is a best-effort
            // enhancement — the bandwidth-aware bitrate monitor below provides
            // the primary adaptation. Failures are caught and logged.
            (params.encodings[0] as any).scalabilityMode = "L3T3";
            await videoSender.setParameters(params);
            logger.info("[SVC] VP9 L3T3 scalability configured");
        } catch (err) {
            // SVC not supported — expected on older browsers, non-VP9 calls,
            // or when the codec isn't VP9. The call still works with default
            // settings; the bitrate monitor keeps quality adaptive.
            logger.info("[SVC] Not supported, using browser defaults");
        }
    };

    // Sanitize an SDP so setRemoteDescription survives the Chromium
    // duplicate-payload-type bug (belt-and-suspenders on top of the
    // no-setCodecPreferences fix). The bug produces offers with the SAME
    // payload type declared on multiple rtpmap lines (e.g. an H.264 entry
    // whose PT collides with rtx/ulpfec/red); the callee's parser then
    // throws "Failed to parse codecs correctly". Dedupe by payload type,
    // keeping the FIRST declaration and dropping later duplicate rtpmap +
    // their fmtp/rtcp-fb companions — the first entry is always the real
    // codec mapping.
    const sanitizeSdpForMobile = (sdp: string): string => {
        const lines = sdp.split("\r\n").filter(Boolean);
        const seenPt = new Set<string>();
        const kept = lines.filter((line) => {
            const rtpmap = line.match(/^a=rtpmap:(\d+) /);
            if (!rtpmap) return true; // not a codec mapping — keep
            const pt = rtpmap[1];
            if (seenPt.has(pt)) return false; // duplicate payload type
            seenPt.add(pt);
            return true;
        });
        return kept.join("\r\n") + "\r\n";
    };

    // try/catch wrapper around setRemoteDescription: retry once with a
    // sanitized SDP when the first attempt fails on a codec-parse error.
    // Used on every remote-description path (caller answer, callee accept,
    // ICE-restart) so a single bad line can never kill a mobile call.
    const safeSetRemoteDescription = async (
        pc: RTCPeerConnection,
        sdp: any,
    ): Promise<void> => {
        try {
            await pc.setRemoteDescription(new RTCSessionDescription(sdp));
            return;
        } catch (err: any) {
            const msg = `${err?.message || err}`;
            const isCodecParse =
                msg.includes("Failed to parse codecs") ||
                msg.includes("Failed to parse SessionDescription");
            if (!isCodecParse || typeof sdp?.sdp !== "string") {
                throw err;
            }
            // One retry with deduped payload types. If it still fails, the
            // offer is genuinely malformed — rethrow so the caller can
            // surface the error / hang up cleanly.
            const cleaned = sanitizeSdpForMobile(sdp.sdp);
            logger.warn(
                "SDP codec-parse failure — retrying with sanitized SDP",
                { original: sdp.sdp.length, cleaned: cleaned.length },
            );
            await pc.setRemoteDescription(
                new RTCSessionDescription({ ...sdp, sdp: cleaned }),
            );
        }
    };

    // Monitors the outgoing video stream and adapts the encoder bitrate to
    // the current network state. Combines three signals:
    //   1. Packet loss (from outbound-rtp) — the ground truth for congestion.
    //   2. qualityLimitationReason === "bandwidth" — WebRTC's own congestion
    //      controller saying it's starving the encoder.
    //   3. availableOutgoingBitrate — the bandwidth the ICE pair estimates.
    // Stepping DOWN is instant and aggressive (keeps the call fluid). Recovery
    // is gradual: after 3 healthy polls it ramps back up toward the target.
    const startBitrateMonitor = (
        pc: RTCPeerConnection,
        type: "audio" | "video",
        targetBitrate: number = 1_500_000,
    ): (() => void) => {
        if (type !== "video") return () => {};

        let healthyPolls = 0;
        let poorNetworkNotified = false;

        const findVideoSender = () =>
            pc.getSenders().find((s) => s.track?.kind === "video");

        const timer = setInterval(async () => {
            try {
                const stats = await pc.getStats();
                let availableBitrate = 0;
                let packetsLost = 0;
                let packetsSent = 0;
                let limitationBandwidth = false;

                stats.forEach((report) => {
                    if (
                        report.type === "candidate-pair" &&
                        report.state === "succeeded"
                    ) {
                        availableBitrate = report.availableOutgoingBitrate || 0;
                    }
                    if (
                        report.type === "bandwidth-estimation" &&
                        report.availableBitrate
                    ) {
                        availableBitrate = report.availableBitrate;
                    }
                    if (
                        report.type === "outbound-rtp" &&
                        report.bytesSent > 0
                    ) {
                        packetsLost += report.packetsLost || 0;
                        packetsSent += report.packetsSent || 0;
                        // "bandwidth" means libwebrtc is throttling the encoder
                        if (report.qualityLimitationReason === "bandwidth") {
                            limitationBandwidth = true;
                        }
                    }
                });

                const lossRatio =
                    packetsSent > 0 ? packetsLost / packetsSent : 0;
                const lossPct = lossRatio * 100;

                let bitrateCap = targetBitrate;
                // Respect the ICE pair's own bandwidth estimate if reported
                // (leave 10% headroom for audio, FEC, and retransmits).
                if (availableBitrate > 0) {
                    bitrateCap = Math.min(
                        bitrateCap,
                        Math.floor(availableBitrate * 0.9),
                    );
                }

                const sender = findVideoSender();
                if (!sender) return;

                const params = sender.getParameters();
                if (!params.encodings || params.encodings.length === 0) return;

                const current = params.encodings[0].maxBitrate || targetBitrate;
                let next = current;

                // ── Congestion: step down fast ────────────────────────────
                if (lossPct > 5 || limitationBandwidth) {
                    next = Math.floor(current * 0.7);
                    healthyPolls = 0;
                    if (!poorNetworkNotified) {
                        poorNetworkNotified = true;
                        window.dispatchEvent(
                            new CustomEvent("callNetworkQuality", {
                                detail: { poor: true },
                            }),
                        );
                    }
                } else if (lossPct > 3) {
                    // Mild loss — smaller step, don't punish yet
                    next = Math.floor(current * 0.85);
                    healthyPolls = 0;
                } else {
                    // ── Healthy: ramp back up gradually ──────────────────
                    healthyPolls += 1;
                    if (
                        healthyPolls >= 3 &&
                        current < bitrateCap &&
                        current < targetBitrate
                    ) {
                        next = Math.min(bitrateCap, Math.ceil(current * 1.15));
                    }
                    if (poorNetworkNotified && lossPct <= 2) {
                        poorNetworkNotified = false;
                        window.dispatchEvent(
                            new CustomEvent("callNetworkQuality", {
                                detail: { poor: false },
                            }),
                        );
                    }
                }

                // Never exceed the cap (network estimate or target)
                next = Math.min(next, bitrateCap);
                // Sensible floor — below ~120kbps video is unwatchable anyway
                next = Math.max(next, 120_000);

                if (Math.abs(next - current) > current * 0.05) {
                    params.encodings[0].maxBitrate = next;
                    await sender.setParameters(params);
                    logger.info(
                        `[Bitrate] ${next < current ? "↓" : "↑"} ${Math.round(next / 1000)} kbps (loss ${lossPct.toFixed(1)}%, avail ${Math.round(availableBitrate / 1000)} kbps, limit ${limitationBandwidth ? "bandwidth" : "none"})`,
                    );
                }
            } catch {
                // Stats polling is best-effort
            }
        }, 3000);

        return () => {
            clearInterval(timer);
            // Reset the poor-network indicator if the call ends while degraded
            window.dispatchEvent(
                new CustomEvent("callNetworkQuality", {
                    detail: { poor: false },
                }),
            );
        };
    };

    // ─── Call Ring Timeout ──────────────────────────────────────────────
    // If the callee doesn't answer within 45s, the caller hangs up and
    // notifies the callee of the missed call. Also used on the callee side
    // to auto-cancel the incoming ring after 45s.
    const clearCallRingTimeout = () => {
        if (callRingTimeoutRef.current) {
            clearTimeout(callRingTimeoutRef.current);
            callRingTimeoutRef.current = null;
        }
    };

    const scheduleCallRingTimeout = useCallback(
        (partnerId: string, side: "caller" | "callee") => {
            clearCallRingTimeout();
            callAnsweredRef.current = false;
            callRingTimeoutRef.current = setTimeout(() => {
                if (callAnsweredRef.current) return; // already answered/ended
                const sock = socketRef.current;
                // Only the CALLER emits call:missed (authoritative). The callee's
                // own timeout just cleans up locally — the caller's missed event
                // arrives at the same moment, avoiding double toasts.
                if (sock && side === "caller") {
                    sock.emit("call:missed", { targetUserId: partnerId });
                }
                // Clean up the unanswered call locally
                if (peerConnectionRef.current) {
                    peerConnectionRef.current.close();
                    peerConnectionRef.current = null;
                }
                if (localStreamRef.current) {
                    localStreamRef.current.getTracks().forEach((t) => t.stop());
                    localStreamRef.current = null;
                }
                pendingCallOfferRef.current = null;
                pendingIceCandidatesRef.current = [];
                remoteStreamRef.current = null;
                callPartnerIdRef.current = null;
                if (iceRestartTimeoutRef.current) {
                    clearTimeout(iceRestartTimeoutRef.current);
                    iceRestartTimeoutRef.current = null;
                }
                setIceConnectionState("closed");
                setCallState(null);
                // Surface the outcome as a REAL device notification (only
                // fires when the tab is backgrounded — the in-app call UI
                // already shows the ended state when the app is foregrounded).
                // No toast: an in-app toast would just duplicate this.
                if (typeof document !== "undefined" && document.hidden) {
                    showBrowserNotification(
                        side === "caller"
                            ? "Call ended — no answer"
                            : "Missed call",
                        {
                            body:
                                side === "caller"
                                    ? "Your call was not answered."
                                    : "You missed a call from Orbit.",
                        },
                    );
                }
            }, 45000);
        },
        [],
    );

    const handleStartCall = useCallback(
        async (
            partnerId: string,
            partnerName: string,
            type: "audio" | "video",
        ) => {
            const sock = socketRef.current;
            if (!sock) return;

            // Clean up any previous call
            if (peerConnectionRef.current) {
                peerConnectionRef.current.close();
            }
            if (localStreamRef.current) {
                localStreamRef.current.getTracks().forEach((t) => t.stop());
            }
            remoteStreamRef.current = null;
            pendingIceCandidatesRef.current = [];

            setCallState({ type, status: "outgoing", partnerId, partnerName });
            try {
                let stream: MediaStream;
                try {
                    stream = await navigator.mediaDevices.getUserMedia({
                        audio: {
                            echoCancellation: true,
                            noiseSuppression: true,
                            autoGainControl: true,
                            // ⚠️ Intentionally omitting sampleRate/channelCount.
                            // Letting the browser use its native audio format prevents
                            // AEC pipeline conflicts (resampling/downmixing) that cause echo.
                        },
                        video:
                            type === "video"
                                ? isMobileDevice()
                                    ? {
                                          // Mobile: 480p@24 keeps the encode
                                          // light AND fits cellular upload —
                                          // the phone screen can't show more,
                                          // and starving the encoder is what
                                          // makes calls freeze. 720p30 here is
                                          // the single biggest quality/stability
                                          // killer on phones.
                                          width: { ideal: 640 },
                                          height: { ideal: 480 },
                                          frameRate: { ideal: 24 },
                                      }
                                    : {
                                          width: { ideal: 1280 },
                                          height: { ideal: 720 },
                                          frameRate: { ideal: 30 },
                                      }
                                : false,
                    });
                } catch (videoErr) {
                    logger.warn(
                        "Caller: getUserMedia with HD video constraints failed, trying basic video constraints",
                        videoErr,
                    );
                    try {
                        if (type === "video") {
                            stream = await navigator.mediaDevices.getUserMedia({
                                audio: {
                                    echoCancellation: true,
                                    noiseSuppression: true,
                                    autoGainControl: true,
                                },
                                video: true,
                            });
                        } else {
                            throw videoErr;
                        }
                    } catch (fallbackErr) {
                        logger.warn(
                            "Caller: getUserMedia with basic video failed, falling back to audio only",
                            fallbackErr,
                        );
                        stream = await navigator.mediaDevices.getUserMedia({
                            audio: {
                                echoCancellation: true,
                                noiseSuppression: true,
                                autoGainControl: true,
                            },
                            video: false,
                        });
                    }
                }
                localStreamRef.current = stream;

                const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
                peerConnectionRef.current = pc;

                // Add audio track (via addTrack — simple, no encodings needed)
                stream
                    .getAudioTracks()
                    .forEach((track) => pc.addTrack(track, stream));

                // Add video track via addTransceiver for encoding configuration.
                // No setCodecPreferences here — see the SVC helpers note above:
                // filtered codec lists produce malformed offers (Chromium
                // duplicate-payload-type bug) that break the CALLEE's
                // setRemoteDescription on mobile. Native negotiation picks a
                // valid codec on every device.
                const videoTracks = stream.getVideoTracks();
                if (type === "video" && videoTracks.length > 0) {
                    pc.addTransceiver(videoTracks[0], {
                        streams: [stream],
                        direction: "sendrecv",
                        sendEncodings: [
                            {
                                active: true,
                                // Mobile: 1 Mbps ceiling — cellular upload is
                                // the bottleneck; asking for 2.5 Mbps on LTE
                                // just queues packets and freezes the call.
                                // Desktop keeps the HD ceiling.
                                maxBitrate: isMobileDevice()
                                    ? 1_000_000
                                    : 2_500_000,
                            },
                        ],
                    });
                    // Also add any remaining video tracks (e.g. from secondary cameras)
                    for (let i = 1; i < videoTracks.length; i++) {
                        pc.addTrack(videoTracks[i], stream);
                    }
                }

                pc.onicecandidate = (e) => {
                    if (e.candidate) {
                        sock.emit("call:ice-candidate", {
                            targetUserId: partnerId,
                            candidate: e.candidate,
                        });
                    }
                };

                pc.ontrack = (e) => {
                    logger.info("Call: received remote track", {
                        kind: e.track.kind,
                    });
                    // Store the remote stream immediately in the ref so CallUI can wire it
                    // even if the component hasn't mounted its ontrack handler yet.
                    const stream = e.streams[0];
                    if (stream) {
                        remoteStreamRef.current = stream;
                    } else if (!remoteStreamRef.current) {
                        remoteStreamRef.current = new MediaStream([e.track]);
                    } else {
                        remoteStreamRef.current.addTrack(e.track);
                    }
                };

                // ── ICE connection state monitoring ───────────────────────
                callPartnerIdRef.current = partnerId;
                pc.oniceconnectionstatechange = () => {
                    const state = pc.iceConnectionState;
                    logger.info("ICE connection state changed", {
                        state,
                        partnerId,
                    });
                    setIceConnectionState(state);

                    // Trigger ICE restart on network handoff events (WiFi ↔ cellular)
                    if (state === "disconnected") {
                        // Give the connection a few seconds to recover naturally
                        if (iceRestartTimeoutRef.current)
                            clearTimeout(iceRestartTimeoutRef.current);
                        iceRestartTimeoutRef.current = setTimeout(() => {
                            initiateIceRestart(pc, partnerId);
                        }, 3000);
                    } else if (state === "failed") {
                        // Immediate restart on failure
                        if (iceRestartTimeoutRef.current)
                            clearTimeout(iceRestartTimeoutRef.current);
                        initiateIceRestart(pc, partnerId);
                    } else if (state === "connected" || state === "completed") {
                        // Clear any pending restart timer if connection recovered
                        if (iceRestartTimeoutRef.current) {
                            clearTimeout(iceRestartTimeoutRef.current);
                            iceRestartTimeoutRef.current = null;
                        }
                        // Now that negotiation has completed, we know which
                        // video codec was actually agreed. Enable VP9 SVC
                        // (L3T3) only if VP9 was negotiated — skip for
                        // H.264/VP8 (e.g. iOS Safari peers).
                        if (type === "video") {
                            tryConfigureVideoSvc(pc).catch(() => {});
                        }
                    }
                };

                const offer = await pc.createOffer({
                    offerToReceiveAudio: true,
                    offerToReceiveVideo: type === "video",
                });
                offer.sdp = setOpusBitrate(offer.sdp || "");
                await pc.setLocalDescription(offer);

                sock.emit("call:offer", {
                    targetUserId: partnerId,
                    sdp: pc.localDescription,
                    type,
                });

                // Start ring timeout — auto-hang-up if the callee doesn't answer
                scheduleCallRingTimeout(partnerId, "caller");

                // Start bandwidth-aware bitrate monitor for video calls
                // This polls getStats() every 3s and adapts the video encoder's
                // max bitrate to packet loss / WebRTC congestion control.
                // Target matches the 2.5 Mbps encoding ceiling set above.
                // Cleans up automatically when the peer connection is closed.
                if (type === "video") {
                    const stopMonitor = startBitrateMonitor(
                        pc,
                        type,
                        // Monitor target must match the encoding ceiling.
                        isMobileDevice() ? 1_000_000 : 2_500_000,
                    );
                    // Store the cleanup function on the pc for later disposal
                    (pc as any).__bitrateMonitorCleanup = stopMonitor;
                }
            } catch (err) {
                logger.error("Failed to start call", err);
                setCallState(null);
                if (localStreamRef.current) {
                    localStreamRef.current.getTracks().forEach((t) => t.stop());
                    localStreamRef.current = null;
                }
                window.dispatchEvent(
                    new CustomEvent("showToast", {
                        detail: {
                            message:
                                "Failed to start call. Please check camera/microphone permissions.",
                            type: "error",
                        },
                    }),
                );
            }
        },
        [],
    );

    // ─── ICE Restart Helper ────────────────────────────────────────
    // Creates a new offer with iceRestart flag to re-establish the peer connection
    // after a network handoff (e.g., WiFi → cellular on mobile).
    const initiateIceRestart = useCallback(
        async (pc: RTCPeerConnection, partnerId: string) => {
            const sock = socketRef.current;
            if (!sock || !pc) return;
            logger.info("ICE restart: initiating", { partnerId });
            try {
                const offer = await pc.createOffer({
                    iceRestart: true,
                    offerToReceiveAudio: true,
                    offerToReceiveVideo: callState?.type === "video",
                });
                await pc.setLocalDescription(offer);
                sock.emit("call:ice-restart", {
                    targetUserId: partnerId,
                    sdp: pc.localDescription,
                });
                logger.info("ICE restart: offer sent");
            } catch (err) {
                logger.error("ICE restart: failed", err);
            }
        },
        [callState?.type],
    );
    const handleLogout = useCallback(async () => {
        // The server-side logout (cookie clear) is best-effort: it may fail when the
        // session is already torn down (e.g. after account deletion clears the
        // cookies, or an expired token). Local cleanup must ALWAYS run so the UI
        // never gets stuck logged-in.
        try {
            await apiFetch("/api/auth/logout", { method: "POST" });
        } catch (e) {
            logger.error(e);
        } finally {
            setUser(null);
            setTab("home");
            setBadgeCount(0);
            setChatBadgeCount(0);
            setConversations([]);
            setRequestedFollows({});
            // Clear any URL-restored sub-selection so the next screen starts clean.
            setSelectedUserUsername("");
            setSinglePostSlug(null);
            setAutoOpenComments(false);
            setActiveConversationId(null);
            setCommunityToOpen(null);
            conversationsFetchedRef.current = false;
            // Release any active call media/peer resources on logout
            teardownActiveCall();
            if (socketRef.current) {
                socketRef.current.disconnect();
                socketRef.current = null;
            }
            setSocket(null);
            socketUserIdRef.current = null;
            // This is a REAL logout — clear persisted badge counts AND all cached
            // user-specific data so the next account starts clean.
            try {
                localStorage.removeItem("orbit_notif_badge");
                localStorage.removeItem("orbit_chat_badge");
            } catch {
                /* non-critical */
            }
            stopCacheRefreshTimer();
            clearAllCaches();
        }
    }, []);

    // Mark all badge counts as read
    const handleBadgeReset = useCallback(() => {
        setBadgeCount(0);
    }, []);

    // Helper selectors
    const handleUserSelection = useCallback(
        (username: string) => {
            setSelectedUserUsername(username);
            navigateToTab("profile");
        },
        [navigateToTab],
    );

    // Message a user directly from their profile — switch to the chat tab and
    // open (or create) the conversation with them.
    const handleMessageUser = useCallback(
        (userId: string) => {
            setChatOpenWithUserId(userId);
            navigateToTab("chat");
        },
        [navigateToTab],
    );

    // Intercept compose tab → open PostModal instead
    const handleTabChange = useCallback(
        (tab: string) => {
            if (tab === "compose") {
                setComposeOpen(true);
                return;
            }
            if (tab === "profile") {
                setSelectedUserUsername(user?.username || "");
            }
            if (tab === "home") {
                setSinglePostSlug(null);
            }
            // Reset notification badge when navigating to notifications tab
            if (tab === "notifications") {
                setBadgeCount(0);
                // Also clear the OS launcher badge (set by the service worker
                // via setAppBadge on each push). Opening the inbox means the
                // user has seen the notifications — the launcher dot/count
                // must go away, like WhatsApp/Instagram.
                try {
                    if ("clearAppBadge" in navigator) {
                        navigator.clearAppBadge();
                    }
                } catch {
                    /* badge unsupported — ignore */
                }
            }
            // Clear only the aggregate chat badge when navigating to chat tab
            // Per-conversation unread counts are managed by Chat.tsx (cleared when user opens that specific conversation)
            if (tab === "chat") {
                setChatBadgeCount(0);
                // Cache-first (stale-while-revalidate): paint the list INSTANTLY
                // from CacheStorage/Dexie — WhatsApp-style — then reconcile with
                // the server in the background. New conversations/messages that
                // arrived while away are still picked up: socket events evict the
                // cached list + upsert Dexie in realtime, the 30s SWR timer keeps
                // it warm, and the background reconcile lands fresh data right
                // after paint. Bypassing here forced a full network round-trip on
                // every chat-tab open (visible delay / list reload on slow or
                // cold-starting servers).
                fetchConversations();
            }
            navigateToTab(tab);
        },
        [user?.username, navigateToTab],
    );

    const handlePostSelectionBySlug = useCallback(
        (slug: string, openComments?: boolean) => {
            setSinglePostSlug(slug);
            setAutoOpenComments(!!openComments);
            navigateToTab("home");
        },
        [navigateToTab],
    );

    // Non-admins who land on the admin tab (a stale saved localStorage tab
    // from before a demotion) get sent home as soon as the session resolves —
    // the tab is invisible to them anyway.
    useEffect(() => {
        if (user && !user.isAdmin && currentTab === "admin") {
            setTab("home");
        }
    }, [user, currentTab]);

    const handleFollowSuggestion = useCallback(
        async (userId: string) => {
            // Optimistic update
            const currentState = followingStates[userId];
            setFollowingStates((prev) => ({
                ...prev,
                [userId]: !currentState,
            }));

            try {
                const res = await apiFetch(`/api/follows/${userId}`, {
                    method: "POST",
                });
                const data = await res.json();
                if (res.ok && data.success) {
                    // Following state is now tracked via followingStates —
                    // keep user visible with "Following" indicator instead of removing.
                    setFollowingStates((prev) => ({
                        ...prev,
                        [userId]: data.following,
                    }));
                    // Fetch fresh suggestions after a brief delay so the server
                    // can exclude the just-followed user from the next batch.
                    if (followFetchTimeoutRef.current) {
                        clearTimeout(followFetchTimeoutRef.current);
                    }
                    followFetchTimeoutRef.current = setTimeout(
                        () => fetchSuggestions(),
                        400,
                    );
                } else {
                    throw new Error(
                        data.message || "Failed to follow suggestion",
                    );
                }
            } catch (e: any) {
                logger.error("Follow recommendation toggling difficulty", e);
                // Revert on error
                setFollowingStates((prev) => ({
                    ...prev,
                    [userId]: currentState,
                }));
            }
        },
        [followingStates, navigateToTab, fetchSuggestions],
    );

    // Skip / dismiss a recommendation — the server permanently filters this
    // user out of future suggestion batches (feedback loop).
    const handleDismissSuggestion = useCallback(
        async (userId: string) => {
            // Snapshot so we can restore on failure
            const removed =
                suggestions.find((u) => u._id === userId) || null;
            setSuggestions((prev) => prev.filter((u) => u._id !== userId));
            try {
                const res = await apiFetch("/api/users/suggestions/dismiss", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ userId }),
                });
                if (!res.ok) throw new Error("Dismiss failed");
            } catch (e: any) {
                logger.error("Failed to dismiss suggestion", e);
                // Roll back the optimistic removal so a failed request doesn't
                // silently delete a recommendation.
                if (removed) {
                    setSuggestions((prev) =>
                        prev.some((u) => u._id === userId)
                            ? prev
                            : [removed, ...prev],
                    );
                }
            }
        },
        [suggestions],
    );

    // Only show the back arrow when there's an in-app screen to step back to
    // (navPos > 1 means snapshots were pushed on top of the root entry).
    const canGoBack = navPos > 1;

    const handleGoBack = useCallback(() => {
        // Route through the browser history so the OS/browser back button and
        // the in-app arrow share one stack — `popstate` restores the previous
        // tab/profile/post snapshot. At the root entry there's nothing to step
        // back to in-app; the arrow is hidden (canGoBack) so this won't fire.
        if (navPosRef.current > 1) {
            window.history.back();
        }
    }, []);

    const scrollToAuthSection = useCallback(() => {
        document
            .getElementById("auth-section")
            ?.scrollIntoView({ behavior: "smooth" });
    }, []);

    const scrollToSignupSection = useCallback(() => {
        setShowSignupForm(true);
        requestAnimationFrame(scrollToAuthSection);
    }, []);

    return (
        <>
            {/* Skip-to-content link for keyboard users — first focusable element */}
            <a
                href="#main-content"				className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:px-4 focus:py-2 focus:bg-violet-500 focus:text-white focus:font-bold focus:rounded-lg focus:outline-none focus:ring-2 focus:ring-white/50"
            >
                Skip to content
            </a>
            <ErrorBoundary>
                <div
                    className={`relative isolate z-0 mobile-shell text-slate-800 dark:text-zinc-100 selection:bg-zinc-800/10 dark:selection:bg-white/10 antialiased font-ui flex flex-col justify-start bg-transparent transition-colors duration-500 overflow-x-hidden ${
                        sessionChecked && !user && !publicFeedMode
                            ? "landing-shell min-h-dvh"
                            : "min-h-dvh h-dvh"
                    }`}
                >
                    {/* Static ambient light — gives every glass surface something to
				    frost (backdrop-blur is invisible against pure black). Fixed,
				    zero motion, zero color — pure zinc/white glows. Shown on ALL
				    screen sizes so the app background is identical on mobile,
				    tablet and desktop. */}
                    <div aria-hidden="true" className="app-ambient" />

                    {/* Global Fullscreen Image Viewer Modal (lazy) */}
                    <Suspense fallback={null}>
                        <ImagePreviewRenderer />
                    </Suspense>

                    {/* Global Compose / Create Post Modal (lazy) */}
                    <Suspense fallback={null}>
                        <PostModal
                            isOpen={composeOpen}
                            currentUserId={user?._id}
                            onClose={() => setComposeOpen(false)}
                            onPostCreated={() => {
                                setComposeOpen(false);
                                setTab("home");
                                setSinglePostSlug(null);
                                window.dispatchEvent(
                                    new Event("forceFeedRefresh"),
                                );
                            }}
                        />
                    </Suspense>

                    {/* First-run device-permission onboarding — once per account */}
                    <Suspense fallback={null}>
                        <PermissionOnboarding
                            open={showPermissionOnboarding && !!user}
                            onComplete={() => {
                                setShowPermissionOnboarding(false);
                                // After the one-time setup (whether enabled or skipped),
                                // silently re-sync the push subscription — no prompt; only
                                // acts when permission is already granted. Covers returning
                                // users who granted notifications before this feature.
                                ensurePushSubscription();
                            }}
                        />
                    </Suspense>

                    {/* Achievement detail — perk preview for ANY badge (locked
                        shows what you'll get; unlocked shows the active perk +
                        where to enable it). */}
                    <Suspense fallback={null}>
                        <AchievementDetailModal
                            badgeId={detailBadge?.badgeId || null}
                            earned={earnedBadges}
                            progressText={detailBadge?.progressText}
                            onClose={() => setDetailBadge(null)}
                            onOpenAppearance={() => {
                                setTab("settings");
                                setSettingsSubTabRequest({
                                    tab: "appearance",
                                    nonce: Date.now(),
                                });
                            }}
                        />
                    </Suspense>

                    <AnimatePresence mode="wait">
                        {!sessionChecked ? (
                            // Session check in progress — show minimal loader
                            // instead of flashing the landing page.
                            <motion.div
                                key="session-loading"
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                                transition={{ duration: 0 }}
                                className="w-full min-h-dvh bg-zinc-950 flex items-center justify-center"
                            >
                                <div className="flex flex-col items-center gap-3">
                                    <div className="h-8 w-8 border-2 border-zinc-700 border-t-zinc-300 rounded-full animate-spin" />
                                    <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">Loading…</p>
                                </div>
                            </motion.div>
                        ) : sessionChecked && !user && !publicFeedMode ? (
                            <motion.div
                                key="logged-out-section"
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                                transition={{ duration: 0.5 }}
                                className="w-full min-h-dvh"
                            >
                                {/* The app's logged-out landing — the SAME page as the standalone
                                    waitlist landing (nav, hero, chapters, features, showcase, lab,
                                    footer) with the waitlist form swapped for the real login/signup
                                    form embedded in the page flow. Lazy — logged-out only. */}
                                <Suspense
                                    fallback={
                                        <div className="min-h-dvh bg-zinc-950 animate-pulse" />
                                    }
                                >
                                    <LandingRoot
                                        onAuthSuccess={handleAuthSuccess}
                                        onForgotPasswordClick={() =>
                                            setForgotPasswordOpen(true)
                                        }
                                        onBackToLogin={() =>
                                            setForgotPasswordOpen(false)
                                        }
                                        initialShowSignup={showSignupForm}
                                        forgotPasswordOpen={forgotPasswordOpen}
                                    />
                                </Suspense>
                            </motion.div>
                        ) : (
                            <motion.div
                                key="logged-in-section"
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                                transition={{ duration: 0.5 }}								className="w-full h-dvh max-h-dvh overflow-hidden flex flex-col justify-between relative z-0"
							>
								{/* God-mode maintenance gate — the admin can shut the whole app
								    down for everyone except admins via the maintenance_mode
								    feature flag. */}
								{featureFlags.maintenance_mode && user && !user.isAdmin && (
									<div className="absolute inset-0 z-[800] flex flex-col items-center justify-center gap-3 bg-zinc-950 px-6 text-center">
										<Wrench className="h-10 w-10 text-amber-400" />
										<h2 className="text-display-sm font-black text-white">
											We're making things better
										</h2>
										<p className="max-w-sm text-sm text-zinc-400">
											ORBIT is briefly under maintenance. Check back
											in a few minutes — your circle will still be here.
										</p>
									</div>
								)}

								{/* Admin announcements — instantly visible to every user. */}
								<BroadcastBanner />

								{/* Main Content Area Routing with Global Full Widescreen Grid */}
								{publicFeedMode && !user && (
                                    <div className="flex items-center justify-between px-4 sm:px-6 py-3 sm:py-4 border-b border-zinc-800/50 bg-zinc-950/80 backdrop-blur-xl">
                                        <div>
                                            <h2 className="text-label text-base font-semibold text-white">
                                                Explore Public Feed
                                            </h2>
                                            <p className="text-[11px] text-zinc-400 mt-0.5">
                                                Browsing posts — sign in to
                                                interact
                                            </p>
                                        </div>
                                        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                                            <button
                                                onClick={() => {
                                                    setPublicFeedMode(false);
                                                    setShowSignupForm(false);
                                                    scrollToAuthSection();
                                                }}								className="rounded-full bg-violet-500/15 hover:bg-violet-500/25 border border-violet-300/30 px-4 py-1.5 text-[12px] md:text-sm font-bold text-violet-100 transition-all cursor-pointer"
                                            >
                                                Sign In
                                            </button>
                                            <button
                                                onClick={() => {
                                                    setPublicFeedMode(false);
                                                    setShowSignupForm(true);
                                                    scrollToSignupSection();
                                                }}								className="rounded-full bg-aurora text-white border border-white/10 px-4 py-1.5 text-[12px] md:text-sm font-bold shadow-aurora transition-all hover:opacity-90 cursor-pointer"
                                            >
                                                Create Account
                                            </button>
                                        </div>
                                    </div>
                                )}
                                {/* Animated background (stellar theme) — fixed behind every screen */}
                                {bgTheme === "stellar" && (
                                    <Suspense fallback={null}>
                                        <BackgroundGradients />
                                    </Suspense>
                                )}
                                <main className="grow min-h-0 overflow-y-auto sm:overflow-hidden flex items-stretch justify-center py-0 sm:py-3 lg:py-6 w-full h-full">
                                    {(user || publicFeedMode) && (
                                        <div
                                            className={`w-full h-full max-w-[1440px] mx-auto overflow-hidden ${
                                                currentTab === "chat" ||
                                                currentTab === "communities"
                                                    ? "px-0 sm:px-6 lg:px-8"
                                                    : "px-1.5 sm:px-6 lg:px-8"
                                            }`}
                                        >
                                            {/* Semantic page heading — visually hidden but provides proper h1 hierarchy for screen readers */}
                                            <h1 className="sr-only">
                                                {currentTab === "home" &&
                                                    "Home Feed — Orbit"}
                                                {currentTab === "explore" &&
                                                    "Explore — Orbit"}
                                                {currentTab ===
                                                    "notifications" &&
                                                    "Notifications — Orbit"}
                                                {currentTab === "chat" &&
                                                    "Messages — Orbit"}
                                                {currentTab === "communities" &&
                                                    "Communities — Orbit"}
                                                {currentTab === "profile" &&
                                                    (selectedUserUsername
                                                        ? `${selectedUserUsername} — Orbit`
                                                        : "Profile — Orbit")}
                                                {currentTab === "settings" &&
                                                    "Settings — Orbit"}
                                                {currentTab === "admin" &&
                                                    "Admin Dashboard — Orbit"}
                                                Orbit{!user ? " — Sign In" : ""}
                                            </h1>
                                            <div
                                                id="main-content"
                                                className="flex items-start justify-center gap-4 sm:gap-5 lg:gap-6 w-full h-full"
                                            >
                                                {user && (
                                                    <div className="hidden sm:block sidebar-force-show w-48 md:w-56 lg:w-60 xl:w-64 shrink-0 h-full overflow-hidden pb-3.5 pt-3.5 lg:pt-0 lg:pb-0">
                                                        <Suspense
                                                            fallback={
                                                                <div className="w-full h-full rounded-2xl border border-zinc-800/60 bg-zinc-950/40 animate-pulse" />
                                                            }
                                                        >
                                                            <LeftSidebar
                                                                user={user}
                                                                currentTab={
                                                                    currentTab
                                                                }
                                                                setTab={(
                                                                    tab,
                                                                ) => {
                                                                    if (
                                                                        tab ===
                                                                        "home"
                                                                    ) {
                                                                        setSinglePostSlug(
                                                                            null,
                                                                        );
                                                                    }
                                                                    if (
                                                                        tab ===
                                                                        "compose"
                                                                    ) {
                                                                        setComposeOpen(
                                                                            true,
                                                                        );
                                                                        return;
                                                                    }
                                                                    setTab(tab);
                                                                }}
                                                                setSelectedUserUsername={
                                                                    setSelectedUserUsername
                                                                }
                                                                badgeCount={
                                                                    badgeCount
                                                                }
                                                                chatBadgeCount={
                                                                    chatBadgeCount
                                                                }
                                                            />
                                                        </Suspense>
                                                    </div>
                                                )}
                                                <div
                                                    ref={mainColumnRef}
                                                    className={`${
                                                        currentTab === "chat"
                                                            ? "max-w-[44rem] xl:max-w-[48rem] overflow-hidden"
                                                            : currentTab ===
                                                                "communities"
                                                              ? "max-w-[44rem] xl:max-w-[48rem] overflow-hidden"
                                                              : currentTab ===
                                                                  "settings"
                                                                ? "max-w-[44rem] xl:max-w-[48rem] overflow-y-auto"
                                                                : currentTab ===
                                                                    "admin"
                                                                  ? "max-w-[62rem] xl:max-w-[72rem] overflow-y-auto"
                                                                  : "max-w-[42rem] overflow-y-auto"
                                                    } w-full min-w-0 flex-1 h-full ${currentTab === "chat" || (currentTab === "communities" && hasCommunityChatOpen) ? "pb-0 sm:pb-safe-bottom" : "pb-24 sm:pb-safe-bottom"} ${(currentTab === "chat" && hasActiveConversation) || currentTab === "communities" ? "pt-0 pr-0 sm:pt-3.5 lg:pt-0" : "sm:pt-3.5 lg:pt-0"}`}
                                                >
                                                    {commentsOpen && (
                                                        <motion.button
                                                            initial={{
                                                                opacity: 0,
                                                                x: -10,
                                                            }}
                                                            animate={{
                                                                opacity: 1,
                                                                x: 0,
                                                            }}
                                                            exit={{
                                                                opacity: 0,
                                                                x: -10,
                                                            }}
                                                            onClick={() =>
                                                                window.dispatchEvent(
                                                                    new CustomEvent(
                                                                        "closeComments",
                                                                    ),
                                                                )
                                                            }
                                                            className="mb-4 flex h-8 w-8 items-center justify-center rounded-full border border-zinc-200/10 bg-white/5 hover:bg-white/10 text-zinc-400 hover:text-white transition-all cursor-pointer shadow-sm shrink-0"
                                                            title="Close comments"
                                                        >
                                                            <ArrowLeft className="h-3.5 w-3.5" />
                                                        </motion.button>
                                                    )}

                                                    <ErrorBoundary>
                                                        <Suspense
                                                            fallback={
                                                                <div className="h-32 animate-pulse rounded-3xl border border-zinc-800 bg-zinc-950/20" />
                                                            }
                                                        >
                                                            <AnimatePresence
                                                                mode="wait"
                                                                initial={false}
                                                            >
                                                                {currentTab ===
                                                                    "home" && (
                                                                    <motion.div
                                                                        key="home"
                                                                        className="relative min-h-[calc(100vh-2rem)]"
                                                                        initial={{
                                                                            opacity: 0,
                                                                        }}
                                                                        animate={{
                                                                            opacity: 1,
                                                                        }}
                                                                        exit={{
                                                                            opacity: 0,
                                                                        }}
                                                                        transition={{
                                                                            duration: 0,
                                                                        }}
                                                                    >
                                                                        <div className="relative z-10 w-full h-full">
                                                                            <Feed
                                                                                user={
                                                                                    user
                                                                                }
                                                                                readOnly={
                                                                                    publicFeedMode &&
                                                                                    !user
                                                                                }
                                                                                onUserSelected={
                                                                                    handleUserSelection
                                                                                }
                                                                                singlePostSlug={
                                                                                    singlePostSlug
                                                                                }
                                                                                autoOpenComments={
                                                                                    autoOpenComments
                                                                                }
                                                                                onClearAutoOpenComments={() => {
                                                                                    setAutoOpenComments(
                                                                                        false,
                                                                                    );
                                                                                }}
                                                                                onClearSinglePost={() => {
                                                                                    setSinglePostSlug(
                                                                                        null,
                                                                                    );
                                                                                    setAutoOpenComments(
                                                                                        false,
                                                                                    );
                                                                                }}
                                                                                followingStates={
                                                                                    followingStates
                                                                                }
                                                                                onCommentsOpenChange={
                                                                                    setCommentsOpen
                                                                                }
                                                                            />
                                                                        </div>
                                                                    </motion.div>
                                                                )}
                                                                {currentTab ===
                                                                    "explore" && (
                                                                    <motion.div
                                                                        key="explore"
                                                                        initial={{
                                                                            opacity: 0,
                                                                        }}
                                                                        animate={{
                                                                            opacity: 1,
                                                                        }}
                                                                        exit={{
                                                                            opacity: 0,
                                                                        }}
                                                                        transition={{
                                                                            duration: 0,
                                                                        }}
                                                                    >
                                                                        <Explore
                                                                            onUserSelected={
                                                                                handleUserSelection
                                                                            }
                                                                            onPostSelected={
                                                                                handlePostSelectionBySlug
                                                                            }
                                                                            user={
                                                                                user
                                                                            }
                                                                            followingStates={
                                                                                followingStates
                                                                            }
                                                                            requestedFollows={
                                                                                requestedFollows
                                                                            }
                                                                            onToggleFollow={
                                                                                onToggleFollow
                                                                            }
                                                                            searchQuery={
                                                                                exploreSearch.query
                                                                            }
                                                                            searchNonce={
                                                                                exploreSearch.nonce
                                                                            }
                                                                        />
                                                                    </motion.div>
                                                                )}
                                                                {currentTab ===
                                                                    "notifications" && (
                                                                    <motion.div
                                                                        key="notifications"
                                                                        initial={
                                                                            false
                                                                        }
                                                                        animate={{
                                                                            opacity: 1,
                                                                        }}
                                                                        exit={{
                                                                            opacity: 0,
                                                                        }}
                                                                        transition={{
                                                                            duration: 0,
                                                                        }}
                                                                    >
                                                                        <Notifications
                                                                            user={
                                                                                user
                                                                            }
                                                                            socket={
                                                                                socket
                                                                            }
                                                                            onPostClick={
                                                                                handlePostSelectionBySlug
                                                                            }
                                                                            onUserClick={
                                                                                handleUserSelection
                                                                            }
                                                                            onBadgeReset={
                                                                                handleBadgeReset
                                                                            }
                                                                            onCommunityClick={(communityId) => {
                                                                                setCommunityToOpen(communityId);
                                                                                setTab("communities");
                                                                            }}
                                                                        />
                                                                    </motion.div>
                                                                )}
                                                                {currentTab ===
                                                                    "saved" && (
                                                                    <motion.div
                                                                        key="saved"
                                                                        initial={{
                                                                            opacity: 0,
                                                                        }}
                                                                        animate={{
                                                                            opacity: 1,
                                                                        }}
                                                                        exit={{
                                                                            opacity: 0,
                                                                        }}
                                                                        transition={{
                                                                            duration: 0,
                                                                        }}
                                                                    >
                                                                        <Feed
                                                                            user={
                                                                                user
                                                                            }
                                                                            onUserSelected={
                                                                                handleUserSelection
                                                                            }
                                                                            searchQuery=""
                                                                            onClearSinglePost={() => {}}
                                                                            singlePostSlug={
                                                                                null
                                                                            }
                                                                            showSavesOnly={
                                                                                true
                                                                            }
                                                                            followingStates={
                                                                                followingStates
                                                                            }
                                                                            onCommentsOpenChange={
                                                                                setCommentsOpen
                                                                            }
                                                                        />
                                                                    </motion.div>
                                                                )}
                                                                {currentTab ===
                                                                    "reposts" && (
                                                                    <motion.div
                                                                        key="reposts"
                                                                        initial={{
                                                                            opacity: 0,
                                                                        }}
                                                                        animate={{
                                                                            opacity: 1,
                                                                        }}
                                                                        exit={{
                                                                            opacity: 0,
                                                                        }}
                                                                        transition={{
                                                                            duration: 0,
                                                                        }}
                                                                    >
                                                                        <Feed
                                                                            user={
                                                                                user
                                                                            }
                                                                            onUserSelected={
                                                                                handleUserSelection
                                                                            }
                                                                            searchQuery=""
                                                                            onClearSinglePost={() => {}}
                                                                            singlePostSlug={
                                                                                null
                                                                            }
                                                                            showRepostsOnly={
                                                                                true
                                                                            }
                                                                            followingStates={
                                                                                followingStates
                                                                            }
                                                                            onCommentsOpenChange={
                                                                                setCommentsOpen
                                                                            }
                                                                        />
                                                                    </motion.div>
                                                                )}
                                                                {user &&
                                                                    currentTab ===
                                                                        "profile" && (
                                                                        <motion.div
                                                                            key="profile"
                                                                            initial={{
                                                                                opacity: 0,
                                                                            }}
                                                                            animate={{
                                                                                opacity: 1,
                                                                            }}
                                                                            exit={{
                                                                                opacity: 0,
                                                                            }}
                                                                            transition={{
                                                                                duration: 0,
                                                                            }}
                                                                        >
                                                                            <Profile
                                                                                user={
                                                                                    user
                                                                                }
                                                                                targetUsername={
                                                                                    selectedUserUsername ||
                                                                                    user.username
                                                                                }
                                                                                onUserUpdate={(
                                                                                    u,
                                                                                ) =>
                                                                                    setUser(
                                                                                        u,
                                                                                    )
                                                                                }
                                                                                onPostClick={
                                                                                    handlePostSelectionBySlug
                                                                                }
                                                                                onUserClick={
                                                                                    handleUserSelection
                                                                                }
                                                                                followingStates={
                                                                                    followingStates
                                                                                }
                                                                                requestedFollows={
                                                                                    requestedFollows
                                                                                }
                                                                                onToggleFollow={
                                                                                    onToggleFollow
                                                                                }
                                                                                onProfileLoaded={
                                                                                    handleProfileLoaded
                                                                                }
                                                                                onBack={
                                                                                    canGoBack
                                                                                        ? handleGoBack
                                                                                        : undefined
                                                                                }
                                                                                onMessageUser={
                                                                                    handleMessageUser
                                                                                }
                                                                            />
                                                                        </motion.div>
                                                                    )}{" "}
                                                                {user?.isAdmin &&
                                                                    currentTab ===
                                                                        "admin" && (
                                                                        <motion.div
                                                                            key="admin"
                                                                            initial={{
                                                                                opacity: 0,
                                                                            }}
                                                                            animate={{
                                                                                opacity: 1,
                                                                            }}
                                                                            exit={{
                                                                                opacity: 0,
                                                                            }}
                                                                            transition={{
                                                                                duration: 0,
                                                                            }}
                                                                        >
                                                                            <AdminDashboard />
                                                                        </motion.div>
                                                                    )}
                                                                {user &&
                                                                    currentTab ===
                                                                        "settings" && (
                                                                        <motion.div
                                                                            key="settings"
                                                                            initial={{
                                                                                opacity: 0,
                                                                            }}
                                                                            animate={{
                                                                                opacity: 1,
                                                                            }}
                                                                            exit={{
                                                                                opacity: 0,
                                                                            }}
                                                                            transition={{
                                                                                duration: 0,
                                                                            }}
                                                                        >
                                                                            {" "}													<Settings
														user={
															user
														}
														onLogout={
																handleLogout
															}
														bgTheme={
															bgTheme
														}
														onBgThemeChange={
																changeBgTheme
															}
														colorTheme={
															colorTheme
														}
																												onColorThemeChange={changeColorTheme}
														unlockedThemes={unlockedThemes}
														subTabRequest={settingsSubTabRequest}
														/>
                                                                        </motion.div>
                                                                    )}
                                                                {user &&
                                                                    currentTab ===
                                                                        "chat" && (
                                                                        <motion.div
                                                                            key="chat"
                                                                            initial={{
                                                                                opacity: 0,
                                                                            }}
                                                                            animate={{
                                                                                opacity: 1,
                                                                            }}
                                                                            exit={{
                                                                                opacity: 0,
                                                                            }}
                                                                            transition={{
                                                                                duration: 0,
                                                                            }}
                                                                            className="h-full"
                                                                        >
                                                                            <Chat
                                                                                user={
                                                                                    user
                                                                                }
                                                                                socket={
                                                                                    socket
                                                                                }
                                                                                conversations={
                                                                                    conversations
                                                                                }
                                                                                conversationsLoading={
                                                                                    conversationsLoading
                                                                                }
                                                                                setConversations={
                                                                                    setConversations
                                                                                }
                                                                                onUserSelected={
                                                                                    handleUserSelection
                                                                                }
                                                                                onBack={() =>
                                                                                    setTab(
                                                                                        "home",
                                                                                    )
                                                                                }
                                                                                onChatConversationChange={
                                                                                    setHasActiveConversation
                                                                                }
                                                                                onStartCall={
                                                                                    handleStartCall
                                                                                }
                                                                                openWithUserId={
                                                                                    chatOpenWithUserId
                                                                                }
                                                                                openConversationId={
                                                                                    activeConversationId
                                                                                }
                                                                                onConversationOpenChange={
                                                                                    setActiveConversationId
                                                                                }
                                                                                onOpenWithUserIdHandled={() =>
                                                                                    setChatOpenWithUserId(
                                                                                        null,
                                                                                    )
                                                                                }
                                                                            />
                                                                        </motion.div>
                                                                    )}
                                                                {user &&
                                                                    currentTab ===
                                                                        "communities" && (
                                                                        <motion.div
                                                                            key="communities"
                                                                            initial={{
                                                                                opacity: 0,
                                                                                y: 10,
                                                                            }}
                                                                            animate={{
                                                                                opacity: 1,
                                                                                y: 0,
                                                                            }}
                                                                            exit={{
                                                                                opacity: 0,
                                                                                y: -10,
                                                                            }}
                                                                            transition={{
                                                                                duration: 0.2,
                                                                            }}
                                                                            className="h-full w-full"
                                                                        >
                                                                            {" "}
                                                                            <Communities
                                                                                user={
                                                                                    user
                                                                                }
                                                                                socket={
                                                                                    socket
                                                                                }
                                                                                onUserSelected={
                                                                                    handleUserSelection
                                                                                }
                                                                                onCommunityChatChange={
                                                                                    setHasCommunityChatOpen
                                                                                }
                                                                                onCommunityOpenChange={
                                                                                    setCommunityToOpen
                                                                                }
                                                                                openCommunityId={
                                                                                    communityToOpen
                                                                                }
                                                                            />
                                                                        </motion.div>
                                                                    )}{" "}
                                                            </AnimatePresence>{" "}
                                                        </Suspense>{" "}
                                                    </ErrorBoundary>
                                                </div>{" "}
                                                {/* Right Sidebar: Dual Liquid Glass Containers for Suggestions & Features */}
                                                {user &&
                                                    currentTab !== "chat" &&
                                                    currentTab !==
                                                        "communities" &&
                                                    currentTab !==
                                                        "settings" && (
                                                        <div className="w-80 space-y-5 hidden xl:flex flex-col h-full overflow-hidden select-none shrink-0 pb-safe-bottom">
                                                            {/* 1. People Recommendations Box with macOS spring animations */}
                                                            <GlassCard
                                                                animate={true}
                                                                className="p-6"
                                                            >
                                                                <h3 className="text-label mb-4 pr-0.5 text-zinc-300 dark:text-zinc-300">
                                                                    Recommended
                                                                    Users
                                                                </h3>

                                                                <AnimatePresence mode="wait">
                                                                    {loadingSuggestions ? (
                                                                        <motion.div
                                                                            key="loading"
                                                                            initial={{
                                                                                opacity: 0,
                                                                            }}
                                                                            animate={{
                                                                                opacity: 1,
                                                                            }}
                                                                            exit={{
                                                                                opacity: 0,
                                                                            }}
                                                                            transition={{
                                                                                duration: 0.2,
                                                                            }}
                                                                            className="space-y-4 py-2"
                                                                        >
                                                                            {[
                                                                                1,
                                                                                2,
                                                                                3,
                                                                            ].map(
                                                                                (
                                                                                    n,
                                                                                ) => (
                                                                                    <div
                                                                                        key={
                                                                                            n
                                                                                        }
                                                                                        className="flex items-center justify-between gap-3"
                                                                                        style={
                                                                                            {
                                                                                                "--shimmer-delay": `${(n - 1) * 0.15}s`,
                                                                                            } as React.CSSProperties
                                                                                        }
                                                                                    >
                                                                                        <div className="flex items-center gap-3">
                                                                                            {/* Avatar shimmer */}
                                                                                            <div className="h-9 w-9 rounded-full shimmer-bg shrink-0" />
                                                                                            <div className="flex flex-col gap-1.5">
                                                                                                {/* Name shimmer — same width as text-xs extrabold */}
                                                                                                <div className="h-3 w-[88px] shimmer-bg rounded" />
                                                                                                {/* Username shimmer — same width as [10px] font-bold */}
                                                                                                <div className="h-[10px] w-[64px] shimmer-bg rounded" />
                                                                                            </div>
                                                                                        </div>
                                                                                        {/* Follow button shimmer */}
                                                                                        <div className="h-9 w-9 rounded-full shimmer-bg shrink-0" />
                                                                                    </div>
                                                                                ),
                                                                            )}
                                                                        </motion.div>
                                                                    ) : suggestions.length ===
                                                                      0 ? (
                                                                        <motion.p
                                                                            key="empty"
                                                                            initial={{
                                                                                opacity: 0,
                                                                                y: 5,
                                                                            }}
                                                                            animate={{
                                                                                opacity: 1,
                                                                                y: 0,
                                                                            }}
                                                                            exit={{
                                                                                opacity: 0,
                                                                                y: -5,
                                                                            }}
                                                                            transition={{
                                                                                duration: 0.2,
                                                                            }}
                                                                            className="text-[11px] text-zinc-400 dark:text-zinc-550 pl-0.5 py-4 leading-relaxed font-mono uppercase"
                                                                        >
                                                                            No
                                                                            new
                                                                            recommendations
                                                                            at
                                                                            this
                                                                            time
                                                                        </motion.p>
                                                                    ) : (
                                                                        <motion.div
                                                                            key="cards"
                                                                            initial={{
                                                                                opacity: 0,
                                                                            }}
                                                                            animate={{
                                                                                opacity: 1,
                                                                            }}
                                                                            exit={{
                                                                                opacity: 0,
                                                                            }}
                                                                            transition={{
                                                                                duration: 0.2,
                                                                            }}
                                                                            className="space-y-4"
                                                                        >
                                                                            <AnimatePresence mode="popLayout">
                                                                                {suggestions
                                                                                    .slice(
                                                                                        0,
                                                                                        6,
                                                                                    )
                                                                                    .map(
                                                                                        (
                                                                                            sugUser,
                                                                                        ) => (
                                                                                            <motion.div
                                                                                                key={
                                                                                                    sugUser._id
                                                                                                }
                                                                                                layout
                                                                                                initial={{
                                                                                                    opacity: 0,
                                                                                                    y: 16,
                                                                                                    scale: 0.95,
                                                                                                }}
                                                                                                animate={{
                                                                                                    opacity: 1,
                                                                                                    y: 0,
                                                                                                    scale: 1,
                                                                                                }}
                                                                                                exit={{
                                                                                                    opacity: 0,
                                                                                                    y: -8,
                                                                                                    scale: 0.9,
                                                                                                }}
                                                                                                transition={{
                                                                                                    duration: 0.25,
                                                                                                    ease: "easeOut",
                                                                                                }}
                                                                                                className="flex items-center justify-between gap-3 group/item"
                                                                                            >
                                                                                                <div
                                                                                                    onClick={() =>
                                                                                                        handleUserSelection(
                                                                                                            sugUser.username,
                                                                                                        )
                                                                                                    }
                                                                                                    className="flex items-center gap-3 cursor-pointer hover:opacity-85 transition-opacity"
                                                                                                >
                                                                                                    <UserAvatar
                                                                                                        src={
                                                                                                            sugUser
                                                                                                                .profilePic
                                                                                                                ?.url
                                                                                                        }
                                                                                                        alt=""
                                                                                                        className="h-9 w-9 rounded-full object-cover border border-zinc-800/60 shadow-sm shrink-0"
                                                                                                    />
                                                                                                    <div className="flex flex-col text-left">
                                                                                                        <span className="text-xs font-extrabold text-black dark:text-white line-clamp-1 hover:underline">
                                                                                                            {
                                                                                                                sugUser.fullName
                                                                                                            }
                                                                                                        </span>
                                                                                                        <span className="text-[10px] font-bold text-zinc-400 dark:text-zinc-550">
                                                                                                            @
                                                                                                            {
                                                                                                                sugUser.username
                                                                                                            }
                                                                                                        </span>
                                                                                                        {/* Why this user was recommended */}
                                                                                                        {sugUser.reason && (
                                                                                                            <span className="text-[9px] font-semibold text-zinc-500 dark:text-zinc-450 mt-0.5 line-clamp-1">
                                                                                                                {sugUser.reason ===
                                                                                                                "mutual"
                                                                                                                    ? `Followed by ${sugUser.mutualFollowersCount ?? 1} ${
                                                                                                                          (sugUser.mutualFollowersCount ??
                                                                                                                              1) === 1
                                                                                                                              ? "person"
                                                                                                                              : "people"
                                                                                                                      } you follow`
                                                                                                                    : sugUser.reason ===
                                                                                                                        "affinity"
                                                                                                                      ? "Because you interact with their content"
                                                                                                                      : sugUser.reason ===
                                                                                                                          "fresh"
                                                                                                                        ? "New & active on Orbit"
                                                                                                                        : "Popular creator"}
                                                                                                            </span>
                                                                                                        )}
                                                                                                    </div>
                                                                                                </div>
                                                                                                <div className="flex items-center gap-1.5 shrink-0">
                                                                    <motion.button
                                                                        whileHover={{
                                                                            scale: 1.1,
                                                                        }}
                                                                        whileTap={{
                                                                            scale: 0.9,
                                                                        }}
                                                                        onClick={() =>
                                                                            handleFollowSuggestion(
                                                                                sugUser._id,
                                                                            )
                                                                        }
                                                                        className={`rounded-full h-9 w-9 flex items-center justify-center transition-all cursor-pointer ${
                                                                            followingStates[
                                                                                sugUser._id
                                                                            ]
                                                                                ? "bg-zinc-900 text-zinc-400 border border-zinc-800"
                                                                                : "bg-aurora text-white border border-white/10 shadow-aurora hover:opacity-90"
                                                                        }`}
                                                                        title={
                                                                            followingStates[
                                                                                sugUser._id
                                                                            ]
                                                                                ? "Unfollow"
                                                                                : "Follow"
                                                                        }
                                                                    >
                                                                        {followingStates[
                                                                            sugUser._id
                                                                        ] ? (
                                                                            <Check className="h-4 w-4" />
                                                                        ) : (
                                                                            <UserPlus className="h-4 w-4" />
                                                                        )}
                                                                    </motion.button>
                                                                    <button
                                                                        onClick={() =>
                                                                            handleDismissSuggestion(
                                                                                sugUser._id,
                                                                            )
                                                                        }
                                                                        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-zinc-500 opacity-0 group-hover/item:opacity-100 focus-visible:opacity-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-700 dark:hover:text-zinc-200 transition-all cursor-pointer"
                                                                        title="Not interested — skip this recommendation"
                                                                        aria-label={`Dismiss suggestion for ${sugUser.username}`}
                                                                    >
                                                                        <X className="h-3 w-3" />
                                                                    </button>
                                                                </div>
                                                                                            </motion.div>
                                                                                        ),
                                                                                    )}
                                                                            </AnimatePresence>
                                                                        </motion.div>
                                                                    )}
                                                                </AnimatePresence>
                                                                {suggestions.length >
                                                                    0 && (
                                                                    <button
                                                                        onClick={() =>
                                                                            setTab(
                                                                                "explore",
                                                                            )
                                                                        }
                                                                        className="w-full mt-4 py-2 text-xs font-bold text-black dark:text-zinc-200 hover:underline transition-all cursor-pointer flex items-center justify-center gap-1"
                                                                    >
                                                                        Explore
                                                                        More{" "}
                                                                        <ArrowRight className="h-3 w-3" />
                                                                    </button>
                                                                )}
                                                            </GlassCard>

                                                        </div>
                                                    )}
                                            </div>
                                        </div>
                                    )}
                                </main>

                                {/* Center Apple Dock — hidden when chat or comments are open */}
                                {user && (
                                    <Suspense fallback={null}>
                                        {" "}
                                        {!(
                                            currentTab === "chat" &&
                                            hasActiveConversation
                                        ) &&
                                            !(
                                                currentTab === "communities" &&
                                                hasCommunityChatOpen
                                            ) && (												<Dock
													currentTab={currentTab}
													setTab={handleTabChange}
													badgeCount={badgeCount}
													chatBadgeCount={
														chatBadgeCount
													}
													isAdmin={user?.isAdmin}
													profilePicUrl={user?.profilePic?.url}
												/>
                                            )}
                                    </Suspense>
                                )}
                            </motion.div>
                        )}
                    </AnimatePresence>

                    {/* Sonner Toast — sleek glass toasts (styling lives in index.css under `.orbit-toast` / sonner theme vars) */}
                    <Toaster
                        theme="dark"
                        position="top-center"
                        richColors
                        closeButton
                        offset={16}
                        gap={10}
                        toastOptions={{
                            duration: 2200,
                            classNames: {
                                toast: "orbit-toast",
                                title: "orbit-toast-title",
                                description: "orbit-toast-desc",
                                actionButton: "orbit-toast-action",
                                cancelButton: "orbit-toast-cancel",
                                closeButton: "orbit-toast-close-btn",
                            },
                        }}
                    />

                    {/* Call UI Overlay (outside main layout flow) */}
                    {callState && socket && (
                        <Suspense fallback={null}>
                            <CallUI
                                socket={socket}
                                user={{
                                    _id: user?._id || "",
                                    fullName: user?.fullName || "",
                                    profilePic: user?.profilePic,
                                }}
                                callState={{
                                    type: callState.type,
                                    status: callState.status,
                                    partnerId: callState.partnerId,
                                    partnerName: callState.partnerName,
                                    partnerAvatar: callState.partnerAvatar,
                                }}
                                onEndCall={() => {
                                    // Cancel any pending ring timeout
                                    clearCallRingTimeout();
                                    socket.emit("call:end", {
                                        targetUserId: callState.partnerId,
                                    });
                                    // Stop bitrate monitor before closing PC
                                    cleanupBitrateMonitor(
                                        peerConnectionRef.current,
                                    );
                                    if (peerConnectionRef.current) {
                                        peerConnectionRef.current.close();
                                        peerConnectionRef.current = null;
                                    }
                                    if (localStreamRef.current) {
                                        localStreamRef.current
                                            .getTracks()
                                            .forEach((t) => t.stop());
                                        localStreamRef.current = null;
                                    }
                                    pendingCallOfferRef.current = null;
                                    setCallState(null);
                                }}
                                onAcceptCall={async () => {
                                    // Snapshot ref values at the START of the async flow
                                    // to avoid stale closure issues with callState.
                                    const acceptData =
                                        callAcceptDataRef.current;
                                    const partnerId =
                                        acceptData?.partnerId ||
                                        callState.partnerId;
                                    const callType =
                                        acceptData?.type || callState.type;

                                    try {
                                        // Mark as answered so the ring timeout is skipped
                                        callAnsweredRef.current = true;
                                        clearCallRingTimeout();
                                        // Clean up any existing PC/stream
                                        if (peerConnectionRef.current) {
                                            peerConnectionRef.current.close();
                                        }
                                        if (localStreamRef.current) {
                                            localStreamRef.current
                                                .getTracks()
                                                .forEach((t) => t.stop());
                                        }
                                        let stream: MediaStream;
                                        try {
                                            stream =
                                                await navigator.mediaDevices.getUserMedia(
                                                    {
                                                        audio: {
                                                            echoCancellation: true,
                                                            noiseSuppression: true,
                                                            autoGainControl: true,
                                                        },
                                                        video:
                                                            callType === "video"
                                                                ? isMobileDevice()
                                                                    ? {
                                                                          // Mobile: 480p@24 — same rationale as the
                                                                          // caller side (light encode + fits cellular).
                                                                          width: {
                                                                              ideal: 640,
                                                                          },
                                                                          height: {
                                                                              ideal: 480,
                                                                          },
                                                                          frameRate: {
                                                                              ideal: 24,
                                                                          },
                                                                      }
                                                                    : {
                                                                          width: {
                                                                              ideal: 1280,
                                                                          },
                                                                          height: {
                                                                              ideal: 720,
                                                                          },
                                                                          frameRate:
                                                                              {
                                                                                  ideal: 30,
                                                                              },
                                                                      }
                                                                : false,
                                                    },
                                                );
                                        } catch (videoErr) {
                                            logger.warn(
                                                "Callee: getUserMedia with HD video constraints failed, trying basic video constraints",
                                                videoErr,
                                            );
                                            try {
                                                if (callType === "video") {
                                                    stream =
                                                        await navigator.mediaDevices.getUserMedia(
                                                            {
                                                                audio: {
                                                                    echoCancellation: true,
                                                                    noiseSuppression: true,
                                                                    autoGainControl: true,
                                                                },
                                                                video: true,
                                                            },
                                                        );
                                                } else {
                                                    throw videoErr;
                                                }
                                            } catch (fallbackErr) {
                                                logger.warn(
                                                    "Callee: getUserMedia with basic video failed, falling back to audio only",
                                                    fallbackErr,
                                                );
                                                stream =
                                                    await navigator.mediaDevices.getUserMedia(
                                                        {
                                                            audio: {
                                                                echoCancellation: true,
                                                                noiseSuppression: true,
                                                                autoGainControl: true,
                                                            },
                                                            video: false,
                                                        },
                                                    );
                                            }
                                        }
                                        localStreamRef.current = stream;

                                        const pc = new RTCPeerConnection({
                                            iceServers: ICE_SERVERS,
                                        });
                                        peerConnectionRef.current = pc;

                                        // Set remote description first so transceivers are initialized from the offer
                                        const offer =
                                            pendingCallOfferRef.current;
                                        if (offer?.sdp) {
                                            // safeSetRemoteDescription retries
                                            // once with a sanitized SDP on
                                            // codec-parse failures — the
                                            // exact mobile "failed to accept
                                            // video call" crash.
                                            await safeSetRemoteDescription(
                                                pc,
                                                offer.sdp,
                                            );
                                            for (const candidate of pendingIceCandidatesRef.current.splice(
                                                0,
                                            )) {
                                                await pc.addIceCandidate(
                                                    new RTCIceCandidate(
                                                        candidate,
                                                    ),
                                                );
                                            }
                                        } else {
                                            throw new Error(
                                                "No pending offer found to accept",
                                            );
                                        }

                                        // Add audio track
                                        stream
                                            .getAudioTracks()
                                            .forEach((track) =>
                                                pc.addTrack(track, stream),
                                            );

                                        // Add video tracks (browser will automatically bind to offered transceivers)
                                        const videoTracks =
                                            stream.getVideoTracks();
                                        if (
                                            callType === "video" &&
                                            videoTracks.length > 0
                                        ) {
                                            videoTracks.forEach((track) =>
                                                pc.addTrack(track, stream),
                                            );
                                        }

                                        pc.onicecandidate = (e) => {
                                            if (e.candidate) {
                                                socket.emit(
                                                    "call:ice-candidate",
                                                    {
                                                        targetUserId: partnerId,
                                                        candidate: e.candidate,
                                                    },
                                                );
                                            }
                                        };

                                        pc.ontrack = (e) => {
                                            logger.info(
                                                "Call: received remote track (callee)",
                                                {
                                                    kind: e.track.kind,
                                                },
                                            );
                                            const stream = e.streams[0];
                                            if (stream) {
                                                remoteStreamRef.current =
                                                    stream;
                                            } else if (
                                                !remoteStreamRef.current
                                            ) {
                                                remoteStreamRef.current =
                                                    new MediaStream([e.track]);
                                            } else {
                                                remoteStreamRef.current.addTrack(
                                                    e.track,
                                                );
                                            }
                                        };

                                        // ── ICE connection state monitoring (callee) ─────
                                        callPartnerIdRef.current = partnerId;
                                        pc.oniceconnectionstatechange = () => {
                                            const state = pc.iceConnectionState;
                                            logger.info(
                                                "ICE connection state changed (callee)",
                                                {
                                                    state,
                                                    partnerId,
                                                },
                                            );
                                            setIceConnectionState(state);

                                            if (state === "disconnected") {
                                                if (
                                                    iceRestartTimeoutRef.current
                                                )
                                                    clearTimeout(
                                                        iceRestartTimeoutRef.current,
                                                    );
                                                iceRestartTimeoutRef.current =
                                                    setTimeout(() => {
                                                        const currentPc =
                                                            peerConnectionRef.current;
                                                        if (
                                                            currentPc &&
                                                            callPartnerIdRef.current
                                                        ) {
                                                            initiateIceRestart(
                                                                currentPc,
                                                                callPartnerIdRef.current,
                                                            );
                                                        }
                                                    }, 3000);
                                            } else if (state === "failed") {
                                                if (
                                                    iceRestartTimeoutRef.current
                                                )
                                                    clearTimeout(
                                                        iceRestartTimeoutRef.current,
                                                    );
                                                // Store in the ref so it can be
                                                // cleared if the connection recovers
                                                // before the restart fires.
                                                iceRestartTimeoutRef.current =
                                                    setTimeout(() => {
                                                        const currentPc =
                                                            peerConnectionRef.current;
                                                        if (
                                                            currentPc &&
                                                            callPartnerIdRef.current
                                                        ) {
                                                            initiateIceRestart(
                                                                currentPc,
                                                                callPartnerIdRef.current,
                                                            );
                                                        }
                                                    }, 0);
                                            } else if (
                                                state === "connected" ||
                                                state === "completed"
                                            ) {
                                                if (
                                                    iceRestartTimeoutRef.current
                                                ) {
                                                    clearTimeout(
                                                        iceRestartTimeoutRef.current,
                                                    );
                                                    iceRestartTimeoutRef.current =
                                                        null;
                                                }
                                                // Post-negotiation: enable VP9 SVC only
                                                // if VP9 was actually agreed (skipped
                                                // for H.264/VP8, e.g. iOS Safari peers).
                                                if (callType === "video") {
                                                    tryConfigureVideoSvc(
                                                        pc,
                                                    ).catch(() => {});
                                                }
                                            }
                                        };

                                        const answer = await pc.createAnswer();
                                        answer.sdp = setOpusBitrate(
                                            answer.sdp || "",
                                        );
                                        await pc.setLocalDescription(answer);

                                        socket.emit("call:answer", {
                                            targetUserId: partnerId,
                                            sdp: pc.localDescription,
                                        });

                                        // Start bandwidth-aware bitrate monitor (callee side)
                                        // 1.5 Mbps default ceiling — mobile-friendly.
                                        if (callType === "video") {
                                            const stopMonitor =
                                                startBitrateMonitor(
                                                    pc,
                                                    callType,
                                                    1_500_000,
                                                );
                                            (
                                                pc as any
                                            ).__bitrateMonitorCleanup =
                                                stopMonitor;
                                        }

                                        pendingCallOfferRef.current = null;
                                        setCallState((prev) =>
                                            prev
                                                ? { ...prev, status: "active" }
                                                : prev,
                                        );
                                    } catch (err: any) {
                                        logger.error(
                                            "Failed to accept call",
                                            err,
                                        );
                                        if (localStreamRef.current) {
                                            localStreamRef.current
                                                .getTracks()
                                                .forEach((t) => t.stop());
                                            localStreamRef.current = null;
                                        }
                                        pendingCallOfferRef.current = null;
                                        setCallState(null);
                                        window.dispatchEvent(
                                            new CustomEvent("showToast", {
                                                detail: {
                                                    message:
                                                        "Failed to accept call. " +
                                                        (err?.message ||
                                                            "Please try again."),
                                                    type: "error",
                                                },
                                            }),
                                        );
                                    }
                                }}
                                onRejectCall={() => {
                                    clearCallRingTimeout();
                                    socket.emit("call:end", {
                                        targetUserId: callState.partnerId,
                                    });
                                    pendingCallOfferRef.current = null;
                                    setCallState(null);
                                }}
                                localStreamRef={localStreamRef}
                                peerConnectionRef={peerConnectionRef}
                                remoteStreamRef={remoteStreamRef}
                                iceConnectionState={iceConnectionState}
                            />
                        </Suspense>
                    )}
                </div>
            </ErrorBoundary>
        </>
    );
}

// link rel=preconnect to res.cloudinary.com for faster image loads
