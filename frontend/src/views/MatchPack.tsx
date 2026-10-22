import { useMemo, useState } from "react";
import { minuteOf, statsAt, xgRace } from "../lib/derive";
import type { Pack, Side } from "../lib/types";
import type { PlayerLine } from "../lib/derive";

const MINI = "0 0 105 68";

function MiniPitch({ children }: { children: React.ReactNode }) {
  return (
    <svg viewBox={MINI} className="mini-pitch">
      <rect x="0" y="0" width="105" height="68" className="mp-turf" />
      <g className="mp-lines">
        <rect x="0.3" y="0.3" width="104.4" height="67.4" />
        <line x1="52.5" y1="0" x2="52.5" y2="68" />
        <circle cx="52.5" cy="34" r="9.15" />
        <rect x="0" y="13.84" width="16.5" height="40.32" />
        <rect x="88.5" y="13.84" width="16.5" height="40.32" />
      </g>
      {children}
    </svg>
  );
}

function Lineup({ pack, side, players }: { pack: Pack; side: Side; players: PlayerLine[] }) {
  const team = pack.meta[side];
  const mine = players.filter((p) => p.side === side && p.avg);
  const number = (id: string) => [...team.players, ...team.bench].find((p) => p.id === id)?.number ?? "";
  return (
    <section className="panel">
      <div className="panel-head">
        <h2><i className="sw" style={{ background: team.color }} /> {team.name}</h2>
        <span className="dim">average positions</span>
      </div>
      <MiniPitch>
        {mine.map((p) => (
          <g key={p.id} transform={`translate(${side === "away" ? 105 - p.avg![0] : p.avg![0]} ${p.avg![1]})`}>
            <circle r={2.2 + Math.min(2.2, p.touches / 40)} fill={team.color} className="mp-dot" />
            <text y="0.9" className="mp-num">{number(p.id)}</text>
          </g>
        ))}
      </MiniPitch>
      <p className="dim small">Dot size grows with touches. Both sides shown attacking right.</p>
    </section>
  );
}

const ROWS: { key: keyof ReturnType<typeof statsAt>["teams"]["home"]; label: string; fmt?: (v: number) => string }[] = [
  { key: "possession", label: "possession %" },
  { key: "passes", label: "passes" },
  { key: "completed", label: "passes completed" },
  { key: "shots", label: "shots" },
  { key: "onTarget", label: "on target" },
  { key: "xg", label: "expected goals", fmt: (v) => v.toFixed(2) },
  { key: "pressures", label: "pressures" },
  { key: "defActions", label: "tackles + interceptions" },
];

type SortKey = "passes" | "acc" | "shots" | "xg" | "goals" | "defActions" | "pressures";

