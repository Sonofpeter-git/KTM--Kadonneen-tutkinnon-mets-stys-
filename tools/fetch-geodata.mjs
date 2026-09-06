#!/usr/bin/env node
/**
 * Fetches the real coastline, lakes and national borders the board is drawn from.
 *
 * WHY THIS EXISTS
 * ---------------
 * The board used to be a repainted photograph of a terrain map, which meant the
 * only way to know what part of the world it covered was to measure it - read the
 * pixels, guess bounds, score the guess. That measurement was always a little
 * wrong, and a little wrong puts Kemi twenty kilometres out to sea.
 *
 * Drawing the map from vectors removes the question. The coastline and the city
 * circles are then projected by the same four numbers, so a city cannot land in
 * the water unless it really is in the water.
 *
 * Output is vendored into the repo - tools/art/geodata.json - so rendering the
 * board needs no network. Re-run this only to refresh the source data:
 *
 *   node tools/fetch-geodata.mjs
 *
 * Source: Natural Earth 1:10m, public domain (naturalearthdata.com).
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, 'art', 'geodata.json');

const BASE = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson';

/**
 * A little larger than the board's own window, so coastlines and borders run off
 * the edge of the picture instead of stopping just inside it.
 */
const WINDOW = { west: 14, east: 35, south: 56, north: 73 };

/**
 * Half a pixel at the board's resolution, near enough. Simplifying harder than
 * this starts to show as flattened fjords; simplifying less just makes the file
 * bigger without changing a single painted pixel.
 */
const TOLERANCE = 0.004;

/** The countries whose shared borders the board should show. */
const NEIGHBOURS = new Set(['Finland', 'Sweden', 'Norway', 'Russia', 'Estonia', 'Latvia']);

const inWindow = ([lon, lat]) =>
  lon >= WINDOW.west && lon <= WINDOW.east && lat >= WINDOW.south && lat <= WINDOW.north;

/** Every ring in a feature, whatever geometry type it happens to be. */
function ringsOf(geom) {
  const out = [];
  if (!geom) return out;
  if (geom.type === 'Polygon') out.push(...geom.coordinates);
  else if (geom.type === 'MultiPolygon') for (const p of geom.coordinates) out.push(...p);
  else if (geom.type === 'LineString') out.push(geom.coordinates);
  else if (geom.type === 'MultiLineString') out.push(...geom.coordinates);
  return out;
}

/**
 * Douglas-Peucker. Dropping points that are merely close to the previous one
 * flattens curves; this drops only points that are close to the line their
 * neighbours already describe, which is what keeps a coastline looking like one.
 */
function simplify(points, tol) {
  if (points.length < 3) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];

  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = points[a];
    const [bx, by] = points[b];
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;

    let worst = 0, at = -1;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = points[i];
      let d;
      if (len2 === 0) {
        d = Math.hypot(px - ax, py - ay);
      } else {
        const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
        d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
      }
      if (d > worst) { worst = d; at = i; }
    }

    if (worst > tol && at !== -1) {
      keep[at] = 1;
      stack.push([a, at], [at, b]);
    }
  }

  return points.filter((_, i) => keep[i]);
}

const bboxArea = (ring) => {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const [x, y] of ring) {
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return (x1 - x0) * (y1 - y0);
};

// A thousandth of a degree is about a tenth of a pixel at board resolution -
// far below the simplification tolerance, so this costs nothing and the file
// shrinks by a third.
const round = (ring) =>
  ring.map(([lon, lat]) => [Math.round(lon * 1e3) / 1e3, Math.round(lat * 1e3) / 1e3]);

async function collect(file, { closed, minArea = 0, filter = () => true }) {
  process.stdout.write(`  ${file} ... `);
  const res = await fetch(`${BASE}/${file}.geojson`);
  if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`);
  const json = await res.json();

  const out = [];
  for (const feature of json.features) {
    if (!filter(feature.properties)) continue;
    for (const ring of ringsOf(feature.geometry)) {
      // Keep anything that shows at all: a ring can be mostly outside the window
      // and still put a headland inside it.
      if (!ring.some(inWindow)) continue;
      const simple = simplify(ring, TOLERANCE);
      if (simple.length < (closed ? 3 : 2)) continue;
      if (minArea && bboxArea(simple) < minArea) continue;
      out.push(round(simple));
    }
  }

  const vertices = out.reduce((n, r) => n + r.length, 0);
  console.log(`${out.length} rings, ${vertices} vertices`);
  return out;
}

console.log('Fetching Natural Earth 1:10m ...');

// Islands below roughly a square kilometre are a scattering of single pixels at
// board resolution - noise in the file and speckle in the paint.
const land = await collect('ne_10m_land', { closed: true, minArea: 0.0004 });
const lakes = await collect('ne_10m_lakes', { closed: true, minArea: 0.0004 });
const borders = await collect('ne_10m_admin_0_boundary_lines_land', {
  closed: false,
  filter: (p) => NEIGHBOURS.has(p.ADM0_LEFT) && NEIGHBOURS.has(p.ADM0_RIGHT),
});

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify({
  source: 'Natural Earth 1:10m (public domain) - naturalearthdata.com',
  fetchedAt: new Date().toISOString(),
  window: WINDOW,
  tolerance: TOLERANCE,
  land,
  lakes,
  borders,
}) + '\n');

console.log(`\nWritten to tools/art/geodata.json`);
