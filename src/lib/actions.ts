import { parseSentence } from "./ai";
import { config, paypalMode } from "./config";
import { available, collected, fmt, paidBy, proRata, toCents } from "./money";
import * as paypal from "./paypal";
import { purchaseChecks, refundChecks } from "./policy";
import { getKitty, kittyByToken, log, newId, nowFor, participantName, persist, putKitty, say } from "./store";
import type { Approval, Cents, Contribution, DecisionOption, Kitty, Participant } from "./types";
import { runAgent } from "./agent";

const COLORS = ["#E8467C", "#2E7D6B", "#5B5BD6", "#E0892B", "#1F8FBF", "#9A4FCB", "#C2453D", "#4E8A2F", "#B8860B", "#3A6EA5"];

export const organizer = (k: Kitty) => k.participants.find((p) => p.isOrganizer) || k.participants[0];
export const owes = (k: Kitty, p: Participant): Cents => Math.max(0, p.share - paidBy(k, p.id));
export const unpaid = (k: Kitty) => k.participants.filter((p) => owes(k, p) > 0);
export const payLink = (p: Participant) => `/pay/${p.token}`;

// ---------- Create ----------
export async function createKitty(sentence: string, organizerName: string): Promise<Kitty> {
  const today = new Date();
  const { draft, via } = await parseSentence(sentence, organizerName || "Lina", today);
  const id = newId();
  const share = toCents(draft.sharePerPerson || 20);
  let people = draft.participants.filter((p) => p.name);
  if (!people.some((p) => p.isOrganizer)) people = [{ name: draft.organizerName, isOrganizer: true }, ...people];
  people = people.filter((p, i, a) => a.findIndex((q) => q.name.toLowerCase() === p.name.toLowerCase()) === i).slice(0, 12);
  const participants: Participant[] = people.map((p, i) => ({
    id: newId(),
    name: p.name,
    email: emailFor(p.name, id),
    share,
    token: newId() + newId(),
    color: COLORS[i % COLORS.length],
    isOrganizer: !!p.isOrganizer,
    reminders: 0,
    joinedAt: today.toISOString(),
  }));
  // Organizer first
  participants.sort((a, b) => Number(b.isOrganizer) - Number(a.isOrganizer));
  const eventDate = /^\d{4}-\d{2}-\d{2}$/.test(draft.eventDate) ? draft.eventDate : new Date(today.getTime() + 7 * 86400000).toISOString().slice(0, 10);
  const deadline = new Date(new Date(`${eventDate}T18:00:00Z`).getTime() - 2 * 86400000);
  const interests = (draft.interests || []).map((x) => x.toLowerCase()).slice(0, 4);
  const k: Kitty = {
    id,
    createdAt: today.toISOString(),
    sentence,
    organizerId: participants[0].id,
    recipient: draft.recipient,
    occasion: draft.occasion || "Birthday",
    eventDate,
    deadline: (deadline < today ? new Date(today.getTime() + 2 * 86400000) : deadline).toISOString(),
    currency: "USD",
    sharePerPerson: share,
    goal: share * participants.length,
    interests,
    purpose: `${draft.occasion || "Birthday"} gift for ${draft.recipient}`,
    spendCap: share * participants.length,
    status: "collecting",
    clockOffsetDays: 0,
    participants,
    contributions: [],
    messages: [],
    candidates: [],
    giftOptions: [],
    votes: {},
    approvals: [],
    refunds: [],
    log: [],
    agentBusy: false,
  };
  putKitty(k);
  log(k, {
    actor: participants[0].name,
    action: `Typed one sentence: “${sentence.slice(0, 90)}${sentence.length > 90 ? "…" : ""}”`,
    status: "ok",
  });
  log(k, {
    actor: "Kitty AI",
    action: `Understood it: ${k.occasion.toLowerCase()} for ${k.recipient}, ${participants.length} people × ${fmt(share)}, goal ${fmt(k.goal)}`,
    tool: via === "claude" ? "claude.structured_output" : "offline_parser",
    amount: k.goal,
    status: "ok",
    details: `Interests: ${interests.join(", ") || "none given"} · event ${eventDate}`,
  });
  // The agent welcomes the group, then everyone gets a personal PayPal link.
  runAgent(k, { type: "kitty_created" }).then(() => postPayLinks(k));
  return k;
}

