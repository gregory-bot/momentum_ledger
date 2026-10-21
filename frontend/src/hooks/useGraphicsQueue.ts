import { useEffect, useRef, useState } from "react";
import type { Overlay } from "../lib/types";

/**
 * Plays overlays one at a time like a vision mixer: the highest priority first, each held
 * for a time scaled to replay speed, and shortened when a backlog builds up.
 */
export function useGraphicsQueue(overlays: Overlay[], speed: number): Overlay | null {
  const [current, setCurrent] = useState<Overlay | null>(null);
  const queue = useRef<Overlay[]>([]);
  const seen = useRef(new Set<string>());
  const timer = useRef<number | null>(null);

  useEffect(() => {
    if (overlays.length === 0) {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      queue.current = [];
      seen.current.clear();
      setCurrent(null);
      return;
    }
    for (const o of overlays) {
      if (seen.current.has(o.id)) break; // newest first: stop at the first one already queued
      seen.current.add(o.id);
      queue.current.push(o);
    }
    queue.current.sort((a, b) => b.priority - a.priority || a.trigger.t - b.trigger.t);
    if (!timer.current) advance();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overlays]);

  function advance() {
    const next = queue.current.shift() ?? null;
    setCurrent(next);
    if (!next) {
      timer.current = null;
      return;
    }
    const base = Math.max(2500, Math.min(7000, (next.duration_s * 6000) / Math.sqrt(speed)));
    timer.current = window.setTimeout(advance, queue.current.length > 3 ? base / 2 : base);
  }

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  return current;
}
