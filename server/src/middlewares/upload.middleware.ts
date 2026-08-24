import multer from "multer";
import cloudinary from "../configs/cloudinary";

type UploadParams = Record<string, unknown>;

/**
 * Minimal Multer storage engine backed by the supported Cloudinary v2 SDK.
 * The old multer-storage-cloudinary package only declares compatibility with
 * Cloudinary v1, which prevents security updates to the SDK.
 */
class CloudinaryStorage implements multer.StorageEngine {
	constructor(
		private readonly options: {
			getParams: (
				req: Express.Request,
				file: Express.Multer.File,
			) => UploadParams | Promise<UploadParams>;
		},
	) {}

	_handleFile(
		req: Express.Request,
		file: Express.Multer.File,
		callback: (error?: Error | null, info?: Partial<Express.Multer.File>) => void,
	): void {
		void Promise.resolve(this.options.getParams(req, file))
			.then((params) => {
				const stream = cloudinary.uploader.upload_stream(
					params as any,
					(error, result) => {
						if (error || !result) {
							callback(error || new Error("Cloudinary upload failed"));
							return;
						}
						callback(null, {
							path: result.secure_url,
							filename: result.public_id,
							size: result.bytes,
							...(result.duration ? { duration: result.duration } : {}),
						});
					},
				);
				file.stream.pipe(stream);
			})
			.catch((error: unknown) =>
				callback(error instanceof Error ? error : new Error("Cloudinary upload failed")),
			);
	}

	_removeFile(
		_req: Express.Request,
		file: Express.Multer.File,
		callback: (error: Error | null) => void,
	): void {
		if (!file.filename) {
			callback(null);
			return;
		}
		cloudinary.uploader.destroy(file.filename, { invalidate: true })
			.then(() => callback(null))
			.catch((error: unknown) =>
				callback(error instanceof Error ? error : new Error("Cloudinary cleanup failed")),
			);
	}
}

// Cloudinary storage config
const storage = new CloudinaryStorage({
	async getParams(req, file) {
		return {
    folder: "orbit",
    resource_type: "auto",
    allowed_formats: ["jpg", "jpeg", "png", "webp", "gif"],
    public_id: `${Date.now()}-${file.originalname}`,

    // Every upload is re-encoded — including GIFs. Previously GIFs skipped
    // the transformation, so a polyglot "GIF" could smuggle HTML/JS payloads
    // into the CDN untouched. Re-encoding strips anything that isn't image
    // data. flags: "animated" keeps animated GIFs animating after the
    // re-encode (delivered as animated webp via fetch_format: auto).
    transformation: [
      {
        width: 1200,
        crop: "limit",
        quality: "auto",
        fetch_format: "auto",
        ...(file.mimetype === "image/gif" ? { flags: "animated" } : {}),
      },
    ],
		};
	},
});

// cloudinary storage config for post images (smaller)
const postImageStorage = new CloudinaryStorage({
	async getParams(req, file) {
		return {
    folder: "orbit/posts",
    resource_type: "auto",
    allowed_formats: ["jpg", "jpeg", "png", "webp", "gif"],
    public_id: `${Date.now()}-${file.originalname}`,

    transformation: [
      {
        width: 800,
        height: 800,
        crop: "limit",
        quality: "auto",
        fetch_format: "auto",
        ...(file.mimetype === "image/gif" ? { flags: "animated" } : {}),
      },
    ],
		};
	},
});

// filter allowed types
const fileFilter = (
  req: any,
  file: any,
  cb: any,
) => {
  const allowed = ["image/jpeg", "image/jpg", "image/png", "image/webp", "image/gif"];

  if (!allowed.includes(file.mimetype)) {
    return cb(new Error("Only image files allowed!"), false);
  }

  // Extension/mimetype consistency: a "photo.jpg" that claims to be
  // image/png (or any mismatch) is rejected — the browser-supplied mimetype
  // alone is spoofable, but a mismatch is a strong signal of a crafted file.
  // Cloudinary's allowed_formats remains the authoritative server-side gate.
  const ext = (file.originalname || "").split(".").pop()?.toLowerCase() || "";
  const extForMime: Record<string, string[]> = {
    "image/jpeg": ["jpg", "jpeg", "jpe"],
    "image/jpg": ["jpg", "jpeg", "jpe"],
    "image/png": ["png"],
    "image/webp": ["webp"],
    "image/gif": ["gif"],
  };
  const okExts = extForMime[file.mimetype];
  if (okExts && ext && !okExts.includes(ext)) {
    return cb(new Error("File type mismatch — upload rejected."), false);
  }

  // Check file size before upload (additional security layer)
  if (file.size > 5 * 1024 * 1024) {
    return cb(new Error("File size exceeds 5MB limit!"), false);
  }

  cb(null, true);
};

// multer instance (profile/banner uploads)
const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB
  },
});

// multer instance for post images (multiple, smaller per-file limit)
const uploadPostImages = multer({
  storage: postImageStorage,
  fileFilter,
  limits: {
    fileSize: 3 * 1024 * 1024, // 3MB per image
    files: 10, // max 10 files
  },
});

