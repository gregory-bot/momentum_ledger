// Plain-language labels so viewers never have to read raw keys.

export const KIND_LABELS: Record<string, string> = {
  goal: "Goal",
  big_chance: "Big chance",
  line_breaking_pass: "Line-breaking pass",
  danger_removed: "Danger snuffed out",
  speed_alert: "Top speed",
  regime_shift: "The game is shifting",
  tactical_story: "Tactical story",
  momentum_swing: "Momentum swing",
  player_card: "Player Lens",
  half_time: "Half-time",
  full_time: "Full-time",
};

export const FACT_LABELS: Record<string, string> = {
  scorer: "Scorer",
  assist: "Assist",
  player: "Player",
  receiver: "Receiver",
  team: "Team",
  team_pressing: "Pressing team",
  team_other: "Opponent",
  viewer_club: "Your club",
  minute: "Minute",
  score_home: "Home goals",
  score_away: "Away goals",
  xg: "Chance quality (xG)",
  shot_speed_kmh: "Shot speed (km/h)",
  player_goals: "Goals today",
  outcome: "Outcome",
  lines_broken: "Defensive lines broken",
  xt_before: "Threat before (xT)",
  xt_after: "Threat after (xT)",
  threat_multiplier: "Threat increase (×)",
  pass_length_m: "Pass length (m)",
  difficulty: "Pass difficulty (/100)",
  action: "Action",
  danger_removed: "Danger removed (xT)",
  speed_kmh: "Speed (km/h)",
  distance_m: "Carry distance (m)",
  direction: "Direction",
  possessions: "Possessions compared",
  passes_recent: "Passes per possession, now",
  passes_before: "Passes per possession, before",
  since_minute: "Since minute",
  window_min: "Window (min)",
  pressures_recent: "Pressures, latest window",
  pressures_before: "Pressures, window before",
  press_recent_m: "Press height now (m)",
  press_before_m: "Press height before (m)",
  press_change_m: "Press moved (m)",
  threat_10m: "Threat created, 10 min (xT)",
  threat_other_10m: "Opponent threat, 10 min (xT)",
  possession_10m: "Possession, 10 min (%)",
  passes_completed: "Passes completed",
  pass_accuracy: "Pass accuracy (%)",
  threat_added: "Threat added (xT)",
  def_actions: "Tackles + interceptions",
  possession_home: "Home possession (%)",
  possession_away: "Away possession (%)",
  shots_home: "Home shots",
  shots_away: "Away shots",
  xg_home: "Home xG",
  xg_away: "Away xG",
};

// Facts that only exist for wiring, not for viewers.
export const HIDDEN_FACTS = new Set(["team_home", "team_away", "metric"]);

const CHECK_LABELS: Record<string, string> = {
  facts: "Every fact re-derived from the raw match events",
  numbers: "Every number on screen matches a verified fact",
  entities: "Only people involved in this moment are named",
  scope: "No claims beyond this match (seasons, records, history)",
  judge: "AI judge found no contradictions",
};

export function checkLabel(name: string): string {
  if (name.startsWith("fact:")) return `Fact re-derived: ${FACT_LABELS[name.slice(5)] ?? name.slice(5)}`;
  return CHECK_LABELS[name] ?? name;
}

export function sourceLabel(source: string): string {
  const parts = source.split("+").map((s) =>
    s === "template" ? "Deterministic narrator" : s === "azure-openai" ? "Azure OpenAI" : s === "azure-translator" ? "Azure AI Translator" : s,
  );
  return parts.join(" + ");
}

export function agentLabel(agent: string, attempt: number): string {
  const name = agent === "narrator" ? "AI narrator" : agent === "template" ? "Deterministic narrator" : agent === "translator" ? "Translator" : "Orchestrator";
  return attempt > 1 ? `${name} · retry` : name;
}

export const isNumeric = (v: string) => /^-?\d/.test(v);
