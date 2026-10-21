"""Deterministic narration in English, Spanish and Swahili.

This is the offline and fallback narrator. Every number it writes is a fact's display value,
so its output is grounded by construction, yet it still passes through the verifier like
everything else.
"""

from __future__ import annotations

from ..models import Insight, Profile

TEMPLATE_LANGS = ("en", "es", "sw")

PHRASES: dict[str, dict[str, str]] = {
    "en": {
        "goal.casual": "GOAL! {scorer} scores for {team} ({minute}'). {team_home} {score_home}-{score_away} {team_away}.",
        "goal.analyst": "GOAL {minute}' · {scorer} ({team}) · {xg} xG chance, struck at {shot_speed_kmh} km/h · {team_home} {score_home}-{score_away} {team_away}",
        "goal.assist": "Assist: {assist}.",
        "goal.brace": "That's {player_goals} goals for {scorer} today.",
        "big_chance.casual": "Big chance for {team}! {player}'s shot is {outcome_word}.",
        "big_chance.analyst": "{minute}' · {player} ({team}) · {xg} xG chance, {outcome_word} · shot speed {shot_speed_kmh} km/h",
        "line_breaking_pass.casual": "{player} finds {receiver} with a pass that makes the attack {threat_multiplier}x more dangerous.",
        "line_breaking_pass.analyst": "{minute}' · {player} → {receiver} · {pass_length_m} m pass, lines broken: {lines_broken} · threat {xt_before} → {xt_after} xT ({threat_multiplier}x) · difficulty {difficulty}/100",
        "danger_removed.casual": "Vital {action_word} from {player} to snuff out the danger for {team}.",
        "danger_removed.analyst": "{minute}' · {player} ({team}) {action_word} · {danger_removed} xT of danger removed",
        "speed_alert.casual": "{player} is flying: {speed_kmh} km/h on the ball.",
        "speed_alert.analyst": "Top speed · {player} ({team}) · {speed_kmh} km/h over a {distance_m} m carry",
        "control.lost.casual": "{team} are losing their grip. Their last {possessions} possessions averaged just {passes_recent} passes, down from {passes_before}.",
        "control.lost.analyst": "Control shift · {team}: {passes_recent} passes per possession over the last {possessions} (since minute {since_minute}), down from {passes_before}",
        "control.gained.casual": "{team} are taking control: {passes_recent} passes per possession lately, up from {passes_before}.",
        "control.gained.analyst": "Control shift · {team}: {passes_recent} passes per possession over the last {possessions} (since minute {since_minute}), up from {passes_before}",
        "press.higher.casual": "{team} have pushed their press {press_change_m} m further up the pitch.",
        "press.higher.analyst": "Press shift · {team} engaging {press_recent_m} m from own goal, up from {press_before_m} m · {pressures_recent} pressures in the last {window_min} minutes vs {pressures_before} before",
        "press.deeper.casual": "{team} have dropped off, now pressing {press_change_m} m closer to their own goal.",
        "press.deeper.analyst": "Press shift · {team} engaging {press_recent_m} m from own goal, down from {press_before_m} m · {pressures_recent} pressures in the last {window_min} minutes vs {pressures_before} before",
        "tactical_story.casual": "The game has turned. {team_pressing} are pressing {press_change_m} m higher, and {team} can't keep the ball: {passes_recent} passes per possession, down from {passes_before}.",
        "tactical_story.analyst": "Tactical shift · {team_pressing} press up {press_change_m} m ({press_before_m} → {press_recent_m} m from own goal) · {team} passes per possession {passes_before} → {passes_recent} over the last {possessions}",
        "momentum_swing.casual": "Momentum has swung to {team} over the last {window_min} minutes.",
        "momentum_swing.analyst": "Momentum · {team} on top · threat created in the last {window_min} minutes: {threat_10m} xT vs {threat_other_10m} xT for {team_other} · possession {possession_10m}%",
        "player_card.casual": "{player} so far: {passes_completed} passes completed at {pass_accuracy}% accuracy, {def_actions} tackles or interceptions.",
        "player_card.analyst": "{player} · {minute}' · {passes_completed} passes completed ({pass_accuracy}%) · {threat_added} xT added · {def_actions} tackles/interceptions",
        "half_time.casual": "Half-time: {team_home} {score_home}-{score_away} {team_away}.",
        "half_time.analyst": "HT · {team_home} {score_home}-{score_away} {team_away} · possession {possession_home}%-{possession_away}% · shots {shots_home}-{shots_away} · xG {xg_home}-{xg_away}",
        "full_time.casual": "Full-time: {team_home} {score_home}-{score_away} {team_away}.",
        "full_time.analyst": "FT · {team_home} {score_home}-{score_away} {team_away} · possession {possession_home}%-{possession_away}% · shots {shots_home}-{shots_away} · xG {xg_home}-{xg_away}",
        "catchup.header": "Catch-up at {minute}': {team_home} {score_home}-{score_away} {team_away}.",
        "club.for": "Good news for {viewer_club} fans: ",
        "club.against": "Danger for {viewer_club}: ",
        "outcome.saved": "saved", "outcome.off_target": "wide", "outcome.blocked": "blocked",
        "action.tackle": "tackle", "action.interception": "interception",
    },
    "es": {
        "goal.casual": "¡GOL! {scorer} marca para {team} ({minute}'). {team_home} {score_home}-{score_away} {team_away}.",
        "goal.analyst": "GOL {minute}' · {scorer} ({team}) · ocasión de {xg} xG, disparo a {shot_speed_kmh} km/h · {team_home} {score_home}-{score_away} {team_away}",
        "goal.assist": "Asistencia: {assist}.",
        "goal.brace": "{player_goals} goles de {scorer} hoy.",
        "big_chance.casual": "¡Ocasión clara para {team}! El disparo de {player} es {outcome_word}.",
        "big_chance.analyst": "{minute}' · {player} ({team}) · ocasión de {xg} xG, {outcome_word} · velocidad del disparo {shot_speed_kmh} km/h",
        "line_breaking_pass.casual": "{player} encuentra a {receiver} con un pase que hace el ataque {threat_multiplier} veces más peligroso.",
        "line_breaking_pass.analyst": "{minute}' · {player} → {receiver} · pase de {pass_length_m} m, líneas rotas: {lines_broken} · amenaza {xt_before} → {xt_after} xT ({threat_multiplier}x) · dificultad {difficulty}/100",
        "danger_removed.casual": "¡{action_cap} vital de {player} para cortar el peligro de {team}!",
        "danger_removed.analyst": "{minute}' · {action_word} de {player} ({team}) · {danger_removed} xT de peligro eliminado",
        "speed_alert.casual": "{player} vuela: {speed_kmh} km/h con el balón.",
        "speed_alert.analyst": "Velocidad máxima · {player} ({team}) · {speed_kmh} km/h en una conducción de {distance_m} m",
        "control.lost.casual": "{team} pierde el control. Sus últimas {possessions} posesiones promediaron solo {passes_recent} pases, frente a {passes_before} antes.",
        "control.lost.analyst": "Cambio de control · {team}: {passes_recent} pases por posesión en las últimas {possessions} (desde el minuto {since_minute}), antes {passes_before}",
        "control.gained.casual": "{team} toma el control: {passes_recent} pases por posesión últimamente, frente a {passes_before} antes.",
        "control.gained.analyst": "Cambio de control · {team}: {passes_recent} pases por posesión en las últimas {possessions} (desde el minuto {since_minute}), antes {passes_before}",
        "press.higher.casual": "{team} adelanta su presión {press_change_m} m en el campo.",
        "press.higher.analyst": "Cambio de presión · {team} presiona a {press_recent_m} m de su portería, antes a {press_before_m} m · {pressures_recent} presiones en los últimos {window_min} minutos frente a {pressures_before}",
        "press.deeper.casual": "{team} se repliega: ahora presiona {press_change_m} m más cerca de su portería.",
        "press.deeper.analyst": "Cambio de presión · {team} presiona a {press_recent_m} m de su portería, antes a {press_before_m} m · {pressures_recent} presiones en los últimos {window_min} minutos frente a {pressures_before}",
        "tactical_story.casual": "El partido ha cambiado. {team_pressing} presiona {press_change_m} m más arriba y {team} no retiene el balón: {passes_recent} pases por posesión, antes {passes_before}.",
        "tactical_story.analyst": "Cambio táctico · presión de {team_pressing} {press_change_m} m más alta ({press_before_m} → {press_recent_m} m de su portería) · pases por posesión de {team}: {passes_before} → {passes_recent} en las últimas {possessions}",
        "momentum_swing.casual": "El impulso es ahora de {team} en los últimos {window_min} minutos.",
        "momentum_swing.analyst": "Impulso · {team} domina · amenaza creada en los últimos {window_min} minutos: {threat_10m} xT frente a {threat_other_10m} xT de {team_other} · posesión {possession_10m}%",
        "player_card.casual": "{player} hasta ahora: {passes_completed} pases completados con un {pass_accuracy}% de acierto y {def_actions} entradas o intercepciones.",
        "player_card.analyst": "{player} · {minute}' · {passes_completed} pases completados ({pass_accuracy}%) · {threat_added} xT añadido · {def_actions} entradas/intercepciones",
        "half_time.casual": "Descanso: {team_home} {score_home}-{score_away} {team_away}.",
        "half_time.analyst": "Descanso · {team_home} {score_home}-{score_away} {team_away} · posesión {possession_home}%-{possession_away}% · tiros {shots_home}-{shots_away} · xG {xg_home}-{xg_away}",
        "full_time.casual": "Final: {team_home} {score_home}-{score_away} {team_away}.",
        "full_time.analyst": "Final · {team_home} {score_home}-{score_away} {team_away} · posesión {possession_home}%-{possession_away}% · tiros {shots_home}-{shots_away} · xG {xg_home}-{xg_away}",
        "catchup.header": "Resumen al minuto {minute}: {team_home} {score_home}-{score_away} {team_away}.",
        "club.for": "Buenas noticias para la afición de {viewer_club}: ",
        "club.against": "Alerta para {viewer_club}: ",
        "outcome.saved": "atajado", "outcome.off_target": "desviado", "outcome.blocked": "bloqueado",
        "action.tackle": "entrada", "action.interception": "intercepción",
    },
    "sw": {
        "goal.casual": "GOLI! {scorer} anaifungia {team} ({minute}'). {team_home} {score_home}-{score_away} {team_away}.",
        "goal.analyst": "GOLI {minute}' · {scorer} ({team}) · nafasi ya {xg} xG, shuti la km/h {shot_speed_kmh} · {team_home} {score_home}-{score_away} {team_away}",
        "goal.assist": "Pasi ya goli: {assist}.",
        "goal.brace": "Magoli {player_goals} kwa {scorer} leo.",
        "big_chance.casual": "Nafasi kubwa kwa {team}! Shuti la {player} {outcome_word}.",
        "big_chance.analyst": "{minute}' · {player} ({team}) · nafasi ya {xg} xG, {outcome_word} · kasi ya shuti km/h {shot_speed_kmh}",
        "line_breaking_pass.casual": "{player} anampata {receiver} kwa pasi inayofanya shambulizi kuwa hatari mara {threat_multiplier} zaidi.",
        "line_breaking_pass.analyst": "{minute}' · {player} → {receiver} · pasi ya mita {pass_length_m}, safu zilizovunjwa: {lines_broken} · hatari {xt_before} → {xt_after} xT ({threat_multiplier}x) · ugumu {difficulty}/100",
        "danger_removed.casual": "{player} anaiokoa {team} kwa {action_word} muhimu!",
        "danger_removed.analyst": "{minute}' · {player} ({team}) · {action_word} · hatari ya {danger_removed} xT imeondolewa",
        "speed_alert.casual": "{player} anakimbia kwa kasi: km/h {speed_kmh} akiwa na mpira.",
        "speed_alert.analyst": "Kasi ya juu · {player} ({team}) · km/h {speed_kmh} kwa mita {distance_m}",
        "control.lost.casual": "{team} wanapoteza udhibiti. Umiliki wao {possessions} wa mwisho ulikuwa na wastani wa pasi {passes_recent} tu, kutoka {passes_before}.",
        "control.lost.analyst": "Mabadiliko ya udhibiti · {team}: pasi {passes_recent} kwa kila umiliki katika {possessions} ya mwisho (tangu dakika {since_minute}), kutoka {passes_before}",
        "control.gained.casual": "{team} wanachukua udhibiti: pasi {passes_recent} kwa kila umiliki, kutoka {passes_before}.",
        "control.gained.analyst": "Mabadiliko ya udhibiti · {team}: pasi {passes_recent} kwa kila umiliki katika {possessions} ya mwisho (tangu dakika {since_minute}), kutoka {passes_before}",
        "press.higher.casual": "{team} wamepandisha presha yao mita {press_change_m} juu uwanjani.",
        "press.higher.analyst": "Mabadiliko ya presha · {team} wanakaba mita {press_recent_m} kutoka goli lao, kutoka mita {press_before_m} · presha {pressures_recent} katika dakika {window_min} za mwisho dhidi ya {pressures_before} awali",
        "press.deeper.casual": "{team} wamerudi nyuma, sasa wanakaba mita {press_change_m} karibu zaidi na goli lao.",
        "press.deeper.analyst": "Mabadiliko ya presha · {team} wanakaba mita {press_recent_m} kutoka goli lao, kutoka mita {press_before_m} · presha {pressures_recent} katika dakika {window_min} za mwisho dhidi ya {pressures_before} awali",
        "tactical_story.casual": "Mchezo umebadilika. {team_pressing} wanakaba mita {press_change_m} juu zaidi, na {team} hawawezi kumiliki mpira: pasi {passes_recent} kwa kila umiliki, kutoka {passes_before}.",
        "tactical_story.analyst": "Mabadiliko ya kimbinu · presha ya {team_pressing} juu kwa mita {press_change_m} ({press_before_m} → {press_recent_m} m kutoka goli lao) · pasi kwa umiliki za {team}: {passes_before} → {passes_recent} katika {possessions} ya mwisho",
        "momentum_swing.casual": "Kasi ya mchezo sasa iko upande wa {team} katika dakika {window_min} za mwisho.",
        "momentum_swing.analyst": "Kasi ya mchezo · {team} wanatawala · hatari iliyotengenezwa dakika {window_min} za mwisho: {threat_10m} xT dhidi ya {threat_other_10m} xT za {team_other} · umiliki {possession_10m}%",
        "player_card.casual": "{player} hadi sasa: pasi {passes_completed} zimefika kwa usahihi wa {pass_accuracy}%, na makabiliano {def_actions}.",
        "player_card.analyst": "{player} · {minute}' · pasi {passes_completed} ({pass_accuracy}%) · {threat_added} xT · makabiliano {def_actions}",
        "half_time.casual": "Mapumziko: {team_home} {score_home}-{score_away} {team_away}.",
        "half_time.analyst": "Mapumziko · {team_home} {score_home}-{score_away} {team_away} · umiliki {possession_home}%-{possession_away}% · mashuti {shots_home}-{shots_away} · xG {xg_home}-{xg_away}",
        "full_time.casual": "Mwisho wa mchezo: {team_home} {score_home}-{score_away} {team_away}.",
        "full_time.analyst": "Mwisho wa mchezo · {team_home} {score_home}-{score_away} {team_away} · umiliki {possession_home}%-{possession_away}% · mashuti {shots_home}-{shots_away} · xG {xg_home}-{xg_away}",
        "catchup.header": "Muhtasari dakika ya {minute}: {team_home} {score_home}-{score_away} {team_away}.",
        "club.for": "Habari njema kwa mashabiki wa {viewer_club}: ",
        "club.against": "Tahadhari kwa {viewer_club}: ",
        "outcome.saved": "limeokolewa", "outcome.off_target": "limetoka nje", "outcome.blocked": "limezuiwa",
        "action.tackle": "kukaba", "action.interception": "kunasa pasi",
    },
}


