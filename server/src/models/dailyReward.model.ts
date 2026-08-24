import mongoose from "mongoose";

const dailyRewardSchema = new mongoose.Schema(
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
    totalPoints: {
      type: Number,
      default: 0,
    },
    lastClaimedDate: {
      type: Date,
      default: null,
    },
    // Today's reward is based on streak: Day 1 = 50, Day 2 = 60, Day 3 = 75, Day 4 = 100, Day 5+ = 150
  },
  { timestamps: true }
);

dailyRewardSchema.index({ totalPoints: -1 });

export const DailyReward = mongoose.model("DailyReward", dailyRewardSchema);
