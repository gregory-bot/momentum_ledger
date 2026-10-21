import type { AppConfig, Playback, Viewer } from "../lib/types";

interface Props {
  config: AppConfig;
  viewer: Viewer;
  playback: Playback;
  onViewer: (v: Viewer) => void;
  onPlayback: (p: Playback) => void;
  onWatch: () => void;
  onCatchUp: () => void;
  onMultiview: () => void;
}

interface SegOption<T extends string> {
  value: T;
  label: string;
}

function Segmented<T extends string>({ value, options, onChange, label }: {
  value: T;
  options: SegOption<T>[];
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

export function ViewerPanel({ config, viewer, playback, onViewer, onPlayback, onWatch, onCatchUp, onMultiview }: Props) {
  const { home, away } = config.meta;
  const set = (patch: Partial<Viewer>) => onViewer({ ...viewer, ...patch });

  return (
    <section className="card controls" aria-label="Viewer settings">
      <h2>Viewer</h2>
      <div className="field">
        <label>Mode</label>
        <Segmented label="Mode" value={viewer.persona} onChange={(persona) => set({ persona })}
          options={[{ value: "casual", label: "Casual" }, { value: "analyst", label: "Analyst" }]} />
      </div>
      <div className="field">
        <label>I support</label>
        <Segmented label="Club" value={viewer.club} onChange={(club) => set({ club })}
          options={[{ value: "", label: "Neutral" }, { value: "home", label: home.short }, { value: "away", label: away.short }]} />
      </div>
      <div className="row">
        <div className="field">
          <label htmlFor="player">Player Lens</label>
          <select id="player" value={viewer.player} onChange={(e) => set({ player: e.target.value })}>
            <option value="">Off</option>
            {[home, away].map((t) => (
              <optgroup key={t.side} label={t.name}>
                {[...t.players, ...t.bench].map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.number} · {p.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="lang">Language</label>
          <select id="lang" value={viewer.lang} onChange={(e) => set({ lang: e.target.value })}>
            {Object.entries(config.languages).map(([code, name]) => (
              <option key={code} value={code}>
                {name}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="row">
        <div className="field">
          <label htmlFor="speed">Replay speed</label>
          <select id="speed" value={playback.speed} onChange={(e) => onPlayback({ ...playback, speed: Number(e.target.value) })}>
            {[10, 30, 60, 120].map((s) => (
              <option key={s} value={s}>
                {s}×
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="start">Join at minute</label>
          <input id="start" type="number" min={0} max={89} value={playback.start}
            onChange={(e) => onPlayback({ ...playback, start: Math.max(0, Math.min(89, Number(e.target.value) || 0)) })} />
        </div>
      </div>
      <div className="actions">
        <button type="button" className="primary" onClick={onWatch}>▶ Watch live</button>
        <button type="button" onClick={onCatchUp}>Catch me up</button>
        <button type="button" onClick={onMultiview}>Multiview</button>
      </div>
    </section>
  );
}
