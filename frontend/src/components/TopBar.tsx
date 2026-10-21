import { useEffect, useRef, useState } from "react";
import type { StreamStatus } from "../hooks/useMatchStream";
import type { MatchMeta } from "../lib/types";

const STATUS: Record<StreamStatus, string> = {
  idle: "Ready",
  connecting: "Connecting",
  live: "Live",
  ended: "Full-time",
  error: "Offline",
};

interface Props {
  meta: MatchMeta;
  services: Record<string, string>;
  status: StreamStatus;
}

export function TopBar({ meta, services, status }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  return (
    <header className="topbar">
      <div className="brand">
        <div className="logo" aria-hidden>
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 17l5-6 4 3 6-8" />
            <path d="M15 6h3v3" />
          </svg>
        </div>
        <div className="brand-text">
          <h1>Momentum Ledger</h1>
          <p>
            {meta.home.name} <span className="vs">vs</span> {meta.away.name}
          </p>
        </div>
      </div>

      <div className="topbar-right">
        <span className={`status ${status}`}>
          <i />
          {STATUS[status]}
        </span>
        <div className="popover-wrap" ref={ref}>
          <button type="button" className="ghost" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <path d="M7 18a4 4 0 0 1-.6-7.96A6 6 0 0 1 18 9a4.5 4.5 0 0 1-.5 9H7z" />
            </svg>
            <span className="hide-sm">Azure stack</span>
          </button>
          {open && (
            <div className="popover" role="dialog" aria-label="Active services">
              <h4>Running on</h4>
              <dl>
                {Object.entries(services).map(([k, v]) => (
                  <div key={k}>
                    <dt>{k.replace("_", " ")}</dt>
                    <dd>{v}</dd>
                  </div>
                ))}
              </dl>
              <p>All data is synthetic. Teams and players are fictional.</p>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
