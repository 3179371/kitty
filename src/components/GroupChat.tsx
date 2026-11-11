"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { KittyView } from "@/lib/view";
import type { GiftOption, Message } from "@/lib/types";
import { fmt } from "@/lib/money";
import { KittyMark } from "./Logo";
import { PayPanel } from "./PaySheet";

type Act = (b: Record<string, unknown>) => Promise<KittyView>;

const QUICK = (k: KittyView) => [
  `Sorry, I can only do $10 this month 🙏`,
  `Happy birthday ${k.recipient}!! Have the best day 🎉`,
  `Count me in!`,
];

export function GiftImage({ o, size = 56 }: { o: { image?: string; title: string }; size?: number }) {
  const isUrl = o.image?.startsWith("http");
  return (
    <div className="flex shrink-0 items-center justify-center overflow-hidden rounded-xl bg-paper" style={{ width: size, height: size }}>
      {isUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={o.image} alt={o.title} className="h-full w-full object-contain" />
      ) : (
        <span style={{ fontSize: size * 0.5 }}>{o.image || "🎁"}</span>
      )}
    </div>
  );
}

export function GroupChat({ k, act }: { k: KittyView; act: Act }) {
  const [actingAs, setActingAs] = useState<string>(() => k.participants.find((p) => !p.isOrganizer)?.id || k.participants[0].id);
  const [text, setText] = useState("");
  const [sheet, setSheet] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const scroller = useRef<HTMLDivElement>(null);
  const msgs = useMemo(() => k.messages.filter((m) => m.channel === "group"), [k.messages]);
  const people = k.participantsView;
  const me = people.find((p) => p.id === actingAs) || people[0];

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [msgs.length, k.agentBusy]);

  async function send(t: string) {
    if (!t.trim()) return;
    setText("");
    try {
      await act({ action: "participant_message", participantId: actingAs, text: t });
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  const sheetP = people.find((p) => p.id === sheet);
  const expires = new Date(new Date(`${k.eventDate}T23:59:00Z`).getTime() + 14 * 86400000).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

  return (
    <div className="relative mx-auto flex h-[760px] w-full max-w-[390px] flex-col overflow-hidden rounded-[42px] border-[10px] border-ink bg-[#EEF0F5] shadow-[0_30px_60px_-30px_rgba(23,32,51,0.55)]">
      <div className="flex items-center gap-3 border-b border-line bg-white px-4 pb-3 pt-5">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-berry-soft text-lg">🎁</div>
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold text-ink">
            {k.recipient}&apos;s {k.occasion.toLowerCase()} gift
          </p>
          <p className="truncate text-xs text-ink-3">
            {k.participants.map((p) => p.name).join(", ")} and Kitty
          </p>
        </div>
      </div>

      <div ref={scroller} className="flex-1 space-y-2 overflow-y-auto px-3 py-3">
        {msgs.map((m) => (
          <Bubble key={m.id} m={m} k={k} actingAs={actingAs} onPay={(pid) => setSheet(pid)} act={act} setErr={setErr} />
        ))}
        {k.agentBusy && (
          <div className="flex items-end gap-2">
            <KittyMark size={26} />
            <div className="rounded-2xl rounded-bl-md bg-white px-3 py-2 text-ink-3">
              <span className="typing" aria-label="Kitty is typing">
                <span />
                <span />
                <span />
              </span>
            </div>
          </div>
        )}
      </div>

      <div className="border-t border-line bg-white px-3 pb-4 pt-2">
        <div className="flex items-center gap-1.5 overflow-x-auto pb-2">
          <span className="shrink-0 text-[11px] font-medium text-ink-3">Chat as</span>
          {people.map((p) => (
            <button
              key={p.id}
              onClick={() => setActingAs(p.id)}
              title={p.name}
              className={`flex h-7 shrink-0 items-center gap-1 rounded-full pl-0.5 pr-2 text-[11px] font-semibold transition ${actingAs === p.id ? "bg-ink text-white" : "bg-paper text-ink-2"}`}
            >
              <span className="flex h-6 w-6 items-center justify-center rounded-full text-[10px] text-white" style={{ background: p.color }}>
                {p.name[0]}
              </span>
              {p.name}
            </button>
          ))}
        </div>
        <div className="flex gap-1.5 overflow-x-auto pb-2">
          {QUICK(k).map((q) => (
            <button key={q} onClick={() => send(q)} className="shrink-0 rounded-full border border-line px-2.5 py-1 text-[11px] text-ink-2 hover:border-ink hover:text-ink">
              {q}
            </button>
          ))}
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            send(text);
          }}
          className="flex gap-2"
        >
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder={`Message as ${me.name}`} className="min-w-0 flex-1 rounded-full bg-paper px-4 py-2 text-sm outline-none" />
          <button className="rounded-full bg-ink px-4 text-sm font-semibold text-white">Send</button>
        </form>
        {err && <p className="mt-1 text-xs text-danger">{err}</p>}
      </div>

      {sheetP && (
        <div className="absolute inset-0 z-10 flex flex-col justify-end bg-ink/40" onClick={() => setSheet(null)}>
          <div className="rounded-t-3xl bg-white p-5 pb-7" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <p className="text-sm font-semibold text-ink">Chip in for {k.recipient}</p>
              <button onClick={() => setSheet(null)} className="text-sm text-ink-3">
                Close
              </button>
            </div>
            {sheetP.owes > 0 ? (
              <PayPanel
                token={sheetP.token}
                name={sheetP.name}
                amount={sheetP.owes}
                purpose={k.purpose}
                expires={expires}
                mode={k.modes.paypal}
                onDone={() => setSheet(null)}
                onMockPay={async () => {
                  await act({ action: "mock_pay", participantId: sheetP.id });
                }}
              />
            ) : (
              <p className="text-sm text-mint">{sheetP.name} is all set. Thank you!</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Bubble({ m, k, actingAs, onPay, act, setErr }: { m: Message; k: KittyView; actingAs: string; onPay: (pid: string) => void; act: Act; setErr: (s: string) => void }) {
  const time = new Date(m.at).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
  if (m.from === "system") {
    return (
      <div className="flex justify-center py-1">
        <span className="rounded-full bg-mint-soft px-3 py-1 text-[11px] font-semibold text-mint">✓ {m.text}</span>
      </div>
    );
  }
  if (m.from !== "kitty") {
    const p = k.participants.find((x) => x.id === m.from);
    const mine = m.from === actingAs;
    return (
      <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
        <div className={`max-w-[80%] rounded-2xl px-3 py-2 text-[14px] leading-snug ${mine ? "rounded-br-md bg-ink text-white" : "rounded-bl-md bg-white text-ink"}`}>
          {!mine && (
            <p className="text-[11px] font-bold" style={{ color: p?.color }}>
              {p?.name}
            </p>
          )}
          {m.text}
          <p className={`mt-0.5 text-right text-[10px] ${mine ? "text-white/60" : "text-ink-3"}`}>{time}</p>
        </div>
      </div>
    );
  }
  const d = (m.data || {}) as Record<string, any>;
  const target = d.participantId ? k.participantsView.find((p) => p.id === d.participantId) : undefined;
  return (
    <div className="flex items-end gap-2">
      <KittyMark size={26} />
      <div className="max-w-[84%] rounded-2xl rounded-bl-md bg-white px-3 py-2 text-[14px] leading-snug text-ink">
        <p className="text-[11px] font-bold text-berry">Kitty</p>
        <p>{m.text}</p>
        {(m.kind === "pay_link" || m.kind === "invoice") && target && (
          <div className="mt-2 rounded-xl border border-line p-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-[12px] font-semibold">{m.kind === "invoice" ? "PayPal invoice" : `${target.name}'s link`}</p>
                <p className="num truncate text-[11px] text-ink-3">{m.kind === "invoice" ? d.invoiceId : `${fmt(d.amount)} · secured by PayPal`}</p>
              </div>
              {target.owes === 0 ? (
                <span className="rounded-full bg-mint-soft px-2.5 py-1 text-[11px] font-bold text-mint">Paid</span>
              ) : m.kind === "invoice" && d.href?.startsWith("http") ? (
                <a href={d.href} target="_blank" rel="noreferrer" className="shrink-0 rounded-full bg-[#FFC439] px-3 py-1.5 text-[12px] font-bold text-[#111]">
                  Open invoice
                </a>
              ) : m.kind === "invoice" && k.modes.paypal === "mock" ? (
                <button onClick={() => act({ action: "mock_pay_invoice", participantId: target.id }).catch((e) => setErr(e.message))} className="shrink-0 rounded-full bg-[#FFC439] px-3 py-1.5 text-[12px] font-bold text-[#111]">
                  Pay invoice
                </button>
              ) : (
                <button onClick={() => onPay(target.id)} className="shrink-0 rounded-full bg-[#FFC439] px-3 py-1.5 text-[12px] font-bold text-[#111]">
                  Pay {fmt(target.owes)}
                </button>
              )}
            </div>
          </div>
        )}
        {m.kind === "gift_vote" && <VoteCards k={k} actingAs={actingAs} act={act} setErr={setErr} />}
        {m.kind === "card" && (
          <a href={`/card/${k.id}`} target="_blank" rel="noreferrer" className="mt-2 flex items-center gap-2 rounded-xl bg-berry-soft p-2.5 text-[13px] font-semibold text-berry-deep">
            💌 Open {k.recipient}&apos;s card
          </a>
        )}
        <p className="mt-0.5 text-right text-[10px] text-ink-3">{time}</p>
      </div>
    </div>
  );
}

function VoteCards({ k, actingAs, act, setErr }: { k: KittyView; actingAs: string; act: Act; setErr: (s: string) => void }) {
  const open = k.status === "voting";
  const name = k.participants.find((p) => p.id === actingAs)?.name;
  return (
    <div className="mt-2 space-y-2">
      {k.giftOptions.map((o: GiftOption) => {
        const votes = k.tally[o.id] || 0;
        const mine = k.votes[actingAs] === o.id;
        const won = !open && k.winnerId === o.id;
        return (
          <div key={o.id} className={`rounded-xl border p-2 ${won ? "border-mint bg-mint-soft/40" : mine ? "border-ink" : "border-line"}`}>
            <div className="flex gap-2">
              <GiftImage o={o} size={52} />
              <div className="min-w-0 flex-1">
                <p className="line-clamp-2 text-[12px] font-semibold leading-tight">{o.title}</p>
                <p className="num text-[12px] font-bold text-ink">
                  {fmt(o.price)} <span className="font-normal text-ink-3">· {o.merchant}</span>
                </p>
                <p className="line-clamp-2 text-[11px] text-ink-2">{o.reason}</p>
              </div>
            </div>
            <div className="mt-1.5 flex items-center justify-between">
              <span className="text-[11px] text-ink-3">
                {votes} vote{votes === 1 ? "" : "s"}
                {won ? " · the group's pick" : ""}
              </span>
              {open && (
                <button
                  onClick={() => act({ action: "vote", participantId: actingAs, optionId: o.id }).catch((e) => setErr(e.message))}
                  className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${mine ? "bg-ink text-white" : "bg-paper text-ink"}`}
                >
                  {mine ? `${name} voted` : `Vote as ${name}`}
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
