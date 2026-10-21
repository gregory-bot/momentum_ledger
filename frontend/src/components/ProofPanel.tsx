import { FACT_LABELS, HIDDEN_FACTS, KIND_LABELS, checkLabel, isNumeric, sourceLabel } from "../lib/labels";
import type { Overlay } from "../lib/types";

/**
 * "Why you can trust this": the selected on-air line, the facts behind it, and the checks
 * it passed, in plain language. The raw overlay JSON is kept for graphics partners and judges.
 */
export function ProofPanel({ overlay }: { overlay: Overlay | undefined }) {
  if (!overlay) {
    return (
      <section className="card proof-panel" aria-label="Why you can trust this">
        <h2>Why you can trust this</h2>
        <p className="muted">
          Pick any line from the live feed to see the facts behind it and every check it passed before going on air.
        </p>
      </section>
    );
  }
  const o = overlay;
  const facts = Object.entries(o.data).filter(([k]) => !HIDDEN_FACTS.has(k));
  const people = facts.filter(([, v]) => !isNumeric(v));
  const numbers = facts.filter(([, v]) => isNumeric(v));

  return (
    <section className="card proof-panel" aria-label="Why you can trust this">
      <div className="proof-top">
        <h2>Why you can trust this</h2>
        <span className="pill ok">✓ Verified before air</span>
      </div>

      <blockquote>
        <span className="q-meta">
          {KIND_LABELS[o.kind] ?? o.kind} · {o.trigger.minute}'
        </span>
        {o.text}
      </blockquote>

      {people.length > 0 && (
        <div className="who">
          {people.map(([k, v]) => (
            <span key={k} className="tag">
              <small>{FACT_LABELS[k] ?? k}</small>
              {v}
            </span>
          ))}
        </div>
      )}

      {numbers.length > 0 && (
        <>
          <h3>The numbers behind it</h3>
          <div className="facts">
            {numbers.map(([k, v]) => (
              <div key={k} className="fact">
                <b>{v}</b>
                <span>{FACT_LABELS[k] ?? k}</span>
              </div>
            ))}
          </div>
        </>
      )}

      <h3>Checks passed</h3>
      <ul className="checks">
        {o.verification.checks.map((c) => (
          <li key={c.name}>
            <span className="tick" aria-hidden>✓</span>
            <div>
              {checkLabel(c.name)}
              <small>{c.detail}</small>
            </div>
          </li>
        ))}
      </ul>

      <div className="provenance">
        <span>Written by <b>{sourceLabel(o.source)}</b></span>
        <span>Timecode <b>{o.trigger.timecode}</b></span>
        {o.evidence.length > 0 && <span>Source events <b>{o.evidence.join(", ")}</b></span>}
      </div>

      <details className="dev">
        <summary>Developer view · overlay JSON for graphics partners</summary>
        <pre>{JSON.stringify(o, null, 2)}</pre>
      </details>
    </section>
  );
}
