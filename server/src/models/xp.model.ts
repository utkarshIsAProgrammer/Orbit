import mongoose from "mongoose";

export interface IXP {
  userId: mongoose.Types.ObjectId;
  totalXP: number;
  level: number;
  badges: string[];
  // When each badge was earned — powers the "latest achievement" display on
  // profiles. `badges` stays a plain string[] for backward compatibility;
  // history entries mirror it in award order.
  badgeHistory?: { badge: string; earnedAt: Date }[];
  lastActivity: Date;
  // Anti-farm dedupe window — { key, at } pairs so repeating the same action
  // (e.g. like→unlike→like a post) can't farm XP. Pruned by TTL in xpService.
  recentAwards?: { key: string; at: number }[];
}

const xpSchema = new mongoose.Schema<IXP>(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, unique: true, index: true },
    totalXP: { type: Number, default: 0 },
    level: { type: Number, default: 1 },
    badges: [{ type: String }],
    badgeHistory: [
      {
        _id: false,
        badge: { type: String },
        earnedAt: { type: Date, default: Date.now },
      },
    ],
    lastActivity: { type: Date, default: Date.now },
    recentAwards: [
      {
        _id: false,
        key: { type: String },
        at: { type: Number },
      },
    ],
  },
  { timestamps: true }
);

export const LEVEL_THRESHOLDS = [
  0, 100, 250, 500, 1000, 1750, 2750, 4000, 5500, 7500,
  10000, 13000, 17000, 22000, 28000, 35000, 43000, 52000, 63000, 75000,
];

export function calculateLevel(xp: number): number {
  for (let i = LEVEL_THRESHOLDS.length - 1; i >= 0; i--) {
    const threshold = LEVEL_THRESHOLDS[i];
    if (threshold !== undefined && xp >= threshold) return i + 1;
  }
  return 1;
}

export default mongoose.model<IXP>("XP", xpSchema);
