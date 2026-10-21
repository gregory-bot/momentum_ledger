import type { StreamStatus } from "../hooks/useMatchStream";
import type { MatchMeta, Overlay, Tick, TickEvent } from "../lib/types";
import { GraphicLayer } from "./GraphicLayer";
import { Pitch } from "./Pitch";

interface Props {
  meta: MatchMeta;
  tick: Tick | null;
  trail: TickEvent[];
  onAir: Overlay | null;
  status: StreamStatus;
}

const PILL: Record<StreamStatus, string> = {
  idle: "READY",
  connecting: "CONNECTING",
  live: "LIVE",
  ended: "FULL-TIME",
  error: "OFFLINE",
};

export function Broadcast({ meta, tick, trail, onAir, status }: Props) {
  const { home, away } = meta;
  const m = tick?.momentum ?? 0;
  const poss = tick?.possession_10m ?? 50;

  return (
    <section className="card broadcast" aria-label="Broadcast">
      <div className="screen">
        <div className="scorebug">
          <span className="team">
            <i style={{ background: home.color }} />
            <b>{home.code}</b>
          </span>
          <span className="score">
            <b>{tick?.score.home ?? 0}</b>
            <em>-</em>
            <b>{tick?.score.away ?? 0}</b>
          </span>
          <span className="team">
            <b>{away.code}</b>
            <i style={{ background: away.color }} />
          </span>
          <span className="clock">{tick?.clock ?? "00:00"}</span>
        </div>
        <div className={`live-pill ${status}`}>{PILL[status]}</div>
        <Pitch ball={tick?.ball ?? null} trail={trail} />
        <GraphicLayer overlay={onAir} />
      </div>

      <div className="meters">
        <div className="meter wide">
          <label>Momentum</label>
          <div className="momentum">
            <div className="mid" />
            <div
              className="bar"
              style={{
                left: m >= 0 ? `${50 - m * 50}%` : "50%",
                width: `${Math.abs(m) * 50}%`,
                background: m >= 0 ? home.color : away.color,
              }}
            />
          </div>
          <div className="legend">
            <span>{home.short}</span>
            <span>{away.short}</span>
          </div>
        </div>
        <div className="meter">
          <label>Possession · last 10'</label>
          <div className="split" style={{ background: away.color }}>
            <div style={{ width: `${poss}%`, background: home.color }} />
          </div>
          <div className="legend">
            <span>{Math.round(poss)}%</span>
            <span>{Math.round(100 - poss)}%</span>
          </div>
        </div>
        <div className="meter">
          <label>Control ↔ Chaos</label>
          <div className="chaos">
            <div style={{ width: `${tick?.chaos ?? 0}%` }} />
          </div>
          <div className="legend">
            <span>control</span>
            <span>{Math.round(tick?.chaos ?? 0)}</span>
            <span>chaos</span>
          </div>
        </div>
        <div className="meter">
          <label>Shots · xG</label>
          <div className="statline">
            {tick?.shots.home ?? 0} · {(tick?.xg.home ?? 0).toFixed(2)}
            <span className="sep">|</span>
            {tick?.shots.away ?? 0} · {(tick?.xg.away ?? 0).toFixed(2)}
          </div>
        </div>
      </div>
    </section>
  );
}
