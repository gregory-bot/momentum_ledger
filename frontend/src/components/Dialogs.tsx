import { useEffect, useState, type ReactNode } from "react";
import { api } from "../lib/api";
import { airedAt } from "../lib/derive";
import { KIND_LABELS } from "../lib/labels";
import type { CatchUp, MatchMeta, Overlay, Viewer } from "../lib/types";

function Dialog({ title, onClose, wide, children }: { title: ReactNode; onClose: () => void; wide?: boolean; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="modal" role="dialog" aria-modal="true" onClick={onClose}>
      <div className={`modal-card ${wide ? "wide" : ""}`} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button type="button" className="ghost small" onClick={onClose} aria-label="Close">esc ×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function CatchUpDialog({ scenario, viewer, minute, onClose }: {
  scenario: string;
  viewer: Viewer;
  minute: number;
  onClose: () => void;
}) {
  const [data, setData] = useState<CatchUp | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.catchUp(scenario, viewer, Math.max(1, minute)).then(setData).catch((e: Error) => setError(e.message));
  }, [scenario, viewer, minute]);
  const blocked = data?.trust.filter((t) => t.status === "blocked").length ?? 0;

  return (
    <Dialog title={data?.header ?? `catching you up to ${minute}'…`} onClose={onClose}>
      {error && <p className="bad">{error}</p>}
      {data && (
        <>
          <ol className="catchup">
            {data.items.length === 0 && <li>Nothing decisive yet.</li>}
            {data.items.map((i) => (
              <li key={i.insight_id}>
                <span className="rd-min">{i.minute}'</span>
                <span><span className={`kind k-${i.kind}`}>{KIND_LABELS[i.kind] ?? i.kind}</span>{i.text}</span>
              </li>
            ))}
          </ol>
          <p className="dim small">
            {data.items.length} highest-impact verified moments, ranked from your side, not a chronological log
            {blocked ? ` · ${blocked} draft(s) blocked before you saw them` : ""}.
          </p>
        </>
      )}
    </Dialog>
  );
}

const COLUMNS = (meta: MatchMeta, langs: Record<string, string>): { label: string; viewer: Viewer }[] => {
  const star = meta.away.players.find((p) => p.number === 9) ?? meta.away.players[0];
  const lang = "sw" in langs ? "sw" : "es";
  return [
    { label: "casual · neutral · en", viewer: { persona: "casual", club: "", player: "", lang: "en" } },
    { label: "analyst · neutral · en", viewer: { persona: "analyst", club: "", player: "", lang: "en" } },
    { label: `${meta.home.code} fan · lens ${star.name} · ${lang}`, viewer: { persona: "casual", club: "home", player: star.id, lang } },
  ];
};

/** Three viewers, one match, synced to the same clock. */
export function CompareDialog({ scenario, meta, languages, t, onClose }: {
  scenario: string;
  meta: MatchMeta;
  languages: Record<string, string>;
  t: number;
  onClose: () => void;
}) {
  const cols = COLUMNS(meta, languages);
  const [feeds, setFeeds] = useState<(Overlay[] | null)[]>([null, null, null]);
  useEffect(() => {
    cols.forEach((c, i) =>
      api.prepare(scenario, c.viewer).then((p) => setFeeds((f) => f.map((x, j) => (j === i ? p.overlays : x)))),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenario]);

  return (
    <Dialog wide title={<>same match, three viewers <span className="dim small">· synced to {Math.floor(t / 60) + 1}'</span></>} onClose={onClose}>
      <div className="compare">
        {cols.map((c, i) => {
          const aired = feeds[i] ? airedAt(feeds[i]!, t) : null;
          return (
            <div key={c.label} className="compare-col">
              <h4>{c.label}</h4>
              <ul>
                {!aired && <li className="dim">rendering…</li>}
                {aired?.length === 0 && <li className="dim">nothing aired yet</li>}
                {aired?.slice(0, 30).map((o) => (
                  <li key={o.id}><span className="rd-min">{o.trigger.minute}'</span>{o.text}</li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
      <p className="dim small">Every column passed the same verifier against the same match ledger. Only the telling changes.</p>
    </Dialog>
  );
}
