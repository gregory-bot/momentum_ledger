import { useCallback, useEffect, useRef, useState } from "react";

export interface Playback {
  t: number;
  playing: boolean;
  speed: number;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  seek: (t: number) => void;
  setSpeed: (s: number) => void;
}

const FRAME_MS = 1000 / 30; // the clock re-renders at most 30 times a second

/** A local "theatre clock" over the match. Pausing, scrubbing and speed changes cost nothing. */
export function usePlayback(duration: number, initial = 0, autoplay = false): Playback {
  const [t, setT] = useState(initial);
  const [playing, setPlaying] = useState(autoplay);
  const [speed, setSpeed] = useState(() => Number(new URLSearchParams(window.location.search).get("speed")) || 1);
  const ref = useRef({ t: initial, last: 0, painted: 0 });

  useEffect(() => {
    ref.current.t = initial;
    setT(initial);
  }, [initial]);

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    ref.current.last = performance.now();
    const step = (now: number) => {
      const r = ref.current;
      r.t = Math.min(duration, r.t + ((now - r.last) / 1000) * speed);
      r.last = now;
      if (now - r.painted >= FRAME_MS || r.t >= duration) {
        r.painted = now;
        setT(r.t);
      }
      if (r.t >= duration) {
        setPlaying(false);
        return;
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed, duration]);

  const seek = useCallback((to: number) => {
    const v = Math.max(0, Math.min(duration, to));
    ref.current.t = v;
    setT(v);
  }, [duration]);

  const play = useCallback(() => {
    if (ref.current.t >= duration) seek(0);
    setPlaying(true);
  }, [duration, seek]);
  const pause = useCallback(() => setPlaying(false), []);
  const toggle = useCallback(() => (playing ? pause() : play()), [playing, pause, play]);

  return { t, playing, speed, play, pause, toggle, seek, setSpeed };
}
