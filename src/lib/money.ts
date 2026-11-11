import type { Cents, Kitty } from "./types";

export const toCents = (dollars: number): Cents => Math.round(dollars * 100);
export const toValue = (c: Cents): string => (c / 100).toFixed(2);

export const fmt = (c: Cents | undefined, currency = "USD"): string => {
  if (c === undefined || c === null) return "";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: c % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(c / 100);
};

export const collected = (k: Kitty): Cents =>
  k.contributions.reduce((s, c) => s + c.amount, 0);

export const refundedTotal = (k: Kitty): Cents =>
  k.contributions.reduce((s, c) => s + c.refunded, 0);

export const spent = (k: Kitty): Cents =>
  k.purchase && ["SUCCESS", "PENDING", "UNCLAIMED", "COMPLETED", "PROCESSING"].includes(k.purchase.status)
    ? k.purchase.amount
    : 0;

export const available = (k: Kitty): Cents => collected(k) - spent(k) - refundedTotal(k);

export const paidBy = (k: Kitty, participantId: string): Cents =>
  k.contributions.filter((c) => c.participantId === participantId).reduce((s, c) => s + c.amount, 0);

/** Split `total` across weights pro rata, in cents, distributing rounding remainders. */
export function proRata(total: Cents, weights: { id: string; weight: number }[]): Record<string, Cents> {
  const sum = weights.reduce((s, w) => s + w.weight, 0);
  const out: Record<string, Cents> = {};
  if (sum <= 0 || total <= 0) return out;
  let allocated = 0;
  const parts = weights.map((w) => {
    const exact = (total * w.weight) / sum;
    const floor = Math.floor(exact);
    allocated += floor;
    return { id: w.id, floor, frac: exact - floor };
  });
  let rest = total - allocated;
  parts.sort((a, b) => b.frac - a.frac);
  for (const p of parts) {
    out[p.id] = p.floor + (rest > 0 ? 1 : 0);
    if (rest > 0) rest--;
  }
  return out;
}
