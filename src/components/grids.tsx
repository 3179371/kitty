"use client";

import { AllCommunityModule, ModuleRegistry, themeQuartz, type ColDef, type GridApi, type ICellRendererParams, type IRowNode } from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KittyView } from "@/lib/view";
import type { LogEntry } from "@/lib/types";
import { fmt } from "@/lib/money";

ModuleRegistry.registerModules([AllCommunityModule]);

export const kittyTheme = themeQuartz.withParams({
  accentColor: "#C8326B",
  backgroundColor: "#FFFFFF",
  foregroundColor: "#172033",
  borderColor: "#E3E7EF",
  headerBackgroundColor: "#F7F8FB",
  headerTextColor: "#4A5468",
  headerFontWeight: 600,
  fontFamily: "Figtree Variable, system-ui, sans-serif",
  headerFontFamily: "Figtree Variable, system-ui, sans-serif",
  fontSize: 13,
  headerFontSize: 12,
  spacing: 6,
  rowHoverColor: "#FBF2F6",
  wrapperBorderRadius: 14,
  wrapperBorder: { color: "#DDE2EC" },
  oddRowBackgroundColor: "#FCFCFE",
  browserColorScheme: "light",
});

type PRow = KittyView["participantsView"][number] & {
  status: string;
  method?: string;
  ref?: string;
  mandate?: string;
  refunded: number;
  isTotal?: boolean;
};

