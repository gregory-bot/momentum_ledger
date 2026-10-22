import { memo, useMemo } from "react";
import type { PackEvent, Side } from "../lib/types";

export type PitchMode = "live" | "territory";

interface Props {
  mode: PitchMode;
  ball: [number, number] | null;
  trail: PackEvent[];
  territory: PackEvent[];
  colors: Record<Side, string>;
}

const COLS = 12;
const ROWS = 8;

const Markings = memo(function Markings() {
  return (
    <g className="lines">
      <rect x="0" y="0" width="105" height="68" />
      <line x1="52.5" y1="0" x2="52.5" y2="68" />
      <circle cx="52.5" cy="34" r="9.15" />
      <circle cx="52.5" cy="34" r="0.45" className="spot" />
      <rect x="0" y="13.84" width="16.5" height="40.32" />
      <rect x="88.5" y="13.84" width="16.5" height="40.32" />
      <rect x="0" y="24.84" width="5.5" height="18.32" />
      <rect x="99.5" y="24.84" width="5.5" height="18.32" />
      <circle cx="11" cy="34" r="0.45" className="spot" />
      <circle cx="94" cy="34" r="0.45" className="spot" />
      <path d="M16.5 26.7 A9.15 9.15 0 0 1 16.5 41.3" />
      <path d="M88.5 26.7 A9.15 9.15 0 0 0 88.5 41.3" />
      <rect x="-1.6" y="30.34" width="1.6" height="7.32" className="goal" />
      <rect x="105" y="30.34" width="1.6" height="7.32" className="goal" />
    </g>
  );
});

const Turf = memo(function Turf() {
  return (
    <g>
      {Array.from({ length: 12 }, (_, i) => (
        <rect key={i} x={i * 8.75} y="0" width="8.75" height="68" className={i % 2 ? "turf-b" : "turf-a"} />
      ))}
    </g>
  );
});

/** Which side controlled each zone: every touch in the window votes for its team. */
function Territory({ events, colors }: { events: PackEvent[]; colors: Record<Side, string> }) {
  const cells = useMemo(() => {
    const grid = Array.from({ length: COLS * ROWS }, () => ({ home: 0, away: 0 }));
    for (const e of events) {
      if (e.x === undefined || !e.team) continue;
      const c = Math.min(COLS - 1, Math.floor((e.x / 105) * COLS));
      const r = Math.min(ROWS - 1, Math.floor((e.y! / 68) * ROWS));
      grid[r * COLS + c][e.team]++;
    }
    const max = Math.max(1, ...grid.map((g) => g.home + g.away));
    return grid.map((g, i) => ({ ...g, i, total: g.home + g.away, max }));
  }, [events]);

  return (
    <g>
      {cells.map((c) => {
        if (!c.total) return null;
        const side: Side = c.home >= c.away ? "home" : "away";
        const share = Math.max(c.home, c.away) / c.total;
        return (
          <rect key={c.i} x={(c.i % COLS) * (105 / COLS) + 0.4} y={Math.floor(c.i / COLS) * (68 / ROWS) + 0.4}
            width={105 / COLS - 0.8} height={68 / ROWS - 0.8} rx="1" fill={colors[side]}
            opacity={0.12 + 0.6 * (c.total / c.max) * (share - 0.4)} />
        );
      })}
    </g>
  );
}

export const Pitch = memo(function Pitch({ mode, ball, trail, territory, colors }: Props) {
  return (
    <svg className="pitch" viewBox="-3 -3 111 74" preserveAspectRatio="xMidYMid meet" role="img"
      aria-label={mode === "live" ? "Live pitch view" : "Territory over the last 10 minutes"}>
      <Turf />
      {mode === "territory" && <Territory events={territory} colors={colors} />}
      <Markings />
      {mode === "live" && (
        <g>
          {trail.map((ev, i) => {
            const shot = ev.type === "shot";
            const x2 = shot ? (ev.team === "home" ? 105 : 0) : (ev.end_x ?? ev.x!);
            const y2 = shot ? 34 : (ev.end_y ?? ev.y!);
            return (
              <line key={ev.id} x1={ev.x} y1={ev.y} x2={x2} y2={y2}
                stroke={shot ? "var(--amber)" : colors[ev.team ?? "home"]}
                className={`trail ${ev.outcome === "fail" ? "fail" : ""} ${shot ? "shot" : ""}`}
                opacity={0.25 + (0.75 * (i + 1)) / trail.length} />
            );
          })}
        </g>
      )}
      {ball && (
        <g className="ball" style={{ transform: `translate(${ball[0]}px, ${ball[1]}px)` }}>
          <circle r="2.4" className="ball-halo" />
          <circle r="1.05" className="ball-core" />
        </g>
      )}
    </svg>
  );
});
