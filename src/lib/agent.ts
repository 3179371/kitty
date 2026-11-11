/**
 * Kitty's brain. One agent run per event (kitty created, goal reached, a day passes,
 * someone writes in the group, a vote closes, money moved...). The model acts only
 * through tools; tools that would move money out only create approval requests.
 */
import { generateText, tool, type Tool } from "ai";
import { z } from "zod";
import { model } from "./ai";
import { aiMode, giftSource, paypalMode } from "./config";
import { available, collected, fmt, paidBy, toCents } from "./money";
import { toolkit } from "./paypal";
import { searchGifts } from "./gifts";
import { enqueue, log, newId, nowFor, participantName, persist, say } from "./store";
import type { Kitty } from "./types";
import {
  addParticipant,
  invoiceParticipant,
  organizer,
  owes,
  proposeShareChange,
  requestPurchase,
  requestRefunds,
  tally,
  unpaid,
  winningOption,
} from "./actions";

export type AgentEvent =
  | { type: "kitty_created" }
  | { type: "goal_reached" }
  | { type: "daily_check" }
  | { type: "participant_message"; participantId: string; text: string }
  | { type: "organizer_command"; text: string }
  | { type: "decision_resolved"; approvalId: string }
  | { type: "approval_declined"; approvalId: string }
  | { type: "vote_closed" }
  | { type: "purchase_executed" }
  | { type: "refunds_executed" };

const THOUGHTS: Record<AgentEvent["type"], string> = {
  kitty_created: "Setting up the kitty",
  goal_reached: "Looking for gift ideas",
  daily_check: "Checking who still has to pay",
  participant_message: "Reading the group chat",
  organizer_command: "Working on your request",
  decision_resolved: "Updating everyone",
  approval_declined: "Taking note",
  vote_closed: "Counting votes",
  purchase_executed: "Wrapping things up",
  refunds_executed: "Closing the kitty",
};

export function runAgent(k: Kitty, event: AgentEvent): Promise<void> {
  return enqueue(k.id, async () => {
    k.agentBusy = true;
    k.agentThought = THOUGHTS[event.type];
    persist();
    try {
      if (aiMode() === "claude") await runClaude(k, event);
      else await runOffline(k, event);
    } catch (e) {
      console.error("[kitty] agent run failed", e);
      log(k, { actor: "Kitty AI", action: `Agent error while handling ${event.type}; switched to safe fallback`, status: "error", details: (e as Error).message });
      try {
        await runOffline(k, event);
      } catch (e2) {
        console.error("[kitty] offline fallback failed", e2);
      }
    } finally {
      k.agentBusy = false;
      k.agentThought = undefined;
      persist();
    }
  });
}

// ---------------------------------------------------------------- context
export function snapshot(k: Kitty) {
  const now = nowFor(k);
  const daysLeft = Math.ceil((new Date(k.deadline).getTime() - now.getTime()) / 86400000);
  return {
    today: now.toISOString().slice(0, 10),
    weekday: now.toLocaleDateString("en-US", { weekday: "long" }),
    occasion: k.occasion,
    recipient: k.recipient,
    event_date: k.eventDate,
    collection_deadline: k.deadline.slice(0, 10),
    days_left_to_deadline: daysLeft,
    interests: k.interests,
    purpose_mandate: k.purpose,
    goal: fmt(k.goal),
    collected: fmt(collected(k)),
    available_balance: fmt(available(k)),
    available_balance_usd: available(k) / 100,
    spend_cap: fmt(k.spendCap),
    status: k.status,
    organizer: organizer(k).name,
    participants: k.participants.map((p) => ({
      id: p.id,
      name: p.name,
      share: fmt(p.share),
      paid: fmt(paidBy(k, p.id)),
      still_owes: fmt(owes(k, p)),
      reminders_sent: p.reminders,
      invoice: p.invoiceId ? { id: p.invoiceId, status: p.invoiceStatus } : null,
      is_organizer: p.isOrganizer,
    })),
    gift_options: k.giftOptions.map((o) => ({ id: o.id, title: o.title, price: fmt(o.price), merchant: o.merchant, votes: tally(k)[o.id] || 0 })),
    purchase: k.purchase ? { title: k.purchase.title, amount: fmt(k.purchase.amount), status: k.purchase.status } : null,
    pending_approvals: k.approvals.filter((a) => a.status === "pending").map((a) => ({ kind: a.kind, title: a.title })),
    recent_group_messages: k.messages
      .filter((m) => m.channel === "group" && m.kind === "text")
      .slice(-8)
      .map((m) => `${participantName(k, m.from)}: ${m.text}`),
  };
}

