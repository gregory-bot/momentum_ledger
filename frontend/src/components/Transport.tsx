import { memo } from "react";
import type { Playback } from "../hooks/usePlayback";
import { clockOf, minuteOf } from "../lib/derive";
import { KIND_LABELS } from "../lib/labels";
import type { Overlay } from "../lib/types";

const SPEEDS = [1, 2, 4, 10, 30];

const Markers = memo(function Markers({ overlays, duration, onSeek }: {
  overlays: Overlay[];
  duration: number;
  onSeek: (t: number) => void;
}) {
  return (
    <>
      {overlays.filter((o) => ["goal", "tactical_story", "half_time", "full_time"].includes(o.kind)).map((o) => (
        <button key={o.id} type="button" className={`marker ${o.kind === "goal" ? "goal" : ""}`}
          style={{ left: `${(100 * o.trigger.t) / duration}%` }} title={`${o.trigger.minute}' ${KIND_LABELS[o.kind] ?? o.kind}`}
          aria-label={`Jump to ${o.trigger.minute}' ${KIND_LABELS[o.kind] ?? o.kind}`} onClick={() => onSeek(o.trigger.t)} />
      ))}
    </>
  );
});

export function Transport({ pb, duration, overlays }: { pb: Playback; duration: number; overlays: Overlay[] }) {
  const pct = (100 * pb.t) / duration;
  return (
    <div className="transport">
      <button type="button" className="play" onClick={pb.toggle} aria-label={pb.playing ? "Pause" : "Play"}>
        {pb.playing ? (
          <svg viewBox="0 0 24 24" width="18" height="18"><path d="M7 5h4v14H7zM13 5h4v14h-4z" fill="currentColor" /></svg>
        ) : (
          <svg viewBox="0 0 24 24" width="18" height="18"><path d="M7 4l13 8-13 8z" fill="currentColor" /></svg>
        )}
      </button>
      <div className="speeds" role="radiogroup" aria-label="Replay speed">
        {SPEEDS.map((s) => (
          <button key={s} type="button" role="radio" aria-checked={pb.speed === s} className={pb.speed === s ? "on" : ""}
            onClick={() => pb.setSpeed(s)}>
            {s}×
          </button>
        ))}
      </div>
      <div className="scrub">
        <div className="scrub-track">
          <div className="scrub-fill" style={{ width: `${pct}%` }} />
          <div className="scrub-ht" style={{ left: `${(100 * 2700) / duration}%` }} title="Half-time" />
          <Markers overlays={overlays} duration={duration} onSeek={pb.seek} />
        </div>
        <input type="range" min={0} max={duration} step={1} value={pb.t} aria-label="Match time"
          onChange={(e) => pb.seek(Number(e.target.value))} />
      </div>
      <div className="clock">
        <b>{clockOf(pb.t)}</b>
        <span className="dim">{Math.min(90, minuteOf(pb.t))}' of 90</span>
      </div>
    </div>
  );
}
