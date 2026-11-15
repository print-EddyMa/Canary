/* Trend columns: the trend map as a field of 3D columns on the globe. Height is the size of the
   local trend, colour its direction in the variable's family; only cells whose trend is
   significant after the false-discovery-rate test rise; the rest stay flat on the map beneath. Cells are pooled to about 2° so the
   columns stay readable at globe scale. */

const POOL = 4;            // grid cells per column side (0.5° × 0.625° → 2° × 2.5°)
const TALLEST = 480000;    // metres, for the strongest trend in the layer's scale
const FLOOR = 8000;        // metres, so the weakest significant cell still reads as a column

function hex(c) {
  const n = parseInt(c.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rampColour(stops, t) {
  // stops run from the strongest fall (t = -1) to the strongest rise (t = +1)
  const x = ((Math.max(-1, Math.min(1, t)) + 1) / 2) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(x)), f = x - i;
  const a = hex(stops[i]), b = hex(stops[i + 1]);
  return `rgb(${a.map((v, k) => Math.round(v + (b[k] - v) * f)).join(",")})`;
}

export function columnFeatures(layer, grid) {
  const { nlat, nlon, lat0, dlat, lon0, dlon } = layer.grid;
  const features = [];
  for (let i0 = 0; i0 < nlat; i0 += POOL) {
    for (let j0 = 0; j0 < nlon; j0 += POOL) {
      let sum = 0, n = 0, sig = 0;
      for (let i = i0; i < Math.min(nlat, i0 + POOL); i++) {
        for (let j = j0; j < Math.min(nlon, j0 + POOL); j++) {
          const k = i * nlon + j;
          if (!grid.status[k]) continue;
          sum += grid.values[k]; n++;
          if (grid.status[k] === 2) sig++;
        }
      }
      if (!n) continue;
      const t = sum / n / 127, significant = sig / n >= 0.5;
      if (!significant) continue; // could be chance: it stays flat, on the map beneath
      const s = lat0 + (i0 - 0.5) * dlat, nn = Math.min(89.5, lat0 + (Math.min(nlat, i0 + POOL) - 0.5) * dlat);
      const w = lon0 + (j0 - 0.5) * dlon, e = lon0 + (Math.min(nlon, j0 + POOL) - 0.5) * dlon;
      const inset = 0.12; // a hairline gap so neighbouring columns read as separate
      const ring = [[w + inset, Math.max(-89.5, s) + inset], [e - inset, Math.max(-89.5, s) + inset],
        [e - inset, nn - inset], [w + inset, nn - inset], [w + inset, Math.max(-89.5, s) + inset]];
      features.push({ type: "Feature", geometry: { type: "Polygon", coordinates: [ring] },
        properties: {
          h: FLOOR + Math.min(1, Math.abs(t)) * TALLEST,
          c: rampColour(layer.stops, t),
          v: t * layer.scale_max,
        } });
    }
  }
  return { type: "FeatureCollection", features };
}

export class TrendColumns {
  constructor(map) {
    this.map = map;
    this.on = false;
    this.key = null;
  }

  ensure(beforeId) {
    const map = this.map;
    if (map.getSource("columns")) return;
    map.addSource("columns", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    map.addLayer({ id: "columns", type: "fill-extrusion", source: "columns", layout: { visibility: "none" },
      paint: {
        "fill-extrusion-color": ["get", "c"],
        "fill-extrusion-height": ["get", "h"],
        "fill-extrusion-base": 0,
        "fill-extrusion-opacity": 0.92,
        "fill-extrusion-vertical-gradient": true,
      } }, beforeId);
  }

  /** Show columns for this layer's grid, or hide them when off or when there is no trend. */
  sync(layer, grid, beforeId) {
    this.ensure(beforeId);
    const visible = this.on && layer && grid;
    this.map.setLayoutProperty("columns", "visibility", visible ? "visible" : "none");
    if (!visible) return;
    if (this.key !== layer.id) {
      this.map.getSource("columns").setData(columnFeatures(layer, grid));
      this.key = layer.id;
    }
  }
}
