import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import MessageBubble from "../MessageBubble";

// Mock the apiFetch used by LinkPreviewCard to return a fake preview
vi.mock("../../utils/api", () => ({
  apiFetch: vi.fn(async () => ({
    ok: true,
    json: async () => ({
      success: true,
      preview: {
        url: "https://github.com/facebook/react",
        title: "GitHub - react/react",
        description: "The library for web and native user interfaces.",
        image: "https://example.com/og.png",
        favicon: "https://github.com/favicon.ico",
        siteName: "GitHub",
      },
    }),
  })),
}));

const noop = () => {};

function makeMsg(overrides = {}) {
  return {
    _id: "m1",
    conversationId: "c1",
    sender: { _id: "u2", username: "bob", fullName: "Bob", profilePic: null },
    text: "Check https://github.com/facebook/react",
    type: "text",
    attachments: [],
    reactions: [],
    isEdited: false,
    isDeleted: false,
    createdAt: new Date().toISOString(),
    readBy: [],
    deletedFor: [],
    ...overrides,
  };
}

const baseProps = {
  isMe: false,
  userId: "u1",
  groupedReactions: {},
  handleContextMenu: noop,
  handleReaction: noop,
  formatMessageTime: (s: string) => s,
};

describe("MessageBubble link preview", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders a LinkPreviewCard for a message containing a URL", async () => {
    render(<MessageBubble msg={makeMsg() as any} {...baseProps} />);
    // The card is an <a target=_blank> to the previewed URL
    await waitFor(() => {
      const link = screen.getByRole("link", { name: /GitHub - react\/react/i });
      expect(link).toBeTruthy();
      expect(link.getAttribute("target")).toBe("_blank");
    });
  });

  it("does not render a preview for messages without a URL", async () => {
    render(<MessageBubble msg={makeMsg({ text: "just plain text" }) as any} {...baseProps} />);
    await waitFor(() => {
      expect(screen.queryByRole("link", { name: /GitHub/i })).toBeNull();
    });
  });
});
