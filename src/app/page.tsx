"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Logo } from "@/components/Logo";

const EXAMPLE = "Birthday kitty for Sarah next Saturday: $20 each from me, Mia, Karim, Priya and Tom. She loves hiking.";

const STEPS: { who: "you" | "kitty"; title: string; body: string }[] = [
  { who: "you", title: "You write one sentence", body: "Who it's for, when, how much each, who's in." },
  { who: "kitty", title: "Kitty collects with PayPal", body: "Everyone gets a personal PayPal link. Each payment carries a spending mandate." },
  { who: "kitty", title: "Kitty chases the late ones", body: "A friendly nudge first, then a real PayPal invoice. Someone short? It rebalances." },
  { who: "kitty", title: "Kitty finds the gift", body: "Real products within budget, matched to what they love. The group votes." },
  { who: "you", title: "You approve the purchase", body: "Kitty never spends without your OK, and never above what was collected." },
  { who: "kitty", title: "Kitty pays, refunds and signs the card", body: "Pays with PayPal, refunds the leftover pro rata, logs every dollar." },
];

export default function Home() {
  const router = useRouter();
  const [sentence, setSentence] = useState(EXAMPLE);
  const [name, setName] = useState("Lina");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/kitties", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sentence, organizerName: name }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Something went wrong");
      router.push(`/k/${j.id}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <Logo size={30} />
        <a href="#how" className="text-sm font-medium text-ink-2 hover:text-ink">How it works</a>
      </header>

      <section className="mx-auto grid max-w-6xl gap-12 px-6 pb-16 pt-6 lg:grid-cols-[1.15fr_0.85fr] lg:pt-12">
        <div>
          <h1 className="display max-w-[14ch] text-5xl font-bold leading-[1.02] text-ink sm:text-6xl lg:text-[4.4rem]">
            Type one sentence. Kitty runs the whole group gift.
          </h1>
          <p className="mt-6 max-w-[54ch] text-lg leading-relaxed text-ink-2">
            Kitty is an AI agent that collects everyone&apos;s share with PayPal, chases late payers, lets the group pick a real gift,
            pays for it once you approve, and refunds what&apos;s left.
          </p>

          <form onSubmit={create} className="tag-card mt-16 p-6 pl-16 sm:p-8 sm:pl-20">
            <svg className="pointer-events-none absolute -left-10 -top-16 z-10 h-28 w-28" viewBox="0 0 112 112" aria-hidden="true">
              <path d="M73 97 C 58 74, 36 52, 10 14" fill="none" stroke="#C8326B" strokeWidth="4" strokeLinecap="round" />
              <path d="M73 97 C 64 66, 70 38, 96 8" fill="none" stroke="#C8326B" strokeWidth="4" strokeLinecap="round" />
            </svg>
            <label htmlFor="sentence" className="block text-sm font-semibold text-ink-2">
              Your kitty, in one sentence
            </label>
            <textarea
              id="sentence"
              value={sentence}
              onChange={(e) => setSentence(e.target.value)}
              rows={3}
              className="display mt-2 w-full resize-none bg-transparent text-2xl font-medium leading-snug text-ink outline-none sm:text-[1.7rem]"
            />
            <div className="mt-5 flex flex-wrap items-end gap-3">
              <div>
                <label htmlFor="name" className="block text-xs font-semibold text-ink-3">Your name</label>
                <input id="name" value={name} onChange={(e) => setName(e.target.value)} className="mt-1 w-32 rounded-lg border border-line bg-paper px-3 py-2 text-sm outline-none focus:border-ink" />
              </div>
              <button disabled={busy} className="rounded-full bg-ink px-6 py-3 text-base font-semibold text-white transition hover:bg-berry disabled:opacity-60">
                {busy ? "Kitty is setting it up…" : "Create the kitty"}
              </button>
            </div>
            {error && <p className="mt-3 text-sm font-medium text-danger">{error}</p>}
          </form>
          <p className="mt-4 text-sm text-ink-3">Runs on the PayPal sandbox. No real money moves.</p>
        </div>

        <aside id="how" className="lg:pt-4">
          <h2 className="display text-xl font-semibold text-ink">Two moments for you. Everything else is Kitty.</h2>
          <ol className="mt-5 space-y-1">
            {STEPS.map((s, i) => (
              <li key={s.title} className={`flex gap-4 rounded-2xl p-3 ${s.who === "you" ? "bg-berry-soft" : ""}`}>
                <span className={`display mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ${s.who === "you" ? "bg-berry text-white" : "bg-white text-ink ring-1 ring-line"}`}>
                  {i + 1}
                </span>
                <div>
                  <p className="font-semibold text-ink">{s.title}</p>
                  <p className="text-sm leading-relaxed text-ink-2">{s.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </aside>
      </section>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-6 py-6 text-sm text-ink-3">
          <span className="font-medium text-ink-2">Built with</span>
          <span>PayPal Orders, Invoicing, Refunds and Payouts</span>
          <span>PayPal Agent Toolkit</span>
          <span>Claude</span>
          <span>AG Grid</span>
          <span>Channel3</span>
          <span>Render</span>
        </div>
      </footer>
    </main>
  );
}
