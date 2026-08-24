declare module "imagekit" {
  interface ImageKitOptions {
    publicKey: string;
    privateKey: string;
    urlEndpoint: string;
  }

  interface UploadResponse {
    fileId: string;
    name: string;
    size: number;
    filePath: string;
    url: string;
    fileType: string;
    height: number;
    width: number;
    thumbnailUrl: string;
    AITags: Array<{ name: string; confidence: number; source: string }>;
    [key: string]: unknown;
  }

  interface UploadOptions {
    file: string | Buffer;
    fileName: string;
    useUniqueFileName?: boolean;
    tags?: string[];
    folder?: string;
    isPrivateFile?: boolean;
    transformation?: Record<string, string>;
    [key: string]: unknown;
  }

  interface UrlOptions {
    src: string;
    urlEndpoint?: string;
    transformation?: Array<Record<string, string>>;
    transformationPosition?: "path" | "query";
    [key: string]: unknown;
  }

  interface ListFileOptions {
    skip?: number;
    limit?: number;
    tags?: string;
    [key: string]: unknown;
  }

  interface FileDetail {
    fileId: string;
    name: string;
    size: number;
    filePath: string;
    url: string;
    fileType: string;
    [key: string]: unknown;
  }

  class ImageKit {
    constructor(options: ImageKitOptions);
    upload(options: UploadOptions): Promise<UploadResponse>;
    url(options: UrlOptions): string;
    listFiles(options: ListFileOptions): Promise<FileDetail[]>;
    deleteFile(fileId: string): Promise<void>;
    getFileDetails(fileId: string): Promise<FileDetail>;
    bulkDeleteFiles(fileIds: string[]): Promise<{ successfullyDeletedFileIds: string[] }>;
    purgeCache(url: string): Promise<{ requestId: string }>;
    purgeCacheStatus(requestId: string): Promise<{ status: string }>;
  }

  export = ImageKit;
}
