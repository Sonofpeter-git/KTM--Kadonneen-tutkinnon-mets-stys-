#!/usr/bin/env node
/**
 * Board generator for Kadonneen Tutkinnon Metsastys (KTM) digital edition.
 *
 * Produces server/data/nodes.json: the static map graph the rules engine walks.
 *
 * WHY THIS EXISTS
 * ---------------
 * The physical board is a 203x299cm vinyl mat. Until its node positions are traced
 * off the real artwork, this script synthesises an equivalent graph from real
 * Finnish city coordinates so the engine has something faithful to run against.
 *
 * The output file is a plain drop-in: when the real board is traced, replace
 * server/data/nodes.json wholesale and nothing in the engine needs to change,
 * as long as the schema and the invariants at the bottom of this file still hold.
 *
 *   node tools/generate-board.mjs
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, '..', 'server', 'data', 'nodes.json');

/* ------------------------------------------------------------------ tuning */

const DOT_UNIT_DEG = 0.5;   // one connector dot per this much projected distance
const MAX_DOTS = 3;         // never more than this many dots on a single edge
const EXPECTED_CITIES = 54; // must equal the token pool size (see tokens.js)

/**
 * The picture the board is drawn on, and what part of the world it covers.
 *
 * Every city is placed from its real latitude and longitude into this frame, so
 * these four numbers decide whether Turku lands on Turku or in the sea.
 *
 * They used to be a measurement. The background was a photograph of a terrain
 * map, and the only way to learn what it covered was to read its pixels and
 * search for the bounds that best explained them. That answer was always a
 * little wrong, and a little wrong put Kemi twenty kilometres out to sea and
 * Tornio eight. Worse, the photograph stopped at about 69.7N, so the northern
 * tip of Finland was simply not in the picture - no choice of bounds could put
 * Utsjoki on dry land, because there was no dry land there to put it on.
 *
 * So the window is now a decision rather than a discovery, and the coastline is
 * drawn to match it: client/scripts/render-basemap.mjs paints board.jpg from
 * real vector geometry through this very projection. A city can no longer land
 * in the sea unless it is genuinely at sea. Change these numbers and re-run
 * `npm run art`, and the coast, the lakes and the borders all follow.
 *
 * The window is picked so that:
 *   - every node sits at least ~3% inside the edge, Utsjoki and Tukholma included;
 *   - the longitude span is exactly what the latitude span needs for the mercator
 *     aspect to equal the image's own 1470x2912, so nothing is stretched.
 *
 * Try a different window without editing the file - but re-render the art after,
 * or the map and the cities part company:
 *
 *   node tools/generate-board.mjs --north 71.2 --south 58 --west 14.5 --east 33
 *   node tools/generate-board.mjs --projection equirectangular
 */
const BASEMAP = {
  image: '/board.jpg',
  width: 1470,
  height: 2912,
  projection: 'mercator',          // or 'equirectangular'
  bounds: { north: 70.6, south: 58.8, west: 17.104, east: 31.296 },
};

// CLI overrides, so trying a window is one command rather than an edit-run cycle.
for (const key of ['north', 'south', 'west', 'east']) {
  const at = process.argv.indexOf(`--${key}`);
  if (at !== -1) BASEMAP.bounds[key] = Number(process.argv[at + 1]);
}
const projectionAt = process.argv.indexOf('--projection');
if (projectionAt !== -1) BASEMAP.projection = process.argv[projectionAt + 1];

/* -------------------------------------------------------------- input data */

/**
 * Every node that carries a token is `city`. Coordinates are real (lat, lon).
 * Exactly EXPECTED_CITIES of these, because the physical game places one of the
 * 54 cardboard discs on every city circle.
 */
