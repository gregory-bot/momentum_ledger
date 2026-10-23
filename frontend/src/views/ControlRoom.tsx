import { lazy, Suspense, useMemo, useState } from "react";
import { InsightDesk } from "../components/InsightDesk";
import { OnAir } from "../components/OnAir";
import { Pitch3D, type CamMode } from "../components/Pitch3D";
import { Rundown } from "../components/Rundown";
import { ViewerModes } from "../components/ViewerModes";
import type { Playback } from "../hooks/usePlayback";
import { audio } from "../lib/audio";
import { airedAt, clockOf, onAirAt, pitchAt, snapshotAt } from "../lib/derive";
import type { Overlay, Pack, PackEvent, Viewer } from "../lib/types";

// WebGL monitor loads on demand; the SVG monitor covers loading and devices without WebGL.
const Monitor3D = lazy(() => import("../components/Monitor3D"));
const WEBGL = (() => {
  try {
    return !!document.createElement("canvas").getContext("webgl2");
  } catch {
    return false;
  }
})();

// ?cam=tactical|ball|player|territory deep-links a camera (read once, before the URL is rewritten).
const CAM_PARAM = new URLSearchParams(window.location.search).get("cam");
const INITIAL_CAM: CamMode = CAM_PARAM === "ball" || CAM_PARAM === "player" || CAM_PARAM === "territory" ? CAM_PARAM : "tactical";

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
  const [mode, setMode] = useState<CamMode>(INITIAL_CAM);
  const [sound, setSound] = useState(() => audio.enabled);
  const [followId, setFollowId] = useState<string | null>(p.viewer.player || null);
  const snap = snapshotAt(pack, pb.t);
  const { last } = pitchAt(pack, pb.t);
  const aired = useMemo(() => airedAt(pack.overlays, pb.t), [pack.overlays, pb.t]);
  const onAir = onAirAt(aired, pb.t, pb.speed);
  const colors = { home: pack.meta.home.color, away: pack.meta.away.color };
  const m = snap.momentum;

  return (
    <div className="control">
      <Rundown aired={aired} selectedId={p.selected?.id} onSelect={p.onSelect} onSeek={pb.seek} />

      <section className="stage" aria-label="Broadcast">
        <div className="stage-bar">
          <div className="chips" role="radiogroup" aria-label="Camera">
            {([["tactical", "tactical"], ["ball", "follow ball"], ["player", "player"], ["territory", "territory 10'"]] as [CamMode, string][]).map(([k, label]) => (
              <button key={k} type="button" role="radio" aria-checked={mode === k} className={mode === k ? "on" : ""}
                disabled={k === "player" && !followId} title={k === "player" && !followId ? "Click a player on the pitch to follow them" : undefined}
                onClick={() => setMode(k)}>{label}</button>
            ))}
          </div>
          <div className="stage-right">
            <button type="button" className={`ghost small audio-chip ${sound ? "on" : ""}`} aria-pressed={sound}
              title={sound ? "Commentary and crowd on" : "Commentary and crowd off"}
              onClick={() => { const on = !sound; setSound(on); audio.setEnabled(on); try { localStorage.setItem("dangote.audio", on ? "1" : "0"); } catch { /* private mode */ } }}>
              {sound ? "🔊 audio on" : "🔈 audio off"}
            </button>
            <span className={`rec ${pb.playing ? "on" : ""}`}>{clockOf(pb.t)}</span>
          </div>
        </div>
        <div className="screen-wrap">
          <div className="screen">
            {(() => {
              const follow = (id: string) => { setFollowId(id); setMode("player"); };
              const svg = <Pitch3D pack={pack} t={pb.t} playing={pb.playing} mode={mode} followId={followId} onFollow={follow} />;
              return WEBGL ? (
                <Suspense fallback={svg}>
                  <Monitor3D pack={pack} t={pb.t} speed={pb.speed} playing={pb.playing} mode={mode} followId={followId} onFollow={follow} />
                </Suspense>
              ) : svg;
            })()}
            {mode === "ball" && <span className="cam-hint">click a player to follow them</span>}
            {mode === "player" && followId && (
              <button type="button" className="cam-hint" onClick={() => { setFollowId(null); setMode("tactical"); }}>
                following #{[...pack.meta.home.players, ...pack.meta.home.bench, ...pack.meta.away.players, ...pack.meta.away.bench].find((x) => x.id === followId)?.number} · release ×
              </button>
            )}
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
