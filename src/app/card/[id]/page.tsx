import Link from "next/link";
import { KittyMark } from "@/components/Logo";
import { getKitty } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function CardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const k = getKitty(id);
  if (!k?.card) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6 text-ink-2">
        The card isn&apos;t ready yet. <Link href={`/k/${id}`} className="ml-2 underline">Back to the kitty</Link>
      </main>
    );
  }
  const c = k.card;
  return (
    <main className="min-h-screen bg-berry px-5 py-10 sm:py-16">
      <article className="mx-auto max-w-2xl rounded-[28px] bg-white p-8 shadow-[10px_10px_0_#172033] sm:p-12">
        <div className="flex items-center gap-2 text-sm font-semibold text-berry">
          <KittyMark size={22} /> From the whole group, via Kitty
        </div>
        <h1 className="display mt-6 text-5xl font-bold leading-[1.02] text-ink sm:text-6xl">{c.headline}</h1>
        <p className="mt-6 max-w-[56ch] text-lg leading-relaxed text-ink-2">{c.message}</p>
        {c.giftTitle && (
          <p className="mt-6 inline-flex items-center gap-2 rounded-full bg-berry-soft px-4 py-2 text-sm font-semibold text-berry-deep">🎁 {c.giftTitle}</p>
        )}
        <ul className="mt-10 grid gap-4 sm:grid-cols-2">
          {c.signatures.map((s) => (
            <li key={s.name} className="rounded-2xl bg-paper p-4">
              <p className="display text-xl font-semibold" style={{ color: s.color }}>
                {s.name}
              </p>
              {s.text && <p className="mt-1 text-sm leading-snug text-ink-2">{s.text}</p>}
            </li>
          ))}
        </ul>
      </article>
    </main>
  );
}
