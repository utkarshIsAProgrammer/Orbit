import mongoose from "mongoose";

const featureFlagSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    description: {
      type: String,
      default: "",
    },
    enabled: {
      type: Boolean,
      default: false,
    },
    // Percentage of users to roll out to (0-100)
    percentage: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },
    // Specific users who are part of the test (overrides percentage)
    users: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],
    // Always enabled for admin/test users
    adminOverride: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

export const FeatureFlag = mongoose.model("FeatureFlag", featureFlagSchema);
