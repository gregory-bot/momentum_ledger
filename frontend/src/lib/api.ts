import type { AppConfig, CatchUp, FactCheck, Pack, Viewer } from "./types";

// Empty in dev (Vite proxies /api and /mcp) and in production (same origin).
export const BASE = import.meta.env.VITE_API_URL ?? "";

type Params = Record<string, string | number | boolean | undefined>;

export function query(params: Params): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") q.set(k, String(v));
  return q.toString();
}

const viewerParams = (v: Viewer): Params => ({ persona: v.persona, club: v.club, player: v.player, lang: v.lang });

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, init);
  if (!res.ok) throw new Error(`${path.split("?")[0]} → ${res.status}`);
  return res.json() as Promise<T>;
}

export const api = {
  config: (signal?: AbortSignal) => request<AppConfig>("/api/config", { signal }),
  prepare: (scenario: string, viewer: Viewer, signal?: AbortSignal) =>
    request<Pack>(`/api/matches/prepare?${query({ scenario, ...viewerParams(viewer) })}`, { signal }),
  catchUp: (scenario: string, viewer: Viewer, minute: number) =>
    request<CatchUp>(`/api/catchup?${query({ scenario, minute, ...viewerParams(viewer) })}`),
  factCheck: (scenario: string, minute: number, text: string, lang = "en") =>
    request<FactCheck>("/api/factcheck", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scenario, minute, text, lang }),
    }),
  raw: async (path: string, init?: RequestInit) => {
    const t0 = performance.now();
    const res = await fetch(`${BASE}${path}`, init);
    const text = await res.text();
    return { status: res.status, ms: Math.round(performance.now() - t0), text, type: res.headers.get("content-type") ?? "" };
  },
};
