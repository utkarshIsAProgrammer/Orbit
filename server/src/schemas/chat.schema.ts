import z from "zod";

export const sendMessageSchema = z
  .object({
    text: z.string().optional(),
    replyTo: z.string().optional(),
    attachments: z
      .array(
        z.object({
          url: z.string().url("Attachment URL must be valid"),
          public_id: z.string().min(1, "Attachment public_id is required"),
          type: z.enum(["image", "gif", "sticker", "meme", "voice_note", "video", "file"]),
        })
      )
      .optional(),
  })
  .refine(
    (data) => {
      const hasText = !!data.text && data.text.trim().length > 0;
      const hasAttachments = !!data.attachments && data.attachments.length > 0;
      return hasText || hasAttachments;
    },
    {
      message: "Message must contain either text or an attachment!",
      path: ["text"],
    }
  )
  .refine(
    (data) => {
      if (data.text !== undefined && data.text.trim().length > 0) {
        const words = data.text.trim().split(/\s+/).filter(Boolean);
        return words.length >= 1;
      }
      return true;
    },
    {
      message: "Message must contain at least 1 word if text is provided!",
      path: ["text"],
    }
  );

export const editMessageSchema = z
  .object({
    text: z.string().min(1, "Edited message text cannot be empty!"),
  })
  .refine(
    (data) => {
      const words = data.text.trim().split(/\s+/).filter(Boolean);
      return words.length >= 1;
    },
    {
      message: "Edited message must contain at least 1 word!",
      path: ["text"],
    }
  );

export type SendMessageInput = z.infer<typeof sendMessageSchema>;
export type EditMessageInput = z.infer<typeof editMessageSchema>;