function Pill({ tone, children }: { tone: "mint" | "sun" | "berry" | "gray" | "danger" | "sky"; children: React.ReactNode }) {
  const tones = {
    mint: "bg-mint-soft text-mint",
    sun: "bg-sun-soft text-[#8a5a00]",
    berry: "bg-berry-soft text-berry-deep",
    gray: "bg-[#EEF1F6] text-ink-2",
    danger: "bg-danger-soft text-danger",
    sky: "bg-sky-soft text-sky",
  };
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${tones[tone]}`}>{children}</span>;
}

function PersonCell(p: ICellRendererParams<PRow>) {
  const r = p.data!;
  if (r.isTotal) return <span className="font-semibold">Total · {r.name}</span>;
  return (
    <span className="flex items-center gap-2">
      <span className="flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold text-white" style={{ background: r.color }}>
        {r.name[0]}
      </span>
      <span className="font-medium">{r.name}</span>
      {r.isOrganizer && <span className="text-xs text-ink-3">organizer</span>}
    </span>
  );
}

function StatusCell(p: ICellRendererParams<PRow>) {
  const s = p.value as string;
  if (!s || p.data?.isTotal) return null;
  const tone = s === "Paid" ? "mint" : s.startsWith("Refunded") ? "sky" : s.startsWith("Invoice") ? "berry" : s.startsWith("Reminded") ? "sun" : s === "Pending" ? "sun" : "gray";
  return <Pill tone={tone}>{s}</Pill>;
}

function PayPalRefCell(p: ICellRendererParams<PRow>) {
  const r = p.data!;
  if (r.isTotal || !r.ref) return null;
  return (
    <span className="flex flex-col justify-center leading-tight">
      <span className="text-[12px] font-medium text-ink">{r.method}</span>
      <span className="num truncate text-[11px] text-ink-3">{r.ref}</span>
    </span>
  );
}

function MandateCell(p: ICellRendererParams<PRow>) {
  const r = p.data!;
  if (r.isTotal || !r.mandate) return null;
  const [id, cap] = r.mandate.split(" · ");
  return (
    <span className="flex flex-col justify-center leading-tight">
      <span className="text-[12px] font-medium text-ink">{cap}</span>
      <span className="num text-[11px] text-ink-3">{id}</span>
    </span>
  );
}

const money = (p: { value: number | undefined }) => (p.value === undefined || p.value === null ? "" : fmt(p.value));

export function ContributionsGrid({ k }: { k: KittyView }) {
  const rows: PRow[] = useMemo(
    () =>
      k.participantsView.map((p) => {
        const cs = k.contributions.filter((c) => c.participantId === p.id);
        const last = cs[cs.length - 1];
        const refunded = cs.reduce((s, c) => s + c.refunded, 0);
        let status = "Waiting";
        if (p.owes === 0 && refunded > 0) status = `Refunded ${fmt(refunded)}`;
        else if (p.owes === 0) status = last?.status === "PENDING" ? "Pending" : "Paid";
        else if (p.invoiceId) status = `Invoice ${(p.invoiceStatus || "sent").toLowerCase()}`;
        else if (p.reminders > 0) status = `Reminded ×${p.reminders}`;
        return {
          ...p,
          status,
          method: last ? (last.method === "paypal_invoice" ? "PayPal invoice" : "PayPal checkout") : p.invoiceId ? "Invoice sent" : "",
          ref: last?.captureId || last?.transactionId || p.invoiceId || "",
          mandate: last ? `${last.mandate.id} · Up to ${fmt(cs.reduce((s, c) => s + c.mandate.maxCents, 0))}` : "",
          refunded,
        };
      }),
    [k],
  );
  const total: PRow[] = useMemo(
    () => [
      {
        ...(rows[0] || ({} as PRow)),
        id: "total",
        name: `${k.totals.paidCount}/${k.participants.length} paid`,
        isTotal: true,
        share: rows.reduce((s, r) => s + r.share, 0),
        paid: rows.reduce((s, r) => s + r.paid, 0),
        refunded: rows.reduce((s, r) => s + r.refunded, 0),
        status: "",
        method: "",
        ref: "",
        mandate: "",
        isOrganizer: false,
      },
    ],
    [rows, k.totals.paidCount, k.participants.length],
  );
  const cols: ColDef<PRow>[] = useMemo(
    () => [
      { field: "name", headerName: "Person", cellRenderer: PersonCell, flex: 1.2, minWidth: 130 },
      { field: "share", headerName: "Share", valueFormatter: money, width: 72, cellClass: "num" },
      { field: "paid", headerName: "Paid", valueFormatter: money, width: 72, cellClass: "num", enableCellChangeFlash: true },
      { field: "status", headerName: "Status", cellRenderer: StatusCell, width: 138, enableCellChangeFlash: true },
      { field: "ref", headerName: "PayPal", cellRenderer: PayPalRefCell, flex: 1.1, minWidth: 150, tooltipField: "ref", enableCellChangeFlash: true },
      { field: "mandate", headerName: "Mandate", flex: 0.9, minWidth: 110, cellRenderer: MandateCell, tooltipField: "mandate" },
    ],
    [],
  );
  return (
    <div style={{ height: 44 + 42 * (rows.length + 1) + 6 }}>
      <AgGridReact<PRow>
        theme={kittyTheme}
        rowData={rows}
        pinnedBottomRowData={total}
        columnDefs={cols}
        getRowId={(p) => p.data.id}
        defaultColDef={{ sortable: true, resizable: true, suppressMovable: true }}
        rowHeight={42}
        headerHeight={40}
        animateRows
        suppressCellFocus
        getRowStyle={(p) => (p.node.rowPinned ? { fontWeight: 600, background: "#F7F8FB" } : undefined)}
      />
    </div>
  );
}

// ------------------------------------------------------------------ activity log
type LRow = LogEntry & { time: string };

function ActorCell(p: ICellRendererParams<LRow>) {
  const a = p.value as string;
  const tone = a === "Kitty AI" ? "berry" : a === "PayPal" ? "sky" : a === "Policy engine" ? "danger" : a === "Demo clock" ? "gray" : "gray";
  return <Pill tone={tone}>{a}</Pill>;
}

function LogStatus(p: ICellRendererParams<LRow>) {
  const s = p.value as LogEntry["status"];
  const map = { ok: ["mint", "Done"], pending: ["sun", "Pending"], waiting: ["sun", "Needs approval"], blocked: ["danger", "Blocked"], error: ["danger", "Error"] } as const;
  const [tone, label] = map[s] || ["gray", s];
  return <Pill tone={tone}>{label}</Pill>;
}

function ActionCell(p: ICellRendererParams<LRow>) {
  const d = p.data!;
  return (
    <span className="block py-0.5 leading-snug">
      <span className="block">{d.action}</span>
      {d.ref && <span className="num block text-[11px] text-ink-3">{d.ref}</span>}
      {d.status === "blocked" && d.details && <span className="block text-[11px] font-medium text-danger">{d.details}</span>}
    </span>
  );
}

function ToolCell(p: ICellRendererParams<LRow>) {
  if (!p.value) return null;
  const v = String(p.value);
  const pp = v.startsWith("paypal");
  return <span className={`inline-block max-w-full truncate rounded-md px-1.5 py-0.5 align-middle text-xs font-medium ${pp ? "bg-sky-soft text-sky" : "bg-[#EEF1F6] text-ink-2"}`}>{v}</span>;
}

const FILTERS = [
  { id: "all", label: "Everything" },
  { id: "paypal", label: "PayPal calls" },
  { id: "ai", label: "Agent decisions" },
  { id: "attention", label: "Blocked or waiting" },
] as const;

export function ActivityGrid({ k, height = 420 }: { k: KittyView; height?: number }) {
  const api = useRef<GridApi<LRow> | null>(null);
  const known = useRef<Set<string>>(new Set());
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["id"]>("all");
  const [quick, setQuick] = useState("");
  const rows: LRow[] = useMemo(
    () =>
      [...k.log].reverse().map((l) => ({
        ...l,
        time: new Date(l.at).toLocaleString("en-US", { weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false }),
      })),
    [k.log],
  );
  const filterRef = useRef(filter);
  filterRef.current = filter;

  useEffect(() => {
    api.current?.onFilterChanged();
  }, [filter]);

  const onUpdated = useCallback(() => {
    const a = api.current;
    if (!a) return;
    const fresh: IRowNode<LRow>[] = [];
    a.forEachNode((n) => {
      if (n.data && !known.current.has(n.data.id)) {
        if (known.current.size > 0) fresh.push(n);
        known.current.add(n.data.id);
      }
    });
    if (fresh.length) a.flashCells({ rowNodes: fresh, flashDuration: 1400, fadeDuration: 900 });
  }, []);

  const cols: ColDef<LRow>[] = useMemo(
    () => [
      { field: "time", headerName: "When", width: 92, cellClass: "num text-ink-2", sortable: false },
      { field: "actor", headerName: "Who", cellRenderer: ActorCell, width: 116 },
      { field: "action", headerName: "What happened", flex: 2, minWidth: 190, cellRenderer: ActionCell, wrapText: true, autoHeight: true, tooltipField: "details" },
      { field: "tool", headerName: "Tool", cellRenderer: ToolCell, flex: 1.1, minWidth: 150, tooltipField: "tool" },
      { field: "status", headerName: "Status", cellRenderer: LogStatus, width: 122 },
    ],
    [],
  );

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            className={`rounded-full px-3 py-1 text-xs font-semibold transition ${filter === f.id ? "bg-ink text-white" : "bg-white text-ink-2 ring-1 ring-line hover:text-ink"}`}
          >
            {f.label}
          </button>
        ))}
        <input
          value={quick}
          onChange={(e) => setQuick(e.target.value)}
          placeholder="Search the activity"
          className="ml-auto w-48 rounded-full border border-line bg-white px-3 py-1 text-xs outline-none focus:border-ink"
        />
      </div>
      <div style={{ height }}>
        <AgGridReact<LRow>
          theme={kittyTheme}
          rowData={rows}
          columnDefs={cols}
          getRowId={(p) => p.data.id}
          defaultColDef={{ resizable: true, suppressMovable: true, sortable: true }}
          headerHeight={40}
          animateRows
          suppressCellFocus
          quickFilterText={quick}
          tooltipShowDelay={300}
          onGridReady={(e) => {
            api.current = e.api;
            onUpdated();
          }}
          onRowDataUpdated={onUpdated}
          isExternalFilterPresent={() => filterRef.current !== "all"}
          doesExternalFilterPass={(n) => {
            const d = n.data!;
            const f = filterRef.current;
            if (f === "paypal") return (d.tool || "").startsWith("paypal") || d.actor === "PayPal";
            if (f === "ai") return d.actor === "Kitty AI";
            if (f === "attention") return d.status === "blocked" || d.status === "waiting" || d.status === "error";
            return true;
          }}
          getRowStyle={(p) => (p.data?.status === "blocked" ? { background: "#FFF6F5" } : undefined)}
        />
      </div>
    </div>
  );
}
