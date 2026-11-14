/* Animated wind: thousands of particles carried by the live NASA GEOS wind
   field, drawn as fading trails on a canvas over the globe. */

const PARTICLES = 3200;
const MAX_AGE = 90; // frames
const FADE = 0.93; // trail persistence per frame

export class WindLayer {
  constructor(map) {
    this.map = map;
    this.grid = null;
    this.running = false;
    this.canvas = document.createElement("canvas");
    this.canvas.className = "wind-canvas";
    this.canvas.setAttribute("aria-hidden", "true");
    map.getCanvasContainer().append(this.canvas);
    this.ctx = this.canvas.getContext("2d");
    this.particles = new Float32Array(PARTICLES * 3); // lon, lat, age
    this.keepTrails = false; // set while the globe turns slowly on its own
    this.clear = () => {
      if (!this.keepTrails) this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    };
    this.resize = () => {
      const box = map.getContainer().getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.canvas.width = Math.round(box.width * dpr);
      this.canvas.height = Math.round(box.height * dpr);
      this.canvas.style.width = `${box.width}px`;
      this.canvas.style.height = `${box.height}px`;
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    map.on("move", this.clear);
    map.on("resize", this.resize);
    this.resize();
    this.canvas.hidden = true;
  }

  wipe() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  setGrid(grid) {
    this.grid = grid;
    for (let i = 0; i < PARTICLES; i++) this.spawn(i, Math.random() * MAX_AGE);
  }

  spawn(i, age = 0) {
    // Uniform over the sphere, so the poles are not crowded.
    this.particles[i * 3] = Math.random() * 360 - 180;
    this.particles[i * 3 + 1] = (Math.asin(Math.random() * 2 - 1) * 180) / Math.PI;
    this.particles[i * 3 + 2] = age;
  }

  /** Bilinear wind (m/s) at a point; null where the grid has no data. */
  sample(lon, lat) {
    const g = this.grid;
    const fy = Math.min(Math.max((lat - g.lat0) / g.dlat, 0), g.nlat - 1.001);
    let fx = ((lon - g.lon0) / g.dlon) % g.nlon;
    if (fx < 0) fx += g.nlon;
    const y0 = Math.floor(fy), x0 = Math.floor(fx), x1 = (x0 + 1) % g.nlon;
    const wy = fy - y0, wx = fx - x0;
    const a = y0 * g.nlon, b = (y0 + 1) * g.nlon;
    const mix = (f) => {
      const p = f[a + x0], q = f[a + x1], r = f[b + x0], s = f[b + x1];
      if (p == null || q == null || r == null || s == null) return null;
      return (p * (1 - wx) + q * wx) * (1 - wy) + (r * (1 - wx) + s * wx) * wy;
    };
    const u = mix(g.u), v = mix(g.v);
    return u == null || v == null ? null : [u, v];
  }

  visible(lon, lat) {
    const t = this.map.transform;
    if (t && typeof t.isLocationOccluded === "function") {
      return !t.isLocationOccluded(new maplibregl.LngLat(lon, lat));
    }
    // Fallback: keep the hemisphere facing the camera.
    const c = this.map.getCenter(), r = Math.PI / 180;
    const cos = Math.sin(lat * r) * Math.sin(c.lat * r)
      + Math.cos(lat * r) * Math.cos(c.lat * r) * Math.cos((lon - c.lng) * r);
    return cos > 0.2;
  }

  frame = () => {
    if (!this.running) return;
    const { ctx, map, particles } = this;
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    // Fade what is already drawn, then add this frame's segments.
    ctx.globalCompositeOperation = "destination-in";
    ctx.fillStyle = `rgba(0,0,0,${FADE})`;
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = "source-over";
    ctx.lineWidth = 1.1;
    ctx.lineCap = "round";
    // Degrees moved per frame for each m/s, shrinking as you zoom in.
    const step = 0.09 / 2 ** Math.max(this.map.getZoom() - 1.5, 0);
    const buckets = [[], [], []]; // slow, medium, fast
    for (let i = 0; i < PARTICLES; i++) {
      const lon = particles[i * 3], lat = particles[i * 3 + 1];
      const wind = this.sample(lon, lat);
      if (!wind || particles[i * 3 + 2] > MAX_AGE || Math.abs(lat) > 88) { this.spawn(i); continue; }
      const cosLat = Math.max(Math.cos((lat * Math.PI) / 180), 0.05);
      let lon2 = lon + (wind[0] * step) / cosLat;
      const lat2 = lat + wind[1] * step;
      if (lon2 > 180) lon2 -= 360; else if (lon2 < -180) lon2 += 360;
      particles[i * 3] = lon2; particles[i * 3 + 1] = lat2; particles[i * 3 + 2] += 1;
      if (!this.visible(lon, lat) || Math.abs(lon2 - lon) > 90) continue;
      const p = map.project([lon, lat]), q = map.project([lon2, lat2]);
      if (p.x < -20 || p.y < -20 || p.x > w + 20 || p.y > h + 20) continue;
      if (Math.abs(q.x - p.x) > 40 || Math.abs(q.y - p.y) > 40) continue;
      const speed = Math.hypot(wind[0], wind[1]);
      buckets[speed < 5 ? 0 : speed < 12 ? 1 : 2].push(p.x, p.y, q.x, q.y);
    }
    const styles = ["rgba(240,239,236,0.35)", "rgba(240,239,236,0.65)", "rgba(255,240,184,0.95)"];
    buckets.forEach((segments, k) => {
      if (!segments.length) return;
      ctx.strokeStyle = styles[k];
      ctx.beginPath();
      for (let j = 0; j < segments.length; j += 4) {
        ctx.moveTo(segments[j], segments[j + 1]);
        ctx.lineTo(segments[j + 2], segments[j + 3]);
      }
      ctx.stroke();
    });
    this.raf = requestAnimationFrame(this.frame);
  };

  start() {
    if (this.running || !this.grid) return;
    this.running = true;
    this.canvas.hidden = false;
    this.resize();
    this.raf = requestAnimationFrame(this.frame);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.wipe();
    this.canvas.hidden = true;
  }
}
