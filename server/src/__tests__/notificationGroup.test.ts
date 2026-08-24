import { groupNotificationsForDisplay } from "../controllers/notification.controllers";

const mk = (overrides: any = {}) => ({
  _id: overrides._id || "n1",
  type: "like",
  recipient: "r1",
  sender: { fullName: "Alice", username: "alice" },
  post: { _id: "p1", title: "My post" },
  isRead: false,
  createdAt: new Date("2026-08-17T10:00:00Z"),
  ...overrides,
});

describe("groupNotificationsForDisplay", () => {
  it("groups same-type same-target notifications into one row", () => {
    const rows = [
      mk({ _id: "n1", sender: { fullName: "Alice", username: "alice" }, createdAt: new Date("2026-08-17T10:05:00Z") }),
      mk({ _id: "n2", sender: { fullName: "Bob", username: "bob" }, createdAt: new Date("2026-08-17T10:04:00Z") }),
      mk({ _id: "n3", sender: { fullName: "Carol", username: "carol" }, createdAt: new Date("2026-08-17T10:03:00Z") }),
    ];
    const out = groupNotificationsForDisplay(rows);
    expect(out).toHaveLength(1);
    expect(out[0].groupCount).toBe(3);
    expect(out[0].groupMemberIds).toEqual(["n1", "n2", "n3"]);
    // Newest sender is the display anchor
    expect(out[0].sender.fullName).toBe("Alice");
    expect(out[0].groupSenders).toHaveLength(3);
    // Group is unread if ANY member is unread
    expect(out[0].isRead).toBe(false);
  });

  it("does not group different types on the same target", () => {
    const rows = [
      mk({ _id: "n1", type: "like", createdAt: new Date("2026-08-17T10:05:00Z") }),
      mk({ _id: "n2", type: "comment", createdAt: new Date("2026-08-17T10:04:00Z") }),
    ];
    expect(groupNotificationsForDisplay(rows)).toHaveLength(2);
  });

  it("does not group same type on different targets", () => {
    const rows = [
      mk({ _id: "n1", post: { _id: "p1" }, createdAt: new Date("2026-08-17T10:05:00Z") }),
      mk({ _id: "n2", post: { _id: "p2" }, createdAt: new Date("2026-08-17T10:04:00Z") }),
    ];
    expect(groupNotificationsForDisplay(rows)).toHaveLength(2);
  });

  it("does not merge outside the 24h window", () => {
    const rows = [
      mk({ _id: "n1", createdAt: new Date("2026-08-17T10:00:00Z") }),
      mk({ _id: "n2", createdAt: new Date("2026-08-15T09:00:00Z") }),
    ];
    const out = groupNotificationsForDisplay(rows);
    expect(out).toHaveLength(2);
  });

  it("keeps non-groupable types as individual rows", () => {
    const rows = [
      mk({ _id: "n1", type: "follow", sender: { fullName: "Alice" } }),
      mk({ _id: "n2", type: "follow", sender: { fullName: "Bob" } }),
    ];
    expect(groupNotificationsForDisplay(rows)).toHaveLength(2);
  });

  it("marks group read when all members are read", () => {
    const rows = [
      mk({ _id: "n1", isRead: true, createdAt: new Date("2026-08-17T10:05:00Z") }),
      mk({ _id: "n2", isRead: true, createdAt: new Date("2026-08-17T10:04:00Z") }),
    ];
    const out = groupNotificationsForDisplay(rows);
    expect(out[0].groupCount).toBe(2);
    expect(out[0].isRead).toBe(true);
  });

  it("returns single rows unchanged (no scratch fields leak)", () => {
    const row = mk({ _id: "n1", type: "follow" });
    const out = groupNotificationsForDisplay([row]);
    expect(out).toHaveLength(1);
    expect(out[0].groupCount).toBeUndefined();
    expect(out[0].__groupMemberIds).toBeUndefined();
    expect(out[0].__groupSenders).toBeUndefined();
  });
});
