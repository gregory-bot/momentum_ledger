import { memo } from "react";
import { KIND_LABELS } from "../lib/labels";
import type { Overlay } from "../lib/types";

const Item = memo(function Item({ o, active, onSelect, onSeek }: {
  o: Overlay;
  active: boolean;
  onSelect: (o: Overlay) => void;
  onSeek: (t: number) => void;
}) {
  return (
    <li className={`rd-item p${o.priority} ${active ? "active" : ""}`}>
      <button type="button" className="rd-main" onClick={() => onSelect(o)}>
        <span className="rd-min">{o.trigger.minute}'</span>
        <span>
          <span className={`kind k-${o.kind}`}>{KIND_LABELS[o.kind] ?? o.kind}</span>
          <span className="rd-text">{o.text}</span>
        </span>
      </button>
      <button type="button" className="rd-jump" title="Replay from here" aria-label={`Replay from ${o.trigger.minute}'`}
        onClick={() => onSeek(Math.max(0, o.trigger.t - 20))}>
        ↺
      </button>
    </li>
  );
});

export function Rundown({ aired, selectedId, onSelect, onSeek }: {
  aired: Overlay[];
  selectedId?: string;
  onSelect: (o: Overlay) => void;
  onSeek: (t: number) => void;
}) {
  return (
    <section className="panel rundown" aria-label="Rundown">
      <div className="panel-head">
        <h2>Rundown</h2>
        <span className="dim">{aired.length} aired</span>
      </div>
      <ul className="scroll">
        {aired.length === 0 && <li className="empty">Verified moments appear here as they air.</li>}
        {aired.map((o) => (
          <Item key={o.id} o={o} active={o.id === selectedId} onSelect={onSelect} onSeek={onSeek} />
        ))}
      </ul>
    </section>
  );
}
