import { NextResponse } from "next/server";
import { owes } from "@/lib/actions";
import { kittyByToken } from "@/lib/store";
import { modes } from "@/lib/view";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const k = kittyByToken(token);
  if (!k) return NextResponse.json({ error: "This payment link is not valid anymore." }, { status: 404 });
  const p = k.participants.find((x) => x.token === token)!;
  const org = k.participants.find((x) => x.isOrganizer);
  return NextResponse.json({
    kittyId: k.id,
    recipient: k.recipient,
    occasion: k.occasion,
    eventDate: k.eventDate,
    purpose: k.purpose,
    organizer: org?.name,
    name: p.name,
    owes: owes(k, p),
    open: k.status === "collecting",
    modes: modes(),
  });
}
