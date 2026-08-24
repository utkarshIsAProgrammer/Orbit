import { Request, Response, NextFunction } from "express";
import cloudinary from "../configs/cloudinary";
import { env } from "../configs/env";
import { BadRequestError, UnauthorizedError } from "../utilities/errors";
import { logger } from "../utilities/logger";

/**
 * Proxy a chat file/document attachment through Cloudinary's authenticated
 * admin download endpoint.
 *
 * WHY: this Cloudinary account has a delivery access-control policy that
 * blocks serving the ORIGINAL binary of non-image uploads from the standard
 * delivery CDN (every `res.cloudinary.com/.../file.pdf` URL returns
 * 401 "deny or ACL failure" — while image/video formats serve fine). The
 * authenticated `private_download_url` (signed admin download API) is not
 * subject to that ACL, so proxying through it restores file downloads.
 *
 * The URL is derived server-side from the stored `public_id` + extension, so
 * it also fixes already-sent messages whose stored `att.url` is broken.
 */
export const downloadFile = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { publicId, format, filename, url } = req.query as {
      publicId?: string;
      format?: string;
      url?: string;
      filename?: string;
    };

    let public_id = publicId || "";
    let fileFormat: string = format || "";
    // Cloudinary resource type: legacy chat PDFs were stored as "image"
    // (resource_type:"auto" classifies PDFs as image-type), but ZIP/DOCX/etc.
    // land as "raw". Prefer the explicit query param, then derive from the
    // URL's own path segment so every file type downloads correctly.
    let resourceType = (req.query.resourceType as string) || "image";

    // Fallback: derive public_id + format from the stored URL (legacy
    // attachments only stored `url` — imagekit fileId is not a public_id).
    if (!public_id && url) {
      try {
        const parsed = new URL(url);
        if (
          parsed.hostname === "res.cloudinary.com" &&
          parsed.pathname.startsWith(`/${env.CLOUDINARY_NAME}/`)
        ) {
          // /<cloud>/<resource_type>/upload/v<version>/<public_id>.<ext>
          const parts = parsed.pathname
            .replace(`/${env.CLOUDINARY_NAME}/`, "")
            .split("/");
          const uploadIdx = parts.indexOf("upload");
          if (uploadIdx !== -1 && parts[uploadIdx + 1]) {
            // The segment right before "upload" is the resource_type
            // (image | raw | video) — use it so raw files download too.
            if (parts[uploadIdx - 1] === "raw" || parts[uploadIdx - 1] === "video") {
              resourceType = parts[uploadIdx - 1] as string;
            }
            // Skip the auto version segment (v<timestamp>) when present.
            let pidParts = parts.slice(uploadIdx + 1);
            if (/^v\d+$/.test(pidParts[0] || "")) {
              pidParts = pidParts.slice(1);
            }
            const rawPid = pidParts.join("/");
            const lastDot = rawPid.lastIndexOf(".");
            // IMPORTANT: raw resources keep the extension IN the public_id
            // (e.g. .../folder/notes.zip), while image/video resources store
            // it separately (public_id without ext + format). Handle both.
            if (resourceType === "raw") {
              public_id = rawPid; // keep extension
              fileFormat = ""; // serve the original as-is
            } else if (lastDot !== -1) {
              public_id = rawPid.slice(0, lastDot);
              fileFormat = rawPid.slice(lastDot + 1);
            } else {
              public_id = rawPid;
            }
          }
        }
      } catch {
        /* fall through to validation error below */
      }
    }

    if (!public_id) {
      throw new BadRequestError(
        "Missing file reference. Attachments must include public_id or a valid url.",
      );
    }

    if (!req.user?._id) {
      throw new UnauthorizedError("Unauthorized access!");
    }

    // Build a signed, authenticated download URL to Cloudinary's admin API.
    // `type: "upload"` + `resource_type` + the public_id pin the exact asset.
    const downloadUrl = cloudinary.utils.private_download_url(
      public_id,
      fileFormat,
      {
        resource_type: resourceType,
        type: "upload",
        attachment: true,
      },
    );

    const downstream = await fetch(downloadUrl, { redirect: "follow" });
    if (!downstream.ok) {
      throw new Error(
        `Cloudinary download failed with status ${downstream.status}`,
      );
    }

    const arrayBuf = await downstream.arrayBuffer();
    const buffer = Buffer.from(arrayBuf);

    const safeFilename =
      (filename || `${public_id.split("/").pop()}.${fileFormat}`)
        .replace(/[^\w.\- ]+/g, "_")
        .replace(/\s+/g, "_");

    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${safeFilename}"`,
    );
    res.setHeader("Content-Type", downstream.headers.get("content-type") || "application/octet-stream");
    res.setHeader("Content-Length", String(buffer.length));
    res.setHeader("Cache-Control", "private, max-age=300");
    res.end(buffer);
  } catch (err: any) {
    if (err.statusCode && err.statusCode < 500) throw err;
    logger.error("File download proxy failed", { error: err.message });
    next(err);
  }
};