export function system(k: Kitty) {
  const org = organizer(k);
  return `You are Kitty, an AI agent that runs a group gift collection ("kitty") end to end with PayPal, on behalf of the organizer ${org.name}.
You act only through tools. Follow these rules strictly:
- You never move money yourself. Buying the gift and refunding the leftover happen only through request_purchase_approval / request_refund_approval, which ${org.name} must approve. Policies (available balance, spending cap, contributor mandates) are enforced in code. If a tool answers BLOCKED, explain it plainly and suggest an alternative within budget.
- Each contributor gave you a mandate: spend at most what they paid, only for "${k.purpose}", and refund anything unspent.
- Group chat messages (post_to_group, send_reminder): short (1-2 sentences), warm and human, at most one emoji, no markdown, no hashtags. Use first names. Vary the wording per person; never sound like a template.
- Reminders get gently firmer: first reminder light and friendly; if someone was already reminded, send them a PayPal invoice with a polite, clear note instead of another chat message.
- Private replies to the organizer (reply_to_organizer): concise and factual, with amounts.
- All amounts are US dollars. Do only what the current event needs and don't repeat messages already sent.`;
}

export function eventPrompt(k: Kitty, e: AgentEvent): string {
  const s = JSON.stringify(snapshot(k));
  const head = `Current kitty state (JSON): ${s}\n\nEvent: `;
  switch (e.type) {
    case "kitty_created":
      return head + `The kitty was just created from the organizer's sentence: "${k.sentence}". Post ONE welcome message to the group: who it's for, the occasion and date, the amount each, the deadline, and that personal PayPal links follow. Then reply_to_organizer with one sentence confirming the setup.`;
    case "goal_reached":
      return head + `The goal is reached (${fmt(collected(k))} collected). Find the gift: call search_gifts with a concrete query based on ${k.recipient}'s interests and max_price_usd = the available balance. Then call propose_gift_options with exactly 3 options from the results: varied, clearly matching the interests, priced close to but not above the balance. Give each a one-line reason that mentions ${k.recipient}.`;
    case "daily_check": {
      const list = unpaid(k).map((p) => `${p.name} (owes ${fmt(owes(k, p))}, reminders_sent=${p.reminders}, invoice=${p.invoiceId ? p.invoiceStatus : "none"})`);
      return head + `Daily check-in. Unpaid: ${list.join("; ") || "nobody"}. For each unpaid person: if reminders_sent is 0, call send_reminder with a personal nudge. If reminders_sent >= 1 and they have no invoice, call send_paypal_invoice with a polite note. If they already have an open invoice and the deadline is within 1 day, call send_invoice_reminder (PayPal Agent Toolkit) with that invoice id. If nobody is unpaid, do nothing.`;
    }
    case "participant_message":
      return head + `${participantName(k, e.participantId)} (id ${e.participantId}) wrote in the group: "${e.text}". Decide whether to act. If they say they can only give a different amount, call propose_share_change with their id and the new amount in USD. If they're asking something, answer briefly in the group. Birthday wishes or chit-chat don't need a reply (never reply to every message).`;
    case "organizer_command":
      return head + `${organizer(k).name} wrote to you privately: "${e.text}". Help them using your tools (add people, check status, remind, search gifts, request a purchase approval...). If they ask to buy or pay for anything, ALWAYS call request_purchase_approval with what they asked for (title, price_usd, merchant), even if you expect it to fail: the policy engine decides and logs it, you never refuse on your own. If it answers BLOCKED, say which checks failed. Always finish with reply_to_organizer, in at most two short sentences.`;
    case "decision_resolved": {
      const a = k.approvals.find((x) => x.id === e.approvalId);
      return head + `${organizer(k).name} decided: "${a?.result}" for "${a?.title}". Tell the group in one short message.`;
    }
    case "approval_declined": {
      const a = k.approvals.find((x) => x.id === e.approvalId);
      return head + `${organizer(k).name} declined "${a?.title}". Reply to the organizer in one sentence asking what they'd prefer instead.`;
    }
    case "vote_closed": {
      const w = winningOption(k);
      return head + `Voting closed. Winner: ${w?.title} (option id ${w?.id}) at ${fmt(w?.price)} from ${w?.merchant}. Post a short group message announcing the winner, then call request_purchase_approval with that option id and a one-sentence message to the organizer.`;
    }
    case "purchase_executed":
      return head + `The gift is paid with PayPal: ${k.purchase?.title} for ${fmt(k.purchase?.amount)}. Leftover balance: ${fmt(available(k))}. 1) post_to_group a short celebratory message. 2) If the leftover is above $0, call request_refund_approval. 3) Call create_birthday_card with a warm headline and a 2-3 sentence message to ${k.recipient} from the whole group that mentions the gift.`;
    case "refunds_executed": {
      const r = k.refunds.map((x) => `${participantName(k, x.participantId)} ${fmt(x.amount)}`).join(", ");
      return head + `Refunds are done (${r}). Post one closing message to the group summarising: gift bought, each person's refund, and that the card is ready. Then reply_to_organizer that the kitty is closed and every dollar is accounted for.`;
    }
  }
}

