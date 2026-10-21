import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { Broadcast } from "./components/Broadcast";
import { CatchUpDialog } from "./components/CatchUpDialog";
import { OnAirFeed, OverlayInspector } from "./components/Feeds";
import { Header } from "./components/Header";
import { TrustPanel } from "./components/TrustPanel";
import { ViewerPanel } from "./components/ViewerPanel";
import { useGraphicsQueue } from "./hooks/useGraphicsQueue";
import { useMatchStream } from "./hooks/useMatchStream";
import { api } from "./lib/api";
import type { AppConfig, CatchUp, Playback, Viewer } from "./lib/types";

// Multiview opens three extra streams; load its code only when someone asks for it.
const Multiview = lazy(() => import("./components/Multiview"));

// Deep links preset the viewer, e.g. /?persona=analyst&club=away&lang=sw&start=60&autoplay=1
const url = new URLSearchParams(window.location.search);
const initialViewer: Viewer = {
  persona: url.get("persona") === "analyst" ? "analyst" : "casual",
  club: url.get("club") === "home" || url.get("club") === "away" ? (url.get("club") as Viewer["club"]) : "",
  player: url.get("player") ?? "",
  lang: url.get("lang") ?? "en",
};
const initialPlayback: Playback = {
  speed: Number(url.get("speed")) || 30,
  start: Math.min(89, Math.max(0, Number(url.get("start")) || 0)),
};

export default function App() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [viewer, setViewer] = useState<Viewer>(initialViewer);
  const [playback, setPlayback] = useState<Playback>(initialPlayback);
  const [multiview, setMultiview] = useState<Playback | null>(null);
  const [catchUp, setCatchUp] = useState<{ data: CatchUp | null; error: string | null } | null>(null);
  const [activeSpeed, setActiveSpeed] = useState(playback.speed);
  const multiRef = useRef<HTMLDivElement>(null);

  const stream = useMatchStream();
  const onAir = useGraphicsQueue(stream.overlays, activeSpeed);

  useEffect(() => {
    const ctrl = new AbortController();
    api.config(ctrl.signal).then(setConfig).catch((e: Error) => {
      if (e.name !== "AbortError") setLoadError(e.message);
    });
    return () => ctrl.abort();
  }, []);

  const watch = useCallback(() => {
    setActiveSpeed(playback.speed);
    stream.start(api.streamUrl(viewer, playback));
  }, [playback, stream, viewer]);

  const autoplayed = useRef(false);
  useEffect(() => {
    if (config && url.get("autoplay") === "1" && !autoplayed.current) {
      autoplayed.current = true;
      watch();
    }
  }, [config, watch]);

  const openCatchUp = useCallback(async () => {
    const live = stream.status === "live" && stream.tick;
    const minute = live ? Math.floor(stream.tick!.t / 60) + 1 : playback.start || 60;
    setCatchUp({ data: null, error: null });
    try {
      setCatchUp({ data: await api.catchUp(viewer, Math.max(1, minute)), error: null });
    } catch (e) {
      setCatchUp({ data: null, error: (e as Error).message });
    }
  }, [playback.start, stream.status, stream.tick, viewer]);

  const openMultiview = useCallback(() => {
    setMultiview({ ...playback });
    requestAnimationFrame(() => multiRef.current?.scrollIntoView({ behavior: "smooth" }));
  }, [playback]);

  if (loadError) {
    return (
      <div className="boot error">
        <h1>Momentum Ledger</h1>
        <p>Can't reach the API ({loadError}). Start it with <code>python -m momentum serve</code> in <code>backend/</code>.</p>
      </div>
    );
  }
  if (!config) return <div className="boot">Loading match…</div>;

  return (
    <>
      <Header services={config.services} />
      <main className="layout">
        <Broadcast meta={config.meta} tick={stream.tick} trail={stream.trail} onAir={onAir} status={stream.status} />
        <aside className="side">
          <ViewerPanel config={config} viewer={viewer} playback={playback} onViewer={setViewer} onPlayback={setPlayback}
            onWatch={watch} onCatchUp={openCatchUp} onMultiview={openMultiview} />
          <TrustPanel trust={stream.trust} counts={stream.counts} />
        </aside>
        <OnAirFeed overlays={stream.overlays} />
        <OverlayInspector overlay={stream.overlays[0]} />
        <div ref={multiRef} className="full">
          {multiview && (
            <Suspense fallback={<section className="card">Loading multiview…</section>}>
              <Multiview config={config} playback={multiview} />
            </Suspense>
          )}
        </div>
      </main>
      {catchUp && <CatchUpDialog data={catchUp.data} error={catchUp.error} onClose={() => setCatchUp(null)} />}
    </>
  );
}
