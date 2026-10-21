import { memo } from "react";
import type { Overlay } from "../lib/types";

const FeedItem = memo(function FeedItem({ o }: { o: Overlay }) {
  return (
    <li>
      <span className="min">{o.trigger.minute}'</span>
      <div>
        <div className="kind">
          {o.kind.replace(/_/g, " ")} · {o.lang}
        </div>
        {o.text}
      </div>
    </li>
  );
});

export function OnAirFeed({ overlays }: { overlays: Overlay[] }) {
  return (
    <section className="card feed" aria-label="On-air feed">
      <h2>On-air feed</h2>
      <ul className="list">
        {overlays.length === 0 && <li className="empty">Verified lines appear here as they go to air.</li>}
        {overlays.map((o) => (
          <FeedItem key={o.id} o={o} />
        ))}
      </ul>
    </section>
  );
}

export function OverlayInspector({ overlay }: { overlay: Overlay | undefined }) {
  return (
    <section className="card json" aria-label="Overlay JSON">
      <h2>
        Overlay JSON <small>timecoded · machine-readable</small>
      </h2>
      <pre>{overlay ? JSON.stringify(overlay, null, 2) : "Waiting for the first verified overlay…"}</pre>
    </section>
  );
}