const CITIES = {
  // --- Uusimaa / south coast
  helsinki:      { name: 'Helsinki',       lat: 60.17, lon: 24.94 },
  otaniemi:      { name: 'Otaniemi',       lat: 60.19, lon: 24.83 },
  porvoo:        { name: 'Porvoo',         lat: 60.39, lon: 25.66 },
  lohja:         { name: 'Lohja',          lat: 60.25, lon: 24.07 },
  hanko:         { name: 'Hanko',          lat: 59.83, lon: 22.97 },
  // --- south-east
  kotka:         { name: 'Kotka',          lat: 60.47, lon: 26.94 },
  kouvola:       { name: 'Kouvola',        lat: 60.87, lon: 26.70 },
  lahti:         { name: 'Lahti',          lat: 60.98, lon: 25.66 },
  lappeenranta:  { name: 'Lappeenranta',   lat: 61.06, lon: 28.19 },
  imatra:        { name: 'Imatra',         lat: 61.17, lon: 28.77 },
  // --- lakeland
  mikkeli:       { name: 'Mikkeli',        lat: 61.69, lon: 27.27 },
  savonlinna:    { name: 'Savonlinna',     lat: 61.87, lon: 28.88 },
  varkaus:       { name: 'Varkaus',        lat: 62.32, lon: 27.87 },
  kuopio:        { name: 'Kuopio',         lat: 62.89, lon: 27.68 },
  joensuu:       { name: 'Joensuu',        lat: 62.60, lon: 29.76 },
  nurmes:        { name: 'Nurmes',         lat: 63.54, lon: 29.14 },
  iisalmi:       { name: 'Iisalmi',        lat: 63.56, lon: 27.19 },
  // --- Kainuu
  kajaani:       { name: 'Kajaani',        lat: 64.22, lon: 27.73 },
  kuhmo:         { name: 'Kuhmo',          lat: 64.13, lon: 29.52 },
  suomussalmi:   { name: 'Suomussalmi',    lat: 64.89, lon: 28.91 },
  kuusamo:       { name: 'Kuusamo',        lat: 65.96, lon: 29.19 },
  // --- Oulu region
  oulu:          { name: 'Oulu',           lat: 65.01, lon: 25.47 },
  pudasjarvi:    { name: 'Pudasjarvi',     lat: 65.36, lon: 26.99 },
  raahe:         { name: 'Raahe',          lat: 64.68, lon: 24.48 },
  ylivieska:     { name: 'Ylivieska',      lat: 64.08, lon: 24.55 },
  kemi:          { name: 'Kemi',           lat: 65.74, lon: 24.56 },
  tornio:        { name: 'Tornio',         lat: 65.85, lon: 24.15 },
  // --- Lapland
  rovaniemi:     { name: 'Rovaniemi',      lat: 66.50, lon: 25.73 },
  kemijarvi:     { name: 'Kemijarvi',      lat: 66.71, lon: 27.43 },
  sodankyla:     { name: 'Sodankyla',      lat: 67.42, lon: 26.59 },
  kittila:       { name: 'Kittila',        lat: 67.65, lon: 24.90 },
  muonio:        { name: 'Muonio',         lat: 67.96, lon: 23.68 },
  kilpisjarvi:   { name: 'Kilpisjarvi',    lat: 69.05, lon: 20.79 },
  ivalo:         { name: 'Ivalo',          lat: 68.66, lon: 27.54 },
  inari:         { name: 'Inari',          lat: 68.91, lon: 27.03 },
  utsjoki:       { name: 'Utsjoki',        lat: 69.91, lon: 27.03 },
  // --- Ostrobothnia
  kokkola:       { name: 'Kokkola',        lat: 63.84, lon: 23.13 },
  pietarsaari:   { name: 'Pietarsaari',    lat: 63.68, lon: 22.70 },
  vaasa:         { name: 'Vaasa',          lat: 63.10, lon: 21.62 },
  seinajoki:     { name: 'Seinajoki',      lat: 62.79, lon: 22.84 },
  kauhajoki:     { name: 'Kauhajoki',      lat: 62.43, lon: 22.18 },
  // --- Satakunta / Varsinais-Suomi
  pori:          { name: 'Pori',           lat: 61.49, lon: 21.80 },
  rauma:         { name: 'Rauma',          lat: 61.13, lon: 21.51 },
  uusikaupunki:  { name: 'Uusikaupunki',   lat: 60.80, lon: 21.41 },
  turku:         { name: 'Turku / Abo',    lat: 60.45, lon: 22.27 },
  salo:          { name: 'Salo',           lat: 60.39, lon: 23.13 },
  // --- Hame / central
  hameenlinna:   { name: 'Hameenlinna',    lat: 60.99, lon: 24.46 },
  tampere:       { name: 'Tampere',        lat: 61.50, lon: 23.76 },
  jyvaskyla:     { name: 'Jyvaskyla',      lat: 62.24, lon: 25.75 },
  // --- abroad
  pietari:       { name: 'Pietari',        lat: 59.93, lon: 30.34 },
  tallinna:      { name: 'Tallinna',       lat: 59.44, lon: 24.75 },
  maarianhamina: { name: 'Maarianhamina',  lat: 60.10, lon: 19.94 },
  tukholma:      { name: 'Tukholma',       lat: 59.33, lon: 18.07 },
  uumaja:        { name: 'Uumaja',         lat: 63.83, lon: 20.26 },
};

