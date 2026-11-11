/**
 * PayPal integration layer (SANDBOX).
 *  - Orders v2 (checkout for each contribution), REST
 *  - Payouts v1 (paying the gift shop from the pooled balance), REST
 *  - Invoicing v2 + Refunds, through the official PayPal Agent Toolkit
 * When no sandbox credentials are configured the app runs in a clearly labelled MOCK mode
 * so the UI can be developed offline. Judges always get the sandbox build.
 */
import { PayPalAgentToolkit } from "@paypal/agent-toolkit/ai-sdk";
import { config, paypalMode } from "./config";
import { newId } from "./store";
import { toValue } from "./money";
import type { Cents } from "./types";

let tokenCache: { token: string; exp: number } | null = null;

async function accessToken(): Promise<string> {
  if (tokenCache && tokenCache.exp > Date.now() + 60_000) return tokenCache.token;
  const basic = Buffer.from(`${config.paypalClientId}:${config.paypalClientSecret}`).toString("base64");
  const r = await fetch(`${config.paypalApiBase}/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  });
  if (!r.ok) throw new Error(`PayPal OAuth failed (${r.status}): ${(await r.text()).slice(0, 300)}`);
  const j = await r.json();
  tokenCache = { token: j.access_token, exp: Date.now() + j.expires_in * 1000 };
  return j.access_token;
}

async function pp<T = any>(path: string, method: string, body?: unknown, extraHeaders: Record<string, string> = {}): Promise<T> {
  const token = await accessToken();
  const r = await fetch(`${config.paypalApiBase}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "PayPal-Request-Id": newId(),
      ...extraHeaders,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  const data = text ? JSON.parse(text) : {};
  if (!r.ok) {
    const detail = data?.details?.[0]?.description || data?.message || text.slice(0, 300);
    throw new Error(`PayPal ${method} ${path} failed (${r.status}): ${detail}`);
  }
  return data as T;
}

// ---------- Agent Toolkit ----------
const g = globalThis as unknown as { __kittyToolkit?: PayPalAgentToolkit };

export function toolkit(): PayPalAgentToolkit {
  if (!g.__kittyToolkit) {
    g.__kittyToolkit = new PayPalAgentToolkit({
      clientId: config.paypalClientId || "mock",
      clientSecret: config.paypalClientSecret || "mock",
      configuration: {
        actions: {
          invoices: { create: true, list: true, get: true, send: true, sendReminder: true, cancel: true },
          orders: { get: true },
          payments: { createRefund: true, getRefunds: true },
          transactions: { list: true },
        },
        context: { sandbox: config.paypalApiBase.includes("sandbox") },
      },
    });
  }
  return g.__kittyToolkit;
}

/** Run one Agent Toolkit tool and parse its JSON result. Throws on PayPal errors. */
export async function runToolkit(name: string, args: Record<string, unknown>): Promise<any> {
  const tools = toolkit().getTools() as Record<string, { execute?: (a: any, o: any) => Promise<any> }>;
  const t = tools[name];
  if (!t?.execute) throw new Error(`Agent Toolkit tool ${name} is not enabled`);
  const raw = await t.execute(args, { toolCallId: newId(), messages: [] });
  const parsed = typeof raw === "string" ? safeJson(raw) : raw;
  if (parsed && typeof parsed === "object" && "error" in parsed && parsed.error) {
    const e = parsed.error as { message?: string };
    throw new Error(`PayPal Agent Toolkit ${name}: ${e.message || JSON.stringify(e)}`);
  }
  return parsed;
}

function safeJson(s: string) {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

const mock = () => paypalMode() === "mock";
const mockId = (p: string) => `${p}${newId().toUpperCase()}${newId().toUpperCase()}`.slice(0, 17);

// ---------- Orders v2 ----------
export async function createOrder(o: {
  amount: Cents;
  description: string;
  customId: string;
  referenceId: string;
  brand: string;
}): Promise<{ id: string; status: string }> {
  if (mock()) return { id: mockId("MOCKORD"), status: "CREATED" };
  const order = await pp<{ id: string; status: string }>("/v2/checkout/orders", "POST", {
    intent: "CAPTURE",
    purchase_units: [
      {
        reference_id: o.referenceId,
        custom_id: o.customId,
        description: o.description.slice(0, 127),
        soft_descriptor: "KITTY GIFT",
        amount: { currency_code: "USD", value: toValue(o.amount) },
      },
    ],
    application_context: {
      brand_name: o.brand.slice(0, 127),
      shipping_preference: "NO_SHIPPING",
      user_action: "PAY_NOW",
    },
  });
  return { id: order.id, status: order.status };
}

export async function captureOrder(orderId: string): Promise<{
  status: string;
  captureId: string;
  captureStatus: string;
  amount: Cents;
  payerEmail?: string;
}> {
  if (mock())
    return { status: "COMPLETED", captureId: mockId("MOCKCAP"), captureStatus: "COMPLETED", amount: -1, payerEmail: "buyer@mock" };
  const r = await pp<any>(`/v2/checkout/orders/${orderId}/capture`, "POST", {}, { Prefer: "return=representation" });
  const cap = r.purchase_units?.[0]?.payments?.captures?.[0];
  return {
    status: r.status,
    captureId: cap?.id,
    captureStatus: cap?.status,
    amount: Math.round(parseFloat(cap?.amount?.value || "0") * 100),
    payerEmail: r.payer?.email_address,
  };
}

// ---------- Payouts v1 ----------
export async function payout(o: { email: string; amount: Cents; note: string; batchId: string; subject: string }) {
  if (mock()) return { batchId: mockId("MOCKPAYOUT"), status: "SUCCESS" };
  const r = await pp<any>("/v1/payments/payouts", "POST", {
    sender_batch_header: { sender_batch_id: o.batchId, email_subject: o.subject, email_message: o.note },
    items: [
      {
        recipient_type: "EMAIL",
        amount: { value: toValue(o.amount), currency: "USD" },
        receiver: o.email,
        note: o.note.slice(0, 4000),
        sender_item_id: o.batchId,
      },
    ],
  });
  return { batchId: r.batch_header?.payout_batch_id as string, status: r.batch_header?.batch_status as string };
}

export async function getPayout(batchId: string) {
  if (mock()) return { status: "SUCCESS", itemId: mockId("MOCKITEM"), transactionId: mockId("MOCKTX"), itemStatus: "SUCCESS" };
  const r = await pp<any>(`/v1/payments/payouts/${batchId}`, "GET");
  const item = r.items?.[0];
  return {
    status: r.batch_header?.batch_status as string,
    itemId: item?.payout_item_id as string | undefined,
    transactionId: item?.transaction_id as string | undefined,
    itemStatus: item?.transaction_status as string | undefined,
  };
}

// ---------- Refunds (Agent Toolkit: create_refund) ----------
export async function refundCapture(captureId: string, amount: Cents, note: string) {
  if (mock()) return { id: mockId("MOCKREF"), status: "COMPLETED" };
  const r = await runToolkit("create_refund", {
    capture_id: captureId,
    amount: { currency_code: "USD", value: toValue(amount) },
    note_to_payer: note.slice(0, 255),
  });
  return { id: r.id as string, status: r.status as string };
}

// ---------- Invoicing (Agent Toolkit) ----------
export async function createAndSendInvoice(o: {
  givenName: string;
  surname: string;
  email: string;
  amount: Cents;
  itemName: string;
  note: string;
  reference: string;
  businessName: string;
}): Promise<{ invoiceId: string; payerUrl?: string; status: string }> {
  if (mock()) return { invoiceId: `INV2-MOCK-${newId().toUpperCase().slice(0, 4)}`, payerUrl: undefined, status: "SENT" };
  const created = await runToolkit("create_invoice", {
    currency_code: "USD",
    reference: o.reference.slice(0, 120),
    note: o.note.slice(0, 4000),
    invoicer_business_name: o.businessName.slice(0, 300),
    primary_recipients: [
      { billing_info: { name: { given_name: o.givenName, surname: o.surname || "-" }, email_address: o.email } },
    ],
    items: [
      {
        name: o.itemName.slice(0, 200),
        quantity: "1",
        unit_amount: { currency_code: "USD", value: toValue(o.amount) },
      },
    ],
  });
  const invoiceId: string =
    created?.id || String(created?.href || "").split("/").pop() || String(created?.links?.[0]?.href || "").split("/").pop();
  if (!invoiceId) throw new Error("PayPal did not return an invoice id");
  const sent = await runToolkit("send_invoice", {
    invoice_id: invoiceId,
    note: o.note.slice(0, 4000),
    send_to_recipient: true,
  });
  const payerUrl =
    sent?.links?.find?.((l: { rel: string }) => l.rel === "payer-view")?.href ||
    (typeof sent?.href === "string" && sent.href.includes("/invoice/") ? sent.href : undefined) ||
    `${config.paypalApiBase.includes("sandbox") ? "https://www.sandbox.paypal.com" : "https://www.paypal.com"}/invoice/p/#${invoiceId}`;
  return { invoiceId, payerUrl, status: "SENT" };
}

export async function remindInvoice(invoiceId: string, subject: string, note: string) {
  if (mock()) return { ok: true };
  await runToolkit("send_invoice_reminder", { invoice_id: invoiceId, subject, note });
  return { ok: true };
}

export async function getInvoice(invoiceId: string): Promise<{
  status: string;
  paid?: Cents;
  transactionId?: string;
}> {
  if (mock()) return { status: "SENT" };
  const r = await runToolkit("get_invoice", { invoice_id: invoiceId });
  const tx = r?.payments?.transactions?.[0];
  return {
    status: r?.status,
    paid: r?.payments?.paid_amount?.value ? Math.round(parseFloat(r.payments.paid_amount.value) * 100) : undefined,
    transactionId: tx?.payment_id,
  };
}

export async function healthCheck() {
  if (mock()) return { mode: "mock" as const, ok: true, detail: "No sandbox credentials: mock mode" };
  try {
    await accessToken();
    return { mode: "sandbox" as const, ok: true, detail: "OAuth token obtained from PayPal sandbox" };
  } catch (e) {
    return { mode: "sandbox" as const, ok: false, detail: (e as Error).message };
  }
}
