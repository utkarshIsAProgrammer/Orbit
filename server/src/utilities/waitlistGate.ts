/**
 * Email canonicalization for waitlist matching.
 *
 * The app is open to everyone (post-launch posture), and anyone whose email
 * has a Waitlist record gets the Day One perks at signup/login/OAuth-link.
 * Canonical matching closes bypasses like Gmail plus-addresses
 * (`user+tag@`) and dots (`u.ser@`) so a member's perks are always granted
 * to the account they sign in with.
 */

/**
 * Canonical form of an email used for waitlist matching:
 *  - lowercase + trimmed (handles case/whitespace tricks)
 *  - "+tag" suffixes stripped (Gmail-style aliases resolve to the same box)
 *  - dots removed from the local part (Gmail ignores dots)
 * e.g. "  User.Name+ads@Gmail.com  " → "username@gmail.com"
 */
export const canonicalEmail = (email: string): string => {
  const e = email.trim().toLowerCase();
  const at = e.indexOf("@");
  if (at <= 0) return e;
  const local = (e.slice(0, at).split("+")[0] ?? "").replace(/\./g, "");
  const domain = e.slice(at + 1);
  return `${local}@${domain}`;
};
