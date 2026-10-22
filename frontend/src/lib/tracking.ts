// Synthetic positional model: where all 22 players and the ball are at any moment t.
//
// The event stream only records on-ball actions, so off-ball positions come from a formation
// model: each player holds a slot that slides with the ball, compresses when defending, and the
// nearest defender presses. The on-ball player is always exactly where the event says.

import { lastIndexAtOrBefore } from "./derive";
import type { MatchMeta, Pack, PackEvent, Player, Side } from "./types";

export interface Pin {
  id: string;
  number: number;
  name: string;
  side: Side;
  x: number;
  y: number;
  role: "holder" | "presser" | "runner" | "none";
}

export interface Frame {
  ball: { x: number; y: number; z: number };
  players: Pin[];
  holder: string | null;
  possession: Side | null;
}

const L = 105;
const W = 68;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const lerp = (a: number, b: number, s: number) => a + (b - a) * s;

// Base 4-3-3 shape for a team attacking toward x = 105.
const SHAPE: Record<string, [number, number][]> = {
  GK: [[5, 34]],
  DEF: [[24, 9], [21, 26], [21, 42], [24, 59]],
  MID: [[44, 18], [40, 34], [44, 50]],
  FWD: [[64, 12], [68, 34], [64, 56]],
};

interface Slot {
  player: Player;
  side: Side;
  base: [number, number];
  phase: number;
}

/** Slots for the eleven on the pitch at t (substitutes inherit the slot they replace). */
export function lineupAt(meta: MatchMeta, events: PackEvent[], t: number): Slot[] {
  const slots: Slot[] = [];
  for (const side of ["home", "away"] as Side[]) {
    const team = meta[side];
    const count: Record<string, number> = {};
    const byId = new Map([...team.players, ...team.bench].map((p) => [p.id, p]));
    const xi = [...team.players];
    for (const e of events) {
      if (e.t > t) break;
      if (e.type === "substitution" && e.team === side && e.player_id && e.off_id) {
        const i = xi.findIndex((p) => p.id === e.off_id);
        const on = byId.get(e.player_id);
        if (i >= 0 && on) xi[i] = on;
      }
    }
    team.players.forEach((orig, i) => {
      const role = orig.role;
      const k = (count[role] = (count[role] ?? -1) + 1);
      const base = SHAPE[role][Math.min(k, SHAPE[role].length - 1)];
      slots.push({ player: xi[i], side, base, phase: (orig.number * 1.7) % 6.28 });
    });
  }
  return slots;
}

const toAbs = (side: Side, x: number, y: number): [number, number] => (side === "home" ? [x, y] : [L - x, W - y]);
const toRel = toAbs;

function startOf(e: PackEvent): [number, number] {
  return [e.x ?? L / 2, e.y ?? W / 2];
}
function endOf(e: PackEvent): [number, number] {
  return [e.end_x ?? e.x ?? L / 2, e.end_y ?? e.y ?? W / 2];
}

const BALL_EVENTS = new Set(["pass", "carry", "shot", "tackle", "interception", "possession_change", "goal", "pressure"]);

function around(ev: PackEvent[], t: number) {
  let i = lastIndexAtOrBefore(ev, t, (e) => e.t);
  while (i > 0 && !BALL_EVENTS.has(ev[i].type)) i--;
  const e = i >= 0 ? ev[i] : undefined;
  let next: PackEvent | undefined;
  for (let j = i + 1; j < ev.length; j++) if (BALL_EVENTS.has(ev[j].type)) { next = ev[j]; break; }
  return { i, e, next };
}

/** Ball position at t, plus how far through its current flight it is (1 = landed). */
export function ballAt(ev: PackEvent[], t: number) {
  const { e, next } = around(ev, t);
  let ball = { x: L / 2, y: W / 2, z: 0 };
  let flight = 1;
  if (e) {
    const [sx, sy] = startOf(e);
    const [ex, ey] = endOf(e);
    const len = Math.hypot(ex - sx, ey - sy);
    const travel = e.type === "pass" || e.type === "shot" ? clamp(len / 22, 0.4, 2.2) : e.type === "carry" ? clamp(len / 6, 0.8, 3) : 0;
    const dt = t - e.t;
    if (e.type === "goal") {
      ball = { x: e.team === "home" ? L + 1 : -1, y: clamp(e.y ?? 34, 31, 37), z: 0.6 };
    } else if (travel && dt < travel) {
      flight = dt / travel;
      const lob = e.type === "pass" && len > 28 ? len / 9 : e.type === "shot" ? 0.8 : 0;
      ball = { x: lerp(sx, ex, flight), y: lerp(sy, ey, flight), z: 4 * lob * flight * (1 - flight) };
    } else if (next && e.type !== "shot") {
      const [nx, ny] = startOf(next);
      const s = clamp((dt - travel) / Math.max(0.1, next.t - e.t - travel), 0, 1);
      ball = { x: lerp(ex, nx, s), y: lerp(ey, ny, s), z: 0 };
    } else {
      ball = { x: ex, y: ey, z: 0 };
    }
  }

  return { ball, flight };
}

