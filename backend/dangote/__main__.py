"""Command line:

    python -m dangote simulate --out data/match.json        write the synthetic match
    python -m dangote narrate --persona analyst --lang es   print verified overlays for a viewer
    python -m dangote trust                                 print every blocked draft and why
    python -m dangote publish --speed 30                    stream events into Azure Event Hubs
    python -m dangote export --out ../frontend/public/static-api   static JSON for GitHub Pages
    python -m dangote serve                                 run the API on :8010
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .broadcast import Director, LiveSession
from .config import load_settings
from .llm import AzureLLM
from .models import Profile, clock
from .simulator import generate_match, save_match


def _session(args: argparse.Namespace) -> tuple[LiveSession, list]:
    settings = load_settings()
    meta, events = generate_match(args.seed, args.scenario)
    llm = AzureLLM(settings) if settings.llm_enabled else None
    profile = Profile(args.persona, args.club, args.player, args.lang)
    return LiveSession(meta, settings, profile, llm), events


def cmd_simulate(args: argparse.Namespace) -> None:
    meta, events = generate_match(args.seed, args.scenario)
    save_match(Path(args.out), meta, events)
    goals = [f"{e.minute}' {meta.player(e.player_id).name}" for e in events if e.type == "goal"]
    print(f"wrote {len(events)} events to {args.out} · goals: {', '.join(goals)}")


def cmd_narrate(args: argparse.Namespace) -> None:
    session, events = _session(args)
    for e in events:
        for i in session.feed(e):
            r = session.render(i)
            if not r.on_air:
                continue
            if args.json:
                print(json.dumps(Director.overlay(r), ensure_ascii=False))
            else:
                print(f"{clock(i.t)}  [{i.kind:<18}] {r.text}")


def cmd_trust(args: argparse.Namespace) -> None:
    session, events = _session(args)
    verified = blocked = 0
    for e in events:
        for i in session.feed(e):
            for rec in session.render(i).trail:
                if rec.status == "verified":
                    verified += 1
                elif rec.status == "blocked":
                    blocked += 1
                    why = "; ".join(c["detail"] for c in rec.checks if not c["ok"])
                    tag = f" (injected: {rec.injected})" if rec.injected else ""
                    print(f"{rec.minute:>3}' BLOCKED{tag}\n     text: {rec.text}\n     why:  {why}")
    print(f"\n{verified} verified · {blocked} blocked before air")


def cmd_publish(args: argparse.Namespace) -> None:
    settings = load_settings()
    if not settings.eventhubs_enabled:
        sys.exit("Set EVENTHUB_CONNECTION (and EVENTHUB_NAME) to publish to Azure Event Hubs.")
    from .azure_io import publish_events

    meta, events = generate_match(args.seed, args.scenario)
    n = publish_events(settings, events, args.speed)
    print(f"published {n} events for {meta.match_id} to {settings.eventhub_name}")


def cmd_export(args: argparse.Namespace) -> None:
    from .export_static import export

    sizes = export(Path(args.out))
    print(f"exported {sizes['files']} files ({sizes['bytes'] / 1e6:.1f} MB) to {args.out}")


def cmd_serve(args: argparse.Namespace) -> None:
    import uvicorn

    uvicorn.run("dangote.server:app", host=args.host, port=args.port, reload=args.reload)


def main() -> None:
    p = argparse.ArgumentParser(prog="dangote", description="dangote")
    sub = p.add_subparsers(dest="cmd", required=True)

    s = sub.add_parser("simulate")
    s.add_argument("--out", default="data/match.json")
    s.add_argument("--seed", type=int)
    s.add_argument("--scenario", default="press-trap")
    s.set_defaults(fn=cmd_simulate)

    for name, fn in (("narrate", cmd_narrate), ("trust", cmd_trust)):
        n = sub.add_parser(name)
        n.add_argument("--persona", choices=["casual", "analyst"], default="casual")
        n.add_argument("--club", choices=["home", "away"])
        n.add_argument("--player")
        n.add_argument("--lang", default="en")
        n.add_argument("--seed", type=int)
        n.add_argument("--scenario", default="press-trap")
        n.add_argument("--json", action="store_true")
        n.set_defaults(fn=fn)

    pub = sub.add_parser("publish")
    pub.add_argument("--speed", type=float, default=0.0, help="0 = as fast as possible")
    pub.add_argument("--seed", type=int)
    pub.add_argument("--scenario", default="press-trap")
    pub.set_defaults(fn=cmd_publish)

    ex = sub.add_parser("export", help="write a static JSON export for hosting the web app without a server")
    ex.add_argument("--out", default="../frontend/public/static-api")
    ex.set_defaults(fn=cmd_export)

    sv = sub.add_parser("serve")
    sv.add_argument("--host", default="0.0.0.0")
    sv.add_argument("--port", type=int, default=8010)
    sv.add_argument("--reload", action="store_true")
    sv.set_defaults(fn=cmd_serve)

    args = p.parse_args()
    args.fn(args)


if __name__ == "__main__":
    main()
