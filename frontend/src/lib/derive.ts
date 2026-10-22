// Pure functions that read the match pack at any moment t (seconds from kickoff).
// Everything is cheap (binary search or one linear pass), so scrubbing stays instant.

import type { Overlay, Pack, PackEvent, Side, Snapshot, TrustRecord } from "./types";

export function lastIndexAtOrBefore<T>(items: T[], t: number, at: (x: T) => number): number {
  let lo = 0;
  let hi = items.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (at(items[mid]) <= t) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

export const snapshotAt = (pack: Pack, t: number): Snapshot =>
  pack.timeline[Math.max(0, lastIndexAtOrBefore(pack.timeline, t, (s) => s.t))];

const ACTIONS = new Set(["pass", "carry", "shot"]);

export function pitchAt(pack: Pack, t: number) {
  const i = lastIndexAtOrBefore(pack.events, t, (e) => e.t);
  let ball: [number, number] | null = null;
  const trail: PackEvent[] = [];
  for (let j = i; j >= 0 && trail.length < 8; j--) {
    const e = pack.events[j];
    if (!ball && e.x !== undefined) ball = [e.end_x ?? e.x, e.end_y ?? e.y!];
    if (ACTIONS.has(e.type) && t - e.t < 40) trail.unshift(e);
  }
  return { ball, trail, last: i >= 0 ? pack.events[i] : undefined, index: i };
}

/** Overlays already aired at t, newest first. */
export function airedAt(overlays: Overlay[], t: number): Overlay[] {
  const out: Overlay[] = [];
  for (const o of overlays) if (o.trigger.t <= t) out.push(o);
  return out.reverse();
}

/** What is on screen right now: the newest overlay still inside its hold time (in real seconds). */
export function onAirAt(aired: Overlay[], t: number, speed: number): Overlay | null {
  const o = aired[0];
  if (!o) return null;
  const hold = (o.priority >= 3 ? 7 : 5) * Math.max(speed, 1);
  return t - o.trigger.t <= hold ? o : null;
}

export const trustAt = (trust: TrustRecord[], minute: number) => trust.filter((r) => r.minute <= minute);

export interface TeamLine {
  passes: number;
  completed: number;
  shots: number;
  onTarget: number;
  xg: number;
  pressures: number;
  defActions: number;
  possession: number;
}

export interface PlayerLine {
  id: string;
  name: string;
  side: Side;
  passes: number;
  completed: number;
  shots: number;
  xg: number;
  goals: number;
  defActions: number;
  pressures: number;
  touches: number;
  avg: [number, number] | null;
}

/** Team and player stats from the raw events up to t. */
export function statsAt(pack: Pack, t: number) {
  const team = (): TeamLine => ({ passes: 0, completed: 0, shots: 0, onTarget: 0, xg: 0, pressures: 0, defActions: 0, possession: 0 });
  const teams: Record<Side, TeamLine> = { home: team(), away: team() };
  const players = new Map<string, PlayerLine & { sx: number; sy: number; n: number }>();
  const sideOf = new Map<string, Side>();
  for (const side of ["home", "away"] as Side[])
    for (const p of [...pack.meta[side].players, ...pack.meta[side].bench]) sideOf.set(p.id, side);

  const held: Record<Side, number> = { home: 0, away: 0 };
  let possSide: Side | null = null;
  let possStart = 0;
  const shots: PackEvent[] = [];

  for (const e of pack.events) {
    if (e.t > t) break;
    if (e.type === "possession_change" && e.team) {
      if (possSide) held[possSide] += e.t - possStart;
      possSide = e.team;
      possStart = e.t;
    }
    const tl = e.team ? teams[e.team] : null;
    if (tl) {
      if (e.type === "pass") {
        tl.passes++;
        if (e.outcome === "success") tl.completed++;
      } else if (e.type === "shot") {
        tl.shots++;
        if (e.outcome === "goal" || e.outcome === "saved") tl.onTarget++;
        tl.xg += e.xg ?? 0;
        shots.push(e);
      } else if (e.type === "pressure") tl.pressures++;
      else if (e.type === "tackle" || e.type === "interception") tl.defActions++;
    }
    if (!e.player_id || !e.player) continue;
    let p = players.get(e.player_id);
    if (!p) {
      p = { id: e.player_id, name: e.player, side: sideOf.get(e.player_id) ?? "home", passes: 0, completed: 0, shots: 0,
        xg: 0, goals: 0, defActions: 0, pressures: 0, touches: 0, avg: null, sx: 0, sy: 0, n: 0 };
      players.set(e.player_id, p);
    }
    if (e.x !== undefined && e.type !== "goal") {
      p.touches++;
      p.sx += e.x;
      p.sy += e.y!;
      p.n++;
    }
    if (e.type === "pass") {
      p.passes++;
      if (e.outcome === "success") p.completed++;
    } else if (e.type === "shot") {
      p.shots++;
      p.xg += e.xg ?? 0;
    } else if (e.type === "goal") p.goals++;
    else if (e.type === "tackle" || e.type === "interception") p.defActions++;
    else if (e.type === "pressure") p.pressures++;
  }
  if (possSide) held[possSide] += Math.max(0, t - possStart);
  const total = held.home + held.away || 1;
  teams.home.possession = Math.round((100 * held.home) / total);
  teams.away.possession = 100 - teams.home.possession;

  const list: PlayerLine[] = [...players.values()].map(({ sx, sy, n, ...p }) => ({
    ...p,
    xg: Math.round(p.xg * 100) / 100,
    avg: n ? [sx / n, sy / n] : null,
  }));
  return { teams, players: list, shots };
}

/** Cumulative xG per side as step points, for the xG race chart. */
export function xgRace(pack: Pack, t: number) {
  const pts: Record<Side, [number, number][]> = { home: [[0, 0]], away: [[0, 0]] };
  const tot: Record<Side, number> = { home: 0, away: 0 };
  for (const e of pack.events) {
    if (e.t > t) break;
    if (e.type === "shot" && e.team) {
      pts[e.team].push([e.t, tot[e.team]]);
      tot[e.team] += e.xg ?? 0;
      pts[e.team].push([e.t, tot[e.team]]);
    }
  }
  pts.home.push([t, tot.home]);
  pts.away.push([t, tot.away]);
  return { pts, tot };
}

export function clockOf(t: number): string {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export const minuteOf = (t: number) => Math.floor(t / 60) + 1;