export function MatchPack({ pack, t }: { pack: Pack; t: number }) {
  // Recompute at most once per match minute.
  const minute = minuteOf(t);
  const tm = Math.min(t, minute * 60);
  const stats = useMemo(() => statsAt(pack, tm), [pack, tm]);
  const race = useMemo(() => xgRace(pack, tm), [pack, tm]);
  const [sort, setSort] = useState<SortKey>("passes");
  const { home, away } = pack.meta;
  const colors = { home: home.color, away: away.color };

  const sorted = [...stats.players].sort((a, b) => {
    const v = (p: PlayerLine) => (sort === "acc" ? (p.passes ? p.completed / p.passes : 0) : p[sort]);
    return v(b) - v(a);
  });

  const W = 600, H = 160, maxX = Math.max(5400, pack.duration);
  const maxY = Math.max(1, race.tot.home, race.tot.away) * 1.15;
  const path = (pts: [number, number][]) => pts.map(([x, y], i) => `${i ? "L" : "M"}${(x / maxX) * W},${H - (y / maxY) * H}`).join(" ");
  const mom = pack.timeline.filter((s) => s.t <= tm);
  const momPath = mom.length ? `M0,${H / 2} ` + mom.map((s) => `L${(s.t / maxX) * W},${H / 2 - s.momentum * (H / 2 - 6)}`).join(" ") + ` L${(mom[mom.length - 1].t / maxX) * W},${H / 2} Z` : "";
  const goals = pack.events.filter((e) => e.type === "goal" && e.t <= tm);

  return (
    <div className="pack">
      <Lineup pack={pack} side="home" players={stats.players} />
      <Lineup pack={pack} side="away" players={stats.players} />

      <section className="panel">
        <div className="panel-head"><h2>Match stats <span className="live-dot">live</span></h2><span className="dim">to {minute}'</span></div>
        <div className="statrows">
          {ROWS.map((r) => {
            const h = stats.teams.home[r.key], a = stats.teams.away[r.key];
            const share = h + a ? (100 * h) / (h + a) : 50;
            const f = r.fmt ?? ((v: number) => String(v));
            return (
              <div key={r.key} className="statrow">
                <b>{f(h)}</b>
                <div>
                  <div className="bar duo" style={{ background: colors.away }}><i className="fill-l" style={{ width: `${share}%`, background: colors.home }} /></div>
                  <span>{r.label}</span>
                </div>
                <b>{f(a)}</b>
              </div>
            );
          })}
        </div>
      </section>

      <section className="panel">
        <div className="panel-head"><h2>Shot map</h2><span className="dim">area = xG · ring = goal</span></div>
        <MiniPitch>
          {stats.shots.map((s) => (
            <circle key={s.id} cx={s.x} cy={s.y} r={1 + Math.sqrt(s.xg ?? 0.02) * 6} fill={colors[s.team!]}
              fillOpacity={0.55} stroke={s.outcome === "goal" ? "#fff" : "none"} strokeWidth={0.6}>
              <title>{`${s.player} · xG ${s.xg} · ${s.outcome}`}</title>
            </circle>
          ))}
        </MiniPitch>
        <p className="dim small">{home.code} attack right, {away.code} attack left.</p>
      </section>

      <section className="panel">
        <div className="panel-head"><h2>xG race</h2><span className="dim">{home.code} {race.tot.home.toFixed(2)} · {away.code} {race.tot.away.toFixed(2)}</span></div>
        <svg viewBox={`0 0 ${W} ${H}`} className="chart" preserveAspectRatio="none">
          <line x1={(2700 / maxX) * W} x2={(2700 / maxX) * W} y1="0" y2={H} className="ht" />
          <path d={path(race.pts.home)} stroke={colors.home} className="line" />
          <path d={path(race.pts.away)} stroke={colors.away} className="line" />
          {goals.map((g) => <circle key={g.id} cx={(g.t / maxX) * W} cy={6} r={4} fill={colors[g.team!]} />)}
        </svg>
        <div className="axis dim small"><span>0'</span><span>45'</span><span>90'</span></div>
      </section>

      <section className="panel span2">
        <div className="panel-head"><h2>Momentum river</h2><span className="dim">above: {home.code} · below: {away.code}</span></div>
        <svg viewBox={`0 0 ${W} ${H}`} className="chart" preserveAspectRatio="none">
          <defs>
            <linearGradient id="riv" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={colors.home} stopOpacity=".75" />
              <stop offset=".5" stopColor={colors.home} stopOpacity=".05" />
              <stop offset=".5" stopColor={colors.away} stopOpacity=".05" />
              <stop offset="1" stopColor={colors.away} stopOpacity=".75" />
            </linearGradient>
          </defs>
          <line x1="0" x2={W} y1={H / 2} y2={H / 2} className="ht" />
          <line x1={(2700 / maxX) * W} x2={(2700 / maxX) * W} y1="0" y2={H} className="ht" />
          {momPath && <path d={momPath} fill="url(#riv)" />}
          {goals.map((g) => (
            <g key={g.id}>
              <line x1={(g.t / maxX) * W} x2={(g.t / maxX) * W} y1="0" y2={H} stroke={colors[g.team!]} strokeDasharray="3 3" />
              <text x={(g.t / maxX) * W + 3} y={g.team === "home" ? 12 : H - 4} className="chart-label">⚽ {Math.floor(g.t / 60) + 1}'</text>
            </g>
          ))}
        </svg>
        <div className="axis dim small"><span>0'</span><span>45'</span><span>90'</span></div>
      </section>

      <section className="panel span2">
        <div className="panel-head"><h2>Players</h2><span className="dim">click a column to sort</span></div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>player</th>
                {([["passes", "pass"], ["acc", "acc%"], ["shots", "sh"], ["xg", "xG"], ["goals", "gls"], ["defActions", "tkl+int"], ["pressures", "press"]] as [SortKey, string][]).map(([k, l]) => (
                  <th key={k}><button type="button" className={sort === k ? "on" : ""} onClick={() => setSort(k)}>{l}</button></th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((p) => (
                <tr key={p.id}>
                  <td><i className="sw" style={{ background: colors[p.side] }} />{p.name}</td>
                  <td>{p.passes}</td>
                  <td>{p.passes ? Math.round((100 * p.completed) / p.passes) : "–"}</td>
                  <td>{p.shots}</td>
                  <td>{p.xg.toFixed(2)}</td>
                  <td>{p.goals || ""}</td>
                  <td>{p.defActions}</td>
                  <td>{p.pressures}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
