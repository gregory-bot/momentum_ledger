// WebGL broadcast monitor: a lit pitch, animated player figures with number badges, goals with nets,
// a ball with a trail, and tactical / follow-ball / player cameras. Loaded lazily; the SVG monitor
// (Pitch3D) is the fallback when WebGL isn't available.

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { frameAt, lineupAt } from "../lib/tracking";
import type { Pack, Side } from "../lib/types";
import type { CamMode } from "./Pitch3D";

interface Props {
  pack: Pack;
  t: number;
  speed: number;
  playing: boolean;
  mode: CamMode;
  followId: string | null;
  onFollow: (id: string) => void;
}

// World mapping: pitch metres (x along, y across) -> three.js (X right, Y up, Z toward camera).
const wx = (x: number) => x - 52.5;
const wz = (y: number) => 34 - y;

const SKIN = ["#5c3a21", "#8d5524", "#a86b3c", "#c68642", "#e0ac69", "#f1c27d"];
const GK_SHIRT: Record<Side, string> = { home: "#facc15", away: "#22c55e" };
const SHORTS: Record<Side, string> = { home: "#f1f5f9", away: "#0f172a" };

const matCache = new Map<string, THREE.MeshStandardMaterial>();
function mat(color: string, roughness = 0.7) {
  const k = `${color}:${roughness}`;
  let m = matCache.get(k);
  if (!m) matCache.set(k, (m = new THREE.MeshStandardMaterial({ color, roughness })));
  return m;
}

function box(w: number, h: number, d: number, m: THREE.Material) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  mesh.castShadow = true;
  return mesh;
}

/** A blocky footballer whose limbs swing with running speed and who turns to face where he runs. */
function makeFigure(shirt: string, shorts: string, socks: string, skin: string) {
  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);
  const torso = box(0.46, 0.54, 0.26, mat(shirt, 0.6));
  torso.position.y = 1.25;
  const pants = box(0.42, 0.22, 0.25, mat(shorts));
  pants.position.y = 0.92;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.15, 14, 10), mat(skin, 0.85));
  head.position.y = 1.67;
  head.castShadow = true;
  body.add(torso, pants, head);
  const limb = (m: THREE.Material, len: number, thick: number, x: number, y: number) => {
    const pivot = new THREE.Group();
    const seg = box(thick, len, thick, m);
    seg.position.y = -len / 2;
    pivot.add(seg);
    pivot.position.set(x, y, 0);
    body.add(pivot);
    return pivot;
  };
  const legL = limb(mat(socks), 0.82, 0.15, 0.12, 0.86);
  const legR = limb(mat(socks), 0.82, 0.15, -0.12, 0.86);
  const armL = limb(mat(skin, 0.85), 0.56, 0.1, 0.28, 1.47);
  const armR = limb(mat(skin, 0.85), 0.56, 0.1, -0.28, 1.47);
  let phase = Math.random() * 6;
  let heading = 0;
  return {
    group,
    update(dx: number, dz: number, kph: number, dt: number) {
      const effort = Math.min(1, kph / 24);
      phase += dt * (2.2 + kph * 0.62);
      const swing = Math.sin(phase) * effort * 0.85;
      legL.rotation.x = swing;
      legR.rotation.x = -swing;
      armL.rotation.x = -swing * 0.7;
      armR.rotation.x = swing * 0.7;
      body.position.y = Math.abs(Math.cos(phase)) * 0.05 * effort;
      body.rotation.x = effort * 0.12; // lean into the run
      if (Math.hypot(dx, dz) > 0.004) {
        const want = Math.atan2(dx, dz);
        let d = (want - heading) % (Math.PI * 2);
        if (d > Math.PI) d -= Math.PI * 2;
        if (d < -Math.PI) d += Math.PI * 2;
        heading += d * (1 - Math.exp(-8 * dt));
        group.rotation.y = heading;
      }
    },
  };
}