/**
 * Non-city fixed nodes. These never carry a token.
 * Haaparanta is the Swedish side of the Tornio border crossing: the rulebook
 * makes teams stop here and face the border guard.
 */
const SPECIAL_NODES = {
  haaparanta: { name: 'Haaparanta', lat: 65.84, lon: 24.10, type: 'border' },
};

/**
 * Adjacency, written one line per node. Symmetrised below, so each connection
 * only needs to be listed once (listing it twice is harmless).
 */
const ADJACENCY = {
  hanko:         ['turku', 'salo', 'lohja', 'maarianhamina'],
  turku:         ['rauma', 'uusikaupunki', 'salo', 'hanko', 'maarianhamina'],
  uusikaupunki:  ['rauma', 'turku'],
  salo:          ['turku', 'hanko', 'lohja', 'hameenlinna'],
  lohja:         ['salo', 'hanko', 'otaniemi', 'hameenlinna'],
  otaniemi:      ['lohja', 'helsinki', 'hameenlinna'],
  helsinki:      ['otaniemi', 'porvoo', 'lahti', 'tallinna'],
  porvoo:        ['helsinki', 'kotka', 'lahti'],
  kotka:         ['porvoo', 'kouvola', 'pietari'],
  kouvola:       ['kotka', 'lahti', 'lappeenranta', 'mikkeli'],
  lahti:         ['helsinki', 'porvoo', 'kouvola', 'hameenlinna', 'mikkeli'],
  lappeenranta:  ['kouvola', 'imatra', 'mikkeli', 'pietari'],
  imatra:        ['lappeenranta', 'savonlinna', 'pietari'],
  savonlinna:    ['imatra', 'mikkeli', 'varkaus', 'joensuu'],
  mikkeli:       ['kouvola', 'lahti', 'lappeenranta', 'savonlinna', 'varkaus'],
  varkaus:       ['mikkeli', 'savonlinna', 'kuopio', 'joensuu', 'jyvaskyla'],
  kuopio:        ['varkaus', 'iisalmi', 'joensuu', 'jyvaskyla'],
  joensuu:       ['savonlinna', 'varkaus', 'kuopio', 'nurmes'],
  nurmes:        ['joensuu', 'kajaani', 'kuhmo'],
  iisalmi:       ['kuopio', 'kajaani', 'jyvaskyla', 'ylivieska'],
  kajaani:       ['iisalmi', 'nurmes', 'kuhmo', 'oulu', 'suomussalmi'],
  kuhmo:         ['nurmes', 'kajaani', 'suomussalmi'],
  suomussalmi:   ['kuhmo', 'kajaani', 'kuusamo'],
  kuusamo:       ['suomussalmi', 'pudasjarvi', 'kemijarvi'],
  pudasjarvi:    ['oulu', 'kuusamo', 'rovaniemi'],
  oulu:          ['kajaani', 'raahe', 'kemi', 'pudasjarvi'],
  raahe:         ['oulu', 'ylivieska', 'kokkola'],
  ylivieska:     ['raahe', 'kokkola', 'iisalmi'],
  kokkola:       ['raahe', 'ylivieska', 'pietarsaari', 'seinajoki'],
  pietarsaari:   ['kokkola', 'vaasa', 'seinajoki'],
  vaasa:         ['pietarsaari', 'seinajoki', 'kauhajoki', 'uumaja'],
  seinajoki:     ['vaasa', 'pietarsaari', 'kokkola', 'kauhajoki', 'tampere', 'jyvaskyla'],
  kauhajoki:     ['vaasa', 'seinajoki', 'pori'],
  pori:          ['kauhajoki', 'rauma', 'tampere'],
  rauma:         ['pori', 'uusikaupunki', 'turku', 'tampere'],
  tampere:       ['hameenlinna', 'pori', 'rauma', 'seinajoki', 'jyvaskyla'],
  hameenlinna:   ['tampere', 'lahti', 'lohja', 'salo', 'otaniemi'],
  jyvaskyla:     ['tampere', 'seinajoki', 'iisalmi', 'kuopio', 'varkaus', 'mikkeli'],
  kemi:          ['oulu', 'tornio', 'rovaniemi'],
  tornio:        ['kemi', 'haaparanta', 'rovaniemi'],
  haaparanta:    ['tornio', 'uumaja'],
  uumaja:        ['haaparanta', 'vaasa'],
  rovaniemi:     ['kemi', 'tornio', 'pudasjarvi', 'kemijarvi', 'sodankyla', 'kittila'],
  kemijarvi:     ['rovaniemi', 'kuusamo', 'sodankyla'],
  sodankyla:     ['rovaniemi', 'kemijarvi', 'kittila', 'ivalo'],
  kittila:       ['rovaniemi', 'sodankyla', 'muonio'],
  muonio:        ['kittila', 'kilpisjarvi'],
  kilpisjarvi:   ['muonio', 'utsjoki'],
  utsjoki:       ['inari', 'kilpisjarvi'],
  inari:         ['ivalo', 'utsjoki'],
  ivalo:         ['sodankyla', 'inari', 'pietari'],
  pietari:       ['kotka', 'lappeenranta', 'imatra', 'ivalo'],
  tallinna:      ['helsinki', 'tukholma'],
  maarianhamina: ['turku', 'hanko', 'tukholma'],
  tukholma:      ['maarianhamina', 'tallinna'],
};

