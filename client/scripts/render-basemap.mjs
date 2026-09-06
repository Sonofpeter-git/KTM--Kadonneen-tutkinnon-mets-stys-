#!/usr/bin/env node
/**
 * Paints the board background in the style of the physical game.
 *
 * The real KTM board is plywood: flat bright green land, strong blue water,
 * black dot routes, hand lettering. A photographic terrain map reads as murky
 * next to that, and it fights the yellow route highlights for attention.
 *
 * WHERE THE MAP COMES FROM
 * ------------------------
 * This used to repaint a photograph of a terrain map. That left one question
 * open which could never be answered exactly: which part of the world does the
 * photograph show? It had to be measured - read the pixels, guess bounds, score
 * the guess - and the answer was always a little wrong. A little wrong is enough
 * to put Kemi twenty kilometres out to sea, which is where it sat.
 *
 * So the coastline is drawn from real vector geometry now (tools/art/geodata.json,
 * refreshed by tools/fetch-geodata.mjs), projected through the very same bounds
 * that place the city circles. The map and the cities cannot disagree, because
 * neither is measured against the other: both come from the same four numbers in
 * server/data/nodes.json. Change the bounds, re-run this, and the coast follows.
 *
 *   npm run art                        paint the background
 *   npm run art -- --cities            also bake in the nodes, for a printable board
 *   npm run art -- --cities --scale 3  render that at 3x, for print
 *
 * Chrome does the drawing (canvas), so this needs no image libraries and no
 * running server.
 */

import { chromium } from 'playwright-core';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');

const GEODATA = join(root, 'tools', 'art', 'geodata.json');
const BOARD = join(root, 'server', 'data', 'nodes.json');
const OUT = join(root, 'client', 'public', 'board.jpg');
const OUT_CITIES = join(root, 'tools', 'art', 'board-printable.png');

const WITH_CITIES = process.argv.includes('--cities');
// Flat colour plus paint grain is exactly the case PNG compresses badly and JPEG
// handles well, and this is a background - nobody is pixel-peeping the coastline.
const AS_PNG = process.argv.includes('--png');
// The served image has to stay the size the board declares, or nodes.json stops
// describing it. Scale up only for the printable sheet.
const scaleAt = process.argv.indexOf('--scale');
const SCALE = scaleAt !== -1 ? Number(process.argv[scaleAt + 1]) : 1;

/** Taken off the photograph of the real board. */
const PALETTE = {
  land: [46, 173, 79],        // plywood green
  landShade: [33, 140, 62],   // the darker streaks where the paint pooled
  water: [23, 92, 200],       // poster blue
  waterShade: [18, 74, 168],
  ink: [12, 14, 16],          // route dots and lettering
  border: [24, 30, 26],       // the painted line between countries
};

