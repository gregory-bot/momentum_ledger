// A tiny pinhole camera: world metres (x along the pitch, y across, z up) -> SVG pixels.

export type V3 = [number, number, number];

export interface Camera {
  pos: V3;
  target: V3;
  focal: number; // pixels
}

export interface View {
  r: V3;
  u: V3;
  f: V3;
  pos: V3;
  focal: number;
  w: number;
  h: number;
}

const NEAR = 1.2;
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V3): V3 => {
  const l = Math.hypot(...a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

export function view(cam: Camera, w: number, h: number): View {
  const f = norm(sub(cam.target, cam.pos));
  const r = norm(cross(f, [0, 0, 1]));
  const u = cross(r, f);
  return { r, u, f, pos: cam.pos, focal: cam.focal, w, h };
}

/** Camera-space coordinates [x, y, depth]. */
export function toCam(v: View, p: V3): V3 {
  const d = sub(p, v.pos);
  return [dot(d, v.r), dot(d, v.u), dot(d, v.f)];
}

export function toScreen(v: View, c: V3): [number, number] {
  return [v.w / 2 + (v.focal * c[0]) / c[2], v.h / 2 - (v.focal * c[1]) / c[2]];
}

export function project(v: View, p: V3): { x: number; y: number; depth: number } | null {
  const c = toCam(v, p);
  if (c[2] < NEAR) return null;
  const [x, y] = toScreen(v, c);
  return { x, y, depth: c[2] };
}

/** Project a polyline, clipping each segment against the near plane. Returns an SVG path. */
export function pathOf(v: View, pts: V3[], closed = false): string {
  const cam = pts.map((p) => toCam(v, p));
  if (closed) cam.push(cam[0]);
  let d = "";
  let pen = false;
  for (let i = 0; i < cam.length - 1; i++) {
    let a = cam[i];
    let b = cam[i + 1];
    if (a[2] < NEAR && b[2] < NEAR) { pen = false; continue; }
    if (a[2] < NEAR || b[2] < NEAR) {
      const s = (NEAR - a[2]) / (b[2] - a[2]);
      const m: V3 = [a[0] + (b[0] - a[0]) * s, a[1] + (b[1] - a[1]) * s, NEAR];
      if (a[2] < NEAR) { a = m; pen = false; } else b = m;
    }
    const [ax, ay] = toScreen(v, a);
    const [bx, by] = toScreen(v, b);
    if (!pen) d += `M${ax.toFixed(1)},${ay.toFixed(1)}`;
    d += `L${bx.toFixed(1)},${by.toFixed(1)}`;
    pen = b === cam[i + 1];
  }
  return d;
}

/** Project a ground polygon, clipped against the near plane (Sutherland-Hodgman, one plane). */
export function polygonOf(v: View, pts: V3[]): string {
  const cam = pts.map((p) => toCam(v, p));
  const out: V3[] = [];
  for (let i = 0; i < cam.length; i++) {
    const a = cam[i];
    const b = cam[(i + 1) % cam.length];
    const ain = a[2] >= NEAR;
    const bin = b[2] >= NEAR;
    if (ain) out.push(a);
    if (ain !== bin) {
      const s = (NEAR - a[2]) / (b[2] - a[2]);
      out.push([a[0] + (b[0] - a[0]) * s, a[1] + (b[1] - a[1]) * s, NEAR]);
    }
  }
  if (out.length < 3) return "";
  return out.map((c) => toScreen(v, c).map((n) => n.toFixed(1)).join(",")).join(" ");
}

export function arc(cx: number, cy: number, r: number, a0: number, a1: number, n = 32): V3[] {
  return Array.from({ length: n + 1 }, (_, i) => {
    const a = a0 + ((a1 - a0) * i) / n;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a), 0] as V3;
  });
}

export const lerp3 = (a: V3, b: V3, s: number): V3 => [a[0] + (b[0] - a[0]) * s, a[1] + (b[1] - a[1]) * s, a[2] + (b[2] - a[2]) * s];
