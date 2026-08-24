import React from "react";

/**
 * Regex that matches URLs embedded in plain text (http/https, www, or bare
 * t.co-style short domains are NOT matched — only protocol/www forms so we
 * never mis-highlight normal prose like "see you at 5").
 */
const URL_RE =
  /(?:https?:\/\/|www\.)[^\s<>"'\u00A0]+/gi;

/** Strip trailing punctuation that is not part of the URL (like Instagram/X). */
function cleanUrl(raw: string): string {
  return raw.replace(/[),.;:!?\]}]+$/, "");
}

/** Add the protocol to bare `www.` links so href works. */
function normalizeHref(url: string): string {
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

/**
 * Instagram/X-style linkification: every http(s):// or www. URL inside a
 * text string becomes a clickable anchor that opens in a new tab.
 *
 * `renderText` lets callers keep their own rich-text handling (hashtags,
 * mentions) for the non-URL segments — e.g. passing `renderMentionTags`.
 * Anchors stop propagation so tapping a link never bubbles to a card's
 * onClick (post open, row navigation, etc).
 */
export function renderLinkifiedText(
  text: string,
  renderText?: (segment: string) => React.ReactNode,
): React.ReactNode {
  if (!text) return text;

  const nodes: React.ReactNode[] = [];
  const re = new RegExp(URL_RE.source, "gi");
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  let key = 0;

  while ((m = re.exec(text)) !== null) {
    const matchStart = m.index;
    const raw = m[0];
    const url = cleanUrl(raw);
    const trailing = raw.slice(url.length);

    if (matchStart > lastIndex) {
      const segment = text.slice(lastIndex, matchStart);
      nodes.push(
        <React.Fragment key={key++}>
          {renderText ? renderText(segment) : segment}
        </React.Fragment>,
      );
    }

    nodes.push(
      <a
        key={key++}
        href={normalizeHref(url)}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => {
          // Keep native anchor behavior (middle-click / ctrl+click still
          // work); only stop the click from bubbling to a card's onClick.
          e.stopPropagation();
        }}
        className="text-cyan-500 dark:text-cyan-400 font-semibold hover:underline break-all cursor-pointer"
        title={url}
      >
        {url}
      </a>,
    );

    if (trailing) {
      nodes.push(
        <React.Fragment key={key++}>{trailing}</React.Fragment>,
      );
    }

    lastIndex = matchStart + raw.length;
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

/** True when the string contains a linkifiable URL. */
export function containsUrl(text: string): boolean {
  if (!text) return false;
  URL_RE.lastIndex = 0;
  return URL_RE.test(text);
}
