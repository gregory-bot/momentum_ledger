// QA: plays a match in headless Chrome and checks that player motion is physically plausible.
//
//   npm run qa:motion -- http://localhost:8010/?scenario=press-trap&t=20&autoplay=1&speed=1
//
// Reads window.__dangote (the positions the WebGL monitor drew each frame) every 100 ms and fails if
// any player moves faster than 12 m/s of match time, or the ball carrier is > 3 m from the ball in
// more than 5% of samples. Requires a local Chrome (CHROME=/path/to/chrome to override).
import puppeteer from "puppeteer-core";

const url = process.argv[2] ?? "http://localhost:8010/?scenario=press-trap&t=20&autoplay=1&speed=1";
const seconds = Number(process.argv[3] ?? 10);
const chrome = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const browser = await puppeteer.launch({ executablePath: chrome, headless: "new",
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"], defaultViewport: { width: 1600, height: 1000 } });
const page = await browser.newPage();
await page.goto(url, { waitUntil: "networkidle0" });
await page.waitForFunction(() => window.__dangote, { timeout: 30000 });
const samples = [];
const end = Date.now() + seconds * 1000;
while (Date.now() < end) {
  samples.push(await page.evaluate(() => JSON.parse(JSON.stringify(window.__dangote))));
  await new Promise((r) => setTimeout(r, 100));
}
await browser.close();

const speeds = [];
let detached = 0;
let carried = 0;
for (let i = 1; i < samples.length; i++) {
  const a = samples[i - 1], b = samples[i], dt = b.t - a.t;
  if (dt <= 0) continue;
  const prev = new Map(a.players.map(([id, x, y]) => [id, [x, y]]));
  for (const [id, x, y] of b.players) {
    const p = prev.get(id);
    if (p) speeds.push(Math.hypot(x - p[0], y - p[1]) / dt);
  }
  if (b.holder) {
    carried++;
    const h = b.players.find((p) => p[0] === b.holder);
    if (h && Math.hypot(h[1] - b.ball[0], h[2] - b.ball[1]) > 3) detached++;
  }
}
speeds.sort((x, y) => x - y);
const q = (f) => speeds[Math.floor(f * (speeds.length - 1))];
const report = { samples: samples.length, p50: q(0.5).toFixed(2), p90: q(0.9).toFixed(2), max: q(1).toFixed(2),
  detachedShare: carried ? +(detached / carried).toFixed(3) : 0 };
console.log(JSON.stringify(report));
const ok = q(1) <= 12 && report.detachedShare <= 0.05;
console.log(ok ? "motion OK" : "motion FAILED");
process.exit(ok ? 0 : 1);