function emailFor(name: string, kittyId: string) {
  const slug = name.toLowerCase().normalize("NFD").replace(/[^a-z]/g, "") || "guest";
  return `${slug}.kitty${kittyId.slice(0, 4)}@example.com`;
}

export function postPayLinks(k: Kitty) {
  for (const p of k.participants) {
    say(k, "group", "kitty", `${p.name}, here's your personal link to chip in ${fmt(owes(k, p))}.`, "pay_link", {
      participantId: p.id,
      amount: owes(k, p),
      href: payLink(p),
    });
  }
  log(k, { actor: "Kitty AI", action: `Sent ${k.participants.length} personal PayPal payment links`, status: "ok", tool: "post_pay_links" });
}

export function addParticipant(k: Kitty, name: string): Participant {
  const p: Participant = {
    id: newId(),
    name,
    email: emailFor(name, k.id),
    share: k.sharePerPerson,
    token: newId() + newId(),
    color: COLORS[k.participants.length % COLORS.length],
    isOrganizer: false,
    reminders: 0,
    joinedAt: nowFor(k).toISOString(),
  };
  k.participants.push(p);
  k.goal += p.share;
  k.spendCap = Math.max(k.spendCap, k.goal);
  putKitty(k);
  say(k, "group", "kitty", `Welcome ${name}! Here's your link to chip in ${fmt(p.share)}.`, "pay_link", { participantId: p.id, amount: p.share, href: payLink(p) });
  log(k, { actor: "Kitty AI", action: `Added ${name} to the kitty; goal is now ${fmt(k.goal)}`, amount: p.share, status: "ok", tool: "add_participant" });
  return p;
}

// ---------- Collect (PayPal Orders v2) ----------
export async function createOrderForToken(token: string) {
  const k = kittyByToken(token);
  if (!k) throw new Error("This payment link is not valid anymore.");
  const p = k.participants.find((x) => x.token === token)!;
  const amount = owes(k, p);
  if (amount <= 0) throw new Error("You're all set: nothing left to pay.");
  if (k.status !== "collecting") throw new Error("This kitty is closed for contributions.");
  const order = await paypal.createOrder({
    amount,
    description: `${k.purpose}: ${p.name}'s share`,
    customId: `${k.id}:${p.id}`,
    referenceId: p.id,
    brand: `Kitty · ${k.recipient}'s ${k.occasion.toLowerCase()}`,
  });
  p.orderId = order.id;
  persist();
  log(k, { actor: p.name, action: `Opened PayPal checkout for ${fmt(amount)}`, tool: "paypal.orders.create", amount, status: "pending", ref: order.id });
  return { id: order.id, amount };
}

export async function captureForToken(token: string, orderId: string) {
  const k = kittyByToken(token);
  if (!k) throw new Error("This payment link is not valid anymore.");
  const p = k.participants.find((x) => x.token === token)!;
  if (k.contributions.some((c) => c.orderId === orderId)) return { ok: true, already: true };
  const due = owes(k, p);
  const cap = await paypal.captureOrder(orderId);
  if (cap.status !== "COMPLETED" && cap.captureStatus !== "PENDING") {
    log(k, { actor: "PayPal", action: `Payment from ${p.name} not completed (${cap.status})`, tool: "paypal.orders.capture", status: "error", ref: orderId });
    throw new Error(`PayPal returned ${cap.status}`);
  }
  const amount = cap.amount > 0 ? cap.amount : due;
  recordContribution(k, p, {
    amount,
    method: "paypal_checkout",
    orderId,
    captureId: cap.captureId,
    payerEmail: cap.payerEmail,
    status: cap.captureStatus === "PENDING" ? "PENDING" : "COMPLETED",
  });
  // If an invoice was still open for this person, close it so they can't pay twice.
  if (p.invoiceId && !["PAID", "MARKED_AS_PAID", "CANCELLED"].includes(p.invoiceStatus || "")) {
    try {
      if (paypalMode() === "sandbox")
        await paypal.runToolkit("cancel_sent_invoice", { invoice_id: p.invoiceId, note: "Paid through your Kitty link, thank you!", send_to_recipient: false });
      p.invoiceStatus = "CANCELLED";
      log(k, { actor: "Kitty AI", action: `Cancelled ${p.name}'s open invoice: paid via link instead`, tool: "paypal.agent_toolkit.cancel_sent_invoice", status: "ok", ref: p.invoiceId });
    } catch (e) {
      log(k, { actor: "Kitty AI", action: `Could not cancel ${p.name}'s invoice`, tool: "paypal.agent_toolkit.cancel_sent_invoice", status: "error", details: (e as Error).message });
    }
  }
  return { ok: true };
}

