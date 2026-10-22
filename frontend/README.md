# Dangote · Frontend

The Dangote control room: React 19 + TypeScript + Vite, Consolas throughout. See the [root README](../README.md) for the full picture.

## Run

```bash
npm install
npm run dev        # http://localhost:5173 (proxies /api and /mcp to http://localhost:8010)
npm run build      # strict type-check + production build to dist/
```

Point the dev proxy elsewhere with `VITE_API_PROXY=http://host:port npm run dev`; for a separately hosted API, build with `VITE_API_URL=https://api.example.com`.

## How it works

The app fetches one **match pack** (`/api/matches/prepare`) with the events, a state timeline and every
verified overlay for the viewer, then plays it on a local clock. Pausing, scrubbing and speed changes cost
nothing; changing viewer mode only re-fetches the overlays (cached server-side).

## Structure

```
src/
├── App.tsx                 shell: launch → studio, tabs, deep links, keyboard
├── views/
│   ├── Launch.tsx          storyline picker
│   ├── ControlRoom.tsx     rundown · stage · viewer modes · insight desk
│   ├── MatchPack.tsx       lineups, stats, shot map, xG race, momentum river, players (lazy)
│   ├── TrustLab.tsx        pipeline, fact-check desk, trust log (lazy)
│   └── Developers.tsx      API console, MCP config, tools (lazy)
├── components/
│   ├── Header.tsx          brand, tabs, scoreboard
│   ├── Transport.tsx       play/pause, speed, scrubber with moment markers, clock
│   ├── Monitor3D.tsx       WebGL broadcast monitor (three.js, lazy-loaded): animated players, cameras
│   ├── Pitch3D.tsx         SVG fallback monitor for devices without WebGL
│   ├── OnAir.tsx           goal flash, tactical panel, lower third
│   ├── Rundown.tsx         aired moments, replay from any
│   ├── ViewerModes.tsx     persona, club, language, player lens
│   ├── InsightDesk.tsx     facts and checks behind a line
│   └── Dialogs.tsx         catch me up, compare 3 viewers
├── hooks/
│   ├── usePlayback.ts      local theatre clock (≤30 renders/s)
│   └── usePack.ts          match pack loader (keeps the old pack while re-rendering)
└── lib/
    ├── api.ts · types.ts   typed API client
    ├── derive.ts           state at any t: binary search + single-pass stats
    ├── tracking.ts         positional model: all 22 players + ball (with flight) at any t
    ├── camera.ts           pinhole camera, near-plane clipping, SVG projection
    └── labels.ts           plain-language labels
```

## The broadcast monitor

The event stream records on-ball actions only, so `tracking.ts` places the other 21 players with a
formation model: each holds a 4-3-3 slot that slides with the ball, compresses when defending, the
nearest defender closes down, receivers run onto passes, and substitutes take the slot they replace.
The ball flies between events (lofted for long passes).

`Monitor3D` renders it with three.js: a lit, shadowed pitch, goals with nets, and a blocky footballer per
player in club kit whose legs and arms swing with running speed and who turns to face where they run, with
a number badge above. Tactical, follow-ball and player cameras glide between each other; click any player
to follow them. three.js lives in its own lazy chunk, and `Pitch3D` (SVG) covers loading and devices
without WebGL. Deep link a camera with `?cam=tactical|ball|player|territory`.

## Motion QA

Player motion is checked, not eyeballed. Players move at human speeds in match time (≤ 8.5 m/s off the
ball, ≤ 10.5 m/s for whoever is in the play), everyone involved in the next 5 s of plays starts moving
early (tacklers, interceptors, pass targets) so they arrive as it happens, and team shapes slide with
where the ball has been rather than snapping to every pass. With the backend running:

```bash
npm run qa:motion -- "http://localhost:8010/?scenario=end-to-end&t=60&autoplay=1&speed=2"
```

fails if any player exceeds 12 m/s or the ball carrier drifts > 3 m from the ball in more than 5% of samples.

## Keyboard

`space` play/pause · `←` `→` ±30 s · `1`–`4` tabs.
