"use client";

import { PayPalScriptProvider } from "@paypal/react-paypal-js";
import { use, useEffect, useState } from "react";
import { Logo } from "@/components/Logo";
import { PayPanel } from "@/components/PaySheet";

type Info = {
  recipient: string;
  occasion: string;
  eventDate: string;
  purpose: string;
  organizer: string;
  name: string;
  owes: number;
  open: boolean;
  modes: { paypal: "sandbox" | "mock"; paypalClientId: string | null };
};

export default function PayPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [info, setInfo] = useState<Info | null>(null);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  useEffect(() => {
    fetch(`/api/pay/${token}`)
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error);
        setInfo(j);
      })
      .catch((e) => setError(e.message));
  }, [token, done]);

  const expires = info ? new Date(new Date(`${info.eventDate}T23:59:00Z`).getTime() + 14 * 86400000).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }) : "";

  const content = (
    <main className="mx-auto flex min-h-screen max-w-md flex-col px-5 py-8">
      <Logo size={26} />
      {error && <p className="mt-10 text-ink-2">{error}</p>}
      {info && (
        <div className="mt-8 rounded-3xl border border-line bg-white p-6">
          <p className="text-sm text-ink-3">{info.organizer} invited you to chip in for</p>
          <h1 className="display mt-1 text-3xl font-bold leading-tight text-ink">
            {info.recipient}&apos;s {info.occasion.toLowerCase()}
          </h1>
          <div className="mt-6">
            {done || info.owes === 0 ? (
              <p className="rounded-xl bg-mint-soft p-4 text-sm font-semibold text-mint">You&apos;re all set, {info.name}. Kitty will take it from here.</p>
            ) : !info.open ? (
              <p className="text-sm text-ink-2">This kitty is closed for contributions.</p>
            ) : (
              <PayPanel token={token} name={info.name} amount={info.owes} purpose={info.purpose} expires={expires} mode={info.modes.paypal} onDone={() => setDone(true)} onMockPay={async () => undefined} />
            )}
          </div>
        </div>
      )}
      <p className="mt-6 text-center text-xs text-ink-3">PayPal sandbox demo. No real money moves.</p>
    </main>
  );

  return info?.modes.paypal === "sandbox" && info.modes.paypalClientId ? (
    <PayPalScriptProvider options={{ clientId: info.modes.paypalClientId, currency: "USD", intent: "capture", components: "buttons" }}>{content}</PayPalScriptProvider>
  ) : (
    content
  );
}
