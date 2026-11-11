import { NextResponse } from "next/server";
import { captureForToken } from "@/lib/actions";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  try {
    const { orderID } = await req.json();
    const r = await captureForToken(token, String(orderID));
    return NextResponse.json(r);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