function badgeTexture(text: string, bg: string) {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  g.beginPath();
  g.arc(32, 32, 27, 0, Math.PI * 2);
  g.fillStyle = bg;
  g.fill();
  g.lineWidth = 4;
  g.strokeStyle = "rgba(255,255,255,.92)";
  g.stroke();
  g.fillStyle = "#fff";
  g.font = "700 28px Consolas, Inconsolata, monospace";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(text, 32, 34);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function labelSprite(text: string) {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 96;
  const g = c.getContext("2d")!;
  g.font = "700 46px Consolas, Inconsolata, monospace";
  const w = Math.min(500, g.measureText(text).width + 40);
  g.fillStyle = "rgba(5,8,15,.82)";
  g.beginPath();
  g.roundRect((512 - w) / 2, 14, w, 68, 12);
  g.fill();
  g.fillStyle = "#fff";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(text, 256, 50);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
  s.scale.set(5.6, 1.05, 1);
  s.renderOrder = 10;
  return s;
}

function pitchTexture() {
  const PX = 20; // pixels per metre
  const c = document.createElement("canvas");
  c.width = 105 * PX;
  c.height = 68 * PX;
  const g = c.getContext("2d")!;
  for (let i = 0; i < 14; i++) {
    g.fillStyle = i % 2 ? "#2a6b43" : "#2f7549";
    g.fillRect(i * 7.5 * PX, 0, 7.5 * PX + 1, c.height);
  }
  const X = (x: number) => x * PX;
  const Y = (y: number) => y * PX;
  g.strokeStyle = "rgba(245,250,245,.9)";
  g.fillStyle = "rgba(245,250,245,.9)";
  g.lineWidth = 0.13 * PX;
  g.strokeRect(X(0.06), Y(0.06), X(104.88), Y(67.88));
  g.beginPath(); g.moveTo(X(52.5), 0); g.lineTo(X(52.5), c.height); g.stroke();
  g.beginPath(); g.arc(X(52.5), Y(34), 9.15 * PX, 0, Math.PI * 2); g.stroke();
  for (const [x, s] of [[0, 1], [105, -1]] as const) {
    g.strokeRect(X(Math.min(x, x + s * 16.5)), Y(13.84), 16.5 * PX, 40.32 * PX);
    g.strokeRect(X(Math.min(x, x + s * 5.5)), Y(24.84), 5.5 * PX, 18.32 * PX);
    const spot = x + s * 11;
    g.beginPath(); g.arc(X(spot), Y(34), 0.25 * PX, 0, Math.PI * 2); g.fill();
    g.beginPath();
    const a = Math.acos(5.5 / 9.15);
    if (s === 1) g.arc(X(spot), Y(34), 9.15 * PX, -a, a);
    else g.arc(X(spot), Y(34), 9.15 * PX, Math.PI - a, Math.PI + a);
    g.stroke();
  }
  g.beginPath(); g.arc(X(52.5), Y(34), 0.25 * PX, 0, Math.PI * 2); g.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function netTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  g.strokeStyle = "rgba(235,240,245,.6)";
  g.lineWidth = 1.5;
  for (let i = 0; i <= 64; i += 8) {
    g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 64); g.stroke();
    g.beginPath(); g.moveTo(0, i); g.lineTo(64, i); g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(6, 2);
  return tex;
}

function makeGoals() {
  const group = new THREE.Group();
  const post = mat("#f4f6f8", 0.35);
  const net = new THREE.MeshBasicMaterial({ map: netTexture(), transparent: true, side: THREE.DoubleSide, depthWrite: false });
  const H = 2.44, HW = 3.66, D = 2;
  for (const sign of [-1, 1]) {
    const goal = new THREE.Group();
    for (const z of [-HW, HW]) {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, H, 10), post);
      p.position.set(0, H / 2, z);
      p.castShadow = true;
      goal.add(p);
    }
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, HW * 2, 10), post);
    bar.rotation.x = Math.PI / 2;
    bar.position.y = H;
    goal.add(bar);
    const back = new THREE.Mesh(new THREE.PlaneGeometry(HW * 2, H), net);
    back.rotation.y = Math.PI / 2;
    back.position.set(sign * D, H / 2, 0);
    const top = new THREE.Mesh(new THREE.PlaneGeometry(D, HW * 2), net);
    top.rotation.x = Math.PI / 2;
    top.position.set((sign * D) / 2, H, 0);
    goal.add(back, top);
    for (const z of [-HW, HW]) {
      const side = new THREE.Mesh(new THREE.PlaneGeometry(D, H), net);
      side.position.set((sign * D) / 2, H / 2, z);
      goal.add(side);
    }
    goal.position.x = sign * 52.5;
    group.add(goal);
  }
  return group;
}

