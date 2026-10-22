import { memo, useEffect, useState } from "react";
import { api } from "../lib/api";
import { trustAt } from "../lib/derive";
import { KIND_LABELS, agentLabel } from "../lib/labels";
import type { FactCheck, Pack, TrustRecord } from "../lib/types";

const VERDICT: Record<FactCheck["verdict"], { label: string; cls: string }> = {
  supported: { label: "SUPPORTED", cls: "ok" },
  unsupported: { label: "UNSUPPORTED", cls: "bad" },
  out_of_scope: { label: "OUT OF SCOPE", cls: "warn" },
  no_claims: { label: "NOTHING TO CHECK", cls: "dim" },
};

function examples(pack: Pack): string[] {
  const goal = pack.events.find((e) => e.type === "goal");
  const scorer = goal?.player ?? pack.meta.home.players[9].name;
  const other = pack.meta.home.players[8].name;
  return [
    `${scorer} has scored 1 goal.`,
    `${other} has 3 goals already.`,
    `${pack.meta.home.short} have had 70% of the ball.`,
    `That's ${scorer.split(" ").pop()}'s 4th goal of the season!`,
  ];
}

const Record_ = memo(function Record_({ r }: { r: TrustRecord }) {
  const why = r.checks.filter((c) => !c.ok).map((c) => c.detail);
  return (
    <li className={`tr ${r.status}`}>
      <div className="tr-head">
        <span className={`tag-${r.status}`}>{r.status === "verified" ? "✓ verified" : r.status === "blocked" ? "✕ blocked" : "· note"}</span>
        <span className="dim">{r.minute}' · {KIND_LABELS[r.kind] ?? r.kind} · {agentLabel(r.agent, r.attempt)} · {r.lang}</span>
      </div>
      {r.text && <p className="tr-text">{r.text}</p>}
      {why.length > 0 && <p className="bad small">why: {why.join(" · ")}</p>}
      {r.note && <p className="dim small">{r.note}</p>}
      {r.injected && <span className="inj">demo fault injected: {r.injected.replace(/_/g, " ")}</span>}
    </li>
  );
});

export function TrustLab({ pack, t, preset }: { pack: Pack; t: number; preset: { text: string; minute: number } | null }) {
  const minute = Math.min(90, Math.floor(t / 60) + 1);
  const trust = trustAt(pack.trust, minute);
  const verified = trust.filter((r) => r.status === "verified").length;
  const blocked = trust.filter((r) => r.status === "blocked");
  const recovered = new Set(trust.filter((r) => r.status === "verified" && r.attempt > 1).map((r) => r.insight_id)).size;
  const [filter, setFilter] = useState<"blocked" | "all">("blocked");

  const [text, setText] = useState(preset?.text ?? "");
  const [at, setAt] = useState(preset?.minute ?? minute);
  const [result, setResult] = useState<FactCheck | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (preset) {
      setText(preset.text);
      setAt(preset.minute);
      run(preset.text, preset.minute);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset]);

  async function run(s = text, m = at) {
    if (!s.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      setResult(await api.factCheck(pack.scenario.id, m, s));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="trustlab">
      <section className="panel span2">
        <div className="panel-head"><h2>Verification pipeline</h2><span className="dim">to {minute}'</span></div>
        <div className="flow">
          {[
            ["detect", "engine finds a moment", `${new Set(trust.map((r) => r.insight_id)).size} moments`],
            ["narrate", "AI / template drafts a line", `${trust.filter((r) => r.agent !== "translator").length} drafts`],
            ["verify", "re-derive every fact from raw events", `${blocked.length} blocked`],
            ["recover", "retry with reasons, then fall back", `${recovered} recovered`],
            ["air", "timecoded overlay", `${verified} verified`],
          ].map(([k, d, n], i) => (
            <div key={k} className="flow-step">
              <span className="flow-n">{String(i + 1).padStart(2, "0")}</span>
              <b>{k}</b>
              <span className="dim small">{d}</span>
              <span className={k === "verify" ? "bad" : k === "air" ? "ok" : ""}>{n}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="panel span2 factdesk">
        <div className="panel-head"><h2>Fact-check desk</h2><span className="dim">check any sentence against the match ledger</span></div>
        <form onSubmit={(e) => { e.preventDefault(); run(); }}>
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} maxLength={600}
            placeholder="Paste a pundit's line, a tweet, or an AI draft…" aria-label="Sentence to check" />
          <div className="fd-row">
            <label>
              <span className="dim">as of minute</span>
              <input type="number" min={1} max={95} value={at} onChange={(e) => setAt(Number(e.target.value) || 1)} />
            </label>
            <button type="button" className="ghost small" onClick={() => setAt(minute)}>use match clock ({minute}')</button>
            <button type="submit" className="btn primary" disabled={busy || !text.trim()}>{busy ? "checking…" : "check it"}</button>
          </div>
          <div className="examples">
            {examples(pack).map((x) => (
              <button key={x} type="button" className="chip-btn" onClick={() => { setText(x); run(x); }}>{x}</button>
            ))}
          </div>
        </form>
        {err && <p className="bad">{err}</p>}
        {result && (
          <div className="fc-result">
            <div className="fc-verdict">
              <span className={`verdict ${VERDICT[result.verdict].cls}`}>{VERDICT[result.verdict].label}</span>
              <span>{result.summary}</span>
            </div>
            {result.claims.length > 0 && (
              <ul className="claims">
                {result.claims.map((c, i) => (
                  <li key={i} className={c.supported ? "ok" : "bad"}>
                    <code className="claim-n">{c.number}</code>
                    <span>
                      {c.supported
                        ? c.matches.map((m) => `${m.subject} · ${m.label} = ${m.value}`).join("  |  ")
                        : `no ${c.subjects.length ? c.subjects.join(" / ") + " " : ""}fact equals ${c.number} at ${result.minute}'`}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {result.out_of_scope.length > 0 && <p className="warn small">beyond this match's data: {result.out_of_scope.join(", ")}</p>}
            <p className="dim small">checked against {result.facts_checked} facts derived from {result.events_in_ledger} raw events at {result.minute}'</p>
          </div>
        )}
      </section>

      <section className="panel span2">
        <div className="panel-head">
          <h2>Trust log</h2>
          <div className="chips">
            <button type="button" className={filter === "blocked" ? "on" : ""} onClick={() => setFilter("blocked")}>blocked ({blocked.length})</button>
            <button type="button" className={filter === "all" ? "on" : ""} onClick={() => setFilter("all")}>all ({trust.length})</button>
          </div>
        </div>
        <ul className="trlist">
          {(filter === "blocked" ? blocked : [...trust].reverse()).map((r) => <Record_ key={r.id} r={r} />)}
          {filter === "blocked" && blocked.length === 0 && <li className="empty">No drafts blocked yet. Play the match to watch the verifier work.</li>}
        </ul>
      </section>
    </div>
  );
}
