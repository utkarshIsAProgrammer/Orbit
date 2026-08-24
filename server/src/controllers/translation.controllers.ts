import { Request, Response } from "express";
import { translateText, detectLanguage } from "../services/translationService";
import { logger } from "../utilities/logger";

export const translate = async (req: Request, res: Response) => {
  try {
    if (!req.user?._id) {
      return res.status(401).json({ success: false, message: "Unauthorized!" });
    }
    const { text, targetLanguage } = req.body;
    if (!text) return res.status(400).json({ success: false, message: "Text is required" });
    const result = await translateText(text, targetLanguage || "en");
    return res.status(200).json({ success: true, translation: result });
  } catch (err: any) {
    logger.error("Translation error", { error: err.message });
    return res.status(500).json({ success: false, message: "Translation failed" });
  }
};

export const detect = async (req: Request, res: Response) => {
  try {
    if (!req.user?._id) {
      return res.status(401).json({ success: false, message: "Unauthorized!" });
    }
    const { text } = req.body;
    if (!text) return res.status(400).json({ success: false, message: "Text is required" });
    const language = await detectLanguage(text);
    return res.status(200).json({ success: true, language });
  } catch (err: any) {
    logger.error("Language detection error", { error: err.message });
    return res.status(500).json({ success: false, message: "Detection failed" });
  }
};
