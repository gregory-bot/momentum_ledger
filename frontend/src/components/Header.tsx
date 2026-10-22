import type { Pack, Scenario, Snapshot } from "../lib/types";

export type Tab = "control" | "pack" | "trust" | "dev";

const TABS: { id: Tab; label: string }[] = [
  { id: "control", label: "Control room" },
  { id: "pack", label: "Match pack" },
  { id: "trust", label: "Trust lab" },
  { id: "dev", label: "Developers" },
];

interface Props {
  pack: Pack | null;
  snap: Snapshot | null;
  t: number;
  tab: Tab;
  onTab: (t: Tab) => void;
  scenarios: Scenario[];
  scenario: string;
  onScenario: (id: string) => void;
}

export function Logo() {
  return (
    <span className="logo" aria-hidden>
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="square">
        <path d="M4 18 L9 11 L13 14 L20 5" />
        <path d="M15 5 H20 V10" />
      </svg>
    </span>
  );
}

export function Header({ pack, snap, t, tab, onTab, scenarios, scenario, onScenario }: Props) {
  const period = !pack ? "" : t >= pack.duration ? "full-time" : t >= 2700 ? "2nd half" : t > 0 ? "1st half" : "pre-match";
  return (
    <header className="header">
      <div className="brand">
        <Logo />
        <span className="wordmark">dangote</span>
        <span className="tagline hide-md">verified match studio</span>
      </div>

      <nav className="tabs" aria-label="Sections">
        {TABS.map((x) => (
          <button key={x.id} type="button" className={tab === x.id ? "on" : ""} aria-current={tab === x.id ? "page" : undefined}
            onClick={() => onTab(x.id)}>
            {x.label}
          </button>
        ))}
      </nav>

      {pack && snap && (
        <div className="hdr-score">
          <span className="chip-team" style={{ background: pack.meta.home.color }}>{pack.meta.home.code}</span>
          <b>{snap.score.home}</b>
          <span className="dim">-</span>
          <b>{snap.score.away}</b>
          <span className="chip-team" style={{ background: pack.meta.away.color }}>{pack.meta.away.code}</span>
          <span className="venue hide-lg">{pack.scenario.name} · {pack.meta.venue}</span>
        </div>
      )}

      <div className="hdr-right">
        {period && <span className="period">{period}</span>}
        <select className="match-pick" value={scenario} onChange={(e) => onScenario(e.target.value)} aria-label="Storyline">
          {scenarios.map((s) => (
            <option key={s.id} value={s.id}>{s.name} · {s.home.code} v {s.away.code}</option>
          ))}
        </select>
      </div>
    </header>
  );
}