const main = async () => {
  const geo = JSON.parse(readFileSync(GEODATA, 'utf8'));
  const board = JSON.parse(readFileSync(BOARD, 'utf8'));

  const browser = await chromium.launch({ channel: 'chrome' });
  const page = await browser.newPage();
  await page.goto('about:blank');

  const png = await page.evaluate(async ({ geo, basemap, palette, scale, nodes, withCities, asPng }) => {
    const w = Math.round(basemap.width * scale);
    const h = Math.round(basemap.height * scale);
    const { north, south, west, east } = basemap.bounds;

    // --- 1. the projection, identical to the one in tools/generate-board.mjs --
    const mercY = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
    const myN = mercY(north);
    const myS = mercY(south);
    const X = (lon) => ((lon - west) / (east - west)) * w;
    const Y = (lat) => basemap.projection === 'mercator'
      ? ((myN - mercY(lat)) / (myN - myS)) * h
      : ((north - lat) / (north - south)) * h;

    const trace = (ctx, rings, close) => {
      ctx.beginPath();
      for (const ring of rings) {
        ctx.moveTo(X(ring[0][0]), Y(ring[0][1]));
        for (let i = 1; i < ring.length; i++) ctx.lineTo(X(ring[i][0]), Y(ring[i][1]));
        if (close) ctx.closePath();
      }
    };

    // --- 2. the land mask, drawn rather than measured ------------------------
    // White is land, black is water. Filling every ring in one path with the
    // even-odd rule is what makes an island inside a lake inside an island come
    // out right. Canvas anti-aliases the edge for us, which step 3 then hardens
    // back into a coastline.
    const maskCanvas = new OffscreenCanvas(w, h);
    const mctx = maskCanvas.getContext('2d');
    mctx.fillStyle = '#000';
    mctx.fillRect(0, 0, w, h);
    mctx.fillStyle = '#fff';
    trace(mctx, geo.land, true);
    mctx.fill('evenodd');
    mctx.fillStyle = '#000';                     // lakes are water too
    trace(mctx, geo.lakes, true);
    mctx.fill('evenodd');
    const landness = mctx.getImageData(0, 0, w, h).data;

    // --- 3. repaint ----------------------------------------------------------
    const out = new ImageData(w, h);

    // Cheap value noise, so the flat fills get some of the unevenness of paint
    // on plywood instead of looking like a vector fill.
    const hash = (x, y) => {
      const n = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
      return n - Math.floor(n);
    };
    const noise = (x, y, cell) => {
      const gx = Math.floor(x / cell), gy = Math.floor(y / cell);
      const fx = (x / cell) - gx, fy = (y / cell) - gy;
      const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
      const a = hash(gx, gy), b = hash(gx + 1, gy);
      const c = hash(gx, gy + 1), d = hash(gx + 1, gy + 1);
      return (a * (1 - sx) + b * sx) * (1 - sy) + (c * (1 - sx) + d * sx) * sy;
    };

    const mix = (a, b, t) => a + (b - a) * t;
    const smoothstep = (e0, e1, x) => {
      const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
      return t * t * (3 - 2 * t);
    };

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;

        // Harden the anti-aliased edge back into a coastline, keeping a pixel
        // or two of blend so it does not alias. 1 = water, since the mask is
        // drawn the other way round.
        const t = 1 - smoothstep(0.42, 0.58, landness[i] / 255);

        // Two scales of noise: broad brush strokes, plus fine grain.
        const broad = noise(x, y, 90 * scale);
        const grain = noise(x, y, 6 * scale);
        const shade = broad * 0.75 + grain * 0.25;

        for (let c = 0; c < 3; c++) {
          const land = mix(palette.landShade[c], palette.land[c], shade);
          const water = mix(palette.waterShade[c], palette.water[c], shade);
          out.data[i + c] = Math.round(mix(land, water, t));
        }
        out.data[i + 3] = 255;
      }
    }

    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext('2d');
    ctx.putImageData(out, 0, 0);

    // --- 4. national borders -------------------------------------------------
    // Finland's edges are a rule, not decoration: the guard at Tornio only makes
    // sense if you can see which side of the line a team is standing on. Drawn as
    // the long dash-and-dot a printed map uses, so it cannot be read as a route.
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    trace(ctx, geo.borders, false);
    // A pale underlay first, so the dark line keeps its contrast over the green
    // and over the darker shading streaks alike.
    ctx.strokeStyle = 'rgba(236,245,232,0.28)';
    ctx.lineWidth = 4.2 * scale;
    ctx.stroke();
    ctx.setLineDash([13 * scale, 5 * scale, 2.5 * scale, 5 * scale]);
    ctx.strokeStyle = `rgba(${palette.border.join(',')},0.9)`;
    ctx.lineWidth = 2.4 * scale;
    ctx.stroke();
    ctx.setLineDash([]);

    // --- 5. optionally bake the game graph on, for a printable board ---------
    if (withCities) {
      const ink = `rgb(${palette.ink.join(',')})`;
      const pos = (n) => ({ x: (n.x / 100) * w, y: (n.y / 100) * h });
      const byId = new Map(nodes.map((n) => [n.id, n]));

      // Routes first, so the squares sit on top of them.
      ctx.strokeStyle = ink;
      ctx.lineWidth = Math.max(1, 1.6 * scale);
      const drawn = new Set();
      for (const n of nodes) {
        for (const e of n.edges) {
          const key = n.id < e.target ? `${n.id}|${e.target}` : `${e.target}|${n.id}`;
          if (drawn.has(key)) continue;
          drawn.add(key);
          const t2 = byId.get(e.target);
          if (!t2) continue;
          const a = pos(n), b = pos(t2);
          ctx.globalAlpha = e.type === 'land' ? 0.55 : 0.35;
          ctx.setLineDash(e.type === 'land' ? [] : [6 * scale, 5 * scale]);
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
      ctx.setLineDash([]);

      for (const n of nodes) {
        const { x, y } = pos(n);
        const city = n.type === 'city';
        const radius = (city ? 5.5 : 3.2) * scale;

        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fillStyle = city ? '#f2e2b8' : ink;   // cities are the disc circles
        ctx.fill();
        if (city) {
          ctx.lineWidth = 1.4 * scale;
          ctx.strokeStyle = ink;
          ctx.stroke();
        }

        if (city && n.name) {
          ctx.font = `${7 * scale}px system-ui, sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'top';
          ctx.lineWidth = 3 * scale;
          ctx.strokeStyle = 'rgba(255,255,255,0.65)';
          ctx.strokeText(n.name.toUpperCase(), x, y + radius + 2 * scale);
          ctx.fillStyle = ink;
          ctx.fillText(n.name.toUpperCase(), x, y + radius + 2 * scale);
        }
      }
    }

    const blob = await canvas.convertToBlob(
      asPng ? { type: 'image/png' } : { type: 'image/jpeg', quality: 0.92 },
    );
    const buf = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    for (let i = 0; i < buf.length; i++) binary += String.fromCharCode(buf[i]);
    return { base64: btoa(binary), width: w, height: h };
  }, {
    geo: { land: geo.land, lakes: geo.lakes, borders: geo.borders },
    basemap: board.basemap,
    palette: PALETTE,
    scale: SCALE,
    nodes: board.nodes,
    withCities: WITH_CITIES,
    asPng: AS_PNG,
  });

  await browser.close();

  const target = WITH_CITIES
    ? OUT_CITIES
    : AS_PNG ? OUT.replace(/\.jpg$/, '.png') : OUT;
  writeFileSync(target, Buffer.from(png.base64, 'base64'));

  const b = board.basemap.bounds;
  console.log(`Painted ${png.width}x${png.height} -> ${target.replace(root, '.')}`);
  console.log(`  ${(Buffer.from(png.base64, 'base64').length / 1024).toFixed(0)} kB`);
  console.log(`  window  N${b.north} S${b.south} W${b.west} E${b.east} (${board.basemap.projection})`);
  console.log(`  drawn   ${geo.land.length} coast rings, ${geo.lakes.length} lakes, ` +
    `${geo.borders.length} border lines`);
  if (!WITH_CITIES && SCALE !== 1) {
    console.warn(`  WARN    board.jpg rendered at ${SCALE}x but nodes.json declares ` +
      `${board.basemap.width}x${board.basemap.height}`);
  }
};

main().catch((e) => { console.error(e); process.exit(1); });
