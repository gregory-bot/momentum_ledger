import { useEffect } from "react";
import type { CatchUp } from "../lib/types";

interface Props {
  data: CatchUp | null;
  error: string | null;
  onClose: () => void;
}

export function CatchUpDialog({ data, error, onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const blocked = data?.trust.filter((t) => t.status === "blocked").length ?? 0;

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-labelledby="catchup-title" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="close" onClick={onClose} aria-label="Close">
          ×
        </button>
        <h3 id="catchup-title">{error ? "Couldn't catch you up" : data ? (data.header ?? `Catch-up at ${data.minute}'`) : "Catching you up…"}</h3>
        {error && <p className="hint">{error}</p>}
        {data && (
          <>
            <ol>
              {data.items.length === 0 && <li>Nothing decisive yet.</li>}
              {data.items.map((i) => (
                <li key={i.insight_id}>
                  <b>{i.minute}'</b> {i.text}
                </li>
              ))}
            </ol>
            <p className="hint">
              {data.items.length} verified moments, ranked by impact
              {blocked ? ` · ${blocked} draft(s) blocked before you saw them` : ""}.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
