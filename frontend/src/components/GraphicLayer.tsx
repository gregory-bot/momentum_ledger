import { KIND_LABELS } from "../lib/labels";
import type { Overlay } from "../lib/types";

const GOAL_WORD: Record<string, string> = { en: "GOAL", es: "GOL", sw: "GOLI", fr: "BUT", pt: "GOLO" };
const AGAINST = /^(Danger for|Alerta para|Tahadhari kwa)/;

interface Props {
  overlay: Overlay | null;
  onSelect: (o: Overlay) => void;
}

/**
 * The on-air graphic. On desktop it is keyed over the pitch like a broadcast graphic;
 * on phones it sits in a "Now on air" card below the pitch so it never hides the play.
 */
export function GraphicLayer({ overlay, onSelect }: Props) {
  if (!overlay) {
    return (
      <div className="onair onair-idle">
        <span className="dot" /> Waiting for the next moment that matters…
      </div>
    );
  }
  const o = overlay;
  const select = () => onSelect(o);
  const verified = (
    <span className="verified-badge">
      <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden>
        <path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
      </svg>
      Verified
    </span>
  );

  if (o.graphic === "goal_flash" || o.graphic === "scoreboard_summary") {
    const word = o.kind === "goal" ? (GOAL_WORD[o.lang] ?? "GOAL") : KIND_LABELS[o.kind];
    return (
      <button type="button" className="onair onair-flash" key={o.id} onClick={select}>
        <span className="flash-word">{word}</span>
        <span className="flash-text">{o.text}</span>
        {verified}
      </button>
    );
  }

  const tactical = o.graphic === "tactical_panel" || o.graphic === "momentum_banner";
  return (
    <button type="button" key={o.id} onClick={select}
      className={`onair ${tactical ? "onair-panel" : "onair-lower"} ${AGAINST.test(o.text) ? "against" : ""}`}>
      <span className="onair-head">
        <span className="onair-kind">{KIND_LABELS[o.kind] ?? o.kind}</span>
        <span className="onair-min">{o.trigger.minute}'</span>
        {verified}
      </span>
      <span className="onair-text">{o.text}</span>
    </button>
  );
}
