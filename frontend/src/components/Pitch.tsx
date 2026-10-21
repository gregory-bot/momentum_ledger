import { memo } from "react";
import type { TickEvent } from "../lib/types";

interface Props {
  ball: [number, number] | null;
  trail: TickEvent[];
}

// Static markings never re-render; only the ball and the last few actions change.
const Markings = memo(function Markings() {
  return (
    <g className="lines">
      <rect x="0" y="0" width="105" height="68" />
      <line x1="52.5" y1="0" x2="52.5" y2="68" />
      <circle cx="52.5" cy="34" r="9.15" />
      <circle cx="52.5" cy="34" r="0.4" className="spot" />
      <rect x="0" y="13.84" width="16.5" height="40.32" />
      <rect x="88.5" y="13.84" width="16.5" height="40.32" />
      <rect x="0" y="24.84" width="5.5" height="18.32" />
      <rect x="99.5" y="24.84" width="5.5" height="18.32" />
      <rect x="-1.5" y="30.34" width="1.5" height="7.32" />
      <rect x="105" y="30.34" width="1.5" height="7.32" />
    </g>
  );
});

const Stripes = memo(function Stripes() {
  return (
    <g>
      {Array.from({ length: 10 }, (_, i) => (
        <rect key={i} x={i * 10.5} y="0" width="10.5" height="68" className={i % 2 ? "grass-b" : "grass-a"} />
      ))}
    </g>
  );
});

export const Pitch = memo(function Pitch({ ball, trail }: Props) {
  return (
    <svg className="pitch" viewBox="-2 -2 109 72" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Live pitch view">
      <Stripes />
      <Markings />
      <g>
        {trail.map((ev, i) => {
          const shot = ev.type === "shot";
          const x2 = shot ? (ev.team === "home" ? 105 : 0) : (ev.end_x ?? ev.x!);
          const y2 = shot ? 34 : (ev.end_y ?? ev.y!);
          return (
            <line
              key={ev.id}
              x1={ev.x!}
              y1={ev.y!}
              x2={x2}
              y2={y2}
              className={`trail ${ev.team ?? ""} ${ev.outcome === "fail" ? "fail" : ""} ${shot ? "shot" : ""}`}
              opacity={0.2 + (0.8 * (i + 1)) / trail.length}
            />
          );
        })}
      </g>
      {ball && <circle className="ball" cx={ball[0]} cy={ball[1]} r="1.1" />}
    </svg>
  );
});
