"use client";

import { PayPalScriptProvider } from "@paypal/react-paypal-js";
import Link from "next/link";
import { use, useState } from "react";
import { useKitty } from "@/components/client";
import { ActivityGrid, ContributionsGrid } from "@/components/grids";
import { GroupChat } from "@/components/GroupChat";
import { Logo } from "@/components/Logo";
import { Approvals, AskKitty, Progress, Shortlist } from "@/components/Panels";
import type { KittyView } from "@/lib/view";

const STAGES = [
  { id: "collecting", label: "Collect" },
  { id: "choosing", label: "Choose" },
  { id: "voting", label: "Vote" },
  { id: "buying", label: "Buy" },
  { id: "purchased", label: "Refund" },
  { id: "done", label: "Done" },
] as const;

export default function KittyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { k, error, act } = useKitty(id);

  if (!k) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
        <Logo size={34} />
        <p className="text-ink-2">{error || "Opening your kitty…"}</p>
        {error && (
          <Link href="/" className="rounded-full bg-ink px-5 py-2.5 text-sm font-semibold text-white">
            Start a new kitty
          </Link>
        )}
      </main>
    );
  }

  const body = <Console k={k} act={act} />;
  return k.modes.paypal === "sandbox" && k.modes.paypalClientId ? (
    <PayPalScriptProvider options={{ clientId: k.modes.paypalClientId, currency: "USD", intent: "capture", components: "buttons" }}>{body}</PayPalScriptProvider>
  ) : (
    body
  );
}

