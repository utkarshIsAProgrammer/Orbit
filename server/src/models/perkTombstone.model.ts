import mongoose from "mongoose";

/**
 * Perk tombstone — records the EARLIEST account-creation time for each
 * canonical email, and persists even when that account is later deleted.
 *
 * The Day One waitlist perk is reserved for members who joined the waitlist
 * BEFORE they ever created an account. Without this ledger, the rule is
 * bypassable: create an account → join the waitlist → (even after deleting
 * the account) sign up again — and the login backfill would grant the perk
 * retroactively. The stamp makes the join-vs-first-account ordering
 * checkable forever, because user records disappear on deletion but this
 * stamp does not.
 */
const perkTombstoneSchema = new mongoose.Schema(
  {
    /** Canonical email (see waitlistGate.canonicalEmail). */
    emailKey: { type: String, required: true, unique: true },
    /** Time the FIRST account was created with this email (never updated
     *  forward — $min keeps the earliest stamp). */
    firstAccountAt: { type: Date, required: true },
  },
  { timestamps: true }
);

export const PerkTombstone = mongoose.model<{
  emailKey: string;
  firstAccountAt: Date;
}>("PerkTombstone", perkTombstoneSchema);
