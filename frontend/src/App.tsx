import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { CatchUpDialog, CompareDialog } from "./components/Dialogs";
import { Header, type Tab } from "./components/Header";
import { Transport } from "./components/Transport";
import { usePack } from "./hooks/usePack";
import { usePlayback } from "./hooks/usePlayback";
import { api } from "./lib/api";
import { airedAt, minuteOf, snapshotAt } from "./lib/derive";
import type { AppConfig, Overlay, Viewer } from "./lib/types";
import { ControlRoom } from "./views/ControlRoom";
import { Launch } from "./views/Launch";

// Secondary tabs load on demand to keep the first paint small.
const MatchPack = lazy(() => import("./views/MatchPack").then((m) => ({ default: m.MatchPack })));
const TrustLab = lazy(() => import("./views/TrustLab").then((m) => ({ default: m.TrustLab })));
const Developers = lazy(() => import("./views/Developers").then((m) => ({ default: m.Developers })));

// Deep links: /?scenario=press-trap&persona=analyst&club=away&lang=sw&t=58&tab=trust&autoplay=1
const url = new URLSearchParams(window.location.search);
const TABS: Tab[] = ["control", "pack", "trust", "dev"];

export default function App() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);
  const [scenario, setScenario] = useState<string | null>(url.get("scenario"));
  const [tab, setTab] = useState<Tab>(TABS.includes(url.get("tab") as Tab) ? (url.get("tab") as Tab) : "control");
  const [viewer, setViewer] = useState<Viewer>({
    persona: url.get("persona") === "analyst" ? "analyst" : "casual",
    club: url.get("club") === "home" || url.get("club") === "away" ? (url.get("club") as Viewer["club"]) : "",
    player: url.get("player") ?? "",
    lang: url.get("lang") ?? "en",
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ kind: "catchup" | "compare"; minute: number } | null>(null);
  const [factPreset, setFactPreset] = useState<{ text: string; minute: number } | null>(null);

  const { pack, loading, error } = usePack(scenario, viewer);
  const startAt = useMemo(() => Math.max(0, Number(url.get("t")) || 0) * 60, []);
  const pb = usePlayback(pack?.duration ?? 5400, startAt, url.get("autoplay") === "1");

  useEffect(() => {
    api.config().then(setConfig).catch((e: Error) => setBootError(e.message));
  }, []);

  useEffect(() => {
    const q = new URLSearchParams();
    if (scenario) q.set("scenario", scenario);
    if (tab !== "control") q.set("tab", tab);
    if (viewer.persona !== "casual") q.set("persona", viewer.persona);
    if (viewer.club) q.set("club", viewer.club);
    if (viewer.player) q.set("player", viewer.player);
    if (viewer.lang !== "en") q.set("lang", viewer.lang);
    window.history.replaceState(null, "", q.toString() ? `?${q}` : window.location.pathname);
  }, [scenario, tab, viewer]);

  const start = useCallback((id: string) => {
    setScenario(id);
    setSelectedId(null);
    setTab("control");
    pb.seek(0);
    pb.play();
  }, [pb]);

  const select = useCallback((o: Overlay) => setSelectedId(o.id), []);
  const factCheck = useCallback((text: string, minute: number) => {
    setFactPreset({ text, minute });
    setTab("trust");
  }, []);

  // Keyboard: space = play/pause, ←/→ = 30s, 1-4 = tabs.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!pack || (e.target as HTMLElement).closest("input, textarea, select")) return;
      if (e.key === " ") { e.preventDefault(); pb.toggle(); }
      else if (e.key === "ArrowRight") pb.seek(pb.t + 30);
      else if (e.key === "ArrowLeft") pb.seek(pb.t - 30);
      else if (["1", "2", "3", "4"].includes(e.key)) setTab(TABS[Number(e.key) - 1]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pack, pb]);

  if (bootError) {
    return (
      <div className="boot">
        <div className="brand big"><span className="wordmark">dangote</span></div>
        <p className="bad">can't reach the API ({bootError})</p>
        <p className="dim">start it with <code>python -m dangote serve</code> in <code>backend/</code></p>
      </div>
    );
  }
  if (!config) return <div className="boot"><span className="blink">booting studio…</span></div>;
  if (!scenario) return <Launch config={config} onStart={start} />;

  const selected = pack?.overlays.find((o) => o.id === selectedId) ?? (pack ? airedAt(pack.overlays, pb.t)[0] : undefined);
  const snap = pack ? snapshotAt(pack, pb.t) : null;

  return (
    <div className="studio">
      <Header pack={pack} snap={snap} t={pb.t} tab={tab} onTab={setTab} onNewMatch={() => { pb.pause(); setScenario(null); }} />
      <main className="main">
        {error && <p className="bad pad">{error}</p>}
        {!pack ? (
          <div className="boot inline"><span className="blink">simulating · interpreting · verifying…</span></div>
        ) : (
          <Suspense fallback={<div className="boot inline"><span className="blink">loading…</span></div>}>
            {tab === "control" && (
              <ControlRoom pack={pack} pb={pb} viewer={viewer} languages={config.languages} loading={loading}
                selected={selected} following={selectedId === null} onViewer={setViewer} onSelect={select}
                onFollow={() => setSelectedId(null)} onFactCheck={factCheck}
                onCatchUp={() => setDialog({ kind: "catchup", minute: Math.min(90, minuteOf(pb.t)) })}
                onCompare={() => setDialog({ kind: "compare", minute: 0 })} />
            )}
            {tab === "pack" && <MatchPack pack={pack} t={pb.t} />}
            {tab === "trust" && <TrustLab pack={pack} t={pb.t} preset={factPreset} />}
            {tab === "dev" && <Developers scenario={pack.scenario.id} />}
          </Suspense>
        )}
      </main>
      {pack && <Transport pb={pb} duration={pack.duration} overlays={pack.overlays} />}
      {pack && dialog?.kind === "catchup" && (
        <CatchUpDialog scenario={pack.scenario.id} viewer={viewer} minute={dialog.minute} onClose={() => setDialog(null)} />
      )}
      {pack && dialog?.kind === "compare" && (
        <CompareDialog scenario={pack.scenario.id} meta={pack.meta} languages={config.languages} t={pb.t} onClose={() => setDialog(null)} />
      )}
    </div>
  );
}