// ---------------------------------------------------------------- tools
export function tools(k: Kitty): Record<string, Tool> {
  const findP = (id: string) => k.participants.find((p) => p.id === id || p.name.toLowerCase() === id.toLowerCase());
  const t: Record<string, Tool> = {
    post_to_group: tool({
      description: "Post a message as Kitty in the group chat everyone sees.",
      parameters: z.object({ text: z.string() }),
      execute: async ({ text }) => {
        say(k, "group", "kitty", text);
        return "posted";
      },
    }),
    reply_to_organizer: tool({
      description: "Send a private message to the organizer.",
      parameters: z.object({ text: z.string() }),
      execute: async ({ text }) => {
        say(k, "organizer", "kitty", text);
        return "sent";
      },
    }),
    get_kitty_status: tool({
      description: "Get the latest state of the kitty: who paid, balances, invoices, votes.",
      parameters: z.object({}),
      execute: async () => snapshot(k),
    }),
    send_reminder: tool({
      description: "Post a personal payment reminder to one unpaid participant in the group chat (mention them by name). Their pay link is attached automatically.",
      parameters: z.object({ participant_id: z.string(), text: z.string() }),
      execute: async ({ participant_id, text }) => {
        const p = findP(participant_id);
        if (!p) return "Unknown participant";
        if (owes(k, p) <= 0) return `${p.name} already paid. No reminder sent.`;
        p.reminders += 1;
        p.lastRemindedAt = nowFor(k).toISOString();
        say(k, "group", "kitty", text, "pay_link", { participantId: p.id, amount: owes(k, p), href: `/pay/${p.token}`, reminder: p.reminders });
        log(k, { actor: "Kitty AI", action: `Reminded ${p.name} (#${p.reminders})`, tool: "send_reminder", amount: owes(k, p), status: "ok", details: text });
        return `Reminder #${p.reminders} sent to ${p.name}`;
      },
    }),
    send_paypal_invoice: tool({
      description: "Create and send a real PayPal invoice (PayPal Agent Toolkit: create_invoice + send_invoice) to one unpaid participant for what they still owe. Use after a chat reminder was ignored.",
      parameters: z.object({ participant_id: z.string(), note: z.string().describe("Polite note shown on the invoice and in the chat") }),
      execute: async ({ participant_id, note }) => {
        const p = findP(participant_id);
        if (!p) return "Unknown participant";
        try {
          const inv = await invoiceParticipant(k, p, note);
          p.reminders += 1;
          return `Invoice ${inv.invoiceId} sent to ${p.name}`;
        } catch (e) {
          log(k, { actor: "Kitty AI", action: `Could not invoice ${p.name}`, tool: "paypal.agent_toolkit.create_invoice", status: "error", details: (e as Error).message });
          return `Failed: ${(e as Error).message}`;
        }
      },
    }),
    propose_share_change: tool({
      description: "When someone can only give a different amount, ask the organizer how to cover the gap (the organizer gets options to choose from).",
      parameters: z.object({ participant_id: z.string(), new_amount_usd: z.number(), message_to_organizer: z.string() }),
      execute: async ({ participant_id, new_amount_usd, message_to_organizer }) => {
        const p = findP(participant_id);
        if (!p) return "Unknown participant";
        const newAmount = toCents(new_amount_usd);
        if (newAmount >= p.share) return "New amount is not lower than their share; nothing to do.";
        proposeShareChange(k, p, newAmount, message_to_organizer);
        say(k, "organizer", "kitty", message_to_organizer);
        return "Decision request sent to the organizer. Tell the person in the group it's handled, briefly.";
      },
    }),
    add_participant: tool({
      description: "Add a person to the kitty. They get their own PayPal link and the goal grows by one share.",
      parameters: z.object({ name: z.string() }),
      execute: async ({ name }) => {
        const p = addParticipant(k, name);
        return `${p.name} added. New goal ${fmt(k.goal)}`;
      },
    }),
    search_gifts: tool({
      description: `Search real products${giftSource() === "channel3" ? " (Channel3 product API)" : " (demo catalog)"} within a budget. Returns candidates with ids.`,
      parameters: z.object({ query: z.string(), max_price_usd: z.number() }),
      execute: async ({ query, max_price_usd }) => {
        const cap = Math.min(toCents(max_price_usd), available(k));
        const found = await searchGifts(query, cap, k.interests);
        k.candidates = found;
        persist();
        log(k, { actor: "Kitty AI", action: `Searched gifts: “${query}” under ${fmt(cap)} → ${found.length} results`, tool: giftSource() === "channel3" ? "channel3.search" : "demo_catalog.search", status: "ok", amount: cap });
        return found.map((c) => ({ id: c.id, title: c.title, brand: c.brand, price: fmt(c.price), merchant: c.merchant, about: c.description }));
      },
    }),
    propose_gift_options: tool({
      description: "Show exactly 3 gift options (from search_gifts results) to the group for a vote.",
      parameters: z.object({ options: z.array(z.object({ candidate_id: z.string(), reason: z.string() })).min(1).max(3), intro: z.string().describe("One short line introducing the vote") }),
      execute: async ({ options, intro }) => {
        const picked = options
          .map((o) => {
            const c = k.candidates.find((x) => x.id === o.candidate_id);
            return c ? { ...c, reason: o.reason } : null;
          })
          .filter(Boolean) as Kitty["giftOptions"];
        if (!picked.length) return "None of those ids exist. Use ids from search_gifts.";
        k.giftOptions = picked;
        k.votes = {};
        k.status = "voting";
        persist();
        say(k, "group", "kitty", intro, "gift_vote", { optionIds: picked.map((p) => p.id) });
        log(k, { actor: "Kitty AI", action: `Proposed 3 gifts to the group: ${picked.map((p) => `${p.title} (${fmt(p.price)})`).join(", ")}`, tool: "propose_gift_options", status: "ok" });
        return "Vote opened in the group chat.";
      },
    }),
    request_purchase_approval: tool({
      description: "Ask the organizer to approve paying for a gift. Use an option_id from the vote, or give title/price/merchant for something else. Policies are checked in code; may return BLOCKED.",
      parameters: z.object({
        option_id: z.string().optional(),
        title: z.string().optional(),
        price_usd: z.number().optional(),
        merchant: z.string().optional(),
        message: z.string().describe("One sentence for the organizer"),
      }),
      execute: async ({ option_id, title, price_usd, merchant, message }) => {
        const opt = option_id ? k.giftOptions.find((o) => o.id === option_id) || k.candidates.find((o) => o.id === option_id) : undefined;
        const item = opt
          ? { title: opt.title, price: opt.price, merchant: opt.merchant, optionId: opt.id, image: opt.image }
          : { title: title || "Gift", price: toCents(price_usd || 0), merchant: merchant || "Unknown merchant" };
        const r = requestPurchase(k, item, message);
        if (r.blocked) return `BLOCKED by policy: ${r.blocked}. Nothing was requested.`;
        return "Approval request shown to the organizer. Wait for their decision; do not claim it is bought.";
      },
    }),
    request_refund_approval: tool({
      description: "Ask the organizer to approve refunding the unspent balance pro rata to everyone who paid (PayPal Refunds).",
      parameters: z.object({ message: z.string() }),
      execute: async ({ message }) => {
        const r = requestRefunds(k, message);
        return r.blocked ? `BLOCKED: ${r.blocked}` : "Refund approval request shown to the organizer.";
      },
    }),
    create_birthday_card: tool({
      description: "Create the shared card for the recipient, signed with everyone's wishes from the group chat.",
      parameters: z.object({ headline: z.string(), message: z.string() }),
      execute: async ({ headline, message }) => {
        makeCard(k, headline, message);
        return `Card ready at /card/${k.id}`;
      },
    }),
  };

  // Direct PayPal Agent Toolkit tools (read + invoice follow-up), sandbox only.
  if (paypalMode() === "sandbox") {
    const tk = toolkit().getTools() as Record<string, Tool>;
    for (const name of ["get_invoice", "send_invoice_reminder"]) {
      const base = tk[name] as Tool & { execute: (a: any, o: any) => Promise<any> };
      if (!base) continue;
      t[name] = {
        ...base,
        execute: async (args: any, opts: any) => {
          const out = await base.execute(args, opts);
          const failed = typeof out === "string" && out.includes('"error"');
          log(k, {
            actor: "Kitty AI",
            action: name === "send_invoice_reminder" ? `PayPal invoice reminder sent (${args.invoice_id})` : `Checked PayPal: ${name.replace(/_/g, " ")}`,
            tool: `paypal.agent_toolkit.${name}`,
            status: failed ? "error" : "ok",
            ref: args.invoice_id,
            details: failed ? String(out).slice(0, 200) : undefined,
          });
          if (name === "send_invoice_reminder" && !failed) {
            const p = k.participants.find((x) => x.invoiceId === args.invoice_id);
            if (p) {
              p.reminders += 1;
              say(k, "group", "kitty", args.note || `${p.name}, PayPal just re-sent your invoice.`, "invoice", { participantId: p.id, amount: owes(k, p), invoiceId: p.invoiceId, href: p.invoiceUrl || `/pay/${p.token}` });
            }
          }
          return typeof out === "string" ? out.slice(0, 4000) : out;
        },
      } as Tool;
    }
  }
  return t;
}

