import type { AppConfig, Playback, Viewer } from "../lib/types";

interface Props {
  config: AppConfig;
  viewer: Viewer;
  playback: Playback;
  live: boolean;
  onViewer: (v: Viewer) => void;
  onPlayback: (p: Playback) => void;
  onWatch: () => void;
  onCatchUp: () => void;
  onMultiview: () => void;
}

function Segmented<T extends string>({ value, options, onChange, label }: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div className="seg" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value}
          className={value === o.value ? "on" : ""} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function ViewerPanel({ config, viewer, playback, live, onViewer, onPlayback, onWatch, onCatchUp, onMultiview }: Props) {
  const { home, away } = config.meta;
  const set = (patch: Partial<Viewer>) => onViewer({ ...viewer, ...patch });

  return (
    <section className="card viewer" aria-label="Make it yours">
      <h2>Make it yours</h2>
      <div className="field">
        <label>How much detail?</label>
        <Segmented label="Mode" value={viewer.persona} onChange={(persona) => set({ persona })}
          options={[{ value: "casual", label: "Casual fan" }, { value: "analyst", label: "Analyst" }]} />
      </div>
      <div className="field">
        <label>I support</label>
        <Segmented label="Club" value={viewer.club} onChange={(club) => set({ club })}
          options={[{ value: "", label: "Neutral" }, { value: "home", label: home.short }, { value: "away", label: away.short }]} />
      </div>
      <div className="row">
        <div className="field">
          <label htmlFor="player">Follow a player</label>
          <select id="player" value={viewer.player} onChange={(e) => set({ player: e.target.value })}>
            <option value="">Nobody</option>
            {[home, away].map((t) => (
              <optgroup key={t.side} label={t.name}>
                {[...t.players, ...t.bench].map((p) => (
                  <option key={p.id} value={p.id}>{p.number} · {p.name}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="lang">Language</label>
          <select id="lang" value={viewer.lang} onChange={(e) => set({ lang: e.target.value })}>
            {Object.entries(config.languages).map(([code, name]) => (
              <option key={code} value={code}>{name}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="row">
        <div className="field">
          <label htmlFor="speed">Replay speed</label>
          <select id="speed" value={playback.speed} onChange={(e) => onPlayback({ ...playback, speed: Number(e.target.value) })}>
            {[10, 30, 60, 120].map((s) => <option key={s} value={s}>{s}×</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="start">Join at minute</label>
          <input id="start" type="number" inputMode="numeric" min={0} max={89} value={playback.start}
            onChange={(e) => onPlayback({ ...playback, start: Math.max(0, Math.min(89, Number(e.target.value) || 0)) })} />
        </div>
      </div>
      <button type="button" className="btn primary block" onClick={onWatch}>
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden><path d="M7 4l13 8-13 8z" fill="currentColor" /></svg>
        {live ? "Restart with these settings" : "Watch live"}
      </button>
      <div className="row actions">
        <button type="button" className="btn" onClick={onCatchUp}>Catch me up</button>
        <button type="button" className="btn" onClick={onMultiview}>Compare viewers</button>
      </div>
    </section>
  );
}