/** Edges crossed by ferry. Rulebook: one beer to begin the sea journey. */
const WATER_EDGES = [
  ['vaasa', 'uumaja'],
  ['turku', 'maarianhamina'],
  ['hanko', 'maarianhamina'],
  ['maarianhamina', 'tukholma'],
  ['helsinki', 'tallinna'],
  ['tallinna', 'tukholma'],
];

/** Rulebook: the flight route runs between Pietari and Ivalo, for three beers. */
const FLIGHT_EDGES = [
  ['pietari', 'ivalo'],
];

/** Teekkariristeily: one water square hands out three cruise shots on landing. */
const CRUISE_ON_EDGE = ['maarianhamina', 'tukholma'];

/**
 * Guilds start from their own home city. Ids must match server/data/guilds.json,
 * which a test cross-checks. Digit and DaTe are both Turku guilds - the rulebook
 * lists Turku and Abo separately but they are one square.
 */
const HOME_CITIES = {
  turku: ['digit', 'date'],
  tampere: ['tite'],
  oulu: ['otit'],
  otaniemi: ['tik'],
  lappeenranta: ['cluster'],
  vaasa: ['tutti'],
  jyvaskyla: ['algo'],
};

/* ------------------------------------------------------------- projection */

const key = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);

const allPlaces = { ...CITIES, ...SPECIAL_NODES };
const { north, south, west, east } = BASEMAP.bounds;

const round2 = (n) => Math.round(n * 100) / 100;

/** Mercator stretches towards the poles; over 58-71N that is a visible amount. */
const mercatorY = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));

/** Real coordinates -> percentage of the basemap's width and height. */
function toPercent(place) {
  const x = ((place.lon - west) / (east - west)) * 100;

  const y = BASEMAP.projection === 'mercator'
    ? ((mercatorY(north) - mercatorY(place.lat)) /
       (mercatorY(north) - mercatorY(south))) * 100
    : ((north - place.lat) / (north - south)) * 100;

  return { x: round2(x), y: round2(y) };
}

/**
 * Distance in projected degrees, used only to decide how many connector dots an
 * edge deserves. Longitude is scaled by the latitude so a degree east counts for
 * what it is worth this far north.
 */
