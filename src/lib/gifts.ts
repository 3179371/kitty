import { config, giftSource } from "./config";
import { newId } from "./store";
import type { Cents, GiftCandidate } from "./types";

/** Real product search through the Channel3 API (falls back to a small demo catalog without a key). */
export async function searchGifts(query: string, maxPrice: Cents, interests: string[]): Promise<GiftCandidate[]> {
  if (giftSource() === "channel3") {
    try {
      const r = await fetch("https://api.trychannel3.com/v1/search", {
        method: "POST",
        headers: { "x-api-key": config.channel3Key, "Content-Type": "application/json" },
        body: JSON.stringify({
          query,
          limit: 20,
          filters: { price: { min_price: Math.max(5, (maxPrice / 100) * 0.35), max_price: maxPrice / 100 } },
        }),
      });
      if (!r.ok) throw new Error(`Channel3 ${r.status}: ${(await r.text()).slice(0, 200)}`);
      const j = await r.json();
      const out: GiftCandidate[] = [];
      for (const p of j.products || []) {
        const offer =
          (p.offers || []).find((o: any) => o.price?.currency === "USD" && o.availability === "InStock") ||
          (p.offers || [])[0];
        if (!offer?.price?.price) continue;
        const price = Math.round(offer.price.price * 100);
        if (price > maxPrice) continue;
        const img = (p.images || []).find((i: any) => i.is_main_image) || (p.images || [])[0];
        out.push({
          id: `c3_${p.id}`,
          title: p.title,
          brand: p.brands?.[0]?.name,
          price,
          currency: offer.price.currency || "USD",
          image: img?.cleaned_url || img?.url,
          merchant: offer.domain,
          url: offer.url,
          source: "channel3",
          description: (p.key_features || []).slice(0, 3).join("; ") || (p.description || "").slice(0, 160),
        });
      }
      if (out.length) return out.slice(0, 12);
    } catch (e) {
      console.error("[kitty] Channel3 search failed, using demo catalog", e);
    }
  }
  return demoCatalog(query, maxPrice, interests);
}

type Item = Omit<GiftCandidate, "id" | "source" | "currency"> & { tags: string[] };

// Fictional merchants and products, used only when no Channel3 key is configured.
const CATALOG: Item[] = [
  { title: "Lightweight 28L day-hiking backpack", brand: "Ridgeline", price: 8900, image: "🎒", merchant: "Trailhead Supply Co.", tags: ["hiking", "outdoors", "travel", "camping"], description: "Ventilated back panel; rain cover; hydration sleeve" },
  { title: "Carbon trekking poles (pair)", brand: "Ridgeline", price: 7400, image: "🥾", merchant: "Trailhead Supply Co.", tags: ["hiking", "outdoors", "trail", "running"], description: "Flick-lock; 480 g pair; cork grips" },
  { title: "Waterproof mid hiking boots", brand: "Northpass", price: 11800, image: "🥾", merchant: "Summit Outfitters", tags: ["hiking", "outdoors", "camping"], description: "Waterproof membrane; grippy outsole" },
  { title: "National parks adventure guidebook + map set", brand: "Wayfarer Press", price: 3900, image: "🗺️", merchant: "Wayfarer Books", tags: ["hiking", "travel", "books", "reading", "outdoors"], description: "62 parks; fold-out waterproof maps" },
  { title: "Insulated trail bottle + filter", brand: "Clearstream", price: 4500, image: "💧", merchant: "Summit Outfitters", tags: ["hiking", "outdoors", "camping", "running"], description: "Removes 99.9% bacteria; 750 ml" },
  { title: "Rechargeable headlamp, 450 lumens", brand: "Lumen Trail", price: 4900, image: "🔦", merchant: "Trailhead Supply Co.", tags: ["hiking", "camping", "outdoors", "running"], description: "USB-C; red night mode; IPX6" },
  { title: "Hiking weekend for two (gift card)", brand: "Basecamp Lodges", price: 11000, image: "🏕️", merchant: "Basecamp Lodges", tags: ["hiking", "travel", "outdoors", "experience"], description: "Valid 12 months at 40 mountain lodges" },
  { title: "Pour-over coffee kit with grinder", brand: "Morning Ritual", price: 7900, image: "☕", merchant: "Roast & Co.", tags: ["coffee", "cooking", "kitchen"], description: "Burr grinder; glass dripper; 2 bags of beans" },
  { title: "Specialty coffee subscription (3 months)", brand: "Roast & Co.", price: 6600, image: "☕", merchant: "Roast & Co.", tags: ["coffee"], description: "Two bags a month from small roasters" },
  { title: "Hardcover book bundle: 3 staff picks", brand: "Wayfarer Press", price: 5400, image: "📚", merchant: "Wayfarer Books", tags: ["books", "reading", "writing"], description: "Handpicked fiction and non-fiction" },
  { title: "Cork yoga mat + strap", brand: "Stillpoint", price: 6800, image: "🧘", merchant: "Stillpoint Studio", tags: ["yoga", "fitness", "wellness", "sport"], description: "Natural cork; 4 mm; non-slip" },
  { title: "Wireless noise-cancelling headphones", brand: "Sonora", price: 11900, image: "🎧", merchant: "Sonora Audio", tags: ["music", "travel", "podcasts", "gaming"], description: "30 h battery; foldable" },
  { title: "Cast-iron dutch oven, 5.5 qt", brand: "Hearth", price: 9500, image: "🍲", merchant: "Hearth Kitchen", tags: ["cooking", "kitchen", "food", "baking"], description: "Enamelled; oven-safe to 500°F" },
  { title: "Instant film camera + 20 shots", brand: "Snapwell", price: 9900, image: "📷", merchant: "Lens & Light", tags: ["photography", "travel", "art"], description: "Auto exposure; selfie mirror" },
  { title: "Indoor herb garden kit", brand: "Greenhaus", price: 5900, image: "🌿", merchant: "Greenhaus", tags: ["gardening", "plants", "cooking"], description: "Self-watering; 6 herb pods; grow light" },
  { title: "Board game night bundle", brand: "Meeple Works", price: 6200, image: "🎲", merchant: "Meeple Works", tags: ["games", "gaming", "board games", "friends"], description: "3 crowd-pleasers for 2–8 players" },
  { title: "Watercolor travel sketch set", brand: "Atelier Nord", price: 4800, image: "🎨", merchant: "Atelier Nord", tags: ["art", "painting", "drawing", "travel"], description: "24 pans; 2 water brushes; A5 pad" },
  { title: "Spa day voucher", brand: "Haven Spa", price: 10500, image: "🛁", merchant: "Haven Spa", tags: ["wellness", "relax", "spa", "experience"], description: "Massage + thermal circuit" },
];

function demoCatalog(query: string, maxPrice: Cents, interests: string[]): GiftCandidate[] {
  const words = `${query} ${interests.join(" ")}`.toLowerCase();
  const scored = CATALOG.filter((i) => i.price <= maxPrice)
    .map((i) => ({ i, score: i.tags.reduce((s, t) => s + (words.includes(t) ? 2 : 0), 0) + (words.includes(i.title.split(" ")[0].toLowerCase()) ? 1 : 0) }))
    .sort((a, b) => b.score - a.score || b.i.price - a.i.price);
  return scored.slice(0, 8).map(({ i }) => ({
    id: `demo_${newId()}`,
    title: i.title,
    brand: i.brand,
    price: i.price,
    currency: "USD",
    image: i.image,
    merchant: i.merchant,
    source: "demo_catalog",
    description: i.description,
  }));
}
