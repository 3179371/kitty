"use client";

import { PayPalButtons, usePayPalScriptReducer } from "@paypal/react-paypal-js";
import { useState } from "react";
import { fmt } from "@/lib/money";

export function PayPanel({
  token,
  name,
  amount,
  purpose,
  expires,
  mode,
  onDone,
  onMockPay,
}: {
  token: string;
  name: string;
  amount: number;
  purpose: string;
  expires: string;
  mode: "sandbox" | "mock";
  onDone: () => void;
  onMockPay?: () => Promise<void>;
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div>
      <p className="text-sm text-ink-2">{name}&apos;s share</p>
      <p className="display num text-4xl font-bold text-ink">{fmt(amount)}</p>
      <div className="mt-3 rounded-xl bg-paper p-3 text-[13px] leading-snug text-ink-2">
        <span className="font-semibold text-ink">Your spending mandate.</span> You allow Kitty to spend up to {fmt(amount)} of this payment on{" "}
        <span className="font-medium text-ink">{purpose.toLowerCase()}</span>, only with the organizer&apos;s approval, until {expires}. Whatever isn&apos;t spent comes back to you.
      </div>
      <div className="mt-4">
        {mode === "sandbox" ? (
          <SandboxButtons>
          <PayPalButtons
            style={{ layout: "vertical", shape: "pill", label: "pay", height: 44 }}
            forceReRender={[token, amount]}
            createOrder={async () => {
              setError("");
              const r = await fetch(`/api/pay/${token}/order`, { method: "POST" });
              const j = await r.json();
              if (!r.ok) {
                setError(j.error);
                throw new Error(j.error);
              }
              return j.id;
            }}
            onApprove={async (data) => {
              const r = await fetch(`/api/pay/${token}/capture`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderID: data.orderID }) });
              const j = await r.json();
              if (!r.ok) setError(j.error || "Payment failed");
              else onDone();
            }}
            onError={(err) => setError(String((err as { message?: string })?.message || "PayPal could not complete the payment."))}
          />
          </SandboxButtons>
        ) : (
          <button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onMockPay?.();
                onDone();
              } catch (e) {
                setError((e as Error).message);
              }
              setBusy(false);
            }}
            className="w-full rounded-full bg-[#FFC439] py-3 text-sm font-bold text-[#111] disabled:opacity-60"
          >
            {busy ? "Paying…" : "Pay (mock PayPal, local dev only)"}
          </button>
        )}
        {error && <p className="mt-2 text-xs font-medium text-danger">{error}</p>}
      </div>
    </div>
  );
}

function SandboxButtons({ children }: { children: React.ReactNode }) {
  const [{ isPending, isRejected }] = usePayPalScriptReducer();
  if (isRejected) return <p className="text-sm font-medium text-danger">PayPal checkout couldn&apos;t load. Check the PayPal client ID, then reload.</p>;
  return (
    <>
      {isPending && <p className="py-3 text-center text-sm text-ink-3">Loading PayPal…</p>}
      {children}
    </>
  );
}
