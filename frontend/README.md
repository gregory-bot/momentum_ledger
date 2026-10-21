# Momentum Ledger · Frontend

React 19 + TypeScript + Vite. A live broadcast view with verified overlays, viewer personalization, a trust panel and multiview. See the [root README](../README.md) for the full picture.

## Run

```bash
npm install
npm run dev        # http://localhost:5173 (proxies /api to http://localhost:8010)
npm run build      # strict type-check + production build to dist/
```

Point the dev proxy at another backend with `VITE_API_PROXY=http://host:port npm run dev`. For a separately hosted API, build with `VITE_API_URL=https://api.example.com`.

## Structure

```
src/
├── App.tsx                    layout, viewer state, deep links (?persona=&club=&player=&lang=&start=&speed=&autoplay=1)
├── components/
│   ├── Broadcast.tsx          screen: scorebug, pitch, graphics, meters
│   ├── Pitch.tsx              SVG pitch (memoized markings, ball, action trail)
│   ├── GraphicLayer.tsx       goal flash, tactical panel, lower-third
│   ├── ViewerPanel.tsx        mode, club, Player Lens, language, playback
│   ├── TrustPanel.tsx         verified / blocked drafts with reasons
│   ├── Feeds.tsx              on-air feed + overlay JSON inspector
│   ├── Multiview.tsx          three viewers side by side (lazy-loaded)
│   └── CatchUpDialog.tsx      "I just joined" recap
├── hooks/
│   ├── useMatchStream.ts      SSE client, buffered and flushed once per animation frame
│   └── useGraphicsQueue.ts    plays overlays by priority, like a vision mixer
└── lib/
    ├── api.ts                 typed API client
    └── types.ts               API types
```

## Performance notes

- No UI framework or state library: 74 KB gzipped in total.
- Stream updates are batched per animation frame, so the UI stays smooth at 600× replay.
- Multiview streams use `ticks=false`, so the server sends overlays only.