export function frameAt(pack: Pack, slots: Slot[], t: number): Frame {
  const ev = pack.events;
  const { i, e } = around(ev, t);
  const { ball, flight } = ballAt(ev, t);
  // Teams shuffle with where the ball has *been* over the last few seconds, not its instant
  // position, the way a defensive block slides rather than snapping to every pass.
  const recent = [ball, ballAt(ev, t - 1.5).ball, ballAt(ev, t - 3).ball, ballAt(ev, t - 4.5).ball];
  const shape = { x: recent.reduce((a, b) => a + b.x, 0) / 4, y: recent.reduce((a, b) => a + b.y, 0) / 4 };

  // ---- who has it --------------------------------------------------------------------------
  let k = i;
  while (k > 0 && ev[k].type === "pressure") k--;
  const owner = k >= 0 ? ev[k] : undefined;
  let holder: string | null = null;
  let runner: string | null = null;
  let possession: Side | null = owner?.team ?? null;
  if (owner) {
    if (owner.type === "pass") {
      if (owner.outcome === "success" && owner.receiver_id) {
        if (owner === e && flight < 1) runner = owner.receiver_id;
        else holder = owner.receiver_id;
      }
    } else if (owner.type !== "shot" && owner.type !== "goal") holder = owner.player_id ?? null;
  }
  if (holder) possession = slots.find((s) => s.player.id === holder)?.side ?? possession;
  const presser = e?.type === "pressure" && t - e.t < 4 ? e.player_id ?? null : null;
  // Everyone involved in the plays coming up in the next few seconds starts moving toward them
  // early (tacklers, interceptors, pressers, and the target of each pass), so they arrive as the
  // play happens instead of appearing at the ball.
  const LEAD = 5;
  const plans = new Map<string, { x: number; y: number; w: number }>();
  for (let j = i + 1, n = 0; j < ev.length && n < 6; j++) {
    const u = ev[j];
    if (u.t - t >= LEAD) break;
    if (!BALL_EVENTS.has(u.type)) continue;
    n++;
    const lead = clamp(1 - (u.t - t) / LEAD, 0, 1);
    if (u.player_id && u.player_id !== holder && !plans.has(u.player_id)) {
      const [px, py] = startOf(u);
      plans.set(u.player_id, { x: px, y: py, w: Math.min(1, lead * 1.15) });
    }
    if (u.type === "pass" && u.outcome === "success" && u.receiver_id && !plans.has(u.receiver_id)) {
      const [ex, ey] = endOf(u);
      plans.set(u.receiver_id, { x: ex, y: ey, w: lead * lead * (3 - 2 * lead) * 0.85 });
    }
  }

  // ---- everyone else -------------------------------------------------------------------------
  const pins: Pin[] = slots.map((s) => {
    const [bx, by] = toRel(s.side, shape.x, shape.y);
    const attacking = possession === s.side;
    const [ox, oy] = s.base;
    let x: number;
    let y: number;
    if (s.player.role === "GK") {
      x = clamp(5 + (bx - 52.5) * 0.1, 2, 16);
      y = 34 + (by - 34) * 0.2;
    } else {
      const shift = (bx - 52.5) * (attacking ? 0.62 : 0.5) + (attacking ? 6 : -6);
      const anchor = 40;
      x = anchor + (ox - anchor) * (attacking ? 1.08 : 0.78) + shift;
      y = oy + (by - oy) * (attacking ? 0.12 : 0.3);
    }
    x += Math.sin(t * 0.21 + s.phase) * 1.4;
    y += Math.cos(t * 0.17 + s.phase * 1.3) * 1.2;
    let [ax, ay] = toAbs(s.side, clamp(x, 1.5, 103.5), clamp(y, 1.5, 66.5));
    let role: Pin["role"] = "none";
    if (s.player.id === holder) {
      [ax, ay] = [ball.x, ball.y];
      role = "holder";
    } else if (s.player.id === runner && owner) {
      // Continue from where the anticipation run left him (85% of the way) to the landing spot.
      const [ex, ey] = endOf(owner);
      const sx = lerp(ax, ex, 0.85), sy = lerp(ay, ey, 0.85);
      ax = lerp(sx, ex, clamp(flight * 1.3, 0, 1));
      ay = lerp(sy, ey, clamp(flight * 1.3, 0, 1));
      role = "runner";
    } else if (plans.has(s.player.id)) {
      const plan = plans.get(s.player.id)!;
      ax = lerp(ax, plan.x, plan.w);
      ay = lerp(ay, plan.y, plan.w);
      role = "runner";
    } else if (s.player.id === presser) {
      ax = lerp(ax, ball.x, 0.85);
      ay = lerp(ay, ball.y + 1.5, 0.85);
      role = "presser";
    }
    return { id: s.player.id, number: s.player.number, name: s.player.name, side: s.side, x: ax, y: ay, role };
  });

  // The defender nearest the ball closes it down even without a logged pressure event.
  if (!presser && possession) {
    let best: Pin | null = null;
    let bd = 1e9;
    for (const p of pins) {
      if (p.side === possession || p.role !== "none") continue;
      const d = Math.hypot(p.x - ball.x, p.y - ball.y);
      if (d < bd) { bd = d; best = p; }
    }
    if (best && bd < 22) {
      best.x = lerp(best.x, ball.x, 0.55);
      best.y = lerp(best.y, ball.y, 0.55);
    }
  }
  return { ball, players: pins, holder, possession };
}
