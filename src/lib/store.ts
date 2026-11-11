import fs from "node:fs";
import { customAlphabet } from "nanoid";
import { config } from "./config";
import type { Channel, Kitty, LogEntry, Message } from "./types";

export const newId = customAlphabet("abcdefghijkmnpqrstuvwxyz23456789", 10);

type Store = { kitties: Record<string, Kitty>; tokens: Record<string, string>; queues: Record<string, Promise<unknown>> };

const g = globalThis as unknown as { __kittyStore?: Store; __kittySaveTimer?: NodeJS.Timeout };

function load(): Store {
  const s: Store = { kitties: {}, tokens: {}, queues: {} };
  try {
    if (fs.existsSync(config.dataFile)) {
      const raw = JSON.parse(fs.readFileSync(config.dataFile, "utf8"));
      s.kitties = raw.kitties || {};
      for (const k of Object.values(s.kitties)) {
        k.agentBusy = false;
        for (const p of k.participants) s.tokens[p.token] = k.id;
      }
    }
  } catch (e) {
    console.error("[kitty] could not load data file", e);
  }
  return s;
}

export function store(): Store {
  if (!g.__kittyStore) g.__kittyStore = load();
  return g.__kittyStore;
}

export function persist() {
  if (g.__kittySaveTimer) clearTimeout(g.__kittySaveTimer);
  g.__kittySaveTimer = setTimeout(() => {
    try {
      fs.writeFileSync(config.dataFile, JSON.stringify({ kitties: store().kitties }));
    } catch (e) {
      console.error("[kitty] could not save data file", e);
    }
  }, 300);
}

export function getKitty(id: string): Kitty | undefined {
  return store().kitties[id];
}

export function putKitty(k: Kitty) {
  store().kitties[k.id] = k;
  for (const p of k.participants) store().tokens[p.token] = k.id;
  persist();
}

export function kittyByToken(token: string): Kitty | undefined {
  const id = store().tokens[token];
  return id ? getKitty(id) : undefined;
}

/** Serialize work per kitty so the agent and money moves never race. */
export function enqueue<T>(kittyId: string, fn: () => Promise<T>): Promise<T> {
  const q = store().queues;
  const prev = q[kittyId] || Promise.resolve();
  const next = prev.catch(() => undefined).then(fn);
  q[kittyId] = next.catch(() => undefined);
  return next;
}

/** The demo can fast-forward time; every date check goes through this. */
export function nowFor(k: Kitty): Date {
  return new Date(Date.now() + k.clockOffsetDays * 86400000);
}

export function log(k: Kitty, e: Omit<LogEntry, "id" | "at">): LogEntry {
  const entry: LogEntry = { id: newId(), at: nowFor(k).toISOString(), ...e };
  k.log.push(entry);
  persist();
  return entry;
}

export function say(
  k: Kitty,
  channel: Channel,
  from: string,
  text: string,
  kind: Message["kind"] = "text",
  data?: Record<string, unknown>,
): Message {
  const m: Message = { id: newId(), at: nowFor(k).toISOString(), channel, from, text, kind, data };
  k.messages.push(m);
  persist();
  return m;
}

export function participantName(k: Kitty, id: string): string {
  if (id === "kitty") return "Kitty";
  if (id === "system") return "PayPal";
  if (id === "organizer") return k.participants.find((p) => p.isOrganizer)?.name || "Organizer";
  return k.participants.find((p) => p.id === id)?.name || id;
}
