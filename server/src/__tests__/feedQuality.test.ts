/**
 * Feed Quality Gate — Unit Tests
 *
 * Covers the Phase-1 content-quality scorer used to push low-effort filler
 * out of discovery and rank richer posts higher.
 */
import { computeQualityScore, computeScore } from "../services/feedService";

/** Helper: score a post with no affinity/follow/boost signals active. */
const scored = (post: any) =>
  computeScore(post, new Map(), new Map(), new Set(), new Set());

describe("computeQualityScore", () => {
  it("scores a rich post (media + hashtags + meaningful text) near the top", () => {
    const post = {
      content:
        "Three months learning street photography in Lisbon — my favorite frames from the tram lines. What do you think?",
      images: ["https://cdn.example.com/a.jpg", "https://cdn.example.com/b.jpg"],
      hashtags: ["streetphotography", "lisbon"],
    };
    const score = computeQualityScore(post);
    expect(score).toBeGreaterThanOrEqual(0.9);
  });

  it("penalizes onboarding boilerplate filler", () => {
    const post = {
      content: "Hello everyone! This is my first post on Orbit!",
      images: [],
      hashtags: [],
    };
    const score = computeQualityScore(post);
    expect(score).toBeLessThan(0.5);
    // and it should fail the discovery minimum
    expect(score).toBeLessThan(0.35);
  });

  it("catches boilerplate even when hashtags + length bonuses are stacked", () => {
    // The realistic seed case: "Hello from Alice! ... #firstpost #orbit" —
    // length and hashtag bonuses must not rescue boilerplate past the
    // discovery threshold.
    const post = {
      content: "Hello from Alice! This is my first post on Orbit!",
      images: [],
      hashtags: ["firstpost", "orbit"],
    };
    const score = computeQualityScore(post);
    expect(score).toBeLessThan(0.35);
  });

  it("penalizes all-caps shouting", () => {
    const post = {
      content: "THIS IS THE BEST DAY EVER EVERYONE LOOK AT THIS AMAZING THING",
      images: [],
      hashtags: [],
    };
    expect(computeQualityScore(post)).toBeLessThan(0.5);
  });

  it("penalizes repeated-word spam", () => {
    const post = {
      content: "nice nice nice nice nice nice",
      images: [],
      hashtags: [],
    };
    expect(computeQualityScore(post)).toBeLessThan(0.5);
  });

  it("penalizes emoji spam", () => {
    const post = {
      content: "so fun 🎉🎉🎉🎉🎉🎉 follow me guys",
      images: [],
      hashtags: [],
    };
    expect(computeQualityScore(post)).toBeLessThan(0.5);
  });

  it("treats a bare one-liner without media as low quality", () => {
    const post = {
      content: "hi",
      images: [],
      hashtags: [],
    };
    const score = computeQualityScore(post);
    expect(score).toBeLessThan(0.5);
  });

  it("clamps the score into the 0.05–1.0 range", () => {
    const good = computeQualityScore({
      content: "a".repeat(200),
      images: ["x"],
      hashtags: ["a", "b", "c"],
    });
    const bad = computeQualityScore({
      content: "first post",
      images: [],
      hashtags: [],
    });
    expect(good).toBeLessThanOrEqual(1);
    expect(bad).toBeGreaterThanOrEqual(0.05);
  });
});

describe("computeScore — quality-adjusted velocity + floor", () => {
  const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000);

  it("ranks a modest high-engagement post above a viral low-quality one", () => {
    // 5000 likes but only 200k views and shouty spam text — 2.5% like rate.
    const viralSpam = scored({
      content: "CHECK OUT MY NEW CHANNEL EVERYONE",
      likesCount: 5000,
      viewsCount: 200000,
      createdAt: hoursAgo(24),
    });
    // 400 weighted engagement units on 800 views — 50% like rate, real text.
    const qualityPost = scored({
      content:
        "Spent the weekend migrating our dashboard to server components — the initial bundle dropped from 410KB to 96KB. Happy to answer questions.",
      hashtags: ["react", "webdev"],
      likesCount: 100,
      commentsCount: 40,
      savesCount: 30,
      sharesCount: 10,
      viewsCount: 800,
      createdAt: hoursAgo(24),
    });
    expect(qualityPost.score).toBeGreaterThan(viralSpam.score);
  });

  it("ranks the better per-view rate higher when raw engagement is identical", () => {
    const base = { createdAt: hoursAgo(24) };
    // Same 400 weighted units, same age — only the audience size differs.
    const tightAudience = scored({
      ...base,
      content: "A thoughtful deep-dive that resonated with a small crowd.",
      likesCount: 100,
      commentsCount: 40,
      savesCount: 30,
      sharesCount: 10,
      viewsCount: 800, // 50% like rate
    });
    const broadAudience = scored({
      ...base,
      content: "A thoughtful deep-dive that resonated with a small crowd.",
      likesCount: 100,
      commentsCount: 40,
      savesCount: 30,
      sharesCount: 10,
      viewsCount: 20000, // 0.5% like rate — shown to many, engaged by few
    });
    expect(tightAudience.score).toBeGreaterThan(broadAudience.score);
  });

  it("flags the viral spam post below the hard floor", () => {
    const spam = scored({
      content: "CHECK OUT MY NEW CHANNEL EVERYONE",
      likesCount: 5000,
      viewsCount: 200000,
      createdAt: hoursAgo(24),
    });
    // MIN_SCORE_FLOOR is 0.15 — the ranked-feed filter drops anything below.
    expect(spam.quality).toBeLessThan(0.15);
    expect(spam.quality).toBeGreaterThanOrEqual(0.05);
  });

  it("produces a finite score for a zero-engagement post", () => {
    const result = scored({
      content: "A quiet post nobody has seen yet.",
      viewsCount: 0,
      createdAt: hoursAgo(1),
    });
    expect(Number.isFinite(result.score)).toBe(true);
    expect(result.score).toBeGreaterThan(0);
  });
});
