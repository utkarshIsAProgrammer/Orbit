import z from "zod";

export const createPostSchema = z.object({
  // Title and description (content) are both required on every post.
  title: z
    .string()
    .trim()
    .min(1, "Title is required!")
    .max(500, "Title must be less than 500 characters!"),

  content: z
    .string()
    .trim()
    .min(1, "Write a description for your post!")
    .max(5000, "Content must be less than 5000 characters!"),

  image: z.string().optional(),

  visibility: z
    .enum(["public", "closeFriends"])
    .optional()
    .default("public"),

  // Poll (sent as a JSON string from the client's FormData)
  poll: z.string().optional(),

  // Collaborator's @username (resolved to a userId in the controller)
  collaborator: z.string().optional(),

  // Post status: draft / scheduled / published (default published)
  status: z
    .enum(["draft", "scheduled", "published"])
    .optional()
    .default("published"),

  // ISO timestamp for scheduled posts
  scheduledAt: z.string().optional(),
});

export const updatePostSchema = z
  .object({
    title: z
      .string()
      .max(500, "Title must be less than 500 characters!")
      .optional(),

    content: z
      .string()
      .max(5000, "Content must be less than 5000 characters!")
      .optional(),

    image: z.string().optional(),
  })
  .refine((data) => data.title !== undefined || data.content !== undefined, {
    message: "At least one of title or content must be provided!",
    path: ["title"],
  });

type createPostSchemaInput = z.infer<typeof createPostSchema>;
type updateSchemaInput = z.infer<typeof updatePostSchema>;

// z.string().max(2000, Post body cannot exceed 2000 characters)

// each route schema in its own file for better organization

// z.coerce.date() with custom error message for invalid dates
