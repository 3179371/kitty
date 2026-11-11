import { config, paypalMode } from "./config";
import { available, collected, fmt } from "./money";
import { nowFor } from "./store";
import type { Cents, Check, Kitty } from "./types";

/**
 * Hard guardrails for any money leaving the kitty. Enforced in code, twice:
 * when the agent asks for approval and again right before PayPal is called.
 * The LLM can't skip these.
 */
export function purchaseChecks(k: Kitty, amount: Cents, opts: { fromVote: boolean }): { ok: boolean; checks: Check[] } {
  const bal = available(k);
  const now = nowFor(k);
  const expired = k.contributions.filter((c) => new Date(c.mandate.expiresAt) < now);
  const payeeReady = paypalMode() === "mock" || !!config.giftShopEmail;
  const checks: Check[] = [
    { label: `Within the money collected (${fmt(bal)} available)`, ok: amount > 0 && amount <= bal },
    { label: `Under the organizer's spending cap (${fmt(k.spendCap)})`, ok: amount <= k.spendCap },
    {
      label: `Matches every contributor's mandate: ${k.purpose}`,
      ok: k.contributions.length > 0 && k.contributions.every((c) => c.mandate.purpose === k.purpose),
    },
    { label: expired.length ? `${expired.length} mandate(s) expired` : "All mandates still valid", ok: expired.length === 0 },
    { label: opts.fromVote ? "Chosen by the group vote" : "Not from the group vote: organizer must confirm", ok: true },
    { label: "Paid to a verified PayPal merchant account", ok: payeeReady, detail: payeeReady ? undefined : "GIFT_SHOP_EMAIL is not configured" },
  ];
  return { ok: checks.every((c) => c.ok), checks };
}

export function refundChecks(k: Kitty, total: Cents): { ok: boolean; checks: Check[] } {
  const bal = available(k);
  const checks: Check[] = [
    { label: `Refund total ${fmt(total)} equals the unspent balance`, ok: total === bal && total > 0 },
    { label: "Split pro rata to what each person paid", ok: true },
    { label: "Back to each original PayPal payment (Refunds API)", ok: true },
    { label: `Nobody gets back more than they paid (${fmt(collected(k))} collected)`, ok: total <= collected(k) },
  ];
  return { ok: checks.every((c) => c.ok), checks };
}
