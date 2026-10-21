import type { MatchMeta, Overlay, Tick, TickEvent } from "../lib/types";
import { GraphicLayer } from "./GraphicLayer";
import { Pitch } from "./Pitch";

interface Props {
  meta: MatchMeta;
  tick: Tick | null;
  trail: TickEvent[];
  onAir: Overlay | null;
  onSelect: (o: Overlay) => void;
}

export function Broadcast({ meta, tick, trail, onAir, onSelect }: Props) {
  const { home, away } = meta;
  const m = tick?.momentum ?? 0;
  const poss = tick?.possession_10m ?? 50;
  const chaos = tick?.chaos ?? 0;

  return (
    <section className="stage" aria-label="Broadcast">
      <div className="screen-wrap">
        <div className="screen">
          <div className="scorebug">
            <span className="sb-team">
              <i style={{ background: home.color }} />
              {home.code}
            </span>
            <span className="sb-score">
              {tick?.score.home ?? 0}
              <em>–</em>
              {tick?.score.away ?? 0}
            </span>
            <span className="sb-team">
              {away.code}
              <i style={{ background: away.color }} />
            </span>
            <span className="sb-clock">{tick?.clock ?? "00:00"}</span>
          </div>
          <Pitch ball={tick?.ball ?? null} trail={trail} />
        </div>
        <GraphicLayer overlay={onAir} onSelect={onSelect} />
      </div>

      <div className="stats">
        <div className="stat wide">
          <div className="stat-head">
            <span>Momentum</span>
            <span className="stat-val">{m === 0 ? "Even" : m > 0 ? home.short : away.short}</span>
          </div>
          <div className="track momentum">
            <div className="mid" />
            <div className="fill" style={{
              left: m >= 0 ? `${50 - m * 50}%` : "50%",
              width: `${Math.abs(m) * 50}%`,
              background: m >= 0 ? home.color : away.color,
            }} />
          </div>
          <div className="legend"><span>{home.short}</span><span>{away.short}</span></div>
        </div>
        <div className="stat">
          <div className="stat-head"><span>Possession · 10'</span></div>
          <div className="track" style={{ background: away.color }}>
            <div className="fill-static" style={{ width: `${poss}%`, background: home.color }} />
          </div>
          <div className="legend"><span>{Math.round(poss)}%</span><span>{Math.round(100 - poss)}%</span></div>
        </div>
        <div className="stat">
          <div className="stat-head">
            <span>Control ↔ Chaos</span>
            <span className="stat-val">{Math.round(chaos)}</span>
          </div>
          <div className="track"><div className="fill-static chaos" style={{ width: `${chaos}%` }} /></div>
          <div className="legend"><span>control</span><span>chaos</span></div>
        </div>
        <div className="stat">
          <div className="stat-head"><span>Shots · xG</span></div>
          <div className="duel">
            <b>{tick?.shots.home ?? 0}</b><small>{(tick?.xg.home ?? 0).toFixed(2)}</small>
            <span className="sep" />
            <b>{tick?.shots.away ?? 0}</b><small>{(tick?.xg.away ?? 0).toFixed(2)}</small>
          </div>
        </div>
      </div>
    </section>
  );
}
