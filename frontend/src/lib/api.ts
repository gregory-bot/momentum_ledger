import type { AppConfig, CatchUp, Playback, Viewer } from "./types";

// Empty in dev (Vite proxies /api) and in production (served from the same origin).
const BASE = import.meta.env.VITE_API_URL ?? "";

type Params = Record<string, string | number | boolean | undefined>;

export function query(params: Params): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") q.set(k, String(v));
  }
  return q.toString();
}

export function viewerParams(v: Viewer): Params {
  return { persona: v.persona, club: v.club, player: v.player, lang: v.lang };
}

async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { signal });
  if (!res.ok) throw new Error(`${path} failed: ${res.status}`);
  return res.json() as Promise<T>;
}

export const api = {
  config: (signal?: AbortSignal) => get<AppConfig>("/api/config", signal),
  catchUp: (viewer: Viewer, minute: number, signal?: AbortSignal) =>
    get<CatchUp>(`/api/catchup?${query({ ...viewerParams(viewer), minute })}`, signal),
  streamUrl: (viewer: Viewer, playback: Playback, ticks = true) =>
    `${BASE}/api/stream?${query({ ...viewerParams(viewer), speed: playback.speed, start: playback.start, ticks })}`,
};