function recordContribution(k: Kitty, p: Participant, c: Omit<Contribution, "id" | "participantId" | "paidAt" | "mandate" | "refunded">) {
  const now = nowFor(k);
  const contribution: Contribution = {
    id: newId(),
    participantId: p.id,
    paidAt: now.toISOString(),
    refunded: 0,
    mandate: {
      id: `MND-${newId().toUpperCase().slice(0, 6)}`,
      purpose: k.purpose,
      maxCents: c.amount,
      acceptedAt: now.toISOString(),
      expiresAt: new Date(new Date(`${k.eventDate}T23:59:00Z`).getTime() + 14 * 86400000).toISOString(),
    },
    ...c,
  };
  k.contributions.push(contribution);
  persist();
  log(k, {
    actor: "PayPal",
    action: `${p.name} paid ${fmt(c.amount)} ${c.method === "paypal_invoice" ? "via PayPal invoice" : "via PayPal checkout"}`,
    tool: c.method === "paypal_invoice" ? "paypal.agent_toolkit.get_invoice" : "paypal.orders.capture",
    amount: c.amount,
    status: c.status === "PENDING" ? "pending" : "ok",
    ref: c.captureId || c.transactionId || c.invoiceId,
    details: `Mandate ${contribution.mandate.id}: up to ${fmt(c.amount)} for “${k.purpose}”`,
  });
  say(k, "group", "system", `${p.name} chipped in ${fmt(c.amount)} with PayPal`, "receipt", { participantId: p.id, amount: c.amount });
  if (k.status === "collecting" && collected(k) >= k.goal) {
    k.status = "choosing";
    persist();
    log(k, { actor: "Kitty AI", action: `Goal reached: ${fmt(collected(k))} collected`, amount: collected(k), status: "ok" });
    runAgent(k, { type: "goal_reached" });
  }
}

/** Poll open invoices (Agent Toolkit get_invoice). Called lazily from the state endpoint. */
export async function syncInvoices(k: Kitty) {
  if (paypalMode() !== "sandbox") return;
  if (k.lastInvoiceSync && Date.now() - k.lastInvoiceSync < 8000) return;
  k.lastInvoiceSync = Date.now();
  const open = k.participants.filter((p) => p.invoiceId && !["PAID", "MARKED_AS_PAID", "CANCELLED"].includes(p.invoiceStatus || ""));
  for (const p of open) {
    try {
      const inv = await paypal.getInvoice(p.invoiceId!);
      if (inv.status !== p.invoiceStatus) p.invoiceStatus = inv.status;
      if ((inv.status === "PAID" || inv.status === "MARKED_AS_PAID") && owes(k, p) > 0) {
        recordContribution(k, p, {
          amount: inv.paid || owes(k, p),
          method: "paypal_invoice",
          invoiceId: p.invoiceId,
          transactionId: inv.transactionId,
          status: "COMPLETED",
        });
      }
    } catch (e) {
      console.error("[kitty] invoice sync", e);
    }
  }
  persist();
}

/** Mock mode only: simulates the buyer approving in PayPal. Never available in sandbox mode. */
export async function mockPay(token: string) {
  if (paypalMode() !== "mock") throw new Error("Mock payments are disabled when PayPal sandbox is configured.");
  const { id } = await createOrderForToken(token);
  return captureForToken(token, id);
}

