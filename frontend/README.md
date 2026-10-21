# Momentum Ledger · Frontend

React 19 + TypeScript + Vite. A live broadcast view with verified overlays, viewer personalization, a trust panel and multiview. See the [root README](../README.md) for the full picture.

## Run

```bash
npm install
npm run dev        # http://localhost:5173 (proxies /api to http://localhost:8010)
npm run build      # strict type-check + production build to dist/
```

Point the dev proxy at another backend with `VITE_API_PROXY=http://host:port npm run dev`. For a separately hosted API, build with `VITE_API_URL=https://api.example.com`.

## Design

- **Mobile first.** On phones, graphics appear in a "Now on air" card *below* the pitch so they never hide the play. From 720px up they're keyed over the pitch like broadcast graphics.
- **Plain language.** "Why you can trust this" explains the selected line: who is involved, the numbers behind it, and each check it passed. The raw overlay JSON is tucked behind a developer toggle.
- **Blue broadcast theme** with tabular numbers, high-contrast text and reduced-motion support.

## Structure

```
src/
├── App.tsx                    layout, viewer state, selection, deep links
├── components/
│   ├── TopBar.tsx             brand, match, live status, "Azure stack" popover
│   ├── Broadcast.tsx          pitch screen, scorebug, stats strip
│   ├── Pitch.tsx              SVG pitch (memoized markings, ball, action trail)
│   ├── GraphicLayer.tsx       on-air graphic: goal flash, tactical panel, lower-third
│   ├── ViewerPanel.tsx        "Make it yours": detail level, club, player, language, playback
│   ├── InsightTabs.tsx        Live feed + Trust log tabs
│   ├── ProofPanel.tsx         "Why you can trust this" (+ developer JSON view)
│   ├── Multiview.tsx          three viewers side by side (lazy-loaded)
│   └── CatchUpDialog.tsx      "I just joined" recap (bottom sheet on phones)
├── hooks/
│   ├── useMatchStream.ts      SSE client, buffered and flushed once per animation frame
│   └── useGraphicsQueue.ts    plays overlays by priority, like a vision mixer
└── lib/
    ├── api.ts                 typed API client
    ├── labels.ts              plain-language labels for facts, checks and sources
    └── types.ts               API types
```

## Performance notes

- No UI framework or state library: 74 KB gzipped in total.
- Stream updates are batched per animation frame, so the UI stays smooth at 600× replay.
- Multiview streams use `ticks=false`, so the server sends overlays only.
