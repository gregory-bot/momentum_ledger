import { Logo } from "../components/Header";
import type { AppConfig } from "../lib/types";

export function Launch({ config, onStart }: { config: AppConfig; onStart: (scenario: string) => void }) {
  return (
    <div className="launch">
      <div className="launch-hero">
        <div className="brand big"><Logo /><span className="wordmark">dangote</span></div>
        <h1>Every number on screen, <em>proven.</em></h1>
        <p className="dim">
          Synthetic football events in. Explainable, verified, personalized match intelligence out:
          an AI production crew that can't put an invented stat on air.
        </p>
        <ul className="launch-points">
          <li><b>measure</b> how much every moment changes the match</li>
          <li><b>explain</b> why it matters, and when the game changes character</li>
          <li><b>verify</b> every number and name against the raw event ledger</li>
          <li><b>personalize</b> by persona, club, player and language</li>
        </ul>
      </div>

      <div className="launch-pick">
        <h2>Pick a storyline</h2>
        <div className="cards">
          {config.scenarios.map((s, i) => (
            <button key={s.id} type="button" className="card-sc" onClick={() => onStart(s.id)}>
              <span className="sc-idx">{String(i + 1).padStart(2, "0")}</span>
              <span className="sc-name">{s.name}</span>
              <span className="sc-tag">{s.tagline}</span>
              <span className="sc-clubs">
                <span><i style={{ background: s.home.color }} />{s.home.name}</span>
                <span className="dim">vs</span>
                <span><i style={{ background: s.away.color }} />{s.away.name}</span>
              </span>
              <span className="sc-foot dim">{s.venue} · seed {s.seed}<span className="go">take it to air →</span></span>
            </button>
          ))}
        </div>
        <p className="dim small">All clubs, players and matches are fictional and generated from a seed. Same seed, same match, on any machine.</p>
      </div>
    </div>
  );
}
