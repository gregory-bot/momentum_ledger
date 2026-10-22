import { useEffect, useMemo, useRef, useState } from "react";
import { arc, lerp3, pathOf, polygonOf, project, view, type Camera, type V3 } from "../lib/camera";
import { lineupAt, frameAt, type Frame, type Pin } from "../lib/tracking";
import type { Pack, PackEvent, Side } from "../lib/types";

export type CamMode = "tactical" | "ball" | "player" | "territory";

const WIDTH = 1000;
const HEIGHT = 600;
const g = (x: number, y: number, z = 0): V3 => [x, y, z];

const TACTICAL: Camera = { pos: [52.5, -20, 64], target: [52.5, 37, 0], focal: 565 };

function desiredCamera(mode: CamMode, frame: Frame, follow: Pin | undefined): Camera {
  if (mode === "ball" || (mode === "player" && follow)) {
    const tx = mode === "player" && follow ? follow.x : frame.ball.x;
    const ty = mode === "player" && follow ? follow.y : frame.ball.y;
    const close = mode === "player";
    // Look from the near touchline, panned toward the nearer goal for a broadcast angle.
    const pan = (tx - 52.5) * 0.25;
    return {
      pos: [tx - pan - (close ? 6 : 10), ty - (close ? 20 : 30), close ? 12 : 19],
      target: [tx, ty + (close ? 2 : 4), 0],
      focal: close ? 760 : 700,
    };
  }
  return TACTICAL;
}

// ---- static pitch geometry (world space) ----
const OUTER = [g(0, 0), g(105, 0), g(105, 68), g(0, 68)];
const LINES: { pts: V3[]; closed?: boolean }[] = [
  { pts: OUTER, closed: true },
  { pts: [g(52.5, 0), g(52.5, 68)] },
  { pts: arc(52.5, 34, 9.15, 0, Math.PI * 2, 56), closed: true },
  { pts: [g(0, 13.84), g(16.5, 13.84), g(16.5, 54.16), g(0, 54.16)] },
  { pts: [g(105, 13.84), g(88.5, 13.84), g(88.5, 54.16), g(105, 54.16)] },
  { pts: [g(0, 24.84), g(5.5, 24.84), g(5.5, 43.16), g(0, 43.16)] },
  { pts: [g(105, 24.84), g(99.5, 24.84), g(99.5, 43.16), g(105, 43.16)] },
  { pts: arc(11, 34, 9.15, -0.9273, 0.9273, 20) },
  { pts: arc(94, 34, 9.15, Math.PI - 0.9273, Math.PI + 0.9273, 20) },
];
const SPOTS = [g(52.5, 34), g(11, 34), g(94, 34)];
const STRIPES = Array.from({ length: 14 }, (_, i) => [g(i * 7.5, 0), g((i + 1) * 7.5, 0), g((i + 1) * 7.5, 68), g(i * 7.5, 68)]);
const APRON = [g(-14, -9), g(119, -9), g(119, 77), g(-14, 77)];

function goal(x: number, back: number): V3[][] {
  const y0 = 30.34, y1 = 37.66, h = 2.44;
  const frame = [g(x, y0), g(x, y0, h), g(x, y1, h), g(x, y1)];
  const rear = [g(back, y0), g(back, y0, h * 0.85), g(back, y1, h * 0.85), g(back, y1)];
  const net: V3[][] = [];
  for (let i = 1; i < 8; i++) {
    const y = y0 + ((y1 - y0) * i) / 8;
    net.push([g(x, y, h), g(back, y, h * 0.85), g(back, y)]);
  }
  for (let i = 1; i < 4; i++) {
    const z = (h * i) / 4;
    net.push([g(back, y0, z * 0.85), g(back, y1, z * 0.85)]);
  }
  return [frame, rear, [g(x, y0, h), g(back, y0, h * 0.85)], [g(x, y1, h), g(back, y1, h * 0.85)],
    [g(x, y0), g(back, y0)], [g(x, y1), g(back, y1)], ...net];
}
const GOALS = [...goal(0, -2.2), ...goal(105, 107.2)];

const COLS = 12;
const ROWS = 8;

interface Props {
  pack: Pack;
  t: number;
  playing?: boolean;
  mode: CamMode;
  followId: string | null;
  onFollow: (id: string) => void;
}

