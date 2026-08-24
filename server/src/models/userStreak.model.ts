import mongoose from "mongoose";

const userStreakSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
    },
    currentStreak: {
      type: Number,
      default: 0,
    },
    longestStreak: {
      type: Number,
      default: 0,
    },
    lastActiveDate: {
      type: Date,
      default: null,
    },
    // Tracks whether a push notification has already been sent for this streak break
    streakBreakNotified: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

userStreakSchema.index({ currentStreak: -1 });
userStreakSchema.index({ lastActiveDate: -1 });

export const UserStreak = mongoose.model("UserStreak", userStreakSchema);
