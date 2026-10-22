import { useEffect, useState } from "react";
import { api } from "../lib/api";
import type { Pack, Viewer } from "../lib/types";

/**
 * Loads the match pack for a scenario and viewer. When only the viewer changes, the previous
 * pack stays on screen until the new overlays arrive, so the match never blinks.
 */
export function usePack(scenario: string | null, viewer: Viewer) {
  const [pack, setPack] = useState<Pack | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const key = `${viewer.persona}|${viewer.club}|${viewer.player}|${viewer.lang}`;

  useEffect(() => {
    if (!scenario) return;
    const ctrl = new AbortController();
    setLoading(true);
    setError(null);
    api
      .prepare(scenario, viewer, ctrl.signal)
      .then((p) => setPack(p))
      .catch((e: Error) => e.name !== "AbortError" && setError(e.message))
      .finally(() => !ctrl.signal.aborted && setLoading(false));
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenario, key]);

  useEffect(() => {
    if (!scenario) setPack(null);
  }, [scenario]);

  return { pack: pack && pack.scenario.id === scenario ? pack : null, stalePack: pack, loading, error };
}
