// The commentary desk and stadium sound.
//
// - Commentary: the browser's speech engine reads each verified on-air line as it airs, and between
//   moments a play-by-play voice calls the action from the events (names and actions only, never
//   numbers, so nothing unverified is ever said).
// - Stadium: a synthesized crowd bed that swells with excitement, kicks on passes and shots,
//   whistles for kick-off, half-time and full-time, and a roar for goals.
//
// Browsers only allow sound after a user gesture, so `unlock()` is called from the play button.

import type { Overlay, PackEvent } from "./types";

const LANG_PREFIX: Record<string, string> = { en: "en", es: "es", sw: "sw", fr: "fr", pt: "pt", ar: "ar", hi: "hi", yo: "yo", "zh-Hans": "zh" };

function readPref(): boolean {
  try {
    return localStorage.getItem("dangote.audio") !== "0";
  } catch {
    return true;
  }
}

function speakable(text: string): string {
  return text
    .replace(/\s·\s/g, ", ")
    .replace(/→/g, " to ")
    .replace(/\/100\b/g, " out of 100")
    .replace(/(\d)-0\b/g, "$1 nil")
    .replace(/(\d)-(\d)/g, "$1 $2")
    .replace(/\bxG\b/g, "expected goals")
    .replace(/\bxT\b/g, "threat")
    .replace(/km\/h/g, "kilometres per hour")
    .replace(/(\d+)'/g, "minute $1")
    .replace(/\s+/g, " ")
    .trim();
}

function scoreVoice(v: SpeechSynthesisVoice, prefix: string): number {
  const lang = v.lang.toLowerCase();
  if (!lang.startsWith(prefix)) return -1;
  const name = v.name.toLowerCase();
  let s = 1;
  if (/natural|neural|online|premium|enhanced/.test(name)) s += 6;
  if (prefix === "en" && (lang === "en-gb" || lang === "en-us")) s += 3;
  if (/daniel|george|ryan|guy|brian|christopher|arthur|alex/.test(name)) s += 2;
  if (!v.localService) s += 1;
  return s;
}

export class AudioDesk {
  enabled = readPref(); // user preference (the "audio on" chip), on by default
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private crowd: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private excitement = 0;
  private lastWall = 0;
  private kickCooldown = 0;
  private pointer = 0;
  private prevT = Number.NaN;
  private playing = false;
  private speaking = false;
  private queue: { text: string; lang: string }[] = [];
  private spoken = new Set<string>();
  private lastCall = 0;
  private voices = new Map<string, SpeechSynthesisVoice | null>();
  private names = new Map<string, string>(); // player id -> surname, for "Mensah... to Vale"

  setRoster(players: { id: string; name: string }[]) {
    this.names = new Map(players.map((p) => [p.id, p.name.split(" ").slice(-1)[0]]));
  }

  /** Must be called from a click/keypress. Safe to call repeatedly. */
  unlock() {
    if (!this.enabled) return;
    if (!this.ctx) {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      this.ctx = ctx;
      this.master = ctx.createGain();
      this.master.gain.value = 0.9;
      this.master.connect(ctx.destination);
      // Brown noise, low-passed: a distant crowd.
      const len = ctx.sampleRate * 2;
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      let last = 0;
      for (let i = 0; i < len; i++) {
        last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
        d[i] = last * 3.2;
      }
      this.noise = buf;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 620;
      this.crowd = ctx.createGain();
      this.crowd.gain.value = 0.0001;
      src.connect(lp).connect(this.crowd).connect(this.master);
      src.start();
    }
    void this.ctx.resume();
    if (typeof speechSynthesis !== "undefined") speechSynthesis.onvoiceschanged = () => this.voices.clear();
  }

  setEnabled(on: boolean) {
    this.enabled = on;
    if (on) this.unlock();
    else this.silence();
  }

  private silence() {
    if (this.ctx && this.crowd) this.crowd.gain.setTargetAtTime(0.0001, this.ctx.currentTime, 0.15);
    if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
    this.speaking = false;
    this.queue = [];
  }

  private voiceFor(lang: string): SpeechSynthesisVoice | null {
    const prefix = LANG_PREFIX[lang] ?? lang.slice(0, 2);
    if (this.voices.has(prefix)) return this.voices.get(prefix)!;
    let best: SpeechSynthesisVoice | null = null;
    let bestScore = 0;
    for (const v of typeof speechSynthesis !== "undefined" ? speechSynthesis.getVoices() : []) {
      const s = scoreVoice(v, prefix);
      if (s > bestScore) { best = v; bestScore = s; }
    }
    this.voices.set(prefix, best);
    return best;
  }

  /** True when the device has a voice for this language (otherwise only the stadium plays). */
  canSpeak(lang: string) {
    return typeof speechSynthesis !== "undefined" && !!this.voiceFor(lang);
  }

  /** A verified on-air line: read in full; goals and headline moments jump the queue. */
  moment(o: Overlay, speed: number) {
    if (!this.ready() || this.spoken.has(o.id)) return;
    this.spoken.add(o.id);
    if (speed > 10 && o.priority < 3) return; // at high speed only the headlines are read
    const item = { text: speakable(o.text), lang: o.lang };
    if (o.priority >= 3) {
      this.queue = [];
      if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
      this.speaking = false;
      this.say(item, true);
    } else if (this.speaking) {
      if (this.queue.length >= 2) this.queue.shift();
      this.queue.push(item);
    } else this.say(item);
    this.lastCall = performance.now();
  }

  /** Called every clock tick with the events: drives play-by-play and stadium sound. */
  update(events: PackEvent[], t: number, playing: boolean, speed: number, lang: string) {
    const was = this.playing;
    this.playing = playing;
    if (!this.ready()) return;
    const now = performance.now();
    const dt = this.lastWall ? Math.min(1, (now - this.lastWall) / 1000) : 0.1;
    this.lastWall = now;
    this.excitement *= Math.exp(-dt / 4);
    this.kickCooldown = Math.max(0, this.kickCooldown - dt);
    if (!playing) {
      if (was) this.silence();
      this.prevT = t;
      return;
    }
    this.crowd!.gain.setTargetAtTime(Math.min(0.2, 0.035 + this.excitement * 0.11), this.ctx!.currentTime, 0.35);

    // A jump (scrub, rewind, or a big speed hop) re-seeks without replaying sounds.
    if (Number.isNaN(this.prevT) || t < this.prevT || t - this.prevT > 4 * Math.max(1, speed)) {
      let lo = 0, hi = events.length;
      while (lo < hi) { const m = (lo + hi) >> 1; if (events[m].t <= t) lo = m + 1; else hi = m; }
      this.pointer = lo;
      this.prevT = t;
      return;
    }
    let latest: PackEvent | null = null;
    while (this.pointer < events.length && events[this.pointer].t <= t) {
      const e = events[this.pointer++];
      if (speed <= 10) this.sfx(e);
      latest = e;
    }
    this.prevT = t;

    // Play-by-play between moments, at watchable speeds, when nobody else is talking.
    if (latest && speed <= 4 && !this.speaking && now - this.lastCall > 2600 && lang === "en") {
      const line = this.call(latest);
      if (line) {
        this.say({ text: line, lang }, false, true);
        this.lastCall = now;
      }
    }
  }

  private call(e: PackEvent): string | null {
    const who = e.player?.split(" ").slice(-1)[0];
    if (!who) return null;
    switch (e.type) {
      case "pass": {
        if (e.outcome === "fail") return `${who}... gives it away.`;
        const to = e.receiver_id ? this.names.get(e.receiver_id) : undefined;
        return to ? `${who}... to ${to}.` : `${who}.`;
      }
      case "carry": return `${who}, driving forward.`;
      case "shot": return e.outcome === "goal" ? null : e.outcome === "saved" ? `${who} shoots... saved!` : e.outcome === "blocked" ? `${who} shoots, blocked!` : `${who} shoots... wide.`;
      case "tackle": return `Good tackle, ${who}.`;
      case "interception": return `${who} reads it, intercepts.`;
      case "pressure": return Math.random() < 0.35 ? `${who} closing down.` : null;
      default: return null;
    }
  }

  private ready() {
    return this.enabled && !!this.ctx && this.ctx.state === "running";
  }

  private say(item: { text: string; lang: string }, urgent = false, quick = false) {
    if (typeof speechSynthesis === "undefined") return;
    const voice = this.voiceFor(item.lang);
    if (!voice) return; // no voice for this language on this device: the stadium still plays
    const u = new SpeechSynthesisUtterance(item.text);
    u.voice = voice;
    u.lang = voice.lang;
    u.rate = urgent ? 1.18 : quick ? 1.15 : 1.05;
    u.pitch = urgent ? 1.08 : 1;
    u.volume = quick ? 0.85 : 1;
    u.onend = () => {
      this.speaking = false;
      const next = this.queue.shift();
      if (next && this.playing && this.enabled) this.say(next);
    };
    u.onerror = () => { this.speaking = false; };
    this.speaking = true;
    speechSynthesis.speak(u);
  }

  // ---- stadium -----------------------------------------------------------------------------
  private sfx(e: PackEvent) {
    switch (e.type) {
      case "pass": this.kick(0.25); break;
      case "shot": this.kick(0.95); this.excitement = Math.max(this.excitement, e.outcome === "goal" ? 1 : 0.5); break;
      case "goal": this.roar(); break;
      case "tackle": case "interception": this.kick(0.4); break;
      case "kickoff": this.whistle(1); break;
      case "half_time": this.whistle(2); break;
      case "full_time": this.whistle(3); break;
    }
  }

  private kick(strength: number) {
    if (!this.ctx || !this.noise || !this.master || this.kickCooldown > 0) return;
    this.kickCooldown = 0.12;
    const ctx = this.ctx, t0 = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 600 + strength * 600;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.35 * strength, t0 + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.1);
    src.connect(bp).connect(g).connect(this.master);
    src.start(t0, Math.random(), 0.14);
    const thud = ctx.createOscillator();
    thud.frequency.setValueAtTime(120, t0);
    thud.frequency.exponentialRampToValueAtTime(50, t0 + 0.08);
    const tg = ctx.createGain();
    tg.gain.setValueAtTime(0.25 * strength, t0);
    tg.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.1);
    thud.connect(tg).connect(this.master);
    thud.start(t0);
    thud.stop(t0 + 0.12);
  }

  private whistle(blasts: number) {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx;
    for (let i = 0; i < blasts; i++) {
      const t0 = ctx.currentTime + i * 0.45;
      const len = i === blasts - 1 && blasts > 1 ? 0.7 : 0.32;
      const o = ctx.createOscillator();
      o.type = "square";
      o.frequency.value = 2900;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 38;
      const lg = ctx.createGain();
      lg.gain.value = 120;
      lfo.connect(lg).connect(o.frequency);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.05, t0 + 0.02);
      g.gain.setValueAtTime(0.05, t0 + len - 0.05);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + len);
      o.connect(g).connect(this.master);
      o.start(t0); lfo.start(t0);
      o.stop(t0 + len); lfo.stop(t0 + len);
    }
  }

  private roar() {
    if (!this.ctx || !this.noise || !this.master) return;
    this.excitement = 1;
    const ctx = this.ctx, t0 = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 900;
    bp.Q.value = 0.6;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.5, t0 + 0.5);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 4.5);
    src.connect(bp).connect(g).connect(this.master);
    src.start(t0);
    src.stop(t0 + 4.6);
  }
}

export const audio = new AudioDesk();
