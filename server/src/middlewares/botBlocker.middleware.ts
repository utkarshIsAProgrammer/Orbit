/**
 * botBlocker.middleware.ts — stop bandwidth-burning crawlers at the door.
 *
 * Render's free tier meters OUTBOUND bandwidth (100 GB/mo). With no real
 * users, the traffic that eats it is automated: AI-training crawlers
 * (GPTBot, ClaudeBot, PerplexityBot, Bytespider…), SEO tools (AhrefsBot,
 * SemrushBot…), and vulnerability scanners. They hit the public API and the
 * Socket.IO endpoint around the clock (the keep-alive pinger keeps the
 * instance awake, so they always get a response).
 *
 * This middleware rejects them with a tiny 403 BEFORE they reach any route,
 * so a crawler costs a few bytes instead of a full API/Socket.IO round-trip.
 * Legitimate traffic is never affected:
 *   • real browsers always send a descriptive User-Agent;
 *   • Node's fetch (keep-alive pinger, external sync) sends `node`;
 *   • Render's own health checks send `Render`.
 */

import type { Request, Response, NextFunction } from "express";

/** Case-insensitive user-agent substrings of bots that burn bandwidth
 *  without ever becoming users. Add new offenders here as they appear. */
const BLOCKED_UA_PATTERNS: RegExp[] = [
  // ── AI training / LLM crawlers ────────────────────────────────────
  /gptbot/i,
  /chatgpt-user/i,
  /oai-searchbot/i,
  /gpt-robot/i,
  /chatgptbot/i,
  /claudebot/i,
  /claude-web/i,
  /claude-crawler/i,
  /claude-agent/i,
  /anthropic-ai/i,
  /perplexitybot/i,
  /perplexity-user/i,
  /ppcbot/i,
  /bytespider/i,
  /amazonbot/i,
  /bedrock/i,
  /ccbot/i, // Common Crawl
  /meta-externalagent/i,
  /google-extended/i,
  /googleother/i,
  /applebot-extended/i,
  /cohere-ai/i,
  /coherenetbot/i,
  /youbot/i,
  /omgili/i,
  /imagesiftbot/i,
  /petalbot/i,
  /timpibot/i,
  /magpie-crawler/i,
  /friendly-crawler/i,
  // ── SEO / market-research crawlers ────────────────────────────────
  /ahrefsbot/i,
  /semrushbot/i,
  /mj12bot/i,
  /dotbot/i,
  /dataforseobot/i,
  /exabot/i,
  /sogou/i,
  /baiduspider/i,
  /yandexbot/i,
  /seznambot/i,
  /serpstatbot/i,
  /trendictionbot/i,
  /lipperhey/i,
  // ── Vulnerability scanners / headless scrapers ────────────────────
  /phantomjs/i,
  /censys/i,
  /shodan/i,
  /masscan/i,
  /zgrab/i,
  /nuclei/i,
  /nmap/i,
  /sqlmap/i,
  /acunetix/i,
  /nessus/i,
  /nikto/i,
  /fasterwaf/i,
  /internetmeasurement/i,
  /prowler/i,
  /scrapy/i,
  /python-requests/i,
  /go-http-client/i,
  /libwww-perl/i,
  /^java\/\d/i,
];

const BLOCKED_RESPONSE = {
  success: false,
  message: "Forbidden",
};

/**
 * Express middleware. Mount as early as possible (before body parsers) so
 * rejected bots never pay for parsing, compression, or rate-limit lookups.
 */
export const botBlocker = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const ua = (req.headers["user-agent"] || "").trim();

  // Real browsers always send a User-Agent. Crawler frameworks and
  // scanners frequently send none — reject UA-less hits to the API and
  // Socket.IO endpoints (which are the only things that cost bandwidth).
  if (!ua) {
    // Liveness probes — Render health checks and uptime monitors may send
    // no UA at all, and these return a few bytes, so let them through.
    if (req.path === "/api/ping" || req.path === "/api/health") {
      return next();
    }
    if (
      req.path.startsWith("/api") ||
      req.path.startsWith("/socket.io")
    ) {
      return res.status(403).json(BLOCKED_RESPONSE);
    }
    return next();
  }

  // Known-bad user-agents: reject with a tiny 403 before any route runs.
  for (const pattern of BLOCKED_UA_PATTERNS) {
    if (pattern.test(ua)) {
      return res.status(403).json(BLOCKED_RESPONSE);
    }
  }

  return next();
};
