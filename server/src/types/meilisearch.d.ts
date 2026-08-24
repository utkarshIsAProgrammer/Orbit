declare module "meilisearch" {
  export default class MeiliSearch {
    constructor(config: { host: string; apiKey: string });
    index(uid: string): MeiliSearchIndex;
    createIndex(uid: string, options?: { primaryKey?: string }): Promise<any>;
    getIndexes(): Promise<any[]>;
    deleteIndex(uid: string): Promise<void>;
  }

  interface MeiliSearchIndex {
    search(
      query: string,
      options?: {
        limit?: number;
        offset?: number;
        filter?: string;
        sort?: string[];
      },
    ): Promise<{ hits: any[]; estimatedTotalHits?: number }>;
    getDocument(id: string): Promise<any>;
    addDocuments(documents: any[]): Promise<any>;
    updateDocuments(documents: any[]): Promise<any>;
    deleteDocument(id: string): Promise<void>;
    updateSettings(settings: any): Promise<any>;
    getSettings(): Promise<any>;
  }
}
