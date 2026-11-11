import { aiMode, config, giftSource, paypalMode } from "./config";
import { available, collected, paidBy, refundedTotal, spent } from "./money";
import { owes, tally, winningOption } from "./actions";
import type { Kitty } from "./types";
import { nowFor } from "./store";

export function modes() {
  return {
    paypal: paypalMode(),
    ai: aiMode(),
    gifts: giftSource(),
    model: aiMode() === "claude" ? config.anthropicModel : null,
    paypalClientId: paypalMode() === "sandbox" ? config.paypalClientId : null,
    giftShopName: config.giftShopName,
  };
}

/** Organizer console view of a kitty. */
export function kittyView(k: Kitty) {
  return {
    ...k,
    now: nowFor(k).toISOString(),
    totals: {
      collected: collected(k),
      available: available(k),
      spent: spent(k),
      refunded: refundedTotal(k),
      paidCount: k.participants.filter((p) => owes(k, p) === 0).length,
    },
    participantsView: k.participants.map((p) => ({ ...p, paid: paidBy(k, p.id), owes: owes(k, p) })),
    tally: tally(k),
    winnerId: winningOption(k)?.id,
    modes: modes(),
  };
}

export type KittyView = ReturnType<typeof kittyView>;
