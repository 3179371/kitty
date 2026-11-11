import { NextResponse } from "next/server";
import { castVote, closeVote, mockPay, mockPayInvoice, resolveApproval } from "@/lib/actions";
import { runAgent } from "@/lib/agent";
import { getKitty, log, persist, say } from "@/lib/store";
import { kittyView } from "@/lib/view";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const k = getKitty(id);
  if (!k) return NextResponse.json({ error: "Kitty not found" }, { status: 404 });
  const body = await req.json();
  try {
    switch (body.action) {
      case "skip_day": {
        k.clockOffsetDays += 1;
        persist();
        log(k, { actor: "Demo clock", action: `Skipped ahead to ${new Date(Date.now() + k.clockOffsetDays * 86400000).toDateString()}`, status: "ok" });
        runAgent(k, { type: "daily_check" });
        break;
      }
      case "participant_message": {
        const text = String(body.text || "").slice(0, 300).trim();
        if (!text) break;
        say(k, "group", body.participantId, text);
        runAgent(k, { type: "participant_message", participantId: body.participantId, text });
        break;
      }
      case "organizer_command": {
        const text = String(body.text || "").slice(0, 400).trim();
        if (!text) break;
        say(k, "organizer", "organizer", text);
        runAgent(k, { type: "organizer_command", text });
        break;
      }
      case "vote":
        castVote(k, body.participantId, body.optionId);
        break;
      case "close_vote":
        closeVote(k);
        break;
      case "approve":
        await resolveApproval(k.id, body.approvalId, "approve", body.optionId);
        break;
      case "decline":
        await resolveApproval(k.id, body.approvalId, "decline");
        break;
      case "mock_pay": {
        const p = k.participants.find((x) => x.id === body.participantId);
        if (!p) throw new Error("Unknown participant");
        await mockPay(p.token);
        break;
      }
      case "mock_pay_invoice":
        await mockPayInvoice(k, body.participantId);
        break;
      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
    return NextResponse.json(kittyView(k));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