export async function mockPayInvoice(k: Kitty, participantId: string) {
  if (paypalMode() !== "mock") throw new Error("Mock payments are disabled when PayPal sandbox is configured.");
  const p = k.participants.find((x) => x.id === participantId);
  if (!p?.invoiceId) throw new Error("No invoice");
  p.invoiceStatus = "PAID";
  recordContribution(k, p, { amount: owes(k, p), method: "paypal_invoice", invoiceId: p.invoiceId, status: "COMPLETED" });
}

// ---------- Reminders & invoices ----------
export async function invoiceParticipant(k: Kitty, p: Participant, note: string) {
  const amount = owes(k, p);
  if (amount <= 0) throw new Error(`${p.name} has already paid.`);
  if (p.invoiceId && !["CANCELLED"].includes(p.invoiceStatus || "")) throw new Error(`${p.name} already has invoice ${p.invoiceId}. Use a reminder instead.`);
  const [given, ...rest] = p.name.split(" ");
  const inv = await paypal.createAndSendInvoice({
    givenName: given,
    surname: rest.join(" "),
    email: config.invoiceRecipientEmail || p.email,
    amount,
    itemName: `${k.purpose}: your share`,
    note,
    reference: `kitty:${k.id}:${p.id}`,
    businessName: `Kitty for ${k.recipient}'s ${k.occasion.toLowerCase()}`,
  });
  p.invoiceId = inv.invoiceId;
  p.invoiceStatus = inv.status;
  p.invoiceUrl = inv.payerUrl;
  persist();
  log(k, {
    actor: "Kitty AI",
    action: `Sent ${p.name} a PayPal invoice for ${fmt(amount)}`,
    tool: "paypal.agent_toolkit.create_invoice + send_invoice",
    amount,
    status: "ok",
    ref: inv.invoiceId,
    details: note,
  });
  say(k, "group", "kitty", note, "invoice", { participantId: p.id, amount, invoiceId: inv.invoiceId, href: inv.payerUrl || payLink(p) });
  return inv;
}

// ---------- Share changes (organizer decisions) ----------
export function proposeShareChange(k: Kitty, p: Participant, newAmount: Cents, message: string): Approval {
  const gap = p.share - newAmount;
  const org = organizer(k);
  const others = unpaid(k).filter((x) => x.id !== p.id && !x.isOrganizer);
  const options: DecisionOption[] = [
    { id: "lower_goal", label: `Lower the goal to ${fmt(k.goal - gap)}`, effect: `${p.name} pays ${fmt(newAmount)}; gift budget drops by ${fmt(gap)}` },
    { id: "organizer_covers", label: `I'll cover the ${fmt(gap)}`, effect: `${org.name}'s share goes up by ${fmt(gap)}` },
  ];
  if (others.length)
    options.push({ id: "split_unpaid", label: `Split ${fmt(gap)} among ${others.map((o) => o.name).join(", ")}`, effect: `+${fmt(Math.ceil(gap / others.length))} each for people who haven't paid yet` });
  const a: Approval = {
    id: newId(),
    kind: "decision",
    createdAt: nowFor(k).toISOString(),
    status: "pending",
    title: `${p.name} can only give ${fmt(newAmount)}`,
    message,
    amount: gap,
    checks: [],
    options,
    data: { participantId: p.id, newAmount, gap },
  };
  k.approvals.push(a);
  persist();
  log(k, { actor: "Kitty AI", action: `Asked ${org.name} how to cover ${p.name}'s ${fmt(gap)} gap`, tool: "propose_share_change", amount: gap, status: "waiting" });
  return a;
}

