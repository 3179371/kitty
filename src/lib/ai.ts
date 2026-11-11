import { createAnthropic } from "@ai-sdk/anthropic";
import { generateText, tool } from "ai";
import { z } from "zod";
import { aiMode, config } from "./config";
import type { KittyDraft } from "./types";

export function model() {
  // AI SDK v4 always sends `temperature` (default 0), which newer Claude models reject.
  // Strip it from the request body before it reaches the API.
  const anthropic = createAnthropic({
    apiKey: config.anthropicKey,
    fetch: async (url, init) => {
      if (init && typeof init.body === "string") {
        try {
          const body = JSON.parse(init.body);
          if (body && typeof body === "object" && "temperature" in body) {
            delete body.temperature;
            init = { ...init, body: JSON.stringify(body) };
          }
        } catch {
          // not JSON: send as is
        }
      }
      return fetch(url, init);
    },
  });
  return anthropic(config.anthropicModel);
}

const draftSchema = z.object({
  recipient: z.string().describe("First name of the person the gift is for"),
  occasion: z.string().describe("Short occasion label, e.g. 'Birthday', 'Farewell', 'New baby'"),
  eventDate: z.string().describe("Date of the occasion, YYYY-MM-DD, resolved relative to today"),
  sharePerPerson: z.number().describe("Amount each participant chips in, in US dollars"),
  participants: z
    .array(z.object({ name: z.string(), isOrganizer: z.boolean().optional() }))
    .describe("Everyone who chips in. Include the organizer if they said 'me', 'us' or 'we'. If only a count is given, invent realistic, diverse first names."),
  interests: z.array(z.string()).describe("What the recipient likes, 1-4 short lowercase keywords"),
});

/** Last structured-output error, exposed by /api/health for diagnosis. */
export let lastParseError = "";

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const FALLBACK_NAMES = ["Mia", "Karim", "Jonas", "Priya", "Tom", "Ana", "Leo", "Sofia", "Omar", "Chloe", "Ben", "Yuki"];

export async function parseSentence(sentence: string, organizerName: string, today: Date): Promise<{ draft: KittyDraft; via: "claude" | "offline" }> {
  if (aiMode() === "claude") {
    // Tool calling (not forced) is the most widely supported way to get structured output from Claude.
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        let captured: z.infer<typeof draftSchema> | null = null;
        await generateText({
          model: model(),
          system:
            "You turn one sentence from a group-gift organizer into a structured kitty by calling the create_kitty tool exactly once. Be precise with numbers and dates. Never invent an amount: if none is given, use 20.",
          prompt: `Today is ${today.toDateString()} (${today.toISOString().slice(0, 10)}). The organizer's name is ${organizerName}.\nSentence: "${sentence}"`,
          tools: {
            create_kitty: tool({
              description: "Create the kitty from the organizer's sentence.",
              parameters: draftSchema,
              execute: async (args) => {
                captured = args;
                return "created";
              },
            }),
          },
          maxSteps: 1,
          abortSignal: AbortSignal.timeout(30_000),
        });
        const object = captured as z.infer<typeof draftSchema> | null;
        if (!object) throw new Error("Claude did not call create_kitty");
        const parts = object.participants.map((p) => ({ name: p.name.trim(), isOrganizer: !!p.isOrganizer || p.name.trim().toLowerCase() === organizerName.toLowerCase() }));
        return { draft: { ...object, organizerName, participants: parts }, via: "claude" };
      } catch (e) {
        lastParseError = (e as Error).message;
        console.error("[kitty] Claude parse failed", e);
      }
    }
  }
  return { draft: offlineParse(sentence, organizerName, today), via: "offline" };
}

function offlineParse(s: string, organizerName: string, today: Date): KittyDraft {
  const lower = s.toLowerCase();
  const recipient = (s.match(/\bfor\s+([A-Z][a-zA-Z'-]+)/) || [])[1] || "our friend";
  const amount = parseFloat((s.match(/[$€£]\s?(\d+(?:\.\d+)?)/) || s.match(/(\d+(?:\.\d+)?)\s?(?:\$|€|dollars|euros|each)/i) || [])[1] || "20");
  const count = parseInt((lower.match(/(\d+)\s+(?:colleagues|friends|people|coworkers|teammates|others)/) || [])[1] || "5", 10);
  const includesMe = /\b(me and|with me|us|we)\b/.test(lower);
  const interestText = (lower.match(/(?:loves?|likes?|into|enjoys?)\s+([^,.;]+)/) || [])[1] || "";
  const interests = interestText.split(/\s+and\s+|,|\s+&\s+/).map((x) => x.trim()).filter(Boolean).slice(0, 4);
  let date = new Date(today);
  const wd = WEEKDAYS.findIndex((d) => lower.includes(d));
  if (wd >= 0) {
    const diff = (wd - today.getDay() + 7) % 7 || 7;
    date = new Date(today.getTime() + diff * 86400000);
  } else date = new Date(today.getTime() + 10 * 86400000);
  const occasion = /farewell|leaving|goodbye/.test(lower) ? "Farewell" : /baby/.test(lower) ? "New baby" : /wedding/.test(lower) ? "Wedding" : "Birthday";
  const listed = ((s.match(/\b(?:from|with)\s+((?:me|us)?[,\s]*(?:[A-Z][a-zA-Z'-]+(?:,\s*|\s+and\s+|\s*&\s*)?)+)/) || [])[1] || "")
    .split(/,|\band\b|&/)
    .map((x) => x.trim())
    .filter((x) => /^[A-Z][a-zA-Z'-]+$/.test(x) && x !== recipient && !/^(Me|Us|She|He|They)$/.test(x));
  if (listed.length) {
    const participants = [{ name: organizerName, isOrganizer: true }, ...listed.map((name) => ({ name }))];
    return { recipient, occasion, eventDate: date.toISOString().slice(0, 10), sharePerPerson: amount, organizerName, participants, interests: interests.length ? interests : ["surprises"] };
  }
  const names = FALLBACK_NAMES.filter((n) => n.toLowerCase() !== recipient.toLowerCase() && n.toLowerCase() !== organizerName.toLowerCase()).slice(0, includesMe ? Math.max(1, count) : count);
  const participants = [{ name: organizerName, isOrganizer: true }, ...names.map((name) => ({ name }))];
  return { recipient, occasion, eventDate: date.toISOString().slice(0, 10), sharePerPerson: amount, organizerName, participants, interests: interests.length ? interests : ["surprises"] };
}
