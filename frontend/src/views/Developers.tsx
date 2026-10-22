import { useEffect, useState } from "react";
import { BASE, api } from "../lib/api";

interface Endpoint {
  method: "GET" | "POST";
  path: string;
  body?: unknown;
  note: string;
}

const origin = () => (BASE || window.location.origin).replace(/\/$/, "");

function endpoints(sc: string): Endpoint[] {
  return [
    { method: "GET", path: "/api", note: "service index" },
    { method: "GET", path: "/api/scenarios", note: "the storylines" },
    { method: "GET", path: `/api/matches/summary?scenario=${sc}`, note: "score, goals, headline moments + proofs" },
    { method: "GET", path: `/api/matches/state?scenario=${sc}&minute=60`, note: "live state at a minute" },
    { method: "GET", path: `/api/matches/teams?scenario=${sc}&minute=60`, note: "team stats at a minute" },
    { method: "GET", path: `/api/matches/insights?scenario=${sc}&min_priority=3`, note: "detected moments with ledger queries" },
    { method: "GET", path: `/api/catchup?scenario=${sc}&minute=63&club=away&lang=sw`, note: "verified recap from a fan's side" },
    { method: "POST", path: "/api/factcheck", body: { scenario: sc, minute: 90, text: "Malik Otieno has 2 goals." }, note: "fact-check any sentence" },
    { method: "GET", path: `/api/matches/data-card?scenario=${sc}`, note: "dataset card (markdown)" },
    { method: "GET", path: `/api/matches/events.jsonl?scenario=${sc}`, note: "raw events (JSONL)" },
    { method: "GET", path: `/api/matches/insights.csv?scenario=${sc}`, note: "insights (CSV)" },
    { method: "POST", path: "/mcp", body: { jsonrpc: "2.0", id: 1, method: "tools/list" }, note: "MCP: list tools" },
  ];
}

export function Developers({ scenario }: { scenario: string }) {
  const eps = endpoints(scenario);
  const [sel, setSel] = useState(0);
  const [out, setOut] = useState<{ status: number; ms: number; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [tools, setTools] = useState<{ name: string; description: string }[]>([]);
  const [copied, setCopied] = useState("");

  useEffect(() => {
    api.raw("/mcp", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) })
      .then((r) => setTools(JSON.parse(r.text).result.tools))
      .catch(() => setTools([]));
  }, []);

  async function run(i: number) {
    setSel(i);
    setBusy(true);
    const e = eps[i];
    const r = await api.raw(e.path, e.body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(e.body) } : undefined)
      .catch((err: Error) => ({ status: 0, ms: 0, text: err.message, type: "" }));
    let text = r.text;
    try {
      text = JSON.stringify(JSON.parse(r.text), null, 2);
    } catch { /* not JSON: show as is */ }
    setOut({ status: r.status, ms: r.ms, text: text.length > 12000 ? text.slice(0, 12000) + "\n… (truncated)" : text });
    setBusy(false);
  }

  const copy = (k: string, s: string) => navigator.clipboard?.writeText(s).then(() => { setCopied(k); setTimeout(() => setCopied(""), 1200); });
  const mcpConfig = JSON.stringify({ mcpServers: { dangote: { type: "http", url: `${origin()}/mcp` } } }, null, 2);
  const curl = `curl -s -X POST ${origin()}/api/factcheck \\\n  -H 'content-type: application/json' \\\n  -d '{"scenario":"${scenario}","minute":90,"text":"Malik Otieno has 2 goals."}'`;

  return (
    <div className="dev">
      <section className="panel">
        <div className="panel-head"><h2>REST API</h2><span className="dim">{origin()}</span></div>
        <ul className="eps">
          {eps.map((e, i) => (
            <li key={e.path + e.method}>
              <button type="button" className={sel === i && out ? "on" : ""} onClick={() => run(i)}>
                <span className={`m m-${e.method}`}>{e.method}</span>
                <code>{e.path.split("?")[0]}</code>
                <span className="dim small">{e.note}</span>
              </button>
            </li>
          ))}
        </ul>
        <p className="dim small">Interactive OpenAPI docs: <a href={`${origin()}/docs`} target="_blank" rel="noreferrer">{origin()}/docs</a></p>
      </section>

      <section className="panel console">
        <div className="panel-head">
          <h2>Console</h2>
          {out && <span className={out.status < 300 ? "ok" : "bad"}>{out.status} · {out.ms} ms</span>}
        </div>
        <pre className="json tall">{busy ? "…" : out ? `${eps[sel].method} ${eps[sel].path}\n\n${out.text}` : "// pick an endpoint to run it live"}</pre>
      </section>

      <section className="panel">
        <div className="panel-head"><h2>MCP server</h2><span className="dim">{tools.length} tools · Streamable HTTP</span></div>
        <p className="small">Any MCP host (Azure AI Foundry agents, GitHub Copilot, Claude, VS Code) can drive the studio. Add:</p>
        <div className="snippet">
          <pre className="json">{mcpConfig}</pre>
          <button type="button" className="ghost small" onClick={() => copy("mcp", mcpConfig)}>{copied === "mcp" ? "copied" : "copy"}</button>
        </div>
        <ul className="tools">
          {tools.map((t) => <li key={t.name}><code>{t.name}</code><span className="dim small">{t.description}</span></li>)}
        </ul>
      </section>

      <section className="panel">
        <div className="panel-head"><h2>Quick start</h2></div>
        <div className="snippet">
          <pre className="json">{curl}</pre>
          <button type="button" className="ghost small" onClick={() => copy("curl", curl)}>{copied === "curl" ? "copied" : "copy"}</button>
        </div>
        <p className="small dim">
          Every response is deterministic for (scenario, seed): the same request returns the same bytes on any machine.
          Facts carry the ledger query that proves them, so agents can re-verify anything they repeat.
        </p>
      </section>
    </div>
  );
}
