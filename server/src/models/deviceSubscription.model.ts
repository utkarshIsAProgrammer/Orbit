import mongoose from "mongoose";

/**
 * Stores Web Push API subscription objects (VAPID) per user.
 * Used by the push notification service to send device push notifications
 * when the user receives an in-app notification.
 */
const deviceSubscriptionSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    // The full PushSubscription JSON object from the browser
    subscription: {
      endpoint: { type: String, required: true },
      keys: {
        p256dh: { type: String, required: true },
        auth: { type: String, required: true },
      },
    },

    // User-agent string for debugging
    userAgent: {
      type: String,
      default: "",
    },
  },
  { timestamps: true }
);

deviceSubscriptionSchema.index({ user: 1, "subscription.endpoint": 1 }, { unique: true });

const DeviceSubscription = mongoose.model(
  "DeviceSubscription",
  deviceSubscriptionSchema
);
export default DeviceSubscription;