function makeCard(k: Kitty, headline: string, message: string) {
  const wishes = k.messages.filter((m) => m.channel === "group" && m.kind === "text" && m.from !== "kitty" && m.from !== "system" && m.from !== "organizer");
  const byPerson = new Map<string, string>();
  for (const m of wishes) {
    if (/birthday|bday|happy|congrat|best|enjoy|love|cheers|wish/i.test(m.text)) byPerson.set(m.from, m.text);
  }
  const signatures = k.participants.map((p) => ({ name: p.name, text: byPerson.get(p.id) || "", color: p.color }));
  k.card = { headline, message, signatures, giftTitle: k.purchase?.title, createdAt: nowFor(k).toISOString() };
  persist();
  say(k, "group", "kitty", `The card for ${k.recipient} is ready, signed by all of you.`, "card", { href: `/card/${k.id}` });
  log(k, { actor: "Kitty AI", action: `Wrote ${k.recipient}'s card, signed by ${signatures.length} people`, tool: "create_birthday_card", status: "ok" });
}

async function runClaude(k: Kitty, e: AgentEvent) {
  const started = Date.now();
  const res = await generateText({
    model: model(),
    system: system(k),
    prompt: eventPrompt(k, e),
    tools: tools(k),
    maxSteps: 8,
    abortSignal: AbortSignal.timeout(75_000),
  });
  const calls = res.steps.flatMap((s) => s.toolCalls.map((c) => c.toolName));
  if (!calls.length && res.text) say(k, e.type === "organizer_command" ? "organizer" : "group", "kitty", res.text);
  log(k, {
    actor: "Kitty AI",
    action: `Handled “${e.type.replace(/_/g, " ")}” in ${((Date.now() - started) / 1000).toFixed(1)}s`,
    tool: `claude · ${calls.length} tool call${calls.length === 1 ? "" : "s"}`,
    status: "ok",
    details: calls.join(" → ") || "no action needed",
  });
}