function Console({ k, act }: { k: KittyView; act: (b: Record<string, unknown>) => Promise<KittyView> }) {
  const stageIdx = Math.max(0, STAGES.findIndex((s) => s.id === k.status));
  const [skipping, setSkipping] = useState(false);
  const [guide, setGuide] = useState(false);
  const today = new Date(k.now);
  return (
    <main className="min-h-screen pb-16">
      <header className="sticky top-0 z-20 border-b border-line bg-paper/90 backdrop-blur">
        <div className="mx-auto flex max-w-[1500px] flex-wrap items-center gap-x-6 gap-y-3 px-5 py-3">
          <Link href="/" aria-label="Kitty home">
            <Logo size={26} />
          </Link>
          <div className="min-w-0">
            <h1 className="display truncate text-xl font-bold leading-tight text-ink">
              {k.recipient}&apos;s {k.occasion.toLowerCase()}
            </h1>
            <p className="text-xs text-ink-3">{new Date(`${k.eventDate}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" })}</p>
          </div>
          <ol className="hidden items-center gap-1 lg:flex" aria-label="Progress">
            {STAGES.map((s, i) => (
              <li key={s.id} className={`rounded-full px-3 py-1 text-xs font-semibold ${i < stageIdx ? "text-mint" : i === stageIdx ? "bg-ink text-white" : "text-ink-3"}`}>
                {i < stageIdx ? "✓ " : ""}
                {s.label}
              </li>
            ))}
          </ol>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <button onClick={() => setGuide((g) => !g)} className="rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-ink ring-1 ring-line hover:ring-ink" aria-expanded={guide}>
              {guide ? "Hide the demo guide" : "Demo guide"}
            </button>
            <span className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold ${k.agentBusy ? "bg-berry text-white" : "bg-white text-ink-2 ring-1 ring-line"}`}>
              {k.agentBusy ? (
                <>
                  <span className="typing">
                    <span />
                    <span />
                    <span />
                  </span>
                  {k.agentThought}
                </>
              ) : (
                "Kitty is watching the kitty"
              )}
            </span>
            <span className="rounded-full bg-white px-3 py-1.5 text-xs font-medium text-ink-2 ring-1 ring-line" title="Where money moves">
              {k.modes.paypal === "sandbox" ? "PayPal sandbox" : "Mock PayPal (local dev)"}
            </span>
            <span className="rounded-full bg-white px-3 py-1.5 text-xs font-medium text-ink-2 ring-1 ring-line">{k.modes.ai === "claude" ? `Claude · ${k.modes.model}` : "AI offline: scripted"}</span>
            <span className="flex items-center gap-2 rounded-full bg-white py-1 pl-3 pr-1 text-xs ring-1 ring-line">
              <span className="text-ink-3">Demo day</span>
              <span className="font-semibold text-ink">{today.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}</span>
              <button
                disabled={skipping || k.status !== "collecting"}
                onClick={async () => {
                  setSkipping(true);
                  await act({ action: "skip_day" }).catch(() => undefined);
                  setSkipping(false);
                }}
                className="rounded-full bg-ink px-3 py-1 font-semibold text-white disabled:opacity-40"
                title="Fast-forward one day: Kitty runs its daily check"
              >
                Skip a day
              </button>
            </span>
          </div>
        </div>
      </header>

      {guide && (
        <div className="mx-auto max-w-[1500px] px-5 pt-4">
          <ol className="grid gap-x-6 gap-y-2 rounded-2xl border border-line bg-white p-4 text-[13px] leading-snug text-ink-2 sm:grid-cols-2 xl:grid-cols-4">
            {[
              "In the phone, tap Pay on a link and pay with a PayPal sandbox personal account (credentials in the README).",
              "Click Skip a day twice: Kitty nudges the late payers, then sends real PayPal sandbox invoices.",
              "Chat as someone and send “Sorry, I can only do $10”. Pick how to cover the gap on the yellow card.",
              "Pay the remaining links (or an invoice). At the goal, Kitty proposes 3 real gifts.",
              "Vote as a few people, then Close the vote.",
              "In Ask Kitty, try “Buy the $500 tent instead”: the policy engine blocks it.",
              "Approve the purchase, then the refunds. Every PayPal ID lands in the ledger and the activity log.",
              "Open the card from the chat.",
            ].map((t, i) => (
              <li key={t} className="flex gap-2">
                <span className="display flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-ink text-[11px] font-bold text-white">{i + 1}</span>
                {t}
              </li>
            ))}
          </ol>
        </div>
      )}

      <div className="mx-auto grid max-w-[1500px] grid-cols-[minmax(0,1fr)] gap-5 px-5 pt-5 xl:grid-cols-[320px_minmax(0,1fr)_390px]">
        <div className="space-y-4">
          <Progress k={k} />
          <Approvals k={k} act={act} />
          <AskKitty k={k} act={act} />
        </div>

        <div className="min-w-0 space-y-4">
          <Shortlist k={k} act={act} />
          {k.purchase && (
            <section className="flex flex-wrap items-center gap-4 rounded-2xl bg-ink p-4 text-white">
              <span className="text-2xl">🎁</span>
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{k.purchase.title}</p>
                <p className="num text-sm text-white/70">
                  Paid with PayPal · {k.purchase.status} · {k.purchase.transactionId || k.purchase.payoutBatchId}
                </p>
              </div>
              {k.card && (
                <a href={`/card/${k.id}`} target="_blank" rel="noreferrer" className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-ink">
                  Open the card
                </a>
              )}
            </section>
          )}
          <section>
            <h2 className="mb-2 text-sm font-semibold text-ink">Ledger</h2>
            <ContributionsGrid k={k} />
          </section>
          <section>
            <h2 className="mb-2 text-sm font-semibold text-ink">Everything Kitty did</h2>
            <ActivityGrid k={k} height={470} />
          </section>
        </div>

        <div>
          <GroupChat k={k} act={act} />
          <p className="mx-auto mt-3 max-w-[390px] text-center text-xs leading-relaxed text-ink-3">
            <span className="font-semibold text-ink-2">Your group chat.</span> Kitty joins the chat your group already uses. Here it&apos;s simulated, so you can play every member: pick who you chat as above.
          </p>
        </div>
      </div>
    </main>
  );
}
