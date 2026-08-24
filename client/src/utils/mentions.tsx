import React from "react";

/**
 * Shared mention-tag renderer — Instagram/X-style.
 *
 * Turns `@username` tokens into clickable tags that open the profile. The
 * mention MUST be a whole-word token: the `@` must not be preceded by a word
 * character (letters/digits/underscore). Emails like `foo@bar.com` fail that
 * boundary check (the `o` before `@` is a word char), so they render as plain
 * text. `@gmail.com` matches `gmail` then stops at the `.`, so the trailing
 * `.com` is rendered as plain text — never a mention.
 */
export function renderMentionTags(
  text: string,
  onUserClick?: (username: string) => void,
): React.ReactNode {
  if (!text) return text;

  const nodes: React.ReactNode[] = [];
  const re = /@([A-Za-z0-9_]+)/g;
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  let key = 0;

  while ((m = re.exec(text)) !== null) {
    const atIndex = m.index;
    // Email safety: a word char directly before `@` means this is an email
    // address (foo@bar.com) or a partial match (@gmail.com) — skip it.
    if (atIndex > 0 && /[A-Za-z0-9_]/.test(text[atIndex - 1])) continue;

    const username = m[1];
    if (atIndex > lastIndex) {
      nodes.push(
        <React.Fragment key={key++}>{text.slice(lastIndex, atIndex)}</React.Fragment>,
      );
    }
    nodes.push(
      <span
        key={key++}
        onClick={(e) => {
          e.stopPropagation();
          if (onUserClick) onUserClick(username);
        }}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if ((e.key === "Enter" || e.key === " ") && onUserClick) {
            e.preventDefault();
            e.stopPropagation();
            onUserClick(username);
          }
        }}
        className="mention-tag font-bold text-cyan-500 dark:text-cyan-400 hover:underline cursor-pointer"
        title={`@${username}`}
      >
        @{username}
      </span>,
    );
    lastIndex = atIndex + m[0].length;
  }

  if (lastIndex < text.length) {
    nodes.push(
      <React.Fragment key={key++}>{text.slice(lastIndex)}</React.Fragment>,
    );
  }

  return nodes.length ? nodes : text;
}

/**
 * Shared hashtag-tag renderer — Instagram/X-style.
 *
 * Turns `#tag` tokens into clickable tags that run a hashtag search (via the
 * global `searchHashtag` window event, or the `onHashtagClick` callback).
 * The `#` must be a whole-word start: a word character directly before it
 * (e.g. `C#sharp`) skips the match. Non-hashtag segments pass through
 * `renderText` when provided (so mentions can be composed on top).
 */
export function renderHashtagTags(
  text: string,
  onHashtagClick?: (tag: string) => void,
  renderText?: (segment: string) => React.ReactNode,
): React.ReactNode {
  if (!text) return text;

  const nodes: React.ReactNode[] = [];
  const re = /#([A-Za-z0-9_]+)/g;
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  let key = 0;

  while ((m = re.exec(text)) !== null) {
    const hashIndex = m.index;
    // Word-char before `#` means this is not a hashtag start (e.g. C#sharp)
    if (hashIndex > 0 && /[A-Za-z0-9_]/.test(text[hashIndex - 1])) continue;

    const tag = m[1];
    if (hashIndex > lastIndex) {
      const segment = text.slice(lastIndex, hashIndex);
      nodes.push(
        <React.Fragment key={key++}>
          {renderText ? renderText(segment) : segment}
        </React.Fragment>,
      );
    }
    nodes.push(
      <span
        key={key++}
        onClick={(e) => {
          e.stopPropagation();
          if (onHashtagClick) {
            onHashtagClick(tag);
          } else {
            window.dispatchEvent(
              new CustomEvent("searchHashtag", { detail: { hashtag: tag } }),
            );
          }
        }}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            e.stopPropagation();
            if (onHashtagClick) {
              onHashtagClick(tag);
            } else {
              window.dispatchEvent(
                new CustomEvent("searchHashtag", {
                  detail: { hashtag: tag },
                }),
              );
            }
          }
        }}
        className="hashtag-tag font-bold text-orange-500 dark:text-orange-400 hover:underline cursor-pointer"
        title={`#${tag}`}
      >
        #{tag}
      </span>,
    );
    lastIndex = hashIndex + m[0].length;
  }

  if (lastIndex < text.length) {
    const segment = text.slice(lastIndex);
    nodes.push(
      <React.Fragment key={key++}>
        {renderText ? renderText(segment) : segment}
      </React.Fragment>,
    );
  }

  return nodes.length ? nodes : text;
}
