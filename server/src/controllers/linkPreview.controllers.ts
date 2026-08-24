import { Request, Response } from "express";
import { fetchLinkPreview } from "../services/linkPreviewService";
import { logger } from "../utilities/logger";

/**
 * GET /api/link-preview?url=<encoded_url>
 */
export const getLinkPreview = async (req: Request, res: Response) => {
  try {
    const url = req.query.url as string;
    if (!url) {
      return res.status(400).json({ success: false, message: "url query parameter is required" });
    }

    // Basic URL validation
    try {
      new URL(url);
    } catch {
      return res.status(400).json({ success: false, message: "Invalid URL provided" });
    }

    const preview = await fetchLinkPreview(url);
    if (!preview) {
      return res.status(200).json({ success: true, preview: null });
    }

    return res.status(200).json({ success: true, preview });
  } catch (err: any) {
    logger.error("Error in getLinkPreview", { error: err.message });
    return res.status(500).json({ success: false, message: "Failed to fetch link preview" });
  }
};
