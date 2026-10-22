import { KIND_LABELS } from "../lib/labels";
import type { Overlay } from "../lib/types";

const GOAL_WORD: Record<string, string> = { en: "GOAL", es: "GOL", sw: "GOLI", fr: "BUT", pt: "GOLO" };
const AGAINST = /^(Danger for|Alerta para|Tahadhari kwa)/;

/**
 * The on-air graphic. On wide screens it is keyed over the pitch like broadcast graphics;
 * on phones it sits in its own slot under the pitch so it never hides the play.
 */
export function OnAir({ overlay, onSelect }: { overlay: Overlay | null; onSelect: (o: Overlay) => void }) {
  if (!overlay) return <div className="onair idle">// waiting for the next moment that matters</div>;
  const o = overlay;
  const badge = <span className="ok-badge">✓ verified</span>;

  if (o.graphic === "goal_flash" || o.graphic === "scoreboard_summary") {
    return (
      <button type="button" key={o.id} className="onair flash" onClick={() => onSelect(o)}>
        <span className="flash-word">{o.kind === "goal" ? (GOAL_WORD[o.lang] ?? "GOAL") : KIND_LABELS[o.kind]}</span>
        <span className="flash-text">{o.text}</span>
        {badge}
      </button>
    );
  }
  const panel = o.graphic === "tactical_panel" || o.graphic === "momentum_banner";
  return (
    <button type="button" key={o.id} onClick={() => onSelect(o)}
      className={`onair ${panel ? "panel" : "lower"} ${AGAINST.test(o.text) ? "against" : ""}`}>
      <span className="onair-head">
        <span className="onair-kind">{KIND_LABELS[o.kind] ?? o.kind}</span>
        <span className="dim">{o.trigger.minute}'</span>
        {badge}
      </span>
      <span className="onair-text">{o.text}</span>
    </button>
  );
}
