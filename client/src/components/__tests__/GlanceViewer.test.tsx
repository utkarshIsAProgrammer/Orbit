import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import GlanceViewer from "../GlanceViewer";

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
  X: (props: any) => <span {...props}>X</span>,
  Eye: (props: any) => <span {...props}>Eye</span>,
  Users: (props: any) => <span {...props}>Users</span>,
  MoreHorizontal: (props: any) => <span {...props}>MoreHorizontal</span>,
  Heart: (props: any) => <span {...props}>Heart</span>,
  MessageSquare: (props: any) => <span {...props}>MessageSquare</span>,
}));

const imageGlance = {
  _id: "glimpse1",
  author: {
    _id: "user1",
    username: "alice",
    fullName: "Alice",
    profilePic: { url: "/alice.jpg" },
  },
  media: { url: "/image.jpg" },
  mediaType: "image" as const,
  viewers: [],
  maxViews: 2,
  viewsRemaining: 2,
  viewedByMe: false,
  expiresAt: new Date(Date.now() + 86400000).toISOString(),
  createdAt: new Date().toISOString(),
};

const videoGlance = {
  ...imageGlance,
  _id: "glimpse2",
  media: { url: "/video.mp4" },
  mediaType: "video" as const,
  viewsRemaining: 1,
};

const defaultProps = {
  glimpses: [imageGlance, videoGlance],
  initialIndex: 0,
  onClose: vi.fn(),
  onView: vi.fn(),
  currentUser: { 
    _id: "user1", 
    username: "alice", 
    fullName: "Alice", 
    email: "alice@example.com", 
    createdAt: "",
    followersCount: 0,
    followingCount: 0,
    postsCount: 0,
    viewsCount: 0,
    sharesCount: 0
  },
};

describe("GlanceViewer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    global.URL.createObjectURL = vi.fn(() => "blob:mock");
    global.URL.revokeObjectURL = vi.fn();
  });

  it("renders an <img> for image-type glances when author views it", () => {
    render(<GlanceViewer {...defaultProps} />);
    const img = screen.getByAltText("");
    expect(img.tagName).toBe("IMG");
    expect(img).toHaveAttribute("src", "/image.jpg");
  });

  it("renders a <video> element for video-type glances when author views it", () => {
    render(<GlanceViewer {...defaultProps} initialIndex={1} />);
    const video = document.querySelector("video");
    expect(video).toBeInTheDocument();
    expect(video).toHaveAttribute("src", "/video.mp4");
  });

  it("renders glance content normally for non-author viewers", () => {
    const nonAuthorProps = {
      ...defaultProps,
      currentUser: { 
        _id: "user2", 
        username: "bob", 
        fullName: "Bob", 
        email: "bob@example.com", 
        createdAt: "",
        followersCount: 0,
        followingCount: 0,
        postsCount: 0,
        viewsCount: 0,
        sharesCount: 0
      },
    };
    render(<GlanceViewer {...nonAuthorProps} />);
    
    // Non-authors should see the glance media content
    const img = screen.getByAltText("");
    expect(img).toBeInTheDocument();
    
    // Author info should be visible
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("@alice", { exact: false })).toBeInTheDocument();
  });

  it("renders without crashing when given an empty array", () => {
    const { container } = render(
      <GlanceViewer glimpses={[]} initialIndex={0} onClose={vi.fn()} onView={vi.fn()} />
    );
    expect(container.innerHTML).toBe("");
  });
});