const lonScale = Math.cos(((north + south) / 2) * (Math.PI / 180));
const geo = (p) => ({ gx: p.lon * lonScale, gy: -p.lat });

/* ------------------------------------------------------------ graph build */

const nodes = new Map();

function addNode(id, name, type, x, y, place = null) {
  if (nodes.has(id)) throw new Error(`duplicate node id: ${id}`);
  const node = { id, name, type, x, y, edges: [] };
  // Real coordinates are kept on the fixed places so the map can be reprojected
  // onto a different image without going back to the source list.
  if (place) { node.lat = place.lat; node.lon = place.lon; }
  nodes.set(id, node);
}

function link(a, b, type) {
  const na = nodes.get(a);
  const nb = nodes.get(b);
  if (!na) throw new Error(`link from unknown node: ${a}`);
  if (!nb) throw new Error(`link to unknown node: ${b}`);
  if (!na.edges.some((e) => e.target === b)) na.edges.push({ target: b, type });
  if (!nb.edges.some((e) => e.target === a)) nb.edges.push({ target: a, type });
}

// 1. place every city and special node
for (const [id, p] of Object.entries(CITIES)) {
  const { x, y } = toPercent(p);
  addNode(id, p.name, 'city', x, y, p);
}
for (const [id, p] of Object.entries(SPECIAL_NODES)) {
  const { x, y } = toPercent(p);
  addNode(id, p.name, p.type, x, y, p);
}

// 2. collapse the adjacency lists into a deduplicated, symmetric edge set
const edgeTypes = new Map();
for (const [a, b] of WATER_EDGES) edgeTypes.set(key(a, b), 'water');
for (const [a, b] of FLIGHT_EDGES) edgeTypes.set(key(a, b), 'flight');

const trunkEdges = new Map();
for (const [from, neighbours] of Object.entries(ADJACENCY)) {
  if (!nodes.has(from)) throw new Error(`adjacency for unknown node: ${from}`);
  for (const to of neighbours) {
    if (!nodes.has(to)) throw new Error(`adjacency ${from} -> unknown node ${to}`);
    if (from === to) throw new Error(`self-edge on ${from}`);
    trunkEdges.set(key(from, to), [from, to]);
  }
}

// 3. subdivide with connector dots, so d4 movement has somewhere to land.
//    Flight edges are never subdivided: you fly the whole leg or not at all.
const cruiseKey = key(...CRUISE_ON_EDGE);
let dotCount = 0;
let cruiseId = null;

for (const [k, [a, b]] of [...trunkEdges].sort()) {
  const type = edgeTypes.get(k) ?? 'land';
  const ga = geo(allPlaces[a]);
  const gb = geo(allPlaces[b]);
  const dist = Math.hypot(gb.gx - ga.gx, gb.gy - ga.gy);
  const count = type === 'flight' ? 0 : Math.min(MAX_DOTS, Math.round(dist / DOT_UNIT_DEG));

  if (count === 0) {
    link(a, b, type);
    continue;
  }

  const pa = nodes.get(a);
  const pb = nodes.get(b);
  const chain = [a];

  for (let i = 0; i < count; i++) {
    const t = (i + 1) / (count + 1);
    const id = `${a}__${b}_${i}`;
    const isCruise = k === cruiseKey && i === Math.floor(count / 2);
    addNode(
      id,
      isCruise ? 'Teekkariristeily' : '',
      isCruise ? 'cruise' : 'dot',
      round2(pa.x + (pb.x - pa.x) * t),
      round2(pa.y + (pb.y - pa.y) * t),
    );
    if (isCruise) cruiseId = id;
    chain.push(id);
    dotCount++;
  }

  chain.push(b);
  for (let i = 0; i < chain.length - 1; i++) link(chain[i], chain[i + 1], type);
}

/* -------------------------------------------------------------- validation */

const problems = [];
const list = [...nodes.values()];

const cities = list.filter((n) => n.type === 'city');
if (cities.length !== EXPECTED_CITIES) {
  problems.push(`expected ${EXPECTED_CITIES} city nodes, got ${cities.length}`);
}

