import { memo } from "react";
import type { TrustRecord } from "../lib/types";

interface Props {
  trust: TrustRecord[];
  counts: { verified: number; blocked: number };
}

const TrustItem = memo(function TrustItem({ r }: { r: TrustRecord }) {
  const why = r.checks.filter((c) => !c.ok).map((c) => `${c.name}: ${c.detail}`).join("; ");
  return (
    <li className={r.status}>
      <div className="tr-top">
        <span>
          {r.minute}' · {r.kind.replace(/_/g, " ")} · {r.agent} #{r.attempt}
        </span>
        <span className="tr-status">{r.status}</span>
      </div>
      {r.text && <div className="tr-text">{r.text}</div>}
      {why && <div className="tr-why">✗ {why}</div>}
      {r.note && <div className="hint">{r.note}</div>}
      {r.injected && <span className="tr-inj">demo fault injected: {r.injected.replace(/_/g, " ")}</span>}
    </li>
  );
});

export function TrustPanel({ trust, counts }: Props) {
  return (
    <section className="card trust" aria-label="Trust panel">
      <div className="trust-head">
        <h2>Trust panel</h2>
        <div className="counts">
          <span className="ok">{counts.verified} verified</span>
          <span className="bad">{counts.blocked} blocked</span>
        </div>
      </div>
      <p className="hint">
        Every line is re-derived from the raw event ledger before air. Blocked drafts never reach the screen.
      </p>
      <ul className="list">
        {trust.length === 0 && <li className="empty">Press ▶ Watch live to start the match.</li>}
        {trust.map((r) => (
          <TrustItem key={r.id} r={r} />
        ))}
      </ul>
    </section>
  );
}
