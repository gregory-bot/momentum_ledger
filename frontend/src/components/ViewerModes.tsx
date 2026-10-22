import type { MatchMeta, Viewer } from "../lib/types";

function Chips<T extends string>({ value, options, onChange, label }: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div className="chips" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value}
          className={value === o.value ? "on" : ""} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

interface Props {
  meta: MatchMeta;
  viewer: Viewer;
  languages: Record<string, string>;
  loading: boolean;
  onViewer: (v: Viewer) => void;
  onCatchUp: () => void;
  onCompare: () => void;
}

export function ViewerModes({ meta, viewer, languages, loading, onViewer, onCatchUp, onCompare }: Props) {
  const set = (patch: Partial<Viewer>) => onViewer({ ...viewer, ...patch });
  return (
    <section className="panel modes" aria-label="Viewer modes">
      <div className="panel-head">
        <h2>Viewer modes</h2>
        {loading && <span className="dim blink">re-rendering…</span>}
      </div>
      <dl className="mode-grid">
        <dt>Persona</dt>
        <dd>
          <Chips label="Persona" value={viewer.persona} onChange={(persona) => set({ persona })}
            options={[{ value: "casual", label: "Casual" }, { value: "analyst", label: "Analyst" }]} />
        </dd>
        <dt>Club</dt>
        <dd>
          <Chips label="Club" value={viewer.club} onChange={(club) => set({ club })}
            options={[{ value: "", label: "Neutral" }, { value: "home", label: meta.home.code }, { value: "away", label: meta.away.code }]} />
        </dd>
        <dt>Language</dt>
        <dd>
          <Chips label="Language" value={viewer.lang} onChange={(lang) => set({ lang })}
            options={Object.entries(languages).map(([value, label]) => ({ value, label }))} />
        </dd>
        <dt><label htmlFor="focus">Player lens</label></dt>
        <dd>
          <select id="focus" value={viewer.player} onChange={(e) => set({ player: e.target.value })}>
            <option value="">Whole match</option>
            {[meta.home, meta.away].map((t) => (
              <optgroup key={t.side} label={t.name}>
                {[...t.players, ...t.bench].map((p) => (
                  <option key={p.id} value={p.id}>#{p.number} {p.name}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </dd>
      </dl>
      <div className="mode-actions">
        <button type="button" className="btn" onClick={onCatchUp}>catch me up</button>
        <button type="button" className="btn" onClick={onCompare}>compare 3 viewers</button>
      </div>
    </section>
  );
}
