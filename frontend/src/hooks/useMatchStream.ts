import { useCallback, useEffect, useRef, useState } from "react";
import type { Overlay, Tick, TickEvent, TrustRecord } from "../lib/types";

export type StreamStatus = "idle" | "connecting" | "live" | "ended" | "error";

const MAX_TRUST = 80;
const MAX_OVERLAYS = 120;
const MAX_TRAIL = 8;

export interface MatchStream {
  status: StreamStatus;
  tick: Tick | null;
  trail: TickEvent[];
  overlays: Overlay[]; // newest first
  trust: TrustRecord[]; // newest first
  counts: { verified: number; blocked: number };
  start: (url: string) => void;
  stop: () => void;
}

/**
 * Subscribes to the SSE match stream. Events can arrive faster than the screen refreshes at
 * high replay speeds, so they are buffered and flushed once per animation frame: at most one
 * React render per frame, however busy the match gets.
 */
export function useMatchStream(): MatchStream {
  const [status, setStatus] = useState<StreamStatus>("idle");
  const [tick, setTick] = useState<Tick | null>(null);
  const [trail, setTrail] = useState<TickEvent[]>([]);
  const [overlays, setOverlays] = useState<Overlay[]>([]);
  const [trust, setTrust] = useState<TrustRecord[]>([]);
  const [counts, setCounts] = useState({ verified: 0, blocked: 0 });

  const es = useRef<EventSource | null>(null);
  const frame = useRef<number | null>(null);
  const buf = useRef({ tick: null as Tick | null, trail: [] as TickEvent[], overlays: [] as Overlay[], trust: [] as TrustRecord[] });

  const flush = useCallback(() => {
    frame.current = null;
    const b = buf.current;
    if (b.tick) setTick(b.tick);
    if (b.trail.length) {
      const fresh = b.trail;
      setTrail((t) => [...t, ...fresh].slice(-MAX_TRAIL));
    }
    if (b.overlays.length) {
      const fresh = b.overlays.reverse();
      setOverlays((o) => [...fresh, ...o].slice(0, MAX_OVERLAYS));
    }
    if (b.trust.length) {
      const fresh = b.trust.reverse();
      const v = fresh.filter((r) => r.status === "verified").length;
      const x = fresh.filter((r) => r.status === "blocked").length;
      setCounts((c) => ({ verified: c.verified + v, blocked: c.blocked + x }));
      setTrust((t) => [...fresh, ...t].slice(0, MAX_TRUST));
    }
    buf.current = { tick: null, trail: [], overlays: [], trust: [] };
  }, []);

  const schedule = useCallback(() => {
    if (frame.current === null) frame.current = requestAnimationFrame(flush);
  }, [flush]);

  const stop = useCallback(() => {
    es.current?.close();
    es.current = null;
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
  }, []);

  const start = useCallback(
    (url: string) => {
      stop();
      buf.current = { tick: null, trail: [], overlays: [], trust: [] };
      setTick(null);
      setTrail([]);
      setOverlays([]);
      setTrust([]);
      setCounts({ verified: 0, blocked: 0 });
      setStatus("connecting");

      const source = new EventSource(url);
      es.current = source;
      source.addEventListener("hello", () => setStatus("live"));
      source.addEventListener("joined", (e) => {
        buf.current.tick = JSON.parse((e as MessageEvent).data).state as Tick;
        schedule();
      });
      source.addEventListener("tick", (e) => {
        const t = JSON.parse((e as MessageEvent).data) as Tick;
        buf.current.tick = t;
        const ev = t.event;
        if (ev && ev.x !== null && (ev.type === "pass" || ev.type === "carry" || ev.type === "shot")) buf.current.trail.push(ev);
        schedule();
      });
      source.addEventListener("overlay", (e) => {
        buf.current.overlays.push(JSON.parse((e as MessageEvent).data) as Overlay);
        schedule();
      });
      source.addEventListener("trust", (e) => {
        buf.current.trust.push(JSON.parse((e as MessageEvent).data) as TrustRecord);
        schedule();
      });
      source.addEventListener("end", () => {
        flush();
        setStatus("ended");
        source.close();
      });
      source.onerror = () => {
        if (source.readyState === EventSource.CLOSED) setStatus((s) => (s === "ended" ? s : "error"));
        source.close();
      };
    },
    [flush, schedule, stop],
  );

  useEffect(() => stop, [stop]);

  return { status, tick, trail, overlays, trust, counts, start, stop };
}
