"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { KittyView } from "@/lib/view";

export function useKitty(id: string) {
  const [k, setK] = useState<KittyView | null>(null);
  const [error, setError] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/kitties/${id}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      setK(j);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, [id]);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      await load();
      if (alive) timer.current = setTimeout(tick, 1200);
    };
    tick();
    return () => {
      alive = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [load]);

  const act = useCallback(
    async (body: Record<string, unknown>) => {
      const r = await fetch(`/api/kitties/${id}/act`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Action failed");
      setK(j);
      return j as KittyView;
    },
    [id],
  );

  return { k, error, act, reload: load };
}
