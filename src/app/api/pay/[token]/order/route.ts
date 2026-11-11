import { NextResponse } from "next/server";
import { createOrderForToken } from "@/lib/actions";

export const dynamic = "force-dynamic";

export async function POST(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  try {
    const o = await createOrderForToken(token);
    return NextResponse.json(o);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