// ---------- Purchase & refunds (approval gate) ----------
export function requestPurchase(
  k: Kitty,
  item: { title: string; price: Cents; merchant: string; optionId?: string; image?: string },
  message: string,
): { approval?: Approval; blocked?: string } {
  const fromVote = !!item.optionId && winningOption(k)?.id === item.optionId;
  const { ok, checks } = purchaseChecks(k, item.price, { fromVote });
  if (!ok) {
    const failed = checks.filter((c) => !c.ok).map((c) => c.label + (c.detail ? ` (${c.detail})` : ""));
    log(k, { actor: "Policy engine", action: `Blocked a ${fmt(item.price)} purchase: ${item.title}`, tool: "request_purchase_approval", amount: item.price, status: "blocked", details: failed.join("; ") });
    return { blocked: failed.join("; ") };
  }
  k.approvals.filter((a) => a.kind === "purchase" && a.status === "pending").forEach((a) => (a.status = "declined"));
  const a: Approval = {
    id: newId(),
    kind: "purchase",
    createdAt: nowFor(k).toISOString(),
    status: "pending",
    title: `Buy “${item.title}”`,
    message,
    amount: item.price,
    payee: item.merchant,
    checks,
    data: { ...item },
  };
  k.approvals.push(a);
  k.status = "buying";
  persist();
  log(k, { actor: "Kitty AI", action: `Waiting for ${organizer(k).name}'s approval to pay ${fmt(item.price)} to ${item.merchant}`, tool: "request_purchase_approval", amount: item.price, status: "waiting" });
  return { approval: a };
}

export function requestRefunds(k: Kitty, message: string): { approval?: Approval; blocked?: string } {
  const leftover = available(k);
  if (leftover <= 0) return { blocked: "Nothing left to refund." };
  const weights = k.contributions.filter((c) => c.amount - c.refunded > 0).map((c) => ({ id: c.id, weight: c.amount }));
  const split = proRata(leftover, weights);
  const lines = Object.entries(split)
    .filter(([, v]) => v > 0)
    .map(([cid, amount]) => {
      const c = k.contributions.find((x) => x.id === cid)!;
      return { contributionId: cid, participantId: c.participantId, amount, name: participantName(k, c.participantId) };
    })
    .sort((a, b) => k.participants.findIndex((p) => p.id === a.participantId) - k.participants.findIndex((p) => p.id === b.participantId));
  const { ok, checks } = refundChecks(k, lines.reduce((s, l) => s + l.amount, 0));
  if (!ok) return { blocked: checks.filter((c) => !c.ok).map((c) => c.label).join("; ") };
  const a: Approval = {
    id: newId(),
    kind: "refund",
    createdAt: nowFor(k).toISOString(),
    status: "pending",
    title: `Refund the ${fmt(leftover)} left over`,
    message,
    amount: leftover,
    payee: `${lines.length} contributors`,
    checks,
    data: { lines },
  };
  k.approvals.push(a);
  persist();
  log(k, { actor: "Kitty AI", action: `Proposed refunding ${fmt(leftover)} pro rata to ${lines.length} people`, tool: "request_refund_approval", amount: leftover, status: "waiting" });
  return { approval: a };
}

export function winningOption(k: Kitty) {
  if (!k.giftOptions.length) return undefined;
  const tally: Record<string, number> = {};
  for (const o of Object.values(k.votes)) tally[o] = (tally[o] || 0) + 1;
  return [...k.giftOptions].sort((a, b) => (tally[b.id] || 0) - (tally[a.id] || 0))[0];
}

export function tally(k: Kitty) {
  const t: Record<string, number> = {};
  for (const o of Object.values(k.votes)) t[o] = (t[o] || 0) + 1;
  return t;
}

export async function resolveApproval(kittyId: string, approvalId: string, decision: "approve" | "decline", optionId?: string) {
  const k = getKitty(kittyId);
  if (!k) throw new Error("Kitty not found");
  const a = k.approvals.find((x) => x.id === approvalId);
  if (!a || a.status !== "pending") throw new Error("This request was already handled.");
  const org = organizer(k);
  a.resolvedAt = nowFor(k).toISOString();
  if (decision === "decline") {
    a.status = "declined";
    if (a.kind === "purchase") k.status = "voting";
    log(k, { actor: org.name, action: `Declined: ${a.title}`, status: "ok", amount: a.amount });
    persist();
    runAgent(k, { type: "approval_declined", approvalId: a.id });
    return a;
  }
  a.status = "approved";
  log(k, { actor: org.name, action: `Approved: ${a.title}${optionId ? ` (${a.options?.find((o) => o.id === optionId)?.label})` : ""}`, status: "ok", amount: a.amount });
  persist();
  if (a.kind === "purchase") await executePurchase(k, a);
  else if (a.kind === "refund") await executeRefunds(k, a);
  else await applyDecision(k, a, optionId || a.options?.[0]?.id || "lower_goal");
  return a;
}

