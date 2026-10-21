import type { Overlay } from "../lib/types";

const GOAL_WORD: Record<string, string> = { en: "GOAL!", es: "¡GOL!", sw: "GOLI!", fr: "BUT !", pt: "GOLO!" };
const AGAINST = /^(Danger for|Alerta para|Tahadhari kwa)/;

function Proof({ o }: { o: Overlay }) {
  return (
    <div className="proof">
      ✓ verified · {o.verification.checks.length} checks · {o.source}
    </div>
  );
}

/** Renders the overlay currently on air using the graphic template the backend chose. */
export function GraphicLayer({ overlay }: { overlay: Overlay | null }) {
  if (!overlay) return null;
  const o = overlay;

  if (o.graphic === "goal_flash" || o.graphic === "scoreboard_summary") {
    const big = o.kind === "goal" ? (GOAL_WORD[o.lang] ?? "GOAL!") : o.kind === "half_time" ? "HALF-TIME" : "FULL-TIME";
    return (
      <div className="flash" key={o.id}>
        <div>
          <div className="big">{big}</div>
          <div className="sub">{o.text}</div>
          <Proof o={o} />
        </div>
      </div>
    );
  }

  if (o.graphic === "tactical_panel" || o.graphic === "momentum_banner") {
    return (
      <div className="tactical" key={o.id}>
        <div className="tag">
          {o.graphic === "tactical_panel" ? "TACTICAL SHIFT" : "MOMENTUM"} · {o.trigger.minute}'
        </div>
        <div className="txt">{o.text}</div>
        <Proof o={o} />
      </div>
    );
  }

  const tag = o.graphic === "player_card" ? "PLAYER LENS" : o.graphic === "player_tag" ? "SPEED" : `${o.trigger.minute}'`;
  return (
    <div className={`lower-third ${AGAINST.test(o.text) ? "against" : ""}`} key={o.id}>
      <div className="lt-tag">{tag}</div>
      <div className="lt-text">{o.text}</div>
      <Proof o={o} />
    </div>
  );
}