export default function Monitor3D(props: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const live = useRef(props);
  live.current = props;

  useEffect(() => {
    const canvas = canvasRef.current!;
    const { pack } = live.current;
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#070b10");
    scene.fog = new THREE.Fog("#070b10", 120, 230);
    const camera = new THREE.PerspectiveCamera(50, 5 / 3, 0.5, 400);
    camera.position.set(0, 64, 56);
    const look = new THREE.Vector3(0, 0, -3);

    scene.add(new THREE.HemisphereLight("#dfeaff", "#1a2a1a", 0.9));
    const sun = new THREE.DirectionalLight("#ffffff", 1.7);
    sun.position.set(-35, 70, 40);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -70, right: 70, top: 50, bottom: -50, near: 10, far: 200 });
    scene.add(sun);

    const apron = new THREE.Mesh(new THREE.PlaneGeometry(150, 110), new THREE.MeshStandardMaterial({ color: "#14301f", roughness: 1 }));
    apron.rotation.x = -Math.PI / 2;
    apron.position.y = -0.02;
    apron.receiveShadow = true;
    const pitch = new THREE.Mesh(new THREE.PlaneGeometry(105, 68), new THREE.MeshStandardMaterial({ map: pitchTexture(), roughness: 0.95 }));
    pitch.rotation.x = -Math.PI / 2;
    pitch.receiveShadow = true;
    scene.add(apron, pitch, makeGoals());

    // Territory overlay (redrawn every few match seconds while that camera is active).
    const terrCanvas = document.createElement("canvas");
    terrCanvas.width = 12;
    terrCanvas.height = 8;
    const terrTex = new THREE.CanvasTexture(terrCanvas);
    terrTex.magFilter = THREE.NearestFilter;
    const terr = new THREE.Mesh(new THREE.PlaneGeometry(105, 68), new THREE.MeshBasicMaterial({ map: terrTex, transparent: true, depthWrite: false }));
    terr.rotation.x = -Math.PI / 2;
    terr.position.y = 0.03;
    scene.add(terr);
    let terrStamp = -1;

    // Players: one figure, badge and hit-box per squad member, created up front.
    const colors: Record<Side, string> = { home: pack.meta.home.color, away: pack.meta.away.color };
    const figures = new Map<string, { fig: ReturnType<typeof makeFigure>; badge: THREE.Sprite; last: [number, number] | null }>();
    const pickables: THREE.Object3D[] = [];
    for (const side of ["home", "away"] as Side[]) {
      for (const p of [...pack.meta[side].players, ...pack.meta[side].bench]) {
        const shirt = p.role === "GK" ? GK_SHIRT[side] : colors[side];
        const fig = makeFigure(shirt, SHORTS[side], shirt, SKIN[(p.number * 7 + (side === "home" ? 1 : 4)) % SKIN.length]);
        fig.group.scale.setScalar(1.3); // a touch larger than life so they read on a wide shot
        fig.group.userData.playerId = p.id;
        fig.group.traverse((o) => { o.userData.playerId = p.id; });
        const badge = new THREE.Sprite(new THREE.SpriteMaterial({ map: badgeTexture(String(p.number), colors[side]), depthTest: false }));
        badge.scale.setScalar(1.55);
        badge.renderOrder = 5;
        badge.userData.playerId = p.id;
        fig.group.visible = badge.visible = false;
        scene.add(fig.group, badge);
        pickables.push(fig.group, badge);
        figures.set(p.id, { fig, badge, last: null });
      }
    }
    const ring = (inner: number, outer: number, color: string, opacity: number) => {
      const m = new THREE.Mesh(new THREE.RingGeometry(inner, outer, 32), new THREE.MeshBasicMaterial({ color, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false }));
      m.rotation.x = -Math.PI / 2;
      m.position.y = 0.04;
      scene.add(m);
      return m;
    };
    const holderRing = ring(0.95, 1.2, "#ffffff", 0.9);
    const focusRing = ring(1.3, 1.6, "#ffb547", 0.95);
    let label: THREE.Sprite | null = null;
    let labelFor: string | null = null;

    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.3, 18, 14), new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.35, emissive: "#222222" }));
    ball.castShadow = true;
    scene.add(ball);
    const TRAIL = 36;
    const trailPos = new Float32Array(TRAIL * 3);
    const trailGeo = new THREE.BufferGeometry();
    trailGeo.setAttribute("position", new THREE.BufferAttribute(trailPos, 3));
    trailGeo.setDrawRange(0, 0);
    scene.add(new THREE.Line(trailGeo, new THREE.LineBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.35 })));
    let trailLen = 0;

    const resize = () => {
      const parent = canvas.parentElement!;
      renderer.setSize(parent.clientWidth, parent.clientHeight, false);
      camera.aspect = parent.clientWidth / Math.max(1, parent.clientHeight);
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas.parentElement!);

    // Click a player to follow; pointer cursor on hover.
    const ray = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const pick = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      const hit = ray.intersectObjects(pickables.filter((o) => o.visible), true)[0];
      return (hit?.object.userData.playerId as string | undefined) ?? null;
    };
    const onClick = (e: PointerEvent) => {
      const id = pick(e);
      if (id) live.current.onFollow(id);
    };
    let hoverAt = 0;
    const onMove = (e: PointerEvent) => {
      if (performance.now() - hoverAt < 80) return;
      hoverAt = performance.now();
      canvas.style.cursor = pick(e) ? "pointer" : "default";
    };
    canvas.addEventListener("pointerup", onClick);
    canvas.addEventListener("pointermove", onMove);

    let slots = lineupAt(pack.meta, pack.events, live.current.t);
    let slotMinute = Math.floor(live.current.t / 60);
    let lastT = live.current.t;
    let propT = live.current.t;
    let propAt = performance.now();
    let last = performance.now();
    let first = true;
    let raf = 0;
    const wantPos = new THREE.Vector3();
    const wantLook = new THREE.Vector3();

    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const p = live.current;
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      // The app clock ticks ~30×/s; interpolate between ticks so motion is smooth at 60 fps.
      if (p.t !== propT) { propT = p.t; propAt = now; }
      const tv = p.playing ? propT + Math.min(0.05, (now - propAt) / 1000) * p.speed : propT;
      const minute = Math.floor(tv / 60);
      if (minute !== slotMinute) {
        slots = lineupAt(pack.meta, pack.events, tv);
        slotMinute = minute;
      }
      const frame = frameAt(pack, slots, tv);
      // Players move at human speeds in *match* time: each frame they may close at most
      // vmax * (match seconds elapsed) on their target. A scrub (jump back, or > 3 s forward,
      // or any change while paused) snaps them instead.
      const dtm = tv - lastT;
      lastT = tv;
      const snap = dtm < 0 || dtm > 3 || (!p.playing && dtm !== 0);
      const onPitch = new Set<string>();
      let followXZ: [number, number] | null = null;

      for (const pin of frame.players) {
        const f = figures.get(pin.id);
        if (!f) continue;
        onPitch.add(pin.id);
        let [x, y] = [pin.x, pin.y];
        const prev = f.last;
        if (prev && !snap) {
          const gap = Math.hypot(x - prev[0], y - prev[1]);
          const vmax = pin.role === "none" ? 8.5 : 10.5; // m/s: jog-to-sprint off the ball, flat out on it
          const step = Math.min(gap, vmax * dtm);
          if (gap > 1e-6) {
            x = prev[0] + ((x - prev[0]) / gap) * step;
            y = prev[1] + ((y - prev[1]) / gap) * step;
          }
        }
        const dx = prev && !snap ? x - prev[0] : 0;
        const dy = prev && !snap ? y - prev[1] : 0;
        f.last = [x, y];
        // Running speed in match time drives the stride; standing still when paused.
        const kph = !snap && dtm > 0 ? Math.min(36, (Math.hypot(dx, dy) / dtm) * 3.6) : 0;
        f.fig.group.visible = f.badge.visible = true;
        f.fig.group.position.set(wx(x), 0, wz(y));
        f.fig.update(dx, -dy, kph, dt);
        f.badge.position.set(wx(x), 3.05, wz(y));
        if (pin.id === frame.holder) holderRing.position.set(wx(x), 0.04, wz(y));
        if (pin.id === p.followId) followXZ = [wx(x), wz(y)];
      }
      for (const [id, f] of figures) if (!onPitch.has(id)) f.fig.group.visible = f.badge.visible = false;
      holderRing.visible = !!frame.holder;
      focusRing.visible = !!followXZ;
      if (followXZ) focusRing.position.set(followXZ[0], 0.05, followXZ[1]);

      // Name tag over the followed player.
      if (p.followId !== labelFor) {
        if (label) { scene.remove(label); label.material.map?.dispose(); label.material.dispose(); label = null; }
        labelFor = p.followId;
        const player = [...pack.meta.home.players, ...pack.meta.home.bench, ...pack.meta.away.players, ...pack.meta.away.bench].find((x) => x.id === p.followId);
        if (player) { label = labelSprite(player.name); scene.add(label); }
      }
      if (label) {
        label.visible = !!followXZ;
        if (followXZ) label.position.set(followXZ[0], 4.6, followXZ[1]);
      }

      // Debug/QA hook: the positions actually drawn this frame (read by automated motion checks).
      (window as unknown as { __dangote?: unknown }).__dangote = {
        t: tv, now, players: [...figures].filter(([, f]) => f.fig.group.visible).map(([id, f]) => [id, f.last![0], f.last![1]]),
        ball: [frame.ball.x, frame.ball.y, frame.ball.z], holder: frame.holder,
        targets: frame.players.map((q) => [q.id, q.x, q.y, q.role]),
      };
      const bx = wx(frame.ball.x), bz = wz(frame.ball.y), by = 0.3 + frame.ball.z;
      ball.position.set(bx, by, bz);
      for (let i = Math.min(trailLen, TRAIL - 1); i > 0; i--) {
        trailPos[i * 3] = trailPos[(i - 1) * 3];
        trailPos[i * 3 + 1] = trailPos[(i - 1) * 3 + 1];
        trailPos[i * 3 + 2] = trailPos[(i - 1) * 3 + 2];
      }
      trailPos.set([bx, Math.max(0.12, by - 0.2), bz], 0);
      trailLen = p.playing ? Math.min(trailLen + 1, TRAIL) : trailLen;
      trailGeo.setDrawRange(0, trailLen);
      trailGeo.attributes.position.needsUpdate = true;

      if (p.mode === "territory") {
        const stamp = Math.floor(p.t / 5);
        if (stamp !== terrStamp) {
          terrStamp = stamp;
          const g = terrCanvas.getContext("2d")!;
          g.clearRect(0, 0, 12, 8);
          const cells = Array.from({ length: 96 }, () => ({ home: 0, away: 0 }));
          for (const e of pack.events) {
            if (e.t > p.t) break;
            if (e.t < p.t - 600 || e.x === undefined || !e.team) continue;
            cells[Math.min(7, Math.floor((e.y! / 68) * 8)) * 12 + Math.min(11, Math.floor((e.x / 105) * 12))][e.team]++;
          }
          const max = Math.max(1, ...cells.map((c) => c.home + c.away));
          cells.forEach((c, i) => {
            const tot = c.home + c.away;
            if (!tot) return;
            const side: Side = c.home >= c.away ? "home" : "away";
            g.globalAlpha = Math.max(0.08, 0.75 * (tot / max) * (Math.max(c.home, c.away) / tot - 0.35));
            g.fillStyle = colors[side];
            g.fillRect(i % 12, Math.floor(i / 12), 1, 1);
          });
          terrTex.needsUpdate = true;
        }
      }
      terr.visible = p.mode === "territory";

      // Cameras.
      const pan = bx * 0.25;
      if (p.mode === "ball") {
        wantPos.set(bx - pan - 8, 20, bz + 30);
        wantLook.set(bx, 0, bz - 4);
      } else if (p.mode === "player" && followXZ) {
        const [fx, fz] = followXZ;
        wantPos.set(fx - fx * 0.2 - 5, 12, fz + 19);
        wantLook.set(fx, 1, fz - 2);
      } else {
        wantPos.set(0, 64, 56);
        wantLook.set(0, 0, -3);
      }
      const kc = first ? 1 : 1 - Math.exp(-dt * 3);
      first = false;
      camera.position.lerp(wantPos, kc);
      look.lerp(wantLook, kc);
      camera.lookAt(look);
      renderer.render(scene, camera);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener("pointerup", onClick);
      canvas.removeEventListener("pointermove", onMove);
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose();
        const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
        for (const x of mats) { (x as THREE.MeshBasicMaterial).map?.dispose(); x.dispose(); }
      });
      matCache.clear();
      renderer.dispose();
    };
  }, [props.pack]);

  return <canvas ref={canvasRef} className="monitor-canvas" aria-label="Broadcast monitor: click a player to follow them" />;
}