async function executePurchase(k: Kitty, a: Approval) {
  const item = a.data as { title: string; price: Cents; merchant: string; optionId?: string };
  const recheck = purchaseChecks(k, item.price, { fromVote: true });
  if (!recheck.ok) {
    a.status = "blocked";
    a.result = recheck.checks.filter((c) => !c.ok).map((c) => c.label).join("; ");
    log(k, { actor: "Policy engine", action: `Stopped the payment at the last check`, status: "blocked", amount: item.price, details: a.result });
    persist();
    return;
  }
  try {
    const batchId = `kitty_${k.id}_${newId()}`;
    const po = await paypal.payout({
      email: config.giftShopEmail || "shop@mock",
      amount: item.price,
      batchId,
      subject: `Kitty order: ${item.title}`,
      note: `Group gift for ${k.recipient} (${k.occasion}). Item: ${item.title}. Paid by Kitty on behalf of ${k.contributions.length} contributors.`,
    });
    k.purchase = { optionId: item.optionId || "", title: item.title, merchant: item.merchant, amount: item.price, payoutBatchId: po.batchId, status: po.status || "PENDING", at: nowFor(k).toISOString() };
    k.status = "purchased";
    a.status = "executed";
    persist();
    log(k, { actor: "Kitty AI", action: `Paid ${fmt(item.price)} to ${item.merchant} with PayPal`, tool: "paypal.payouts.create", amount: item.price, status: "pending", ref: po.batchId, details: paypalMode() === "sandbox" ? `Sandbox merchant: ${config.giftShopName}` : "mock" });
    // Wait briefly for the payout to settle so the demo shows the final PayPal transaction id.
    for (let i = 0; i < 6; i++) {
      const s = await paypal.getPayout(po.batchId);
      k.purchase.status = s.status;
      k.purchase.payoutItemId = s.itemId;
      k.purchase.transactionId = s.transactionId;
      if (s.status === "SUCCESS" || s.itemStatus === "SUCCESS" || s.status === "DENIED") break;
      await new Promise((r) => setTimeout(r, 1500));
    }
    a.result = `PayPal payout ${po.batchId} · ${k.purchase.status}`;
    log(k, { actor: "PayPal", action: `Payout to ${item.merchant}: ${k.purchase.status}`, tool: "paypal.payouts.get", amount: item.price, status: k.purchase.status === "DENIED" ? "error" : "ok", ref: k.purchase.transactionId || po.batchId });
    persist();
    runAgent(k, { type: "purchase_executed" });
  } catch (e) {
    a.status = "failed";
    a.result = (e as Error).message;
    k.status = "buying";
    log(k, { actor: "PayPal", action: "Payment to the gift shop failed", tool: "paypal.payouts.create", amount: item.price, status: "error", details: a.result });
    persist();
  }
}

