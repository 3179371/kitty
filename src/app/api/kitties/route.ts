import { NextResponse } from "next/server";
import { createKitty } from "@/lib/actions";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const { sentence, organizerName } = await req.json();
    if (!sentence || String(sentence).trim().length < 8) {
      return NextResponse.json({ error: "Describe the kitty in one sentence: who it's for, when, how much each, and who's in." }, { status: 400 });
    }
    const k = await createKitty(String(sentence).slice(0, 400), String(organizerName || "Lina").slice(0, 40));
    return NextResponse.json({ id: k.id });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
