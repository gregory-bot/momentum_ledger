import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import type { AppConfig, Overlay, Playback, Viewer } from "../lib/types";

interface Column {
  label: string;
  viewer: Viewer;
}

function Column({ col, playback }: { col: Column; playback: Playback }) {
  const [items, setItems] = useState<Overlay[]>([]);

  useEffect(() => {
    setItems([]);
    // ticks=false: these columns only need overlays, so the server skips ~2,500 tick messages.
    const es = new EventSource(api.streamUrl(col.viewer, playback, false));
    es.addEventListener("overlay", (e) => {
      const o = JSON.parse((e as MessageEvent).data) as Overlay;
      setItems((xs) => [o, ...xs].slice(0, 60));
    });
    es.addEventListener("end", () => es.close());
    return () => es.close();
  }, [col.viewer, playback]);

  return (
    <div className="mv-col">
      <h3>{col.label}</h3>
      <ul>
        {items.length === 0 && <li className="empty">Waiting for the first verified moment…</li>}
        {items.map((o) => (
          <li key={o.id}>
            <b>{o.trigger.minute}'</b>
            {o.text}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Same match, three viewers: every column is verified against the same ledger. */
export default function Multiview({ config, playback }: { config: AppConfig; playback: Playback }) {
  const columns = useMemo<Column[]>(() => {
    const { home, away } = config.meta;
    const star = away.players.find((p) => p.number === 9) ?? away.players[0];
    const lang = "sw" in config.languages ? "sw" : "es";
    return [
      { label: "Casual fan · English", viewer: { persona: "casual", club: "", player: "", lang: "en" } },
      { label: "Analyst · English", viewer: { persona: "analyst", club: "", player: "", lang: "en" } },
      {
        label: `${home.short} fan · Player Lens: ${star.name} · ${config.languages[lang]}`,
        viewer: { persona: "casual", club: "home", player: star.id, lang },
      },
    ];
  }, [config]);

  return (
    <section className="card multiview" aria-label="Multiview">
      <h2>
        Same match, three viewers <small>every line verified against the same ledger</small>
      </h2>
      <div className="mv-grid">
        {columns.map((c) => (
          <Column key={c.label} col={c} playback={playback} />
        ))}
      </div>
    </section>
  );
}
