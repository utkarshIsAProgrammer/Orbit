/**
 * Meilisearch Configuration — Full-Text Search Engine
 *
 * Provides fast, typo-tolerant search for users, posts, communities, and messages.
 * Replaces MongoDB's limited $text search with a dedicated search engine.
 *
 * Uses Meilisearch Cloud or self-hosted instance.
 * Falls back to MongoDB text search if Meilisearch is not configured.
 */

import MeiliSearch from "meilisearch";
import { logger } from "../utilities/logger";

// ─── Configuration ─────────────────────────────────────────────────

const MEILISEARCH_URL = process.env.MEILISEARCH_URL || "";
const MEILISEARCH_API_KEY = process.env.MEILISEARCH_API_KEY || "";

const isConfigured = (): boolean => {
  if (!MEILISEARCH_URL || !MEILISEARCH_API_KEY) {
    logger.warn(
      "[Meilisearch] MEILISEARCH_URL or MEILISEARCH_API_KEY not configured — falling back to MongoDB search",
    );
    return false;
  }
  return true;
};

// ─── Client ────────────────────────────────────────────────────────

let client: MeiliSearch | null = null;

export function getSearchClient(): MeiliSearch | null {
  if (!isConfigured()) return null;

  if (!client) {
    client = new MeiliSearch({
      host: MEILISEARCH_URL,
      apiKey: MEILISEARCH_API_KEY,
    });
    logger.info("[Meilisearch] Client initialized", { url: MEILISEARCH_URL });
  }

  return client;
}

// ─── Index Names ───────────────────────────────────────────────────

export enum SearchIndex {
  USERS = "orbit_users",
  POSTS = "orbit_posts",
  COMMUNITIES = "orbit_communities",
  MESSAGES = "orbit_messages",
}

// ─── Index Settings ────────────────────────────────────────────────

interface IndexSettings {
  searchableAttributes: string[];
  filterableAttributes: string[];
  sortableAttributes: string[];
  rankingRules: string[];
}

const INDEX_SETTINGS: Record<SearchIndex, IndexSettings> = {
  [SearchIndex.USERS]: {
    searchableAttributes: ["username", "fullName", "bio"],
    filterableAttributes: ["isPrivate", "followerCount"],
    sortableAttributes: ["followerCount", "createdAt"],
    rankingRules: ["words", "typo", "proximity", "attribute", "sort"],
  },
  [SearchIndex.POSTS]: {
    searchableAttributes: ["title", "content", "hashtags", "authorName"],
    filterableAttributes: ["visibility", "status", "authorId", "createdAt"],
    sortableAttributes: ["createdAt", "likesCount", "commentsCount"],
    rankingRules: ["words", "typo", "proximity", "attribute", "sort", "exactness"],
  },
  [SearchIndex.COMMUNITIES]: {
    searchableAttributes: ["name", "description", "tags"],
    filterableAttributes: ["isPrivate", "memberCount", "category"],
    sortableAttributes: ["memberCount", "createdAt"],
    rankingRules: ["words", "typo", "proximity", "attribute", "sort"],
  },
  [SearchIndex.MESSAGES]: {
    searchableAttributes: ["text", "senderName"],
    filterableAttributes: ["conversationId", "senderId", "createdAt"],
    sortableAttributes: ["createdAt"],
    rankingRules: ["words", "typo", "proximity", "attribute", "sort", "exactness"],
  },
};

// ─── Initialize Indexes ────────────────────────────────────────────

export async function initializeSearchIndexes(): Promise<void> {
  const searchClient = getSearchClient();
  if (!searchClient) return;

  for (const [index, settings] of Object.entries(INDEX_SETTINGS)) {
    try {
      // Try to create the index — if it already exists, this throws
      // which is safe to ignore. We then get or create it.
      const existingIndexes = await searchClient.getIndexes();
      const exists = existingIndexes.some((i: any) => i.uid === index);

      if (!exists) {
        await searchClient.createIndex(index, { primaryKey: "id" });
        logger.info(`[Meilisearch] Index created: ${index}`);
      }

      // Apply settings regardless (idempotent update)
      const idx = searchClient.index(index);
      await idx.updateSettings(settings);

      logger.info(`[Meilisearch] Index initialized: ${index}`);
    } catch (err) {
      logger.warn(`[Meilisearch] Index init skipped for ${index}`, {
        error: (err as Error).message,
      });
    }
  }
}

// ─── Search Helper ─────────────────────────────────────────────────

export interface SearchOptions {
  limit?: number;
  offset?: number;
  filter?: string;
  sort?: string[];
}

export async function searchIndex<T = Record<string, unknown>>(
  indexName: SearchIndex,
  query: string,
  options: SearchOptions = {},
): Promise<{ hits: T[]; total: number }> {
  const searchClient = getSearchClient();

  if (!searchClient) {
    return { hits: [], total: 0 };
  }

  try {
    const result = await searchClient.index(indexName).search(query, {
      limit: options.limit || 20,
      offset: options.offset || 0,
      filter: options.filter,
      sort: options.sort,
    });

    return {
      hits: result.hits as T[],
      total: result.estimatedTotalHits || result.hits.length,
    };
  } catch (err) {
    logger.error(`[Meilisearch] Search failed for index ${indexName}`, {
      error: (err as Error).message,
      query,
    });
    return { hits: [], total: 0 };
  }
}

// ─── Document Sync ─────────────────────────────────────────────────

export async function addSearchDocument(
  indexName: SearchIndex,
  document: Record<string, unknown>,
): Promise<void> {
  const searchClient = getSearchClient();
  if (!searchClient) return;

  try {
    await searchClient.index(indexName).addDocuments([document]);
  } catch (err) {
    logger.error(`[Meilisearch] Failed to add document to ${indexName}`, {
      error: (err as Error).message,
    });
  }
}

export async function updateSearchDocument(
  indexName: SearchIndex,
  document: Record<string, unknown>,
): Promise<void> {
  // Meilisearch uses the same method for add/update — `id` must match
  await addSearchDocument(indexName, document);
}

export async function deleteSearchDocument(
  indexName: SearchIndex,
  documentId: string,
): Promise<void> {
  const searchClient = getSearchClient();
  if (!searchClient) return;

  try {
    await searchClient.index(indexName).deleteDocument(documentId);
  } catch (err) {
    logger.error(`[Meilisearch] Failed to delete document from ${indexName}`, {
      error: (err as Error).message,
    });
  }
}

// ─── Graceful Shutdown ─────────────────────────────────────────────

export async function closeSearchClient(): Promise<void> {
  // Meilisearch client doesn't require explicit close
  client = null;
  logger.info("[Meilisearch] Client disposed");
}