// Blocked file extensions for security — executable/script formats AND
// script-bearing web formats (html/svg/js/xml) that can execute when opened
// (stored-XSS files).
const BLOCKED_EXTENSIONS = new RegExp(
  "\\.(exe|sh|bat|cmd|jar|msi|scr|vbs|ps1|com|dll|bin|applescript|hta|py[co]?|pl|html?|svg|js|mjs|xml|php[0-9]?|lnk|url|wsh|msc|reg)",
  "i",
);

// MIME types that carry active content — rejected regardless of the filename
// extension an attacker chooses.
const BLOCKED_MIME_TYPES = new Set([
  "text/html",
  "application/xhtml+xml",
  "image/svg+xml",
  "application/javascript",
  "text/javascript",
  "application/x-javascript",
  "application/xml",
  "text/xml",
  "application/x-httpd-php",
]);

const chatFileFilter = (req: any, file: any, cb: any) => {
  // Block high-risk executable/script/web formats by extension
  if (BLOCKED_EXTENSIONS.test(file.originalname)) {
    return cb(
      new Error("Executable and script files are not allowed for security reasons."),
      false,
    );
  }
  // Block active-content MIME types regardless of the filename extension
  if (BLOCKED_MIME_TYPES.has((file.mimetype || "").toLowerCase())) {
    return cb(
      new Error("This file type is not allowed for security reasons."),
      false,
    );
  }
  // Accept all other file types
  cb(null, true);
};

const uploadChatMedia = multer({
  storage: multer.memoryStorage(),
  fileFilter: chatFileFilter,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB limit for all file types
    files: 10, // max 10 files
  },
});

// ─── Post Media Storage (images + videos, 30MB) ─────────────────────
const postMediaStorage = new CloudinaryStorage({
	async getParams(req, file) {
    const isVideo = file.mimetype.startsWith("video/");
    return {
      folder: "orbit/posts",
      resource_type: "auto",
      allowed_formats: isVideo
        ? ["mp4", "mov", "webm", "avi", "mkv", "3gp"]
        : ["jpg", "jpeg", "png", "webp", "gif"],
      public_id: `${Date.now()}-${file.originalname.replace(/\.[^/.]+$/, "")}`,
      // No transformations for video — Cloudinary auto-optimizes
      transformation: isVideo ? undefined : [
        {
          width: 800,
          height: 800,
          crop: "limit",
          quality: "auto",
          fetch_format: "auto",
        },
      ],
    };
  },
});

const postMediaFilter = (req: any, file: any, cb: any) => {
  const allowedImages = ["image/jpeg", "image/jpg", "image/png", "image/webp", "image/gif"];
  const allowedVideos = ["video/mp4", "video/quicktime", "video/webm", "video/x-msvideo", "video/x-matroska", "video/3gpp"];
  const allAllowed = [...allowedImages, ...allowedVideos];

  if (!allAllowed.includes(file.mimetype)) {
    return cb(new Error("Only image and video files allowed!"), false);
  }

  cb(null, true);
};

const uploadPostMedia = multer({
  storage: postMediaStorage,
  fileFilter: postMediaFilter,
  limits: {
    fileSize: 30 * 1024 * 1024, // 30MB per file
    files: 10, // max 10 files
  },
});

// ─── Glimpse Media Storage (images + videos) ────────────────────
const glimpseMediaStorage = new CloudinaryStorage({
	async getParams(req, file) {
    const isVideo = file.mimetype.startsWith("video/");
    return {
      folder: "orbit/glances",
      resource_type: "auto",
      public_id: `${Date.now()}-${file.originalname.replace(/\.[^/.]+$/, "")}`,
      transformation: isVideo ? [{ width: 1080, crop: "limit", quality: "auto" }] : [
        { width: 1080, height: 1920, crop: "limit", quality: "auto", fetch_format: "auto" },
      ],
    };
  },
});

const glimpseMediaFilter = (req: any, file: any, cb: any) => {
  const isImage = file.mimetype.startsWith("image/");
  const isVideo = file.mimetype.startsWith("video/");

  if (!isImage && !isVideo) {
    return cb(new Error("Only image and video files allowed for glances!"), false);
  }

  cb(null, true);
};

// Video duration check middleware (must be applied after multer)
// Validates that video files are no longer than 60 seconds
// This is a best-effort check at the middleware level; the definitive
// check happens in the controller after Cloudinary returns duration info.
const checkVideoDuration = (req: any, res: any, next: any) => {
  const file = req.file;
  if (!file || !file.mimetype.startsWith("video/")) {
    return next();
  }

  // If Cloudinary already provides duration, check it
  if ((file as any).duration && (file as any).duration > 60) {
    return next(new Error("Video duration must not exceed 1 minute!"));
  }

  next();
};

const uploadGlimpseMedia = multer({
  storage: glimpseMediaStorage,
  fileFilter: glimpseMediaFilter,
  limits: {
    fileSize: 30 * 1024 * 1024, // 30MB per file
    files: 1,
  },
});

export { uploadPostImages, uploadChatMedia, uploadPostMedia, uploadGlimpseMedia };
export default upload;
