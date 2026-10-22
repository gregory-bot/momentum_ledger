import { useState } from "react";
import { FACT_LABELS, HIDDEN_FACTS, KIND_LABELS, checkLabel, isNumeric, sourceLabel } from "../lib/labels";
import type { Overlay } from "../lib/types";

interface Props {
  overlay: Overlay | undefined;
  following: boolean;
  onFollow: () => void;
  onFactCheck: (text: string, minute: number) => void;
}

/** The selected moment, the numbers behind it, and every check it passed before air. */
export function InsightDesk({ overlay, following, onFollow, onFactCheck }: Props) {
  const [dev, setDev] = useState(false);
  return (
    <section className="panel desk" aria-label="Insight desk">
      <div className="panel-head">
        <h2>Insight desk</h2>
        <button type="button" className={`ghost small ${following ? "on" : ""}`} onClick={onFollow}>
          {following ? "● following live" : "follow live"}
        </button>
      </div>
      {!overlay ? (
        <p className="empty">Press play. The newest verified moment lands here with its proof.</p>
      ) : (
        <Body o={overlay} dev={dev} onDev={() => setDev((d) => !d)} onFactCheck={onFactCheck} />
      )}
    </section>
  );
}

function Body({ o, dev, onDev, onFactCheck }: { o: Overlay; dev: boolean; onDev: () => void; onFactCheck: Props["onFactCheck"] }) {
  const facts = Object.entries(o.data).filter(([k]) => !HIDDEN_FACTS.has(k));
  const names = facts.filter(([, v]) => !isNumeric(v));
  const nums = facts.filter(([, v]) => isNumeric(v));
  return (
    <div className="desk-body">
      <div className="desk-meta">
        <span className={`kind k-${o.kind}`}>{KIND_LABELS[o.kind] ?? o.kind}</span>
        <span className="desk-min">{o.trigger.minute}'</span>
        <span className="ok-badge">✓ verified</span>
      </div>
      <p className="desk-text">{o.text}</p>

      {names.length > 0 && (
        <div className="desk-names">
          {names.map(([k, v]) => (
            <span key={k} className="name-tag"><small>{FACT_LABELS[k] ?? k}</small>{v}</span>
          ))}
        </div>
      )}
      {nums.length > 0 && (
        <div className="desk-nums">
          {nums.map(([k, v]) => (
            <div key={k} className="num"><b>{v}</b><span>{FACT_LABELS[k] ?? k}</span></div>
          ))}
        </div>
      )}

      <ul className="desk-checks">
        {o.verification.checks.map((c) => (
          <li key={c.name}><span className="tick">✓</span>{checkLabel(c.name)}</li>
        ))}
      </ul>
      <p className="desk-prov dim">
        {sourceLabel(o.source)} · {o.trigger.timecode} · {o.graphic.replace(/_/g, " ")}
        {o.evidence.length > 0 && <> · events {o.evidence.join(", ")}</>}
      </p>
      <div className="desk-actions">
        <button type="button" className="ghost small" onClick={() => onFactCheck(o.text, o.trigger.minute)}>
          re-check in trust lab →
        </button>
        <button type="button" className="ghost small" onClick={onDev} aria-expanded={dev}>{dev ? "hide" : "show"} overlay json</button>
      </div>
      {dev && <pre className="json">{JSON.stringify(o, null, 2)}</pre>}
    </div>
  );
}
