#!/usr/bin/env node
/**
 * Checks that the painted board and the game graph still agree.
 *
 * This replaces the old calibrate-basemap.mjs, which existed to *measure* which
 * part of the world the background photograph showed. There is nothing left to
 * measure: the background is drawn from vector geometry through the same bounds
 * that place the cities, so the two agree by construction.
 *
 * What can still go wrong is forgetting. Change BASEMAP.bounds, regenerate the
 * board, and skip `npm run art`, and the served picture is of a different window
 * than the one the cities were placed in - silently, because nothing crashes.
 * That is what this catches.
 *
 *   npm run verify:map
 *
 * Two independent checks:
 *
 *   1. Places of undisputed nature - open sea, the big lakes, solid inland - are
 *      read out of the painted image. These fail loudly if board.jpg was painted
 *      from bounds other than the ones nodes.json now declares.
 *   2. Every city and border node is read out of the same image. A city on blue
 *      is a city in the sea.
 *
 * Reads the image off disk, so no server needs to be running.
 */

import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');

const board = JSON.parse(readFileSync(join(root, 'server', 'data', 'nodes.json'), 'utf8'));
const image = readFileSync(join(root, 'client', 'public', 'board.jpg'));

/**
 * Ground truth. Every point here is somewhere whose nature nobody would argue
 * about: open sea well away from any shore, or land well away from the coast and
 * from the bigger lakes. Lakes are the trap - Finland is full of them, and they
 * read as water just like the sea does.
 */
const PROBES = [
  // --- open sea and the big lakes. Ladoga and Peipus are the strongest
  //     landmarks on the whole image: large, unmistakable, and far east/south,
  //     where the coastline alone gives little to grip.
  { name: 'Bothnian Sea', lat: 61.80, lon: 19.80, water: true },
  { name: 'Bothnian Bay', lat: 64.80, lon: 23.20, water: true },
  { name: 'Gulf of Finland', lat: 59.85, lon: 25.50, water: true },
  { name: 'Baltic S of Aland', lat: 59.60, lon: 20.00, water: true },
  { name: 'Bothnian mid', lat: 62.80, lon: 20.20, water: true },
  { name: 'Lake Ladoga', lat: 60.80, lon: 30.90, water: true },

  // --- solid ground, kept away from the coast and from the bigger lakes
  { name: 'Finnmark plateau', lat: 69.30, lon: 24.50, water: false },
  { name: 'Lapland/Rovaniemi', lat: 66.90, lon: 25.30, water: false },
  { name: 'Sweden inland', lat: 64.00, lon: 18.50, water: false },
  { name: 'Sweden Lapland', lat: 66.50, lon: 19.50, water: false },
  { name: 'Estonia inland', lat: 59.10, lon: 25.60, water: false },
  { name: 'Ostrobothnia', lat: 62.50, lon: 22.50, water: false },
  { name: 'S Finland/Salo', lat: 60.40, lon: 23.50, water: false },
  { name: 'Norway/Troms', lat: 69.00, lon: 20.00, water: false },
  { name: 'Karelian Isthmus', lat: 59.60, lon: 30.80, water: false },
];

/**
 * How far into the water a node may sit before it counts as misplaced. Some
 * towns really are built on the water - Savonlinna stands on islands in Saimaa -
 * and at roughly half a kilometre to the pixel their shore is only a few pixels
 * wide. Beyond this, the placement is wrong rather than tight.
 */
const TOLERANCE_PX = 8;

