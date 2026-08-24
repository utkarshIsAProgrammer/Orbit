import mongoose, { InferSchemaType, HydratedDocument } from "mongoose";
import crypto from "crypto";

const apiKeySchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: [true, "API key name is required!"],
      trim: true,
      maxlength: [50, "Name cannot exceed 50 characters!"],
    },
    // Store a hash of the key — never the raw key
    keyHash: {
      type: String,
      required: true,
      unique: true,
    },
    // First 8 chars of the raw key for identification
    keyPrefix: {
      type: String,
      required: true,
    },
    permissions: [{
      type: String,
      enum: ["read", "write", "admin"],
      default: ["read"],
    }],
    lastUsedAt: {
      type: Date,
      default: null,
    },
    expiresAt: {
      type: Date,
      default: null,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

// keyHash already gets a unique index via `unique: true` on the field —
// adding it here again would create a duplicate index.
apiKeySchema.index({ user: 1, isActive: 1 });

// Generate a new API key (static method)
apiKeySchema.statics.generateKey = function(): { rawKey: string; keyHash: string; keyPrefix: string } {
  const rawKey = `orb_${crypto.randomBytes(24).toString("hex")}`;
  const keyHash = crypto.createHash("sha256").update(rawKey).digest("hex");
  const keyPrefix = rawKey.substring(0, 8);
  return { rawKey, keyHash, keyPrefix };
};

type ApiKeyType = InferSchemaType<typeof apiKeySchema>;
export type ApiKeyDocument = HydratedDocument<ApiKeyType> & {
  _id: mongoose.Types.ObjectId;
};

export const ApiKey = mongoose.model<ApiKeyDocument>("ApiKey", apiKeySchema);
