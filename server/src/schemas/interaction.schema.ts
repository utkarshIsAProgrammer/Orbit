import { z } from "zod";

// ---------- Like ----------
export const toggleLikeSchema = z.object({
  postId: z.string().min(1, "Post ID is required"),
});

export const toggleCommentLikeSchema = z.object({
  commentId: z.string().min(1, "Comment ID is required"),
});

// ---------- Saves ----------
export const toggleSaveSchema = z.object({
  folder: z.string().max(50, "Folder name must be under 50 characters").optional(),
});

export const updateSaveFolderSchema = z.object({
  folder: z.string().min(1, "Folder name is required").max(50, "Folder name must be under 50 characters"),
});

// ---------- Repost ----------
export const toggleRepostSchema = z.object({
  postId: z.string().min(1, "Post ID is required"),
});

// ---------- Follow ----------
export const toggleFollowSchema = z.object({
  userId: z.string().min(1, "User ID is required"),
});

// ---------- Post update ----------
export const updatePostSchema = z.object({
  title: z
    .string()
    .min(5, "Title must be at least 5 characters")
    .max(500, "Title must be under 500 characters")
    .optional(),
  content: z
    .string()
    .min(5, "Content must be at least 5 characters")
    .max(5000, "Content must be under 5000 characters")
    .optional(),
}).refine(
  (data) => data.title !== undefined || data.content !== undefined,
  { message: "At least one of title or content must be provided" },
);

// ---------- View ----------
export const addViewSchema = z.object({
  postId: z.string().min(1, "Post ID is required"),
});
