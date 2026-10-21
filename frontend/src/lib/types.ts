// Shapes returned by the Momentum Ledger API (backend/momentum/server.py).

export type Side = "home" | "away";
export type Persona = "casual" | "analyst";

export interface Player {
  id: string;
  name: string;
  number: number;
  role: "GK" | "DEF" | "MID" | "FWD";
}

export interface Team {
  side: Side;
  code: string;
  name: string;
  short: string;
  color: string;
  players: Player[];
  bench: Player[];
}

export interface MatchMeta {
  match_id: string;
  competition: string;
  venue: string;
  home: Team;
  away: Team;
  seed: number;
}

export interface AppConfig {
  meta: MatchMeta;
  events: number;
  languages: Record<string, string>;
  services: Record<string, string>;
}

export interface TickEvent {
  id: string;
  type: string;
  team: Side | null;
  player: string | null;
  outcome: string | null;
  x: number | null;
  y: number | null;
  end_x: number | null;
  end_y: number | null;
}

export interface Tick {
  t: number;
  period: number;
  score: Record<Side, number>;
  momentum: number;
  chaos: number;
  possession_10m: number;
  shots: Record<Side, number>;
  xg: Record<Side, number>;
  ball: [number, number] | null;
  clock?: string;
  event?: TickEvent;
}

export interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

export type Graphic =
  | "goal_flash"
  | "scoreboard_summary"
  | "tactical_panel"
  | "momentum_banner"
  | "player_card"
  | "player_tag"
  | "lower_third";

export interface Overlay {
  type: "overlay";
  id: string;
  insight_id: string;
  kind: string;
  graphic: Graphic;
  priority: number;
  impact: number;
  team: Side | null;
  player_id: string | null;
  trigger: { t: number; match_clock: string; timecode: string; minute: number };
  duration_s: number;
  profile: { persona: Persona; club: Side | null; player_id: string | null; lang: string };
  lang: string;
  text: string;
  source: string;
  data: Record<string, string>;
  evidence: string[];
  verification: { status: "verified"; checks: Check[] };
  latency_ms: number;
}

export type TrustStatus = "verified" | "blocked" | "error" | "note";

export interface TrustRecord {
  id: number;
  insight_id: string;
  kind: string;
  minute: number;
  profile: string;
  agent: string;
  attempt: number;
  lang: string;
  text: string;
  status: TrustStatus;
  checks: Check[];
  injected: string | null;
  note: string;
}

export interface CatchUp {
  type: "catch_up";
  minute: number;
  header: string | null;
  items: { minute: number; kind: string; text: string; insight_id: string }[];
  trust: TrustRecord[];
}

export interface Viewer {
  persona: Persona;
  club: Side | "";
  player: string;
  lang: string;
}

export interface Playback {
  speed: number;
  start: number;
}
