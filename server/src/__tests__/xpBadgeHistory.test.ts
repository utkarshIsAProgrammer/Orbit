import mongoose from "mongoose";
import { awardBadge, getXPInfo } from "../services/xpService";
import XP from "../models/xp.model";

/**
 * Badge history — powers the "latest achievement" hero on profiles.
 * awardBadge must record when each badge was earned, getXPInfo must return
 * that history newest-first, re-awards must stay idempotent, and legacy
 * records (awarded before badgeHistory existed) must backfill from the
 * plain badges array.
 */
describe("XP badge history (latest achievement)", () => {
  const userId = new mongoose.Types.ObjectId().toString();

  afterEach(async () => {
    await XP.deleteMany({ userId });
  });

  it("records badgeHistory in award order and returns newest first", async () => {
    await awardBadge(userId, "first_100");
    // Give the timestamps room so ordering is deterministic.
    await new Promise((r) => setTimeout(r, 5));
    await awardBadge(userId, "post_1");

    const info = await getXPInfo(userId);
    expect(info.badges).toEqual(["first_100", "post_1"]);
    expect(info.badgeHistory).toHaveLength(2);
    // Newest first — post_1 was earned last.
    expect(info.badgeHistory![0].badge).toBe("post_1");
    expect(info.badgeHistory![1].badge).toBe("first_100");
  });

  it("is idempotent — re-awarding a badge does not duplicate history", async () => {
    await awardBadge(userId, "first_100");
    const again = await awardBadge(userId, "first_100");
    expect(again).toBe(false);

    const info = await getXPInfo(userId);
    expect(info.badges).toEqual(["first_100"]);
    expect(info.badgeHistory).toHaveLength(1);
  });

  it("backfills history from plain badges for legacy records", async () => {
    // A record created before badgeHistory existed (no history field).
    await XP.create({
      userId,
      totalXP: 500,
      level: 2,
      badges: ["first_100", "first_1k"],
    });

    const info = await getXPInfo(userId);
    const ids = info.badgeHistory!.map((h) => h.badge).sort();
    expect(ids).toEqual(["first_100", "first_1k"]);
  });

  it("keeps pre-history badges visible when a new badge is earned after deploy", async () => {
    // Partial record: badges [a, b, c] earned before badgeHistory existed,
    // then d earned after (only d has a real timestamp). All four must appear
    // in history, with d first.
    const record = await XP.create({
      userId,
      totalXP: 500,
      level: 2,
      badges: ["first_100", "first_1k", "post_1"],
    });
    // post_1 earned AFTER deploy — clearly newer than the record's createdAt
    // so the ordering assertion is deterministic.
    record.badgeHistory = [
      { badge: "post_1", earnedAt: new Date(Date.now() + 60_000) },
    ];
    await record.save();

    const info = await getXPInfo(userId);
    expect(info.badgeHistory!.map((h) => h.badge)).toEqual([
      "post_1",
      "first_100",
      "first_1k",
    ]);
  });
});