async function executeRefunds(k: Kitty, a: Approval) {
  const lines = (a.data.lines || []) as { contributionId: string; participantId: string; amount: Cents; name: string }[];
  let okCount = 0;
  for (const l of lines) {
    const c = k.contributions.find((x) => x.id === l.contributionId);
    if (!c) continue;
    try {
      let refundId = "";
      let via: "refunds_api" | "payouts_api" = "refunds_api";
      const captureId = c.captureId || c.transactionId;
      try {
        if (!captureId) throw new Error("no capture id");
        const r = await paypal.refundCapture(captureId, l.amount, `Your share of what was left from ${k.purpose}. Thanks for chipping in!`);
        refundId = r.id;
      } catch (err) {
        if (!c.payerEmail && !c.invoiceId) throw err;
        via = "payouts_api";
        const p = k.participants.find((x) => x.id === c.participantId)!;
        const po = await paypal.payout({ email: c.payerEmail || config.invoiceRecipientEmail || p.email, amount: l.amount, batchId: `kitty_refund_${newId()}`, subject: "Your Kitty refund", note: `Leftover from ${k.purpose}` });
        refundId = po.batchId;
      }
      c.refunded += l.amount;
      k.refunds.push({ id: newId(), participantId: l.participantId, contributionId: c.id, amount: l.amount, refundId, via, status: "COMPLETED", at: nowFor(k).toISOString() });
      okCount++;
      log(k, { actor: "Kitty AI", action: `Refunded ${fmt(l.amount)} to ${l.name}`, tool: via === "refunds_api" ? "paypal.agent_toolkit.create_refund" : "paypal.payouts.create", amount: l.amount, status: "ok", ref: refundId });
    } catch (e) {
      log(k, { actor: "PayPal", action: `Refund to ${l.name} failed`, tool: "paypal.agent_toolkit.create_refund", amount: l.amount, status: "error", details: (e as Error).message });
    }
  }
  a.status = okCount === lines.length ? "executed" : "failed";
  a.result = `${okCount}/${lines.length} refunds sent`;
  if (okCount === lines.length) k.status = "done";
  persist();
  runAgent(k, { type: "refunds_executed" });
}

async function applyDecision(k: Kitty, a: Approval, optionId: string) {
  const { participantId, newAmount, gap } = a.data as { participantId: string; newAmount: Cents; gap: Cents };
  const p = k.participants.find((x) => x.id === participantId)!;
  const opt = a.options?.find((o) => o.id === optionId);
  p.share = newAmount;
  if (optionId === "lower_goal") {
    k.goal -= gap;
    k.spendCap = Math.min(k.spendCap, k.goal);
  } else if (optionId === "organizer_covers") {
    organizer(k).share += gap;
  } else if (optionId === "split_unpaid") {
    const others = unpaid(k).filter((x) => x.id !== p.id && !x.isOrganizer);
    const parts = proRata(gap, others.map((o) => ({ id: o.id, weight: 1 })));
    for (const o of others) o.share += parts[o.id] || 0;
  }
  a.status = "executed";
  a.result = opt?.label;
  persist();
  log(k, { actor: "Kitty AI", action: `Rebalanced shares: ${opt?.label}`, tool: "apply_share_change", amount: gap, status: "ok", details: opt?.effect });
  if (optionId === "organizer_covers") {
    const org = organizer(k);
    say(k, "group", "kitty", `${org.name}, here's your link for the extra ${fmt(owes(k, org))}.`, "pay_link", { participantId: org.id, amount: owes(k, org), href: payLink(org) });
  }
  // A lower goal may already be met.
  if (k.status === "collecting" && collected(k) >= k.goal) {
    k.status = "choosing";
    log(k, { actor: "Kitty AI", action: `Goal reached: ${fmt(collected(k))} collected`, amount: collected(k), status: "ok" });
    persist();
    await runAgent(k, { type: "decision_resolved", approvalId: a.id });
    runAgent(k, { type: "goal_reached" });
    return;
  }
  runAgent(k, { type: "decision_resolved", approvalId: a.id });
}

// ---------- Votes ----------
export function castVote(k: Kitty, participantId: string, optionId: string) {
  if (!k.giftOptions.some((o) => o.id === optionId)) throw new Error("Unknown option");
  k.votes[participantId] = optionId;
  const o = k.giftOptions.find((x) => x.id === optionId)!;
  persist();
  log(k, { actor: participantName(k, participantId), action: `Voted for ${o.title}`, status: "ok" });
  const voters = new Set(k.contributions.map((c) => c.participantId));
  if (k.status === "voting" && [...voters].every((v) => k.votes[v])) closeVote(k);
}

export function closeVote(k: Kitty) {
  if (k.status !== "voting") return;
  const w = winningOption(k);
  if (!w) return;
  log(k, { actor: "Kitty AI", action: `Vote closed: ${w.title} wins (${tally(k)[w.id] || 0} votes)`, status: "ok", amount: w.price });
  runAgent(k, { type: "vote_closed" });
}
