"use client";

import { AllCommunityModule, ModuleRegistry } from "ag-charts-community";
import { AgCharts } from "ag-charts-react";
import { useMemo } from "react";
import type { KittyView } from "@/lib/view";

ModuleRegistry.registerModules([AllCommunityModule]);

/** Balance held by the kitty over time, built from the same ledger the grids show (AG Charts). */
export default function MoneyChart({ k }: { k: KittyView }) {
  const data = useMemo(() => {
    const events: { t: number; delta: number; what: string }[] = [];
    for (const c of k.contributions) events.push({ t: Date.parse(c.paidAt), delta: c.amount, what: `${k.participants.find((p) => p.id === c.participantId)?.name} paid` });
    if (k.purchase) events.push({ t: Date.parse(k.purchase.at), delta: -k.purchase.amount, what: "Gift paid" });
    for (const r of k.refunds) events.push({ t: Date.parse(r.at), delta: -r.amount, what: `Refund ${k.participants.find((p) => p.id === r.participantId)?.name}` });
    events.sort((a, b) => a.t - b.t);
    let bal = 0;
    const out = [{ t: new Date(k.createdAt), balance: 0, what: "Kitty created" }];
    for (const e of events) {
      bal += e.delta;
      out.push({ t: new Date(e.t), balance: bal / 100, what: e.what });
    }
    return out;
  }, [k.contributions, k.purchase, k.refunds, k.createdAt, k.participants]);

  const options = useMemo(
    () => ({
      data,
      height: 150,
      padding: { top: 8, right: 8, bottom: 4, left: 4 },
      background: { visible: false },
      series: [
        {
          type: "area" as const,
          xKey: "t",
          yKey: "balance",
          yName: "In the kitty",
          interpolation: { type: "step" as const, position: "end" as const },
          fill: "#C8326B",
          fillOpacity: 0.12,
          stroke: "#C8326B",
          strokeWidth: 2,
          marker: { enabled: true, size: 6, fill: "#C8326B", stroke: "#fff" },
          tooltip: {
            renderer: ({ datum }: { datum: { balance: number; what: string } }) => ({ title: datum.what, content: `$${datum.balance.toFixed(2)} in the kitty` }),
          },
        },
      ],
      axes: {
        x: { type: "time" as const, position: "bottom" as const, label: { fontSize: 10, color: "#7B8498" }, line: { enabled: false }, gridLine: { enabled: false } },
        y: { type: "number" as const, position: "left" as const, label: { fontSize: 10, color: "#7B8498", formatter: ({ value }: { value: number }) => `$${value}` }, gridLine: { style: [{ stroke: "#EEF1F6" }] } },
      },
      legend: { enabled: false },
    }),
    [data],
  );

  return (
    <div>
      <p className="mb-1 text-xs font-semibold text-ink-2">Money in the kitty</p>
      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
      <AgCharts options={options as any} />
    </div>
  );
}
