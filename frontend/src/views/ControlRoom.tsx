import { useMemo, useState } from "react";
import { InsightDesk } from "../components/InsightDesk";
import { OnAir } from "../components/OnAir";
import { Pitch, type PitchMode } from "../components/Pitch";
import { Rundown } from "../components/Rundown";
import { ViewerModes } from "../components/ViewerModes";
import type { Playback } from "../hooks/usePlayback";
import { airedAt, clockOf, onAirAt, pitchAt, snapshotAt } from "../lib/derive";
import type { Overlay, Pack, PackEvent, Viewer } from "../lib/types";

const VERB: Record<string, string> = {
  pass: "passes", carry: "carries", shot: "shoots", tackle: "tackles", interception: "intercepts",
  pressure: "presses", possession_change: "wins it", goal: "SCORES", substitution: "comes on",
};

function ticker(e: PackEvent | undefined, pack: Pack): string {
  if (!e) return "kick-off pending";
  const team = e.team ? pack.meta[e.team].code : "";
  if (!e.player) return `${clockOf(e.t)}  ${e.type.replace(/_/g, " ")}`;
  const ok = e.outcome === "fail" ? " ✗" : e.outcome === "success" ? " ✓" : e.outcome ? ` (${e.outcome.replace("_", " ")})` : "";
  return `${clockOf(e.t)}  ${team}  ${e.player} ${VERB[e.type] ?? e.type}${ok}`;
}

interface Props {
  pack: Pack;
  pb: Playback;
  viewer: Viewer;
  languages: Record<string, string>;
  loading: boolean;
  selected: Overlay | undefined;
  following: boolean;
  onViewer: (v: Viewer) => void;
  onSelect: (o: Overlay) => void;
  onFollow: () => void;
  onFactCheck: (text: string, minute: number) => void;
  onCatchUp: () => void;
  onCompare: () => void;
}

export function ControlRoom(p: Props) {
  const { pack, pb } = p;
  const [mode, setMode] = useState<PitchMode>("live");
  const snap = snapshotAt(pack, pb.t);
  const { ball, trail, last, index } = pitchAt(pack, pb.t);
  const aired = useMemo(() => airedAt(pack.overlays, pb.t), [pack.overlays, pb.t]);
  const onAir = onAirAt(aired, pb.t, pb.speed);
  const colors = { home: pack.meta.home.color, away: pack.meta.away.color };
  const territory = useMemo(() => {
    if (mode !== "territory") return [];
    const out: PackEvent[] = [];
    for (let i = index; i >= 0 && pack.events[i].t >= pb.t - 600; i--) out.push(pack.events[i]);
    return out;
    // recompute at most every few match seconds
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, pack.events, Math.floor(pb.t / 5)]);
  const m = snap.momentum;

  return (
    <div className="control">
      <Rundown aired={aired} selectedId={p.selected?.id} onSelect={p.onSelect} onSeek={pb.seek} />

      <section className="stage" aria-label="Broadcast">
        <div className="stage-bar">
          <div className="chips" role="radiogroup" aria-label="Pitch view">
            <button type="button" className={mode === "live" ? "on" : ""} onClick={() => setMode("live")}>live</button>
            <button type="button" className={mode === "territory" ? "on" : ""} onClick={() => setMode("territory")}>territory 10'</button>
          </div>
          <span className={`rec ${pb.playing ? "on" : ""}`}>{clockOf(pb.t)}</span>
        </div>
        <div className="screen-wrap">
          <div className="screen">
            <Pitch mode={mode} ball={ball} trail={trail} territory={territory} colors={colors} />
          </div>
          <OnAir overlay={onAir} onSelect={p.onSelect} />
        </div>
        <div className="ticker">
          <span className={`live-tag ${pb.playing ? "on" : ""}`}>{pb.playing ? "LIVE" : pb.t >= pack.duration ? "FT" : "PAUSED"}</span>
          <code>{ticker(last, pack)}</code>
        </div>
        <div className="meters">
          <div className="meter wide">
            <div className="meter-head"><span>momentum</span><b>{Math.abs(m) < 0.05 ? "even" : m > 0 ? pack.meta.home.code : pack.meta.away.code}</b></div>
            <div className="bar"><i className="mid" />
              <i className="fill" style={{ left: m >= 0 ? `${50 - m * 50}%` : "50%", width: `${Math.abs(m) * 50}%`, background: m >= 0 ? colors.home : colors.away }} />
            </div>
          </div>
          <div className="meter">
            <div className="meter-head"><span>poss 10'</span><b>{Math.round(snap.possession_10m)}-{Math.round(100 - snap.possession_10m)}</b></div>
            <div className="bar" style={{ background: colors.away }}><i className="fill-l" style={{ width: `${snap.possession_10m}%`, background: colors.home }} /></div>
          </div>
          <div className="meter">
            <div className="meter-head"><span>chaos</span><b>{Math.round(snap.chaos)}</b></div>
            <div className="bar"><i className="fill-l chaos" style={{ width: `${snap.chaos}%` }} /></div>
          </div>
          <div className="meter">
            <div className="meter-head"><span>shots · xG</span></div>
            <div className="duel"><b>{snap.shots.home}</b><small>{snap.xg.home.toFixed(2)}</small><i /><b>{snap.shots.away}</b><small>{snap.xg.away.toFixed(2)}</small></div>
          </div>
        </div>
      </section>

      <aside className="side">
        <ViewerModes meta={pack.meta} viewer={p.viewer} languages={p.languages} loading={p.loading} onViewer={p.onViewer}
          onCatchUp={p.onCatchUp} onCompare={p.onCompare} />
        <InsightDesk overlay={p.selected ?? aired[0]} following={p.following} onFollow={p.onFollow} onFactCheck={p.onFactCheck} />
      </aside>
    </div>
  );
}
