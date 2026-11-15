// Drives the real Canary app shot by shot on a virtual clock and saves every frame.
const { chromium } = require('playwright');
const fs = require('fs');
const CLOCK = require('./clock.js');
const TAIL = 8; // frames each shot runs past its cut, for the crossfade
const FPS = 30;
const only = process.argv[2] ? process.argv[2].split(',') : null;

const ease = (x) => (x < 0 ? 0 : x > 1 ? 1 : x * x * (3 - 2 * x));
const lerp = (a, b, t) => a + (b - a) * t;

const shots = [
  { id: 's1', frames: 90, async setup(p) {
      await p.evaluate(() => window.canary.stopSpin());
    },
    async frame(p, i, n) {
      const t = i / n;
      await p.evaluate(([lon, z]) => window.canary.map.jumpTo({ center: [lon, 22], zoom: z, pitch: 0, bearing: 0 }), [lerp(-20, 22, t), lerp(1.75, 1.95, ease(t))]);
    } },
  { id: 's2', frames: 150, async setup(p) {},
    async frame(p, i) {
      if (i === 8) await p.keyboard.press('/');
      const word = 'Arctic';
      if (i >= 16 && i < 16 + word.length * 4 && (i - 16) % 4 === 0) await p.keyboard.type(word[(i - 16) / 4]);
      if (i === 48) { await p.waitForTimeout(1500); }
      if (i === 52) { await p.keyboard.press('Enter'); await p.waitForTimeout(3500); }
      if (i >= 53) {  // our own camera move to the Arctic, tilted so the pole stays over the horizon
        const k = ease((i - 53) / 45);
        await p.evaluate(([lon, lat, z, pt]) => window.canary.map.jumpTo({ center: [lon, lat], zoom: z, pitch: pt, bearing: 0 }),
          [lerp(22, 18, k), lerp(22, 56, k), lerp(1.95, 2.2, k), lerp(0, 42, k)]);
      }
    } },
  { id: 's3', frames: 150, async setup(p) {},
    async frame(p, i, n) {
      await p.evaluate(([lon]) => window.canary.map.jumpTo({ center: [lon, 56], zoom: 2.2, pitch: 42, bearing: 0 }), [lerp(18, 30, i / n)]);
      if (i === 4) { await p.locator('#card-series [role=tab]', { hasText: 'Latitude' }).click(); await p.mouse.move(1880, 1062); }
      if (i === 80) { await p.locator('#card-series [role=tab]', { hasText: 'Distribution' }).click(); await p.mouse.move(1880, 1062); }
    } },
  { id: 's4', frames: 90, async setup(p) {
      await p.keyboard.press('d');
      await p.waitForTimeout(3000);
    },
    async frame(p, i, n) {
      const t = i / n;
      await p.evaluate(([b, z, pt]) => window.canary.map.jumpTo({ center: [30, 56], zoom: z, pitch: pt, bearing: b }), [lerp(-25, 15, t), lerp(1.95, 2.1, t), lerp(46, 52, ease(t))]);
    } },
  { id: 's5', frames: 165, async setup(p) {
      await p.keyboard.press('d');            // put the columns away
      await p.keyboard.press('2');            // weather
      await p.click('#pane-tab-today');
      await p.waitForTimeout(5000);
      // Replay the real current alerts so the feed builds as they arrive: watch first, serious last.
      await p.evaluate(() => {
        const rank = { watch: 0, serious: 1, critical: 2 };
        const all = [...window.canaryLive.alerts.values()].sort((a, b) => rank[a.severity] - rank[b.severity]);
        window.__replay = all.slice(-22);
        window.canaryLive.alerts.clear();
      });
    },
    async frame(p, i, n) {
      const t = i / n;
      await p.evaluate(([lon, z]) => window.canary.map.jumpTo({ center: [lon, 24], zoom: z, pitch: 0, bearing: 0 }), [lerp(-50, -36, t), lerp(2.2, 2.38, ease(t))]);
      if (i % 5 === 0) await p.evaluate(() => { const a = window.__replay.shift(); if (a) window.canaryLive.receive(a); });
    } },
  { id: 's6', frames: 120, async setup(p) {
      await p.keyboard.press('1'); // trends mode: no wind particles at street zoom
      await p.click('#pane-tab-today');
      await p.locator('#live-filters button', { hasText: 'Methane' }).click();
      await p.evaluate(() => window.canary.map.jumpTo({ center: [58, 38], zoom: 4, pitch: 0, bearing: 0 }));
      await p.waitForTimeout(3000);
    },
    async frame(p, i) {
      if (i === 10) { await p.locator('#live-feed .alert-main').first().click(); await p.mouse.move(1880, 1062); }
    } },
];

(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const ctx = await b.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 4 / 3, colorScheme: 'dark' });
  await ctx.addInitScript(CLOCK);
  const p = await ctx.newPage();
  p.setDefaultTimeout(120000);
  p.on('pageerror', (e) => console.log('PAGEERR', e.message));
  await p.goto('http://localhost:8000/', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(14000);
  await p.mouse.move(1880, 1062);
  await p.evaluate(() => window.__clock.start());
  const started = Date.now();
  for (const s of shots) {
    const dir = `frames/${s.id}`;
    fs.mkdirSync(dir, { recursive: true });
    await s.setup(p);
    const n = s.frames + TAIL;
    const skip = only && !only.includes(s.id);
    for (let i = 0; i < n; i++) {
      await s.frame(p, i, n);
      await p.evaluate((ms) => window.__clock.step(ms), 1000 / FPS);
      if (!skip || i === 0 || i === n - 1) await p.screenshot({ path: `${dir}/${String(i).padStart(4, '0')}.jpg`, type: 'jpeg', quality: 93 });
    }
    console.log(s.id, 'done', Math.round((Date.now() - started) / 1000), 's');
  }
  await b.close();
})();
