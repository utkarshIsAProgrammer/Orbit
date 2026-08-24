import { BADGE_CATALOG } from "../utilities/badgeCatalog";

/**
 * Guards the achievement difficulty curve. Every badge carries an INTERNAL
 * `difficulty` tier (easy / moderate / hard / super) that is never shown in
 * the UI — it only records the balance so the catalog is not trivially
 * completable. This test pins that contract: exactly 100 badges, every one
 * has a valid tier, and all four tiers are populated.
 */
describe("Achievement difficulty curve", () => {
  it("has exactly 100 badges", () => {
    expect(Object.keys(BADGE_CATALOG)).toHaveLength(100);
  });

  it("assigns a valid internal difficulty to every badge", () => {
    const valid = new Set(["easy", "moderate", "hard", "super"]);
    for (const [id, badge] of Object.entries(BADGE_CATALOG)) {
      expect(valid.has(badge.difficulty)).toBe(true);
    }
  });

  it("spans all four difficulty tiers (none empty)", () => {
    const tiers = new Set(
      Object.values(BADGE_CATALOG).map((badge) => badge.difficulty),
    );
    expect(tiers).toEqual(new Set(["easy", "moderate", "hard", "super"]));
  });

  it("keeps super-hard achievements extremely rare (≤ 8)", () => {
    const superCount = Object.values(BADGE_CATALOG).filter(
      (badge) => badge.difficulty === "super",
    ).length;
    expect(superCount).toBeLessThanOrEqual(8);
  });
});