const main = async () => {
  const browser = await chromium.launch({ channel: 'chrome' });
  const page = await browser.newPage();
  await page.goto('about:blank');

  const result = await page.evaluate(async ({ src, basemap, nodes, probes, tolerance }) => {
    const bitmap = await createImageBitmap(await (await fetch(src)).blob());
    const width = bitmap.width, height = bitmap.height;
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0);
    const { data } = ctx.getImageData(0, 0, width, height);

    /**
     * Water on the board is the poster blue; land is the plywood green. Blue
     * being clearly the strongest channel separates them cleanly - the same test
     * the renderer's own palette is built around.
     */
    const isWater = (x, y) => {
      x = Math.round(x); y = Math.round(y);
      if (x < 0 || y < 0 || x >= width || y >= height) return true;   // off-image counts as lost
      const i = (y * width + x) * 4;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      return b > r + 28 && b > g + 8 && b > 120;
    };

    /** Fraction of a small disc that is water, so a single stray pixel cannot decide. */
    const waterness = (px, py) => {
      let wet = 0, seen = 0;
      const radius = Math.max(2, Math.round(width / 250));
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          seen++;
          if (isWater(Math.round(px) + dx, Math.round(py) + dy)) wet++;
        }
      }
      return seen ? wet / seen : 0.5;
    };

    const mercY = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
    const { north, south, west, east } = basemap.bounds;
    const project = (lat, lon) => ({
      x: ((lon - west) / (east - west)) * width,
      y: basemap.projection === 'mercator'
        ? ((mercY(north) - mercY(lat)) / (mercY(north) - mercY(south))) * height
        : ((north - lat) / (north - south)) * height,
    });

    const nature = probes.map((p) => {
      const { x, y } = project(p.lat, p.lon);
      const inside = x >= 0 && y >= 0 && x < width && y < height;   // false for NaN
      const w = inside ? waterness(x, y) : null;
      return {
        name: p.name,
        expected: p.water ? 'water' : 'land',
        got: !inside ? 'off-image' : w > 0.6 ? 'water' : w < 0.4 ? 'land' : 'edge',
        wetness: w === null ? null : Math.round(w * 100),
        px: Math.round(x), py: Math.round(y),
      };
    });

    // Nodes are read at the position the board itself stores, not reprojected -
    // that way a stale nodes.json shows up as a node in the water rather than
    // being quietly corrected on the way past.
    const placed = [];
    for (const n of nodes) {
      if (n.type !== 'city' && n.type !== 'border') continue;
      const x = (n.x / 100) * width, y = (n.y / 100) * height;
      let drift = 0;
      if (isWater(x, y)) {
        search: for (let r = 1; r <= 200; r++) {
          for (let a = 0; a < 72; a++) {
            const t = (a / 72) * Math.PI * 2;
            if (!isWater(x + Math.cos(t) * r, y + Math.sin(t) * r)) { drift = r; break search; }
          }
        }
        if (drift === 0) drift = 200;                 // nothing found within reach
      }
      if (drift) placed.push({ id: n.id, name: n.name, drift, px: Math.round(x), py: Math.round(y) });
    }

    const kmPerPx = ((east - west) * 111.32 *
      Math.cos(((north + south) / 2) * Math.PI / 180)) / width;

    return { width, height, nature, placed, kmPerPx, tolerance };
  }, {
    src: `data:image/jpeg;base64,${image.toString('base64')}`,
    basemap: board.basemap,
    nodes: board.nodes,
    probes: PROBES,
    tolerance: TOLERANCE_PX,
  });

  await browser.close();

  const b = board.basemap.bounds;
  console.log(`image   ${result.width}x${result.height}  (1 px ~ ${result.kmPerPx.toFixed(2)} km)`);
  console.log(`window  N${b.north} S${b.south} W${b.west} E${b.east} (${board.basemap.projection})`);

  let failed = false;

  if (result.width !== board.basemap.width || result.height !== board.basemap.height) {
    console.error(`\nXX board.jpg is ${result.width}x${result.height} but nodes.json ` +
      `declares ${board.basemap.width}x${board.basemap.height} - re-run npm run art`);
    failed = true;
  }

  console.log('\nplaces of known nature');
  let right = 0;
  for (const p of result.nature) {
    const ok = p.got === p.expected;
    if (ok) right++; else failed = true;
    console.log(`  ${ok ? 'ok' : 'XX'} ${p.name.padEnd(20)} want ${p.expected.padEnd(6)}` +
      ` got ${String(p.got).padEnd(9)} wet ${String(p.wetness).padStart(3)}%  at ${p.px},${p.py}`);
  }
  console.log(`  ${right} of ${result.nature.length} correct`);

  console.log('\nnodes standing in water');
  if (!result.placed.length) {
    console.log('  none - every city and the border crossing are on dry land');
  }
  for (const n of result.placed.sort((a, z) => z.drift - a.drift)) {
    const km = (n.drift * result.kmPerPx).toFixed(1);
    const bad = n.drift > result.tolerance;
    if (bad) failed = true;
    console.log(`  ${bad ? 'XX' : 'ok'} ${String(n.name).padEnd(18)} ` +
      `${String(n.drift).padStart(3)} px = ${km.padStart(5)} km from land  at ${n.px},${n.py}`);
  }
  if (result.placed.length) {
    console.log(`  (up to ${result.tolerance} px is a shoreline town, not a misplacement)`);
  }

  if (failed) {
    console.error('\nFAILED - the picture and the graph disagree. Re-run npm run art, ' +
      'and node tools/generate-board.mjs if the bounds changed.');
    process.exit(1);
  }
  console.log('\nOK - the painted map and the city circles agree.');
};

main().catch((e) => { console.error(e); process.exit(1); });
