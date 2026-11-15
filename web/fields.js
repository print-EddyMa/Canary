/* Global fields drawn on the GPU: the trend maps and the last 24 hours of weather.

   Each field is a grid of values (not a picture). A WebGL2 fragment shader reprojects it to
   Web Mercator, interpolates between grid points (and between hours), and colours it with the
   field's own colour family. The result is a canvas that MapLibre drapes over the globe, so the
   map stays smooth at every zoom and the values stay readable under the cursor. */

const WORLD = [[-180, 85.051129], [180, 85.051129], [180, -85.051129], [-180, -85.051129]];

/** Raw bytes from the server (or, in a snapshot build, from a base64 text file beside the page). */
async function getBytes(url) {
  if (window.CANARY_PREVIEW) return window.CANARY_PREVIEW.bytes(url);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} did not load`);
  return response.arrayBuffer();
}
const hexRGB = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);

const VERTEX = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() { vUv = vec2(aPos.x * 0.5 + 0.5, 0.5 - aPos.y * 0.5); gl_Position = vec4(aPos, 0.0, 1.0); }`;

// Shared: the latitude and longitude of a pixel of the Web-Mercator canvas, and texture
// coordinates on a cell-centred grid (longitude wraps, latitude clamps).
const COMMON = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform vec4 uGrid;   // lat0, dlat, lon0, dlon
uniform vec2 uCells;  // nlon, nlat
const float PI = 3.141592653589793;
vec2 lonlat() {
  float lon = -180.0 + 360.0 * vUv.x;
  float lat = degrees(atan(sinh(PI * (1.0 - 2.0 * vUv.y))));
  return vec2(lon, lat);
}
vec2 gridUv(vec2 ll) {
  return vec2(((ll.x - uGrid.z) / uGrid.w + 0.5) / uCells.x, ((ll.y - uGrid.x) / uGrid.y + 0.5) / uCells.y);
}
uniform vec3 uRamp[9];
vec3 ramp(float t) {
  float x = (clamp(t, -1.0, 1.0) + 1.0) * 4.0;
  int i = int(min(floor(x), 7.0));
  float f = x - float(i);
  vec3 a = uRamp[0], b = uRamp[1];
  for (int k = 0; k < 8; k++) { if (k == i) { a = uRamp[k]; b = uRamp[k + 1]; } }
  return mix(a, b, f);
}`;

// Trend: R = change (128 is none), G = has data, B = significant.
const TREND = `${COMMON}
uniform sampler2D uField;
uniform float uSense;
void main() {
  vec4 s = texture(uField, gridUv(lonlat()));
  if (s.g < 0.02) { outColor = vec4(0.0); return; }
  float t = (s.r * 255.0 - 128.0) / 127.0 * uSense;
  vec3 c = ramp(t);
  float a = s.g * mix(0.30, 0.94, s.b);   // could be chance: faint
  outColor = vec4(c * a, a);
}`;

// Weather: R = cloud fraction, G = precipitation (log scale), B = temperature, for hour A and B.
const WEATHER = `${COMMON}
uniform sampler2D uA;
uniform sampler2D uB;
uniform float uT;
uniform vec3 uShow;      // temperature, precipitation, cloud
uniform vec3 uSun;       // the sun's direction (x, y, z on the unit sphere) at this moment
uniform vec3 uRain[4];
uniform float uLogHi;
uniform vec2 uTexel;
vec4 at(vec2 uv) { return mix(texture(uA, uv), texture(uB, uv), uT); }
void main() {
  vec2 ll = lonlat();
  vec2 uv = gridUv(ll);
  vec4 s = at(uv);
  vec3 col = vec3(0.0);
  float alpha = 0.0;
  // Temperature: blue below freezing, red above, grey at 0 degrees C.
  if (uShow.x > 0.5) {
    float tc = -60.0 + s.b * 110.0;
    col = ramp(tc / 40.0);
    alpha = 0.82;
  }
  // Precipitation in mm per hour, on the water family's wet side.
  if (uShow.y > 0.5) {
    float mmh = exp(s.g * uLogHi) - 1.0;
    float a = smoothstep(0.08, 1.2, mmh) * 0.92;
    float k = clamp(log(1.0 + mmh) / log(21.0), 0.0, 1.0) * 3.0;
    int i = int(min(floor(k), 2.0));
    vec3 c = mix(uRain[i], uRain[i + 1], k - float(i));
    col = mix(col, c, a); alpha = max(alpha, a);
  }
  // Cloud: white, lit from the sun across the field's own relief, grey on the night side.
  if (uShow.z > 0.5) {
    float c = s.r;
    float a = smoothstep(0.12, 0.95, c) * 0.9;
    float dx = at(uv + vec2(uTexel.x, 0.0)).r - at(uv - vec2(uTexel.x, 0.0)).r;
    float dy = at(uv + vec2(0.0, uTexel.y)).r - at(uv - vec2(0.0, uTexel.y)).r;
    vec3 n = normalize(vec3(-dx * 2.5, -dy * 2.5, 1.0));
    float lit = 0.80 + 0.20 * dot(n, normalize(vec3(-0.5, 0.6, 0.7)));
    float lat = radians(ll.y), lon = radians(ll.x);
    vec3 p = vec3(cos(lat) * cos(lon), cos(lat) * sin(lon), sin(lat));
    float day = smoothstep(-0.12, 0.12, dot(p, uSun));
    vec3 cloud = vec3(0.97, 0.98, 1.0) * lit * mix(0.42, 1.0, day);
    col = mix(col, cloud, a); alpha = max(alpha, a);
  }
  outColor = vec4(col * alpha, alpha);
}`;

function compile(gl, vertex, fragment) {
  const make = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  };
  const p = gl.createProgram();
  gl.attachShader(p, make(gl.VERTEX_SHADER, vertex));
  gl.attachShader(p, make(gl.FRAGMENT_SHADER, fragment));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  return p;
}

/** A canvas drawn by WebGL2 and shown on the map as one raster layer. */
class GpuCanvas {
  constructor(map, id, size, fragment, beforeId) {
    this.map = map;
    this.id = id;
    this.canvas = document.createElement("canvas");
    this.canvas.width = this.canvas.height = size;
    const gl = this.canvas.getContext("webgl2", { premultipliedAlpha: true, preserveDrawingBuffer: true, antialias: false });
    if (!gl) throw new Error("This browser cannot draw WebGL2.");
    this.gl = gl;
    this.program = compile(gl, VERTEX, fragment);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(this.program, "aPos");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    this.uniforms = new Map();
    this.added = false;
    this.beforeId = beforeId;
    this.opacity = 1;
  }

  u(name) {
    if (!this.uniforms.has(name)) this.uniforms.set(name, this.gl.getUniformLocation(this.program, name));
    return this.uniforms.get(name);
  }

  texture(width, height, data, format) {
    const gl = this.gl;
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, format === "rgb" ? gl.RGB8 : gl.RGBA8, width, height, 0,
      format === "rgb" ? gl.RGB : gl.RGBA, gl.UNSIGNED_BYTE, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  setRamp(stops, name = "uRamp") {
    this.gl.useProgram(this.program);
    this.gl.uniform3fv(this.u(`${name}[0]`), new Float32Array(stops.flatMap(hexRGB)));
  }

  render() {
    const gl = this.gl;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    this.show();
  }

  /** Put the canvas on the map, or tell MapLibre that it has changed. */
  show() {
    const map = this.map;
    if (!this.added) {
      map.addSource(this.id, { type: "canvas", canvas: this.canvas, coordinates: WORLD, animate: false });
      const before = (this.beforeId || []).find((id) => map.getLayer(id));
      map.addLayer({ id: this.id, type: "raster", source: this.id,
        paint: { "raster-opacity": this.opacity, "raster-fade-duration": 0, "raster-resampling": "linear" } }, before);
      this.added = true;
      return;
    }
    if (!map.getLayer(this.id)) return;
    // A paused canvas source uploads its pixels only while playing: play for one frame.
    const source = map.getSource(this.id);
    source.play();
    map.triggerRepaint();
    requestAnimationFrame(() => requestAnimationFrame(() => { if (!this.playing) source.pause(); }));
  }

  setOpacity(value) {
    this.opacity = value;
    if (this.added && this.map.getLayer(this.id)) this.map.setPaintProperty(this.id, "raster-opacity", value);
  }

  setVisible(on) {
    if (this.added && this.map.getLayer(this.id)) this.map.setLayoutProperty(this.id, "visibility", on ? "visible" : "none");
  }

  remove() {
    if (!this.added) return;
    if (this.map.getLayer(this.id)) this.map.removeLayer(this.id);
    if (this.map.getSource(this.id)) this.map.removeSource(this.id);
    this.added = false;
  }
}

/* ---------- trend maps ---------- */

export class TrendField {
  constructor(map, beforeId) {
    // Not a power of two: MapLibre would sample a power-of-two canvas through mipmaps it never builds.
    this.gpu = new GpuCanvas(map, "trend-field", 2000, TREND, beforeId);
    this.grid = null;
    this.layer = null;
    this.cache = new Map();
  }

  async load(layer) {
    if (!this.cache.has(layer.id)) {
      this.cache.set(layer.id, getBytes(layer.grid.file));
    }
    const buffer = await this.cache.get(layer.id);
    const { nlat, nlon } = layer.grid;
    const values = new Int8Array(buffer, 0, nlat * nlon);
    const status = new Uint8Array(buffer, nlat * nlon, nlat * nlon);
    return { values, status };
  }

  /** Draw a variable's trend map. */
  async show(layer, opacity) {
    const data = await this.load(layer);
    this.layer = layer;
    this.grid = data;
    const { nlat, nlon, lat0, dlat, lon0, dlon } = layer.grid;
    const rgb = new Uint8Array(nlat * nlon * 3);
    for (let i = 0; i < nlat * nlon; i++) {
      const v = data.values[i];
      rgb[i * 3] = v === -128 ? 128 : v + 128;
      rgb[i * 3 + 1] = data.status[i] ? 255 : 0;
      rgb[i * 3 + 2] = data.status[i] === 2 ? 255 : 0;
    }
    const gpu = this.gpu, gl = gpu.gl;
    gl.useProgram(gpu.program);
    if (this.texture) gl.deleteTexture(this.texture);
    this.texture = gpu.texture(nlon, nlat, rgb, "rgb");
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.uniform1i(gpu.u("uField"), 0);
    gl.uniform4f(gpu.u("uGrid"), lat0, dlat, lon0, dlon);
    gl.uniform2f(gpu.u("uCells"), nlon, nlat);
    gl.uniform1f(gpu.u("uSense"), 1);
    gpu.setRamp(layer.stops); // already ordered from the strongest fall to the strongest rise
    gpu.opacity = opacity;
    gpu.render();
    gpu.setOpacity(opacity);
    gpu.setVisible(true);
  }

  hide() { this.layer = null; this.gpu.setVisible(false); }

  setOpacity(v) { this.gpu.setOpacity(v); }

  /** The change per decade and its status under a point, or null. */
  probe(lat, lon) {
    if (!this.layer || !this.grid) return null;
    const g = this.layer.grid;
    const i = Math.round((lat - g.lat0) / g.dlat), j = ((Math.round((lon - g.lon0) / g.dlon) % g.nlon) + g.nlon) % g.nlon;
    if (i < 0 || i >= g.nlat) return null;
    const k = i * g.nlon + j, status = this.grid.status[k];
    if (!status) return { value: null };
    return { value: (this.grid.values[k] / 127) * this.layer.scale_max, significant: status === 2 };
  }
}

/* ---------- the last 24 hours of weather ---------- */

export const DECODE = {
  cloud: (q) => (q / 255) * 100,
  precip: (q) => Math.expm1((q / 255) * Math.log1p(40)),
  temp: (q) => -60 + (q / 255) * 110,
  wind: (q) => (q - 128) / 2,
};

function sunDirection(date) {
  // Subsolar point from the day of the year and the time (accurate to a degree or so).
  const start = Date.UTC(date.getUTCFullYear(), 0, 0);
  const day = (date - start) / 864e5;
  const decl = (-23.44 * Math.cos(((2 * Math.PI) / 365) * (day + 10)) * Math.PI) / 180;
  const hours = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
  const lon = ((12 - hours) * 15 * Math.PI) / 180;
  return [Math.cos(decl) * Math.cos(lon), Math.cos(decl) * Math.sin(lon), Math.sin(decl)];
}

export class WeatherField {
  constructor(map, beforeId, families) {
    this.gpu = new GpuCanvas(map, "weather-field", 1536, WEATHER, beforeId);
    this.meta = null;
    this.data = null;
    this.textures = [];
    this.show = { temp: false, precip: true, cloud: true };
    this.time = 0; // fractional frame index
    const gpu = this.gpu;
    gpu.setRamp(families.thermal);
    gpu.setRamp(families.rain, "uRain");
  }

  get frames() { return this.meta ? this.meta.frames : 0; }

  async load(getJSON) {
    const meta = await getJSON("/api/weather");
    if (meta.status !== "ready") return meta;
    if (this.meta && this.meta.times[this.meta.times.length - 1] === meta.times[meta.times.length - 1]) return this.meta;
    const fetchBytes = async (name) => new Uint8Array(await getBytes(`/api/weather/${name}`));
    const [cloud, precip, temp, u, v] = await Promise.all(["cloud", "precip", "temp", "u", "v"].map(fetchBytes));
    this.meta = meta;
    this.data = { cloud, precip, temp, u, v };
    this.upload();
    return meta;
  }

  upload() {
    const { frames, nlat, nlon } = this.meta;
    const gpu = this.gpu, gl = gpu.gl, n = nlat * nlon;
    for (const t of this.textures) gl.deleteTexture(t);
    this.textures = [];
    for (let f = 0; f < frames; f++) {
      const rgba = new Uint8Array(n * 4);
      for (let i = 0; i < n; i++) {
        rgba[i * 4] = this.data.cloud[f * n + i];
        rgba[i * 4 + 1] = this.data.precip[f * n + i];
        rgba[i * 4 + 2] = this.data.temp[f * n + i];
        rgba[i * 4 + 3] = 255;
      }
      this.textures.push(gpu.texture(nlon, nlat, rgba, "rgba"));
    }
    gl.useProgram(gpu.program);
    const m = this.meta;
    gl.uniform4f(gpu.u("uGrid"), m.lat0, m.dlat, m.lon0, m.dlon);
    gl.uniform2f(gpu.u("uCells"), nlon, nlat);
    gl.uniform2f(gpu.u("uTexel"), 1 / nlon, 1 / nlat);
    gl.uniform1f(gpu.u("uLogHi"), Math.log1p(40));
    gl.uniform1i(gpu.u("uA"), 0);
    gl.uniform1i(gpu.u("uB"), 1);
  }

  /** The moment shown, as a Date. */
  dateAt(time = this.time) {
    const times = this.meta.times.map((t) => Date.parse(t));
    const i = Math.min(Math.floor(time), times.length - 2), f = time - i;
    return new Date(times[i] + (times[i + 1] - times[i]) * f);
  }

  /** Draw the weather at a fractional frame index. */
  draw(time = this.time) {
    if (!this.meta) return;
    this.time = Math.max(0, Math.min(this.frames - 1, time));
    const gpu = this.gpu, gl = gpu.gl;
    const i = Math.min(Math.floor(this.time), this.frames - 2), f = this.time - i;
    gl.useProgram(gpu.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.textures[i]);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.textures[i + 1]);
    gl.uniform1f(gpu.u("uT"), f);
    gl.uniform3f(gpu.u("uShow"), this.show.temp ? 1 : 0, this.show.precip ? 1 : 0, this.show.cloud ? 1 : 0);
    gl.uniform3fv(gpu.u("uSun"), sunDirection(this.dateAt()));
    gpu.render();
    gpu.setVisible(true);
  }

  setPlaying(on) {
    this.gpu.playing = on;
    const source = this.gpu.added && this.gpu.map.getSource(this.gpu.id);
    if (source) (on ? source.play() : source.pause());
  }

  hide() { this.setPlaying(false); this.gpu.setVisible(false); }

  /** Wind (u, v in m/s) for the nearest hour, as a grid for the particle layer. */
  windGrid(time = this.time) {
    const m = this.meta, n = m.nlat * m.nlon, f = Math.round(time);
    const u = new Float32Array(n), v = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      u[i] = DECODE.wind(this.data.u[f * n + i]);
      v[i] = DECODE.wind(this.data.v[f * n + i]);
    }
    return { nlat: m.nlat, nlon: m.nlon, lat0: m.lat0, dlat: m.dlat, lon0: m.lon0, dlon: m.dlon, u, v, time: m.times[f] };
  }

  /** Every field's value under a point at the moment shown (bilinear in space and time). */
  probe(lat, lon) {
    if (!this.meta) return null;
    const m = this.meta, n = m.nlat * m.nlon;
    const fy = Math.min(Math.max((lat - m.lat0) / m.dlat, 0), m.nlat - 1.001);
    let fx = ((lon - m.lon0) / m.dlon) % m.nlon;
    if (fx < 0) fx += m.nlon;
    const y0 = Math.floor(fy), x0 = Math.floor(fx), x1 = (x0 + 1) % m.nlon, wy = fy - y0, wx = fx - x0;
    const i = Math.min(Math.floor(this.time), this.frames - 2), ft = this.time - i;
    const at = (arr, decode) => {
      const one = (frame) => {
        const b = frame * n;
        const q = (arr[b + y0 * m.nlon + x0] * (1 - wx) + arr[b + y0 * m.nlon + x1] * wx) * (1 - wy)
          + (arr[b + (y0 + 1) * m.nlon + x0] * (1 - wx) + arr[b + (y0 + 1) * m.nlon + x1] * wx) * wy;
        return decode(q);
      };
      return one(i) * (1 - ft) + one(i + 1) * ft;
    };
    const u = at(this.data.u, DECODE.wind), v = at(this.data.v, DECODE.wind);
    return { cloud: at(this.data.cloud, DECODE.cloud), precip: at(this.data.precip, DECODE.precip),
      temp: at(this.data.temp, DECODE.temp), wind: Math.hypot(u, v),
      windFrom: (Math.atan2(-u, -v) * 180 / Math.PI + 360) % 360 };
  }
}
