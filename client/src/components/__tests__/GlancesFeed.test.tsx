import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import GlancesFeed from "../GlancesFeed";

vi.mock("../../utils/api", () => ({
  apiFetch: vi.fn(),
}));

vi.mock("../../utils/logger", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

vi.mock("motion/react", () => ({
  motion: {
    div: ({ children, ...props }: any) => {
      const { initial, animate, exit, transition, ...rest } = props;
      return <div {...rest}>{children}</div>;
    },
    button: ({ children, ...props }: any) => {
      const { initial, animate, exit, transition, whileHover, whileTap, ...rest } = props;
      return <button {...rest}>{children}</button>;
    },
  },
  AnimatePresence: ({ children }: any) => <>{children}</>,
}));

vi.mock("lucide-react", () => ({
  Plus: (props: any) => <span {...props}>Plus</span>,
  Loader2: (props: any) => <span {...props}>Loader2</span>,
  Lock: (props: any) => <span {...props}>Lock</span>,
  Globe: (props: any) => <span {...props}>Globe</span>,
}));

vi.mock("../GlanceViewer", () => ({
  default: ({ glimpses, initialIndex, onClose }: any) => (
    <div data-testid="glance-viewer" data-count={glimpses.length} data-index={initialIndex}>
      <button onClick={onClose}>Close</button>
    </div>
  ),
}));

const mockUser = {
  _id: "user1",
  username: "testuser",
  fullName: "Test User",
  email: "test@example.com",
  profilePic: { url: "/test.jpg" },
  followersCount: 10,
  followingCount: 5,
  postsCount: 3,
  viewsCount: 100,
  sharesCount: 2,
  createdAt: "2024-01-01T00:00:00Z",
};

describe("GlancesFeed", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.URL.createObjectURL = vi.fn(() => "blob:mock");
    global.URL.revokeObjectURL = vi.fn();
  });

  it("renders loading skeleton initially", () => {
    render(<GlancesFeed user={mockUser} />);
    const skeletons = document.querySelectorAll(".animate-pulse");
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it("shows empty state and file input accepts images and videos", async () => {
    const { apiFetch } = await import("../../utils/api");
    (apiFetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true, glimpses: [] }),
    });

    render(<GlancesFeed user={mockUser} />);

    await screen.findByText("Add");

    const input = document.querySelector('input[type="file"]');
    expect(input).toBeInTheDocument();
    expect(input).toHaveAttribute("accept", "image/*,video/*");
  });
});
