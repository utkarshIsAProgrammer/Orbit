import mongoose from "mongoose";

export interface IMission {
  type: "post" | "comment" | "like" | "profile_view" | "share" | "story";
  label: string;
  target: number;
  xpReward: number;
}

export interface IUserMission {
  userId: mongoose.Types.ObjectId;
  date: string; // YYYY-MM-DD
  missions: {
    type: string;
    current: number;
    target: number;
    completed: boolean;
    claimed: boolean;
  }[];
  allCompleted: boolean;
  allClaimed: boolean;
}

export const DAILY_MISSIONS: IMission[] = [
  { type: "post", label: "Create a post", target: 1, xpReward: 25 },
  { type: "comment", label: "Comment on 3 posts", target: 3, xpReward: 20 },
  { type: "like", label: "Like 5 posts", target: 5, xpReward: 15 },
  { type: "share", label: "Share a post", target: 1, xpReward: 15 },
  { type: "story", label: "Post a story", target: 1, xpReward: 20 },
  { type: "profile_view", label: "View 5 profiles", target: 5, xpReward: 10 },
];

const userMissionSchema = new mongoose.Schema<IUserMission>(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    date: { type: String, required: true },
    missions: [
      {
        type: {
          type: String,
          enum: ["post", "comment", "like", "profile_view", "share", "story"],
          required: true,
        },
        current: { type: Number, default: 0 },
        target: Number,
        completed: { type: Boolean, default: false },
        claimed: { type: Boolean, default: false },
      },
    ],
    allCompleted: { type: Boolean, default: false },
    allClaimed: { type: Boolean, default: false },
  },
  { timestamps: true }
);

userMissionSchema.index({ userId: 1, date: 1 }, { unique: true });

export default mongoose.model<IUserMission>("UserMission", userMissionSchema);