for (const n of list) {
  if (!['city', 'dot', 'border', 'cruise'].includes(n.type)) {
    problems.push(`${n.id}: unknown type ${n.type}`);
  }
  if (n.x < 0 || n.x > 100 || n.y < 0 || n.y > 100) {
    problems.push(
      `${n.id}: falls outside the basemap at (${n.x}, ${n.y}) - ` +
      'the bounds in BASEMAP do not match the image',
    );
  }
  if (n.edges.length === 0) problems.push(`${n.id}: orphan node, no edges`);
  for (const e of n.edges) {
    const t = nodes.get(e.target);
    if (!t) {
      problems.push(`${n.id}: edge to missing node ${e.target}`);
      continue;
    }
    const back = t.edges.find((x) => x.target === n.id);
    if (!back) problems.push(`${n.id} -> ${e.target}: edge is not bidirectional`);
    else if (back.type !== e.type) {
      problems.push(`${n.id} <-> ${e.target}: type mismatch ${e.type} / ${back.type}`);
    }
  }
}

// connectivity, ignoring flight edges: the board must be walkable without flying
const seen = new Set([list[0].id]);
const queue = [list[0].id];
while (queue.length) {
  for (const e of nodes.get(queue.shift()).edges) {
    if (e.type === 'flight' || seen.has(e.target)) continue;
    seen.add(e.target);
    queue.push(e.target);
  }
}
if (seen.size !== list.length) {
  const stranded = list.filter((n) => !seen.has(n.id)).map((n) => n.id);
  problems.push(`graph not connected by land/water; unreachable: ${stranded.join(', ')}`);
}

if (!cruiseId) problems.push('no cruise node was placed');
for (const home of Object.keys(HOME_CITIES)) {
  if (nodes.get(home)?.type !== 'city') problems.push(`home city ${home} is not a city node`);
}

if (problems.length) {
  console.error('Board generation FAILED:');
  for (const p of problems) console.error('  - ' + p);
  process.exit(1);
}

/* ------------------------------------------------------------------ output */

const board = {
  version: 1,
  generator: 'tools/generate-board.mjs',
  generatedAt: new Date().toISOString(),
  note: 'Synthesised from real city coordinates. Replace wholesale once the physical board is traced.',
  // The picture is the board, so the plate takes the image's own shape.
  aspectRatio: round2(BASEMAP.width / BASEMAP.height),
  basemap: BASEMAP,
  homeCities: HOME_CITIES,
  cruiseNode: cruiseId,
  nodes: list,
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(board, null, 2) + '\n');

const edgeCount = list.reduce((n, x) => n + x.edges.length, 0) / 2;
console.log('Board written to server/data/nodes.json');
console.log(`  nodes   ${list.length}  (${cities.length} city, ${dotCount} dot, ` +
  `${list.filter((n) => n.type === 'border').length} border, ` +
  `${list.filter((n) => n.type === 'cruise').length} cruise)`);
console.log(`  edges   ${edgeCount}  (${trunkEdges.size} trunk routes subdivided)`);
console.log(`  cruise  ${cruiseId}`);
console.log(
  `  map     ${BASEMAP.image} ${BASEMAP.width}x${BASEMAP.height} ` +
  `(${BASEMAP.projection}, N${north} S${south} W${west} E${east})`,
);

// The window is meant to have exactly the image's shape, so that a degree of
// longitude and a degree of latitude come out at the same scale and the coast is
// not stretched. Anything more than a per cent or two apart is a window that was
// changed without the arithmetic being redone.
const geoAspect = BASEMAP.projection === 'mercator'
  ? ((east - west) * (Math.PI / 180)) / (mercatorY(north) - mercatorY(south))
  : ((east - west) * lonScale) / (north - south);
const pixAspect = BASEMAP.width / BASEMAP.height;
const skew = Math.abs(geoAspect - pixAspect) / pixAspect;
if (skew > 0.03) {
  console.warn(
    `  WARN    bounds imply an aspect of ${geoAspect.toFixed(3)} but the image is ` +
    `${pixAspect.toFixed(3)} (${Math.round(skew * 100)}% out) - the map will be stretched`,
  );
}
