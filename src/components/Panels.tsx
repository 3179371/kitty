"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import type { KittyView } from "@/lib/view";
import type { Approval } from "@/lib/types";
import { fmt } from "@/lib/money";
import { GiftImage } from "./GroupChat";
import { KittyMark } from "./Logo";

type Act = (b: Record<string, unknown>) => Promise<KittyView>;

const MoneyChart = dynamic(() => import("./MoneyChart"), { ssr: false, loading: () => <div style={{ height: 168 }} /> });

export function Progress({ k }: { k: KittyView }) {
  const pct = Math.min(100, Math.round((k.totals.collected / Math.max(1, k.goal)) * 100));
  return (
    <section className="rounded-2xl border border-line bg-white p-5">
      <p className="text-sm font-medium text-ink-2">Collected for {k.recipient}</p>
      <p className="mt-1 flex items-baseline gap-2">
        <span className="display num text-5xl font-bold text-ink">{fmt(k.totals.collected)}</span>
        <span className="num text-lg text-ink-3">of {fmt(k.goal)}</span>
      </p>
      <div className="ribbon-track relative mt-4 h-4 overflow-hidden rounded-full">
        <div className="absolute inset-y-0 left-0 rounded-full bg-berry transition-[width] duration-700" style={{ width: `${pct}%` }} />
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-y-2 text-sm">
        <dt className="text-ink-3">People paid</dt>
        <dd className="num text-right font-semibold">
          {k.totals.paidCount} of {k.participants.length}
        </dd>
        <dt className="text-ink-3">Available to spend</dt>
        <dd className="num text-right font-semibold">{fmt(k.totals.available)}</dd>
        <dt className="text-ink-3">Spent on the gift</dt>
        <dd className="num text-right font-semibold">{fmt(k.totals.spent) || "$0"}</dd>
        <dt className="text-ink-3">Refunded</dt>
        <dd className="num text-right font-semibold">{fmt(k.totals.refunded) || "$0"}</dd>
        <dt className="text-ink-3">Collection closes</dt>
        <dd className="text-right font-semibold">{new Date(k.deadline).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" })}</dd>
      </dl>
      {k.contributions.length > 0 && (
        <div className="mt-4 border-t border-line pt-3">
          <MoneyChart k={k} />
        </div>
      )}
    </section>
  );
}

export function Approvals({ k, act }: { k: KittyView; act: Act }) {
  const pending = k.approvals.filter((a) => a.status === "pending");
  const recent = k.approvals.filter((a) => a.status !== "pending").slice(-2).reverse();
  if (!pending.length && !recent.length) {
    return (
      <section className="rounded-2xl border border-dashed border-line p-5 text-sm text-ink-3">
        Nothing needs your OK. Kitty will ask here before any money leaves the kitty.
      </section>
    );
  }
  return (
    <section className="space-y-3">
      {pending.map((a) => (
        <Ticket key={a.id} a={a} k={k} act={act} />
      ))}
      {recent.map((a) => (
        <div key={a.id} className="rounded-2xl border border-line bg-white px-4 py-3 text-sm">
          <p className="font-semibold text-ink">{a.title}</p>
          <p className="text-ink-3">
            {a.status === "executed" ? "Done" : a.status === "declined" ? "Declined" : a.status === "blocked" ? "Blocked by policy" : a.status === "failed" ? "Failed" : "Approved"}
            {a.result ? ` · ${a.result}` : ""}
          </p>
        </div>
      ))}
    </section>
  );
}

function Ticket({ a, k, act }: { a: Approval; k: KittyView; act: Act }) {
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const run = async (body: Record<string, unknown>, key: string) => {
    setBusy(key);
    setErr("");
    try {
      await act(body);
    } catch (e) {
      setErr((e as Error).message);
    }
    setBusy("");
  };
  const d = a.data as Record<string, any>;
  return (
    <section className="ticket p-4" aria-live="polite">
      <p className="flex items-center gap-2 text-sm font-semibold text-[#8a5a00]">
        <KittyMark size={18} /> Kitty needs your OK
      </p>
      <div className="mt-3 flex gap-3">
        {a.kind === "purchase" && <GiftImage o={{ image: d.image, title: d.title }} size={64} />}
        <div className="min-w-0">
          <p className="font-semibold leading-snug text-ink">{a.title}</p>
          {a.amount !== undefined && a.kind !== "decision" && <p className="display num text-3xl font-bold text-ink">{fmt(a.amount)}</p>}
          {a.payee && <p className="text-sm text-ink-2">to {a.payee}</p>}
        </div>
      </div>
      {a.message && <p className="mt-3 text-sm leading-snug text-ink-2">“{a.message}”</p>}

      {a.kind === "refund" && (
        <ul className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
          {(d.lines || []).map((l: any) => (
            <li key={l.contributionId} className="flex justify-between">
              <span className="text-ink-2">{l.name}</span>
              <span className="num font-semibold">{fmt(l.amount)}</span>
            </li>
          ))}
        </ul>
      )}

      {a.checks.length > 0 && (
        <>
          <div className="ticket-perf" />
          <ul className="space-y-1.5 text-[13px]">
            {a.checks.map((c) => (
              <li key={c.label} className="flex gap-2">
                <span className={`mt-px flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white ${c.ok ? "bg-mint" : "bg-danger"}`}>{c.ok ? "✓" : "!"}</span>
                <span className="text-ink-2">{c.label}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      {a.kind === "decision" ? (
        <div className="mt-4 space-y-2">
          {a.options?.map((o) => (
            <button key={o.id} disabled={!!busy} onClick={() => run({ action: "approve", approvalId: a.id, optionId: o.id }, o.id)} className="w-full rounded-xl bg-white px-3 py-2.5 text-left text-sm ring-1 ring-[#e4b23f] transition hover:bg-ink hover:text-white disabled:opacity-60">
              <span className="font-semibold">{busy === o.id ? "Applying…" : o.label}</span>
              <span className="block text-xs opacity-70">{o.effect}</span>
            </button>
          ))}
        </div>
      ) : (
        <div className="mt-4 flex gap-2">
          <button disabled={!!busy} onClick={() => run({ action: "approve", approvalId: a.id }, "ok")} className="flex-1 rounded-full bg-ink py-3 text-sm font-semibold text-white transition hover:bg-berry disabled:opacity-60">
            {busy === "ok" ? "Paying with PayPal…" : a.kind === "refund" ? "Approve refunds" : `Approve ${fmt(a.amount)}`}
          </button>
          <button disabled={!!busy} onClick={() => run({ action: "decline", approvalId: a.id }, "no")} className="rounded-full px-4 py-3 text-sm font-semibold text-ink-2 ring-1 ring-[#e4b23f] hover:text-ink">
            Decline
          </button>
        </div>
      )}
      {err && <p className="mt-2 text-xs font-medium text-danger">{err}</p>}
    </section>
  );
}

export function AskKitty({ k, act }: { k: KittyView; act: Act }) {
  const [text, setText] = useState("");
  const msgs = k.messages.filter((m) => m.channel === "organizer").slice(-6);
  const org = k.participants.find((p) => p.isOrganizer);
  return (
    <section className="rounded-2xl border border-line bg-white p-4">
      <p className="text-sm font-semibold text-ink">Ask Kitty</p>
      <div className="mt-2 max-h-60 space-y-2 overflow-y-auto">
        {msgs.map((m) => (
          <div key={m.id} className={`rounded-xl px-3 py-2 text-[13px] leading-snug ${m.from === "kitty" ? "bg-berry-soft text-ink" : "ml-6 bg-paper text-ink-2"}`}>
            <span className="font-semibold">{m.from === "kitty" ? "Kitty" : org?.name}: </span>
            {m.text}
          </div>
        ))}
        {k.agentBusy && <p className="text-xs text-ink-3">Kitty is working…</p>}
      </div>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const t = text;
          setText("");
          await act({ action: "organizer_command", text: t });
        }}
        className="mt-3 flex gap-2"
      >
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Try “Add Karim” or “Who hasn't paid?”" className="min-w-0 flex-1 rounded-full bg-paper px-3 py-2 text-sm outline-none" />
        <button className="rounded-full bg-ink px-3 text-sm font-semibold text-white">Ask</button>
      </form>
    </section>
  );
}

export function Shortlist({ k, act }: { k: KittyView; act: Act }) {
  if (!k.giftOptions.length) return null;
  const voters = k.contributions.length ? new Set(k.contributions.map((c) => c.participantId)).size : 0;
  return (
    <section className="rounded-2xl border border-line bg-white p-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-ink">
          Gift shortlist {k.status === "voting" ? `· ${Object.keys(k.votes).length} of ${voters} voted` : ""}
        </p>
        {k.status === "voting" && (
          <button onClick={() => act({ action: "close_vote" })} className="rounded-full bg-ink px-3 py-1.5 text-xs font-semibold text-white">
            Close the vote
          </button>
        )}
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        {k.giftOptions.map((o) => (
          <div key={o.id} className={`flex gap-3 rounded-xl p-2 ${k.winnerId === o.id && k.status !== "voting" ? "bg-mint-soft" : "bg-paper"}`}>
            <GiftImage o={o} size={48} />
            <div className="min-w-0">
              <p className="line-clamp-2 text-[13px] font-semibold leading-tight">{o.title}</p>
              <p className="num text-[13px] text-ink-2">
                {fmt(o.price)} · {k.tally[o.id] || 0} votes
              </p>
              <p className="truncate text-[11px] text-ink-3">{o.source === "channel3" ? `via Channel3 · ${o.merchant}` : `demo catalog · ${o.merchant}`}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