export function Pitch3D({ pack, t, playing = false, mode, followId, onFollow }: Props) {
  const colors: Record<Side, string> = { home: pack.meta.home.color, away: pack.meta.away.color };
  const slots = useMemo(() => lineupAt(pack.meta, pack.events, t),
    // the eleven only change at substitutions: recompute once per match minute
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pack, Math.floor(t / 60)]);
  const target = frameAt(pack, slots, t);
  const follow = target.players.find((p) => p.id === followId);

  // Smooth players and camera in real time so cuts and possession switches glide.
  const smooth = useRef<{ pos: Map<string, [number, number]>; cam: Camera | null; last: number; lastT: number }>({
    pos: new Map(), cam: null, last: performance.now(), lastT: t,
  });
  const [, force] = useState(0);
  // On small screens the 1000-px-wide scene is scaled down; grow pins so numbers stay readable.
  const svgRef = useRef<SVGSVGElement>(null);
  const [scale, setScale] = useState(() => Math.max(1, Math.min(2, 760 / Math.max(320, window.innerWidth - 32))));
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setScale(Math.max(1, Math.min(2, 760 / e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const want = desiredCamera(mode, target, follow);
  const s = smooth.current;
  const now = performance.now();
  const dt = Math.min(0.1, (now - s.last) / 1000);
  s.last = now;
  const kc = 1 - Math.exp(-dt * 3.5);
  // Same rule as the WebGL monitor: human top speeds in match time; scrubs snap.
  const dtm = t - s.lastT;
  s.lastT = t;
  const snap = dtm < 0 || dtm > 3 || (!playing && dtm !== 0);
  let moving = false;
  const players = target.players.map((p) => {
    const prev = s.pos.get(p.id);
    let x = p.x, y = p.y;
    if (prev && !snap) {
      const gap = Math.hypot(p.x - prev[0], p.y - prev[1]);
      const step = Math.min(gap, (p.role === "none" ? 8.5 : 10.5) * dtm);
      if (gap > 1e-6) {
        x = prev[0] + ((p.x - prev[0]) / gap) * step;
        y = prev[1] + ((p.y - prev[1]) / gap) * step;
      }
    }
    s.pos.set(p.id, [x, y]);
    return { ...p, x, y };
  });
  const from = s.cam ?? want; // the first frame starts on the requested camera
  const cam: Camera = {
    pos: lerp3(from.pos, want.pos, kc),
    target: lerp3(from.target, want.target, kc),
    focal: from.focal + (want.focal - from.focal) * kc,
  };
  if (Math.hypot(...cam.pos.map((v, i) => v - want.pos[i]) as V3) > 0.05) moving = true;
  s.cam = cam;

  // Keep animating while anything is still settling (e.g. paused + camera switch).
  useEffect(() => {
    if (!moving) return;
    const id = requestAnimationFrame(() => force((n) => n + 1));
    return () => cancelAnimationFrame(id);
  });

  const v = view(cam, WIDTH, HEIGHT);

  const territory = useMemo(() => {
    if (mode !== "territory") return [];
    const grid = Array.from({ length: COLS * ROWS }, () => ({ home: 0, away: 0 }));
    const evs: PackEvent[] = pack.events;
    for (const e of evs) {
      if (e.t > t) break;
      if (e.t < t - 600 || e.x === undefined || !e.team) continue;
      const c = Math.min(COLS - 1, Math.floor((e.x / 105) * COLS));
      const r = Math.min(ROWS - 1, Math.floor((e.y! / 68) * ROWS));
      grid[r * COLS + c][e.team]++;
    }
    const max = Math.max(1, ...grid.map((c) => c.home + c.away));
    return grid.map((c, i) => ({ ...c, i, max }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, pack, Math.floor(t / 5)]);

  const pins = players
    .map((p) => {
      const foot = project(v, g(p.x, p.y));
      const head = project(v, g(p.x, p.y, 2.6));
      return foot && head ? { p, foot, head, size: Math.max(9 * scale, Math.min(19 * scale, (v.focal * 1.15 * scale) / foot.depth)) } : null;
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .sort((a, b) => b.foot.depth - a.foot.depth);
  const ball = project(v, g(target.ball.x, target.ball.y, target.ball.z + 0.11));
  const ballShadow = project(v, g(target.ball.x, target.ball.y));
  const closeCam = mode === "ball" || mode === "player";

  return (
    <svg ref={svgRef} className="pitch3d" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="xMidYMid slice" role="img" aria-label="Broadcast monitor">
      <defs>
        <radialGradient id="vignette" cx="50%" cy="45%" r="75%">
          <stop offset="60%" stopColor="#000" stopOpacity="0" />
          <stop offset="100%" stopColor="#000" stopOpacity=".55" />
        </radialGradient>
      </defs>
      <rect width={WIDTH} height={HEIGHT} className="sky" />
      <polygon points={polygonOf(v, APRON)} className="apron" />
      {STRIPES.map((q, i) => <polygon key={i} points={polygonOf(v, q)} className={i % 2 ? "turf-b" : "turf-a"} />)}

      {mode === "territory" && territory.map((c) => {
        const total = c.home + c.away;
        if (!total) return null;
        const side: Side = c.home >= c.away ? "home" : "away";
        const x0 = (c.i % COLS) * (105 / COLS), y0 = Math.floor(c.i / COLS) * (68 / ROWS);
        const share = Math.max(c.home, c.away) / total;
        return (
          <polygon key={c.i} fill={colors[side]} opacity={0.1 + 0.6 * (total / c.max) * (share - 0.4)}
            points={polygonOf(v, [g(x0 + 0.4, y0 + 0.4), g(x0 + 105 / COLS - 0.4, y0 + 0.4), g(x0 + 105 / COLS - 0.4, y0 + 68 / ROWS - 0.4), g(x0 + 0.4, y0 + 68 / ROWS - 0.4)])} />
        );
      })}

      <g className="lines3d">
        {LINES.map((l, i) => <path key={i} d={pathOf(v, l.pts, l.closed)} />)}
        {SPOTS.map((p, i) => {
          const s2 = project(v, p);
          return s2 ? <circle key={i} cx={s2.x} cy={s2.y} r={Math.max(1.2, 160 / s2.depth)} className="spot" /> : null;
        })}
      </g>
      <g className="goals3d">{GOALS.map((pts, i) => <path key={i} d={pathOf(v, pts)} className={i % 16 < 6 ? "frame" : "net"} />)}</g>

      {ballShadow && <ellipse cx={ballShadow.x} cy={ballShadow.y} rx={Math.max(2, 260 / ballShadow.depth)} ry={Math.max(1, 90 / ballShadow.depth)} className="shadow" />}

      {pins.map(({ p, foot, head, size }) => {
        const focused = p.id === followId;
        const holder = p.role === "holder";
        const label = focused || (closeCam && holder);
        return (
          <g key={p.id} className={`pin ${focused ? "focused" : ""}`} onClick={() => onFollow(p.id)}>
            <ellipse cx={foot.x} cy={foot.y} rx={size * 0.9} ry={size * 0.32} className="shadow" />
            {(holder || focused) && (
              <ellipse cx={foot.x} cy={foot.y} rx={size * 1.35} ry={size * 0.5} className={focused ? "ring-focus" : "ring-ball"} />
            )}
            <line x1={foot.x} y1={foot.y} x2={head.x} y2={head.y} stroke={colors[p.side]} strokeWidth={Math.max(1.5, size * 0.18)} />
            <circle cx={head.x} cy={head.y} r={size} fill={colors[p.side]} className="head" />
            <text x={head.x} y={head.y} dy="0.35em" fontSize={size * 0.95} className="num">{p.number}</text>
            {label && (
              <text x={head.x} y={head.y - size - 6} fontSize={Math.max(11, size * 0.7)} className="name">{p.name}</text>
            )}
            <title>{`#${p.number} ${p.name}: click to follow`}</title>
          </g>
        );
      })}

      {ball && <circle cx={ball.x} cy={ball.y} r={Math.max(2.5, Math.min(9, (v.focal * 0.22) / ball.depth))} className="ball3d" />}
      <rect width={WIDTH} height={HEIGHT} fill="url(#vignette)" pointerEvents="none" />
    </svg>
  );
}
