import mongoose from "mongoose";

const reportSchema = new mongoose.Schema(
  {
    reporter: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    // The type of content being reported: "post" | "comment" | "user" | "message"
    contentType: {
      type: String,
      enum: ["post", "comment", "user", "message"],
      required: true,
    },
    // The ID of the reported content
    contentId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },
    // The user who created the reported content
    reportedUser: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    reason: {
      type: String,
      enum: [
        "spam",
        "harassment",
        "nudity",
        "violence",
        "hate_speech",
        "misinformation",
        "copyright",
        "other",
      ],
      required: true,
    },
    description: {
      type: String,
      default: "",
      maxlength: [1000, "Description cannot exceed 1000 characters!"],
    },
    status: {
      type: String,
      enum: ["pending", "reviewed", "dismissed", "action_taken"],
      default: "pending",
    },
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    reviewedAt: {
      type: Date,
      default: null,
    },
    action: {
      type: String,
      enum: ["none", "warning", "mute", "ban", "delete"],
      default: "none",
    },
  },
  { timestamps: true }
);

reportSchema.index({ status: 1, createdAt: -1 });
reportSchema.index({ reportedUser: 1 });
reportSchema.index({ reporter: 1 });

const Report = mongoose.model("Report", reportSchema);
export default Report;
