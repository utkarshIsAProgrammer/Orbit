import z from "zod";

export const addCommentSchema = z.object({
	content: z
		.string()
		.min(1, "Comment must be at least 1 character long!")
		.max(1000, "Comment must be less than 1000 characters!"),

	parent: z.string().optional(),
});

export const updateCommentSchema = addCommentSchema;

type AddCommentInput = z.infer<typeof addCommentSchema>;
type updateCommentInput = z.infer<typeof updateCommentSchema>;
