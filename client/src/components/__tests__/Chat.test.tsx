import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import Chat from "../Chat";

// ── Mock all heavy dependencies ─────────────────────────────────

vi.mock("../../utils/api", () => ({
  apiFetch: vi.fn(),
  uploadWithProgress: vi.fn(),
}));

vi.mock("../../utils/logger", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock("../../utils/validation", () => ({
  validateChatMessage: vi.fn(() => ({})),
}));

vi.mock("../hooks/useKeyboardOpen", () => ({
  useKeyboardOpen: () => false,
}));

// Mock motion/react (framer-motion)
vi.mock("motion/react", () => ({
  motion: {
    div: ({ children, ...props }: any) => {
      const { initial, animate, exit, transition, whileHover, whileTap, ...rest } = props;
      return <div {...rest}>{children}</div>;
    },
    button: ({ children, ...props }: any) => {
      const { initial, animate, exit, transition, whileHover, whileTap, ...rest } = props;
      return <button {...rest}>{children}</button>;
    },
  },
  AnimatePresence: ({ children }: any) => <>{children}</>,
}));

// Mock lucide-react icons
vi.mock("lucide-react", () => ({
  Mic: (props: any) => <span data-testid="icon-mic" {...props}>Mic</span>,
  Square: (props: any) => <span data-testid="icon-square" {...props}>Square</span>,
  Play: (props: any) => <span data-testid="icon-play" {...props}>Play</span>,
  Pause: (props: any) => <span data-testid="icon-pause" {...props}>Pause</span>,
  Send: (props: any) => <span data-testid="icon-send" {...props}>Send</span>,
  X: (props: any) => <span data-testid="icon-x" {...props}>X</span>,
  Phone: () => <span data-testid="icon-phone">Phone</span>,
  Video: () => <span data-testid="icon-video">Video</span>,
  Search: () => <span>Search</span>,
  ArrowLeft: () => <span>ArrowLeft</span>,
  Trash2: () => <span>Trash2</span>,
  MessageSquare: () => <span>MessageSquare</span>,
  Image: () => <span>Image</span>,
  Smile: () => <span>Smile</span>,
  Edit2: () => <span>Edit2</span>,
  Loader2: () => <span>Loader2</span>,
  CornerDownLeft: () => <span>CornerDownLeft</span>,
  Copy: () => <span>Copy</span>,
  Share2: () => <span>Share2</span>,
  User: () => <span>User</span>,
  MoreVertical: () => <span data-testid="icon-more-vertical">MoreVertical</span>,
  Archive: () => <span>Archive</span>,
  ArchiveRestore: () => <span>ArchiveRestore</span>,
  Star: () => <span>Star</span>,
  Clapperboard: () => <span>Clapperboard</span>,
  FileAudio: () => <span>FileAudio</span>,
  FileText: () => <span>FileText</span>,
  ChevronDown: () => <span>ChevronDown</span>,
  Pin: () => <span>Pin</span>,
  PinOff: () => <span>PinOff</span>,
  Bell: () => <span>Bell</span>,
  BellOff: () => <span>BellOff</span>,
  Download: () => <span>Download</span>,
  Languages: () => <span>Languages</span>,
  Shield: () => <span>Shield</span>,
  ShieldOff: () => <span>ShieldOff</span>,
  ShieldAlert: () => <span>ShieldAlert</span>,
  WifiOff: () => <span>WifiOff</span>,
  AlertCircle: () => <span>AlertCircle</span>,
  Hourglass: () => <span>Hourglass</span>,
  Timer: () => <span data-testid="icon-timer">Timer</span>,
  Info: () => <span>Info</span>,
  Paintbrush: () => <span>Paintbrush</span>,
}));

// Mock child components
vi.mock("../GlassCard", () => ({
  default: ({ children, className }: any) => <div className={className} data-testid="glass-card">{children}</div>,
}));

vi.mock("../UserAvatar", () => ({
  default: ({ src, alt, className }: any) => (
    <div data-testid="user-avatar" className={className} data-src={src} data-alt={alt} />
  ),
}));

vi.mock("../Skeleton", () => ({
  default: ({ variant }: any) => <div data-testid="skeleton" data-variant={variant} />,
}));

vi.mock("../ValidationMessage", () => ({
  default: ({ message }: any) => (message ? <div data-testid="validation-msg">{message}</div> : null),
}));

vi.mock("../MessageBubble", () => ({
  default: ({ msg, isMe }: any) => (
    <div data-testid="message-bubble" data-message-id={msg._id} data-is-me={isMe}>
      {msg.text}
    </div>
  ),
}));

// ── Mock Web APIs ────────────────────────────────────────────────

// Mock getUserMedia
const mockStream = {
  getTracks: () => [{ stop: vi.fn(), kind: "audio" }],
  getAudioTracks: () => [{ stop: vi.fn(), enabled: true, kind: "audio" }],
  getVideoTracks: () => [],
};

// MediaRecorder mock
class MockMediaRecorder {
  state: string = "inactive";
  ondataavailable: ((e: any) => void) | null = null;
  onstop: (() => void) | null = null;

  start() {
    this.state = "recording";
  }
  stop() {
    this.state = "inactive";
    // Simulate data available
    if (this.ondataavailable) {
      this.ondataavailable({ data: new Blob(["audio-data"], { type: "audio/webm" }) });
    }
    if (this.onstop) {
      this.onstop();
    }
  }
  static isTypeSupported(type: string) {
    return type === "audio/webm;codecs=opus";
  }
}

// ── Props factory ────────────────────────────────────────────────

const mockUser = {
  _id: "user1",
  username: "testuser",
  fullName: "Test User",
  email: "test@example.com",
  profilePic: { url: "/user.jpg" },
  followersCount: 10,
  followingCount: 5,
  postsCount: 3,
  viewsCount: 100,
  sharesCount: 2,
  createdAt: "2024-01-01T00:00:00Z",
};

const mockSocket = {
  emit: vi.fn(),
  on: vi.fn(),
  off: vi.fn(),
  connected: true,
} as any;

const mockConversation = {
  _id: "conv1",
  participants: [
    { _id: "user1", username: "testuser", fullName: "Test User", profilePic: { url: "/user.jpg" } },
    { _id: "partner1", username: "alice", fullName: "Alice", profilePic: { url: "/alice.jpg" } },
  ],
  lastMessage: null,
  unreadCounts: { user1: 0 },
  presence: "online" as const,
  createdAt: "2024-01-01T00:00:00Z",
  updatedAt: "2024-01-01T00:00:00Z",
};

const defaultProps = {
  user: mockUser,
  socket: mockSocket,
  conversations: [mockConversation],
  setConversations: vi.fn(),
  onUserSelected: vi.fn(),
  onBack: vi.fn(),
};

// ── Tests ────────────────────────────────────────────────────────

describe("Chat Voice Notes", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    // Default apiFetch response (component calls /api/blocks/.../check on mount)
    const { apiFetch } = await import("../../utils/api");
    (apiFetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true, isBlocked: false }),
    });
    // Mock navigator.mediaDevices
    Object.defineProperty(navigator, "mediaDevices", {
      value: {
        getUserMedia: vi.fn().mockResolvedValue(mockStream),
      },
      writable: true,
      configurable: true,
    });
    // Mock MediaRecorder
    (global as any).MediaRecorder = MockMediaRecorder;
    // Mock URL.createObjectURL and revokeObjectURL
    global.URL.createObjectURL = vi.fn(() => "blob:mock-url");
    global.URL.revokeObjectURL = vi.fn();

    // Mock scrollIntoView
    Element.prototype.scrollIntoView = vi.fn();
  });

  // ── Mic Button Rendering ────────────────────────────────────

  it("renders the mic button in the message input area when a conversation is selected", async () => {
    render(<Chat {...defaultProps} />);

    // Click on the conversation to select it
    const convItem = screen.getByText("Alice");
    fireEvent.click(convItem);

    // The mic button should be in the input area
    const micButton = await screen.findByTestId("icon-mic");
    expect(micButton).toBeInTheDocument();
  });

  // ── Recording State ─────────────────────────────────────────

  it("shows recording indicator when mic button is clicked to start recording", async () => {
    render(<Chat {...defaultProps} />);

    // Select conversation to show input area
    fireEvent.click(screen.getByText("Alice"));
    const micButton = await screen.findByTestId("icon-mic");

    // Click mic to start recording
    await act(async () => {
      fireEvent.click(micButton.closest("button")!);
    });

    // Should show the recording indicator (red pulse dot + timer)
    expect(screen.getByText("0s")).toBeInTheDocument();

    // Should show the square (stop) icon
    expect(screen.getByTestId("icon-square")).toBeInTheDocument();

    // Mic button should still be present (it changes icon to Square)
    expect(screen.getByTestId("icon-square")).toBeInTheDocument();
  });

  it("stops recording and shows preview UI when mic is clicked again", async () => {
    render(<Chat {...defaultProps} />);

    // Select conversation
    fireEvent.click(screen.getByText("Alice"));
    const micButton = await screen.findByTestId("icon-mic");

    // Start recording
    await act(async () => {
      fireEvent.click(micButton.closest("button")!);
    });

    // Find the stop button (now showing Square icon)
    const stopButton = screen.getByTestId("icon-square").closest("button");

    // Stop recording
    await act(async () => {
      fireEvent.click(stopButton!);
    });

    // Should now show voice note preview: Play button, duration, Send, and Cancel
    expect(screen.getByTestId("icon-play")).toBeInTheDocument();
    expect(screen.getByTestId("icon-send")).toBeInTheDocument();
    expect(screen.getByTestId("icon-x")).toBeInTheDocument();
  });

  // ── Send Voice Note ─────────────────────────────────────────

  it("sends voice note via uploadWithProgress when send button is clicked", async () => {
    const { uploadWithProgress } = await import("../../utils/api");
    const mockUpload = uploadWithProgress as unknown as ReturnType<typeof vi.fn>;

    // Mock successful upload response
    mockUpload.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          success: true,
          sentMessage: {
            _id: "msg1",
            conversation: "conv1",
            text: "",
            sender: { _id: "user1", username: "testuser", fullName: "Test User" },
            recipient: "partner1",
            attachments: [{ url: "/voice.webm", type: "voice_note" }],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        }),
    });

    render(<Chat {...defaultProps} />);

    // Select conversation
    fireEvent.click(screen.getByText("Alice"));
    const micButton = await screen.findByTestId("icon-mic");

    // Start recording
    await act(async () => {
      fireEvent.click(micButton.closest("button")!);
    });

    // Stop recording
    const stopButton = screen.getByTestId("icon-square").closest("button");
    await act(async () => {
      fireEvent.click(stopButton!);
    });

    // Click send button
    const sendButton = screen.getByTestId("icon-send").closest("button");
    await act(async () => {
      fireEvent.click(sendButton!);
    });

    // uploadWithProgress should have been called with the endpoint and POST
    // options carrying the FormData plus a progress callback.
    expect(mockUpload).toHaveBeenCalledWith(
      expect.stringContaining("/api/chats/conversations/conv1/messages"),
      expect.objectContaining({
        method: "POST",
        body: expect.any(FormData),
        onProgress: expect.any(Function),
      })
    );
  });

  it("handles voice note send failure gracefully", async () => {
    const { uploadWithProgress } = await import("../../utils/api");
    const mockUpload = uploadWithProgress as unknown as ReturnType<typeof vi.fn>;
    const { logger } = await import("../../utils/logger");
    const mockLogger = logger as unknown as { error: ReturnType<typeof vi.fn> };

    // Mock failed upload response
    mockUpload.mockResolvedValueOnce({
      ok: false,
      json: () =>
        Promise.resolve({
          success: false,
          message: "Failed to upload voice note",
        }),
    });

    render(<Chat {...defaultProps} />);

    // Select conversation
    fireEvent.click(screen.getByText("Alice"));
    const micButton = await screen.findByTestId("icon-mic");

    // Record and send
    await act(async () => {
      fireEvent.click(micButton.closest("button")!);
    });
    const stopButton = screen.getByTestId("icon-square").closest("button");
    await act(async () => {
      fireEvent.click(stopButton!);
    });
    const sendButton = screen.getByTestId("icon-send").closest("button");
    await act(async () => {
      fireEvent.click(sendButton!);
    });

    // Error should be logged, and no toast should be dispatched
    expect(mockLogger.error).toHaveBeenCalled();
  });

  // ── Cancel Voice Note ───────────────────────────────────────

  it("cancels voice note preview when X button is clicked", async () => {
    render(<Chat {...defaultProps} />);

    // Select conversation
    fireEvent.click(screen.getByText("Alice"));
    const micButton = await screen.findByTestId("icon-mic");

    // Record
    await act(async () => {
      fireEvent.click(micButton.closest("button")!);
    });
    const stopButton = screen.getByTestId("icon-square").closest("button");
    await act(async () => {
      fireEvent.click(stopButton!);
    });

    // Cancel by clicking X
    const cancelButton = screen.getByTestId("icon-x").closest("button");
    await act(async () => {
      fireEvent.click(cancelButton!);
    });

    // Should return to normal input mode (mic button, no preview)
    expect(screen.getByTestId("icon-mic")).toBeInTheDocument();
    expect(screen.queryByTestId("icon-play")).not.toBeInTheDocument();
  });
});