def phrase_key(insight: Insight) -> str:
    f = insight.facts
    if insight.kind == "regime_shift":
        return f"{f['metric'].value}.{f['direction'].value}"
    return insight.kind


def club_stance(insight: Insight, club: str | None) -> str | None:
    """'for' when the moment is good news for the viewer's club, 'against' when it is a warning."""
    if not club or insight.team is None or insight.kind in ("half_time", "full_time", "player_card"):
        return None
    good = insight.team == club
    f = insight.facts
    if insight.kind == "regime_shift" and f["metric"].value == "control" and f["direction"].value == "lost":
        good = not good
    if insight.kind == "regime_shift" and f["metric"].value == "press" and f["direction"].value == "deeper":
        return None
    if insight.kind == "danger_removed" and not good:
        return None
    return "for" if good else "against"


def render(insight: Insight, profile: Profile, lang: str | None = None) -> str:
    lang = lang or profile.lang
    table = PHRASES[lang]
    persona = "analyst" if profile.persona == "analyst" else "casual"
    values = insight.fact_values()
    if "outcome" in insight.facts:
        values["outcome_word"] = table[f"outcome.{insight.facts['outcome'].value}"]
    if "action" in insight.facts:
        values["action_word"] = table[f"action.{insight.facts['action'].value}"]
        values["action_cap"] = values["action_word"].capitalize()

    text = table[f"{phrase_key(insight)}.{persona}"].format(**values)
    if insight.kind == "goal":
        sep = " · " if persona == "analyst" else " "
        if "assist" in insight.facts:
            text += sep + table["goal.assist"].format(**values)
        if insight.facts["player_goals"].value >= 2:
            text += sep + table["goal.brace"].format(**values)

    stance = club_stance(insight, profile.club)
    if stance and "viewer_club" in values:
        text = table[f"club.{stance}"].format(**values) + text
    return text


def render_header(insight: Insight, lang: str) -> str:
    return PHRASES[lang]["catchup.header"].format(**insight.fact_values())
