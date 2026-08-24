/**
 * Waitlist Day One perk — join-first eligibility rule.
 *
 * The perk (Aurum theme, Day One flair, First Orbit ring) belongs ONLY to
 * members who joined the waitlist BEFORE they ever created an account. These
 * tests lock the ordering rule and prove the bypasses are closed:
 *   - sign up → join waitlist → log in
 *   - sign up → delete account → join waitlist → sign up again
 *   - canonical email variants (plus-address / dots / case)
 */
import { Waitlist } from "../models/waitlist.model";
import { PerkTombstone } from "../models/perkTombstone.model";
import {
  decidePerkForNewAccount,
  reconcilePerk,
} from "../services/waitlistPerkService";
import { canonicalEmail } from "../utilities/waitlistGate";

const joinWaitlist = async (email: string) => {
  const key = canonicalEmail(email);
  return Waitlist.create({
    email: key,
    emailKey: key,
    status: "pending",
    unsubToken: Math.random().toString(36).slice(2),
  });
};

const stampFor = (email: string) =>
  PerkTombstone.findOne({ emailKey: canonicalEmail(email) }).lean();

beforeEach(async () => {
  await Waitlist.deleteMany({});
  await PerkTombstone.deleteMany({});
});

describe("Day One perk — waitlist must precede the first account", () => {
  it("grants the perk when the email joined the waitlist before signup", async () => {
    await joinWaitlist("alice@gmail.com");
    expect(await decidePerkForNewAccount("alice@gmail.com")).toBe(true);
    // The account-creation stamp is recorded for future checks.
    expect(await stampFor("alice@gmail.com")).not.toBeNull();
  });

  it("grants nothing when the email was never on the waitlist", async () => {
    expect(await decidePerkForNewAccount("bob@gmail.com")).toBe(false);
    // The stamp is still recorded so a later waitlist join can't unlock it.
    expect(await stampFor("bob@gmail.com")).not.toBeNull();
  });

  it("denies a user who signed up first and joined the waitlist later", async () => {
    // First account created with no waitlist record → stamp locked.
    expect(await decidePerkForNewAccount("carol@gmail.com")).toBe(false);
    // Carol joins the waitlist afterwards…
    await joinWaitlist("carol@gmail.com");
    // …a second account still gets nothing…
    expect(await decidePerkForNewAccount("carol@gmail.com")).toBe(false);
    // …and the login reconcile can never retroactively grant it.
    expect(await reconcilePerk("carol@gmail.com", new Date())).toBe(false);
  });

  it("denies even after the first account was deleted and the email re-joined", async () => {
    // First account (no waitlist) — the delete flow doesn't touch the stamp.
    expect(await decidePerkForNewAccount("dave@gmail.com")).toBe(false);
    await joinWaitlist("dave@gmail.com");
    // Re-signup after deletion → still no perk.
    expect(await decidePerkForNewAccount("dave@gmail.com")).toBe(false);
    expect(await reconcilePerk("dave@gmail.com", new Date())).toBe(false);
  });

  it("keeps eligibility for a genuine member who deletes and re-signs up", async () => {
    await joinWaitlist("erin@gmail.com");
    expect(await decidePerkForNewAccount("erin@gmail.com")).toBe(true);
    // Delete the account and re-sign up — the earliest stamp never moves.
    expect(await decidePerkForNewAccount("erin@gmail.com")).toBe(true);
  });

  it("reconciles a legacy account created after a waitlist join as eligible", async () => {
    await joinWaitlist("frank@gmail.com");
    const accountCreatedAt = new Date(Date.now() + 60_000); // after the join
    expect(await reconcilePerk("frank@gmail.com", accountCreatedAt)).toBe(true);
  });

  it("reconciles a legacy account created before a waitlist join as ineligible", async () => {
    const accountCreatedAt = new Date(Date.now() - 60_000); // before the join
    await joinWaitlist("grace@gmail.com"); // joined afterwards
    expect(await reconcilePerk("grace@gmail.com", accountCreatedAt)).toBe(false);
  });

  it("matches canonical email variants (plus-address / dots / case)", async () => {
    await joinWaitlist("User.Name+ads@Gmail.com");
    expect(await decidePerkForNewAccount("username@gmail.com")).toBe(true);
    // Same canonical email can never double-grant after a deletion.
    expect(await decidePerkForNewAccount("USERNAME@gmail.com")).toBe(true);
  });
});
