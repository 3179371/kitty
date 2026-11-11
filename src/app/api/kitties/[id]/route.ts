import { NextResponse } from "next/server";
import { syncInvoices } from "@/lib/actions";
import { getKitty } from "@/lib/store";
import { kittyView } from "@/lib/view";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const k = getKitty(id);
  if (!k) return NextResponse.json({ error: "This kitty doesn't exist (the demo server may have restarted). Start a new one." }, { status: 404 });
  syncInvoices(k).catch(() => undefined);
  return NextResponse.json(kittyView(k));
}
