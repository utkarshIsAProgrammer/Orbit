import mongoose, { InferSchemaType, HydratedDocument } from "mongoose";

/**
 * Waitlist — a record separate from the User collection.
 * People who reserve early access to ORBIT with their email before launch.
 * On launch day they can sign in with the same email to get in first.
 */
const waitlistSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true, // unique already creates the index
      lowercase: true,
      trim: true,
    },
    // Canonical form (lowercase, no +tag, no dots in local part) used for
    // signup gating — blocks plus-address / dot / case bypasses of the list.
    emailKey: {
      type: String,
      required: true,
      unique: true, // unique already creates the index
    },
    name: {
      type: String,
      trim: true,
      maxlength: 80,
      default: null,
    },
    // Where the visitor joined from (e.g. "landing-page", "referral:CODE")
    source: {
      type: String,
      trim: true,
      maxlength: 120,
      default: null,
    },
    // Lifecycle: pending → invited (invite email sent) → joined (signed up in-app)
    status: {
      type: String,
      enum: ["pending", "invited", "joined", "removed"],
      default: "pending",
    },
    invitedAt: {
      type: Date,
      default: null,
    },
    joinedAt: {
      type: Date,
      default: null,
    },
    // One-click opt-out token — embedded in the confirmation email as
    // /api/waitlist/remove/<token>. Lets the (possibly unsuspecting) owner
    // of an email that was added to the list remove it without any login.
    unsubToken: {
      type: String,
      unique: true,
      sparse: true,
      default: null,
    },
    // When the launch-day announcement email was sent (null = not yet).
    // Lets the launch blast script re-run safely without double-emailing.
    launchEmailedAt: {
      type: Date,
      default: null,
    },

  },
  { timestamps: true }
);

type WaitlistType = InferSchemaType<typeof waitlistSchema>;
export type WaitlistDocument = HydratedDocument<WaitlistType>;

export const Waitlist = mongoose.model<WaitlistDocument>(
  "Waitlist",
  waitlistSchema
);
