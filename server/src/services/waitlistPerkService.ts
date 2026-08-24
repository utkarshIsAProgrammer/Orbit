import { Waitlist } from "../models/waitlist.model";
import { PerkTombstone } from "../models/perkTombstone.model";
import { canonicalEmail } from "../utilities/waitlistGate";
import { logger } from "../utilities/logger";

/**
 * Day One waitlist perk — eligibility rule.
 *
 * The perk (Aurum theme, Day One flair, First Orbit ring) belongs ONLY to
 * members who joined the waitlist BEFORE they ever created an account with
 * that email. Ordering is locked by a tombstone that records the earliest
 * account-creation time per canonical email and survives account deletion,
 * so none of these can ever unlock the perk:
 *   - sign up → join the waitlist → log in (the login backfill)
 *   - sign up → delete the account → join the waitlist → sign up again
 *   - OAuth / email-link variants of the above
 */

const findWaitlistRecord = (email: string) =>
  Waitlist.findOne({
    $or: [{ emailKey: canonicalEmail(email) }, { email }],
  })
    .select("createdAt")
    .lean();

const earliestStamp = (emailKey: string) =>
  PerkTombstone.findOne({ emailKey })
    .select("firstAccountAt")
    .lean();

/**
 * Record that an account was created for this email (earliest time kept).
 * Called on EVERY account creation — including emails that were never on
 * the waitlist — so a later waitlist join can never unlock the perk.
 */
export const stampAccountCreation = async (email: string): Promise<void> => {
  await PerkTombstone.updateOne(
    { emailKey: canonicalEmail(email) },
    { $min: { firstAccountAt: new Date() } },
    { upsert: true }
  );
};

/**
 * Decide Day One perk eligibility for a NEWLY created account.
 *
 * Eligible ONLY when a waitlist record exists for the canonical email AND
 * the member joined the waitlist at or before the first-ever account
 * created with that email. The stamp is written here (before the account
 * exists) so every path that creates an account goes through the same
 * ordering check. Idempotent and immutable: the earliest stamp never
 * moves, so re-running always returns the same answer.
 *
 * Best-effort: a ledger hiccup must never block signup — returns false
 * (no perk) on error.
 */
export const decidePerkForNewAccount = async (
  email: string
): Promise<boolean> => {
  try {
    const record = await findWaitlistRecord(email);
    const key = canonicalEmail(email);
    const stamp = await earliestStamp(key);
    const now = new Date();
    const eligible =
      !!record &&
      (stamp
        ? record.createdAt.getTime() <= new Date(stamp.firstAccountAt).getTime()
        : record.createdAt.getTime() <= now.getTime());
    await stampAccountCreation(email);
    return eligible;
  } catch (err: any) {
    logger.warn("Failed to decide waitlist perk", {
      email,
      error: err.message,
    });
    return false;
  }
};

/**
 * Reconcile an EXISTING account's perk on login / OAuth-link.
 *
 * Returns the correct eligibility — true grants, false revokes — making
 * the rule self-enforcing for every user on their next sign-in (and
 * retroactively correcting anyone who slipped through the old backfill).
 * `firstAccountAt` is the account's real creation time, used to backfill
 * the tombstone for pre-feature accounts so the decision stays stable.
 *
 * Returns null when the decision can't be made (ledger error) — callers
 * must leave the stored perk untouched in that case.
 */
export const reconcilePerk = async (
  email: string,
  firstAccountAt: Date
): Promise<boolean | null> => {
  try {
    const record = await findWaitlistRecord(email);
    const key = canonicalEmail(email);
    const stamp = await earliestStamp(key);

    if (stamp) {
      // Decision already locked by the earliest stamp.
      return (
        !!record &&
        record.createdAt.getTime() <= new Date(stamp.firstAccountAt).getTime()
      );
    }

    // Pre-feature account — backfill the stamp from the real creation time.
    await PerkTombstone.updateOne(
      { emailKey: key },
      { $min: { firstAccountAt: firstAccountAt } },
      { upsert: true }
    );
    return (
      !!record &&
      record.createdAt.getTime() <= new Date(firstAccountAt).getTime()
    );
  } catch (err: any) {
    logger.warn("Failed to reconcile waitlist perk", {
      email,
      error: err.message,
    });
    return null;
  }
};
