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
│   ├── Pitch.tsx           SVG pitch: live trails or 10' territory
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
    └── labels.ts           plain-language labels
```

## Keyboard

`space` play/pause · `←` `→` ±30 s · `1`–`4` tabs.
