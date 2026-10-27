import { airedAt, minuteOf, snapshotAt } from "./derive";
import type { AppConfig, CatchUp, FactCheck, Overlay, Pack, Viewer } from "./types";

// Live mode: VITE_API_URL is the API origin (empty = same origin, or the Vite dev proxy).
// Static mode (VITE_STATIC=1, used for GitHub Pages): the app plays a pre-verified JSON export
// produced by `python -m dangote export`; only free-text fact-checking needs the live API.
export const BASE = import.meta.env.VITE_API_URL ?? "";
export const STATIC = import.meta.env.VITE_STATIC === "1";
const STATIC_ROOT = `${import.meta.env.BASE_URL}static-api`;

type Params = Record<string, string | number | boolean | undefined>;

export function query(params: Params): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") q.set(k, String(v));
  return q.toString();
}

const viewerParams = (v: Viewer): Params => ({ persona: v.persona, club: v.club, player: v.player, lang: v.lang });

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`${url.split("?")[0]} → ${res.status}`);
  return res.json() as Promise<T>;
}

// ---- static mode --------------------------------------------------------------------------

const matchCache = new Map<string, Promise<Omit<Pack, "overlays" | "trust" | "profile">>>();

async function staticPrepare(scenario: string, v: Viewer, signal?: AbortSignal): Promise<Pack> {
  if (!matchCache.has(scenario)) {
    const p = request<Omit<Pack, "overlays" | "trust" | "profile">>(`${STATIC_ROOT}/match/${scenario}.json`);
    p.catch(() => matchCache.delete(scenario));
    matchCache.set(scenario, p);
  }
  const lang = ["en", "es", "sw"].includes(v.lang) ? v.lang : "en";
  const [match, view] = await Promise.all([
    matchCache.get(scenario)!,
    request<Pick<Pack, "overlays" | "trust" | "profile">>(
      `${STATIC_ROOT}/overlays/${scenario}/${v.persona}-${v.club || "neutral"}-${lang}.json`, { signal }),
  ]);
  return { ...match, ...view } as Pack;
}

const HEADER: Record<string, (m: number, h: string, hs: number, as: number, a: string) => string> = {
  en: (m, h, hs, as, a) => `Catch-up at ${m}': ${h} ${hs}-${as} ${a}.`,
  es: (m, h, hs, as, a) => `Resumen al minuto ${m}: ${h} ${hs}-${as} ${a}.`,
  sw: (m, h, hs, as, a) => `Muhtasari dakika ya ${m}: ${h} ${hs}-${as} ${a}.`,
};

/** Same ranking as the server's catch-up, built from the already-verified overlays. */
async function staticCatchUp(scenario: string, v: Viewer, minute: number): Promise<CatchUp> {
  const pack = await staticPrepare(scenario, v);
  const t = Math.min(pack.duration, minute * 60);
  const pool = airedAt(pack.overlays, t).reverse();
  const goals = pool.filter((o) => o.kind === "goal").slice(-2);
  const story = pool.filter((o) => o.kind === "tactical_story" || o.kind === "regime_shift")
    .sort((a, b) => Number(a.kind === "tactical_story") - Number(b.kind === "tactical_story") || a.impact - b.impact).slice(-1);
  const momentum = pool.filter((o) => o.kind === "momentum_swing" && t - o.trigger.t <= 600).slice(-1);
  const moments = pool.filter((o) => ["big_chance", "line_breaking_pass", "danger_removed"].includes(o.kind) && o.priority >= 2)
    .sort((a, b) => Number(b.team === v.club) - Number(a.team === v.club) || b.impact - a.impact);
  const chosen: Overlay[] = [];
  for (const o of [...goals, ...story, ...momentum, ...moments]) if (!chosen.includes(o) && chosen.length < 4) chosen.push(o);
  chosen.sort((a, b) => a.trigger.t - b.trigger.t);
  const snap = snapshotAt(pack, t);
  const head = HEADER[v.lang] ?? HEADER.en;
  return {
    type: "catch_up",
    minute: minuteOf(t),
    header: head(minuteOf(t), pack.meta.home.name, snap.score.home, snap.score.away, pack.meta.away.name),
    items: chosen.map((o) => ({ minute: o.trigger.minute, kind: o.kind, text: o.text, insight_id: o.insight_id })),
    trust: [],
  };
}

// ---- public API ---------------------------------------------------------------------------

export const api = {
  config: (signal?: AbortSignal) =>
    request<AppConfig>(STATIC ? `${STATIC_ROOT}/config.json` : `${BASE}/api/config`, { signal }),
  prepare: (scenario: string, viewer: Viewer, signal?: AbortSignal) =>
    STATIC ? staticPrepare(scenario, viewer, signal)
      : request<Pack>(`${BASE}/api/matches/prepare?${query({ scenario, ...viewerParams(viewer) })}`, { signal }),
  catchUp: (scenario: string, viewer: Viewer, minute: number) =>
    STATIC ? staticCatchUp(scenario, viewer, minute)
      : request<CatchUp>(`${BASE}/api/catchup?${query({ scenario, minute, ...viewerParams(viewer) })}`),
  factCheck: (scenario: string, minute: number, text: string, lang = "en") =>
    STATIC
      ? Promise.reject(new Error("The fact-check desk runs on the live API. Start the backend (python -m dangote serve) or open the Azure-hosted app."))
      : request<FactCheck>(`${BASE}/api/factcheck`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ scenario, minute, text, lang }),
        }),
};
