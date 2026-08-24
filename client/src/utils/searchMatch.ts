/**
 * Client-side tokenized search matcher — mirrors the server's WhatsApp/
 * Instagram-style matching in `search.controllers.ts` (buildTokenizedSearchRegex):
 * every whitespace-separated token of the query must prefix-match a successive
 * word of the haystack, in order, with arbitrary words allowed in between.
 *
 *   matchesSearchTokens("Shreya Cooking Club", "sh cook")  → true  (prefixes)
 *   matchesSearchTokens("Shreya Cooking Club", "s c")      → true  (initials)
 *   matchesSearchTokens("Shreya Cooking Club", "cook sh")  → false (order)
 *   matchesSearchTokens("alice", "alic")                   → true  (single prefix)
 *   matchesSearchTokens("alice", "ali x")                  → false (token missing)
 *
 * Used by the client-side filters (community list search, community member
 * mention picker) so search behaves identically everywhere — including the
 * "type half the name, still no results" fix.
 */
export function matchesSearchTokens(haystack: string, query: string): boolean {
  const tokens = query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  if (tokens.length === 0) return true;

  const text = haystack.toLowerCase();
  const words = text.split(/\s+/).filter(Boolean);

  // Every token must prefix-match a word, in order, skipping any words
  // between (classic initials / multi-word search).
  let wordIdx = 0;
  for (const token of tokens) {
    let matched = false;
    while (wordIdx < words.length) {
      const word = words[wordIdx];
      wordIdx++;
      if (word.startsWith(token)) {
        matched = true;
        break;
      }
    }
    if (!matched) return false;
  }
  return true;
}
