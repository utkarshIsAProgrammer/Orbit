import {
  buildTokenizedSearchRegex,
  tokenizeSearchQuery,
} from "../controllers/search.controllers";

describe("buildTokenizedSearchRegex", () => {
  it("returns null for single-token queries (plain prefix path handles them)", () => {
    expect(buildTokenizedSearchRegex("shreya")).toBeNull();
    expect(buildTokenizedSearchRegex("a")).toBeNull();
  });

  it("anchors each token as a word prefix with skippable words between", () => {
    // "sh ku" must match "Shreya Kumar" — the WhatsApp/IG-style token match.
    expect(buildTokenizedSearchRegex("sh ku")).toBe(
      "^sh\\S*(\\s+\\S+)*\\s+ku\\S*",
    );
    // 3-token queries chain the same way.
    expect(buildTokenizedSearchRegex("s t a")).toBe(
      "^s\\S*(\\s+\\S+)*\\s+t\\S*(\\s+\\S+)*\\s+a\\S*",
    );
  });

  it("matches real names the way the controller regex would", () => {
    const cases: Array<{ q: string; name: string; expectMatch: boolean }> = [
      { q: "sh ku", name: "Shreya Kumar", expectMatch: true },
      { q: "sh ku", name: "Shreya Kumari", expectMatch: true },
      { q: "s k", name: "Shreya Kumar", expectMatch: true }, // initials
      { q: "a p", name: "ALOK pithale", expectMatch: true }, // initials, case-insensitive
      { q: "s t a", name: "Seen Tick a2062", expectMatch: true }, // 3 tokens
      { q: "sh ku", name: "Kumar Shreya", expectMatch: false }, // wrong order
      { q: "sh ku", name: "Sharma Kunal", expectMatch: true }, // same initials, different name
    ];
    for (const c of cases) {
      const re = buildTokenizedSearchRegex(c.q)!;
      const matched = new RegExp(re, "i").test(c.name);
      expect(matched).toBe(c.expectMatch);
    }
  });

  it("escapes regex metacharacters in tokens", () => {
    expect(buildTokenizedSearchRegex("a.b c+d")).toBe(
      "^a\\.b\\S*(\\s+\\S+)*\\s+c\\+d\\S*",
    );
  });
});

describe("tokenizeSearchQuery", () => {
  it("splits, lowercases, and filters empty tokens", () => {
    expect(tokenizeSearchQuery("  Shreya  Kumar ")).toEqual(["shreya", "kumar"]);
  });

  it("escapes regex metacharacters", () => {
    expect(tokenizeSearchQuery("a.b")).toEqual(["a\\.b"]);
  });
});
