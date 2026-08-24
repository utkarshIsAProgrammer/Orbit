import { describe, expect, it } from "vitest";
import { matchesSearchTokens } from "../searchMatch";

describe("matchesSearchTokens", () => {
  it("matches single-token prefixes (the common case)", () => {
    expect(matchesSearchTokens("Shreya Cooking Club", "sh")).toBe(true);
    expect(matchesSearchTokens("Shreya Cooking Club", "cooking")).toBe(true);
    expect(matchesSearchTokens("alice", "alic")).toBe(true);
  });

  it("matches multi-word queries per-word (WhatsApp/IG style)", () => {
    expect(matchesSearchTokens("Shreya Cooking Club", "sh cook")).toBe(true);
    expect(matchesSearchTokens("Shreya Kumari", "sh ku")).toBe(true);
    // Arbitrary words may sit between matching tokens
    expect(matchesSearchTokens("Shreya Amazing Cooking Club", "sh cook")).toBe(true);
  });

  it("matches initials", () => {
    expect(matchesSearchTokens("Shreya Cooking Club", "s c")).toBe(true);
    expect(matchesSearchTokens("ALOK pithale", "a p")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(matchesSearchTokens("SHREYA KUMARI", "sh ku")).toBe(true);
    expect(matchesSearchTokens("shreya kumari", "SH KU")).toBe(true);
  });

  it("rejects wrong order and missing tokens", () => {
    expect(matchesSearchTokens("Shreya Cooking Club", "cook sh")).toBe(false);
    expect(matchesSearchTokens("Shreya Cooking Club", "sh xyz")).toBe(false);
    expect(matchesSearchTokens("alice", "ali x")).toBe(false);
  });

  it("empty query matches everything (no filter)", () => {
    expect(matchesSearchTokens("anything", "")).toBe(true);
    expect(matchesSearchTokens("anything", "   ")).toBe(true);
  });
});