// ---------------------------------------------------------------- offline fallback (no API key)
const pick = <T,>(arr: T[], seed: string) => arr[[...seed].reduce((s, c) => s + c.charCodeAt(0), 0) % arr.length];

async function runOffline(k: Kitty, e: AgentEvent) {
  const T = tools(k) as unknown as Record<string, { execute: (a: any, o: any) => Promise<any> }>;
  const x = (name: string, args: Record<string, unknown>) => T[name].execute(args, { toolCallId: newId(), messages: [] });
  const org = organizer(k);
  switch (e.type) {
    case "kitty_created":
      await x("post_to_group", { text: `Hi all! We're chipping in ${fmt(k.sharePerPerson)} each for ${k.recipient}'s ${k.occasion.toLowerCase()} on ${new Date(k.eventDate).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" })}. Your personal PayPal link is right below, please pay by ${new Date(k.deadline).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })} 🎁` });
      await x("reply_to_organizer", { text: `All set: ${k.participants.length} people, ${fmt(k.goal)} goal. I'll chase payments and come back to you before spending anything.` });
      break;
    case "goal_reached": {
      const found = (await x("search_gifts", { query: `${k.interests.join(" ")} gift`, max_price_usd: available(k) / 100 })) as { id: string; title: string }[];
      const top = found.slice(0, 3);
      await x("propose_gift_options", {
        intro: `We did it, ${fmt(collected(k))} for ${k.recipient}! Here are 3 ideas, tap to vote.`,
        options: top.map((c, i) => ({ candidate_id: c.id, reason: [`Fits ${k.recipient}'s love of ${k.interests[0] || "nice things"} perfectly`, `Useful on every outing, and within budget`, `A memorable pick that leaves a bit to refund`][i] })),
      });
      break;
    }
    case "daily_check":
      for (const p of unpaid(k)) {
        if (p.reminders === 0)
          await x("send_reminder", { participant_id: p.id, text: pick([`Hey ${p.name}, quick nudge: ${k.recipient}'s gift is almost funded, your link is below 🙂`, `${p.name}, we're nearly there for ${k.recipient}! Your ${fmt(owes(k, p))} link is just below.`, `Psst ${p.name}, don't miss out on ${k.recipient}'s gift. One tap and you're in.`], p.id) });
        else if (!p.invoiceId)
          await x("send_paypal_invoice", { participant_id: p.id, note: `Hi ${p.name}, here's a PayPal invoice for your ${fmt(owes(k, p))} share of ${k.recipient}'s gift. The deadline is close, thanks for sorting it today!` });
      }
      break;
    case "participant_message": {
      const m = e.text.match(/(?:only|just|max|can do)\D{0,12}\$?(\d+(?:\.\d+)?)/i);
      const p = k.participants.find((q) => q.id === e.participantId);
      if (m && p && toCents(parseFloat(m[1])) < p.share) {
        await x("propose_share_change", { participant_id: p.id, new_amount_usd: parseFloat(m[1]), message_to_organizer: `${p.name} can only give $${m[1]} instead of ${fmt(p.share)}. How do you want to cover the ${fmt(p.share - toCents(parseFloat(m[1])))}?` });
        await x("post_to_group", { text: `No worries ${p.name}, I've asked ${org.name} how to handle it.` });
      }
      break;
    }
    case "organizer_command": {
      const add = e.text.match(/add\s+([A-Z][a-z]+)/i);
      if (add) await x("add_participant", { name: add[1][0].toUpperCase() + add[1].slice(1) });
      const s = snapshot(k);
      await x("reply_to_organizer", { text: `${s.collected} of ${s.goal} collected. Still waiting on: ${unpaid(k).map((p) => p.name).join(", ") || "nobody"}.` });
      break;
    }
    case "decision_resolved": {
      const a = k.approvals.find((y) => y.id === e.approvalId);
      await x("post_to_group", { text: `Update: ${a?.result}. All good!` });
      break;
    }
    case "approval_declined":
      await x("reply_to_organizer", { text: "Got it, nothing was paid. Want me to look for something else?" });
      break;
    case "vote_closed": {
      const w = winningOption(k)!;
      await x("post_to_group", { text: `The votes are in: ${w.title} it is!` });
      await x("request_purchase_approval", { option_id: w.id, message: `The group picked ${w.title} for ${fmt(w.price)}. OK to pay?` });
      break;
    }
    case "purchase_executed":
      await x("post_to_group", { text: `Done! ${k.purchase?.title} is paid and on its way to ${k.recipient} 🎉` });
      if (available(k) > 0) await x("request_refund_approval", { message: `${fmt(available(k))} is left over. Shall I refund it to everyone, pro rata?` });
      await x("create_birthday_card", { headline: `Happy ${k.occasion.toLowerCase()}, ${k.recipient}!`, message: `From all of us: we hope ${k.purchase?.title?.toLowerCase()} takes you somewhere wonderful this year. You make every day at work better.` });
      break;
    case "refunds_executed":
      await x("post_to_group", { text: `All wrapped up: ${k.refunds.map((r) => `${participantName(k, r.participantId)} gets ${fmt(r.amount)} back`).join(", ")}. The card is ready. Thanks everyone!` });
      await x("reply_to_organizer", { text: `Kitty closed. Every dollar is accounted for in the ledger.` });
      break;
  }
}
