import { useState, useRef, useCallback } from "react";
import { apiFetch } from "../utils/api";
import { logger } from "../utils/logger";

interface MentionUser {
  _id: string;
  username: string;
  fullName?: string;
  profilePic?: { url?: string } | null;
}

export interface MentionAutocompleteOptions {
  /** Textarea value at the moment of change. */
  value: string;
  /** Callback that sets the new value after a mention is inserted. */
  setValue: (v: string) => void;
  /**
   * Override the candidate source. Community composers pass a members-only
   * resolver so only community members can be mentioned; the default is the
   * global user search endpoint.
   */
  fetchCandidates?: (query: string) => Promise<MentionUser[]>;
}

/**
 * Shared @mention autocomplete logic used by every composer in the app
 * (post, comment, DM chat, community chat). Detects the `@` token before the
 * caret, debounces the candidate search, and inserts `@username ` in place of
 * the partially typed token. Community composers pass `fetchCandidates` that
 * resolves community members only — matching Instagram/X behavior.
 */
export function useMentionAutocomplete({
  value,
  setValue,
  fetchCandidates,
}: MentionAutocompleteOptions) {
  const [query, setQuery] = useState("");
  const [showDropdown, setShowDropdown] = useState(false);
  const [candidates, setCandidates] = useState<MentionUser[]>([]);
  const [charIndex, setCharIndex] = useState(-1);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestSeq = useRef(0);

  const clear = useCallback(() => {
    setShowDropdown(false);
    setCandidates([]);
    setCharIndex(-1);
    setQuery("");
  }, []);

  /** Call from the textarea onChange (e.target.value + selectionStart). */
  const handleChange = useCallback(
    (nextValue: string, selectionStart: number) => {
      const caret = typeof selectionStart === "number" ? selectionStart : nextValue.length;
      const wordBefore = nextValue.slice(0, caret).split(/\s/).pop() || "";

      if (wordBefore.startsWith("@") && wordBefore.length > 1) {
        const q = wordBefore.slice(1);
        setQuery(q);
        setCharIndex(caret - wordBefore.length);
        setShowDropdown(true);

        if (debounceRef.current) clearTimeout(debounceRef.current);
        const seq = ++requestSeq.current;
        debounceRef.current = setTimeout(async () => {
          try {
            const users = fetchCandidates
              ? await fetchCandidates(q)
              : await searchUsers(q);
            if (seq !== requestSeq.current) return;
            setCandidates(users || []);
            if ((users || []).length === 0) setShowDropdown(false);
          } catch (err) {
            logger.error("Mention autocomplete failed", err);
            if (seq === requestSeq.current) setShowDropdown(false);
          }
        }, 150);
      } else {
        clear();
      }
    },
    [clear, fetchCandidates],
  );

  /** Insert `@username ` replacing the partially typed @token. */
  const selectCandidate = useCallback(
    (username: string) => {
      const before = value.slice(0, charIndex);
      const after = value.slice(charIndex + query.length + 1);
      setValue(`${before}@${username} ${after}`);
      clear();
    },
    [value, query, charIndex, setValue, clear],
  );

  return {
    mentionQuery: query,
    showMentionDropdown: showDropdown,
    candidateUsers: candidates,
    handleMentionChange: handleChange,
    selectMentionCandidate: selectCandidate,
    closeMentionDropdown: clear,
  };
}

async function searchUsers(q: string): Promise<MentionUser[]> {
  const res = await apiFetch(`/api/search/users?q=${encodeURIComponent(q)}`);
  const data = await res.json();
  return res.ok && data.success ? data.users || [] : [];
}
