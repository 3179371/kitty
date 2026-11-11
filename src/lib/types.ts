export type Cents = number;

export type Channel = "group" | "organizer";

export interface Mandate {
  id: string;
  purpose: string;
  maxCents: Cents;
  expiresAt: string;
  acceptedAt: string;
}

export interface Participant {
  id: string;
  name: string;
  email: string;
  share: Cents;
  token: string;
  color: string;
  isOrganizer: boolean;
  reminders: number;
  lastRemindedAt?: string;
  invoiceId?: string;
  invoiceStatus?: string;
  invoiceUrl?: string;
  orderId?: string;
  joinedAt: string;
}

export interface Contribution {
  id: string;
  participantId: string;
  amount: Cents;
  method: "paypal_checkout" | "paypal_invoice";
  orderId?: string;
  captureId?: string;
  invoiceId?: string;
  transactionId?: string;
  payerEmail?: string;
  status: "COMPLETED" | "PENDING";
  paidAt: string;
  mandate: Mandate;
  refunded: Cents;
}

export interface Message {
  id: string;
  at: string;
  channel: Channel;
  from: string; // "kitty" | "system" | "organizer" | participantId
  text: string;
  kind: "text" | "pay_link" | "gift_vote" | "invoice" | "card" | "receipt" | "decision";
  data?: Record<string, unknown>;
}

export interface GiftCandidate {
  id: string;
  title: string;
  brand?: string;
  price: Cents;
  currency: string;
  image?: string;
  merchant: string;
  url?: string;
  source: "channel3" | "demo_catalog";
  description?: string;
}

export interface GiftOption extends GiftCandidate {
  reason: string;
}

export interface Check {
  label: string;
  ok: boolean;
  detail?: string;
}

export interface DecisionOption {
  id: string;
  label: string;
  effect: string;
}

export interface Approval {
  id: string;
  kind: "purchase" | "refund" | "decision";
  createdAt: string;
  status: "pending" | "approved" | "declined" | "executed" | "failed" | "blocked";
  title: string;
  message: string;
  amount?: Cents;
  payee?: string;
  checks: Check[];
  options?: DecisionOption[];
  data: Record<string, unknown>;
  result?: string;
  resolvedAt?: string;
}

export interface LogEntry {
  id: string;
  at: string;
  actor: string;
  action: string;
  tool?: string;
  amount?: Cents;
  status: "ok" | "pending" | "error" | "blocked" | "waiting";
  details?: string;
  ref?: string;
}

export interface Purchase {
  optionId: string;
  title: string;
  merchant: string;
  amount: Cents;
  payoutBatchId?: string;
  payoutItemId?: string;
  transactionId?: string;
  status: string;
  at: string;
}

export interface Refund {
  id: string;
  participantId: string;
  contributionId: string;
  amount: Cents;
  refundId?: string;
  via: "refunds_api" | "payouts_api";
  status: string;
  at: string;
}

export interface Card {
  headline: string;
  message: string;
  signatures: { name: string; text: string; color: string }[];
  giftTitle?: string;
  createdAt: string;
}

export type KittyStatus =
  | "collecting"
  | "choosing"
  | "voting"
  | "buying"
  | "purchased"
  | "done";

export interface Kitty {
  id: string;
  createdAt: string;
  sentence: string;
  organizerId: string;
  recipient: string;
  occasion: string;
  eventDate: string; // ISO date
  deadline: string; // ISO date-time, collection deadline
  currency: string;
  sharePerPerson: Cents;
  goal: Cents;
  interests: string[];
  purpose: string;
  spendCap: Cents;
  status: KittyStatus;
  clockOffsetDays: number;
  participants: Participant[];
  contributions: Contribution[];
  messages: Message[];
  candidates: GiftCandidate[];
  giftOptions: GiftOption[];
  votes: Record<string, string>;
  approvals: Approval[];
  purchase?: Purchase;
  refunds: Refund[];
  card?: Card;
  log: LogEntry[];
  agentBusy: boolean;
  agentThought?: string;
  lastInvoiceSync?: number;
}

export interface KittyDraft {
  recipient: string;
  occasion: string;
  eventDate: string;
  sharePerPerson: number; // dollars
  organizerName: string;
  participants: { name: string; isOrganizer?: boolean }[];
  interests: string[];
}
