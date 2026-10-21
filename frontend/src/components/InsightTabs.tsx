import { memo, useState } from "react";
import { KIND_LABELS, agentLabel } from "../lib/labels";
import type { Overlay, TrustRecord } from "../lib/types";

interface Props {
  overlays: Overlay[];
  trust: TrustRecord[];
  counts: { verified: number; blocked: number };
  selectedId: string | undefined;
  onSelect: (o: Overlay) => void;
}

const FeedItem = memo(function FeedItem({ o, active, onSelect }: { o: Overlay; active: boolean; onSelect: (o: Overlay) => void }) {
  return (
    <li>
      <button type="button" className={`feed-item ${active ? "active" : ""} p${o.priority}`} onClick={() => onSelect(o)}>
        <span className="feed-min">{o.trigger.minute}'</span>
        <span className="feed-body">
          <span className="feed-kind">{KIND_LABELS[o.kind] ?? o.kind}</span>
          {o.text}
        </span>
      </button>
    </li>
  );
});

const TrustItem = memo(function TrustItem({ r }: { r: TrustRecord }) {
  const why = r.checks.filter((c) => !c.ok).map((c) => c.detail);
  return (
    <li className={`trust-item ${r.status}`}>
      <div className="trust-row">
        <span className={`badge ${r.status}`}>{r.status === "verified" ? "✓ Verified" : r.status === "blocked" ? "✕ Blocked" : "Note"}</span>
        <span className="muted">
          {r.minute}' · {KIND_LABELS[r.kind] ?? r.kind} · {agentLabel(r.agent, r.attempt)}
        </span>
      </div>
      {r.text && <p className="trust-text">{r.text}</p>}
      {why.length > 0 && <p className="trust-why">Why it was stopped: {why.join(" · ")}</p>}
      {r.note && <p className="muted small">{r.note}</p>}
      {r.injected && <span className="inj">Demo: deliberately corrupted ({r.injected.replace(/_/g, " ")})</span>}
    </li>
  );
});

export function InsightTabs({ overlays, trust, counts, selectedId, onSelect }: Props) {
  const [tab, setTab] = useState<"feed" | "trust">("feed");
  const total = counts.verified + counts.blocked;

  return (
    <section className="card tabs-card" aria-label="Live insights">
      <div className="tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === "feed"} className={tab === "feed" ? "on" : ""} onClick={() => setTab("feed")}>
          Live feed <span className="count">{overlays.length}</span>
        </button>
        <button type="button" role="tab" aria-selected={tab === "trust"} className={tab === "trust" ? "on" : ""} onClick={() => setTab("trust")}>
          Trust log <span className={`count ${counts.blocked ? "bad" : ""}`}>{counts.blocked} blocked</span>
        </button>
      </div>

      {tab === "feed" ? (
        <ul className="scroll-list">
          {overlays.length === 0 && <li className="empty">Verified moments appear here as they go to air. Tap one to see why it's true.</li>}
          {overlays.map((o) => (
            <FeedItem key={o.id} o={o} active={o.id === selectedId} onSelect={onSelect} />
          ))}
        </ul>
      ) : (
        <>
          <div className="trust-summary">
            <div><b className="ok">{counts.verified}</b><span>lines verified</span></div>
            <div><b className="bad">{counts.blocked}</b><span>drafts blocked</span></div>
            <div><b>{total ? Math.round((100 * counts.blocked) / total) : 0}%</b><span>caught before air</span></div>
          </div>
          <ul className="scroll-list">
            {trust.length === 0 && <li className="empty">Every draft the AI writes is checked against the raw match events. Blocked drafts never reach the screen.</li>}
            {trust.map((r) => (
              <TrustItem key={r.id} r={r} />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
