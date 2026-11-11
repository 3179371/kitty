import { NextResponse } from "next/server";
import { generateText } from "ai";
import { model } from "@/lib/ai";
import { aiMode, config, giftSource, paypalMode } from "@/lib/config";
import { searchGifts } from "@/lib/gifts";
import { createOrder, healthCheck, runToolkit } from "@/lib/paypal";
import { modes } from "@/lib/view";

export const dynamic = "force-dynamic";

async function probe(fn: () => Promise<string>) {
  const t = Date.now();
  try {
    return { ok: true, detail: await fn(), ms: Date.now() - t };
  } catch (e) {
    return { ok: false, detail: (e as Error).message.slice(0, 300), ms: Date.now() - t };
  }
}

/** GET /api/health          quick status
 *  GET /api/health?deep=1   also exercises Orders, Invoicing (Agent Toolkit), Claude and Channel3 */
export async function GET(req: Request) {
  const deep = new URL(req.url).searchParams.get("deep") === "1";
  const paypal = await healthCheck();
  const out: Record<string, unknown> = {
    ...modes(),
    paypalHealth: paypal,
    giftShopConfigured: !!config.giftShopEmail,
    invoiceRecipientConfigured: !!config.invoiceRecipientEmail,
    time: new Date().toISOString(),
  };
  if (deep) {
    out.checks = {
      orders: paypalMode() === "sandbox" ? await probe(async () => (await createOrder({ amount: 100, description: "Kitty health check", customId: "health", referenceId: "health", brand: "Kitty" })).id) : "mock",
      invoicing_agent_toolkit: paypalMode() === "sandbox" ? await probe(async () => `total_items=${(await runToolkit("list_invoices", { page: 1, page_size: 1 }))?.total_items ?? "?"}`) : "mock",
      claude: aiMode() === "claude" ? await probe(async () => (await generateText({ model: model(), prompt: "Reply with the single word OK.", maxTokens: 5 })).text) : "offline",
      gifts: await probe(async () => {
        const r = await searchGifts("hiking backpack", 15000, ["hiking"]);
        return `${giftSource()}: ${r.length} results, first=${r[0]?.title} (${r[0]?.source})`;
      }),
    };
  }
  return NextResponse.json(out);
}
