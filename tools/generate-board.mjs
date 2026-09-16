#!/usr/bin/env node
/**
 * Board generator for Kadonneen Tutkinnon Metsastys (KTM) digital edition.
 *
 * Produces server/data/nodes.json: the static map graph the rules engine walks.
 *
 * WHERE THIS COMES FROM
 * ---------------------
 * The physical board is a 203x299cm painted mat. The route graph below - which
 * cities exist, which routes join them, and how many connector dots each route
 * carries - is transcribed from photographs of that mat (ktm-board/*.jpg).
 * Dot counts are COUNTED OFF THE ARTWORK, not derived from distance: the mat
 * spaces its dots by hand and by what fits, and that count is the game's whole
 * distance metric, so deriving it would change how the game plays.
 *
 * Positions are still real latitude and longitude projected through BASEMAP, so
 * the picture and the circles cannot disagree (client/scripts/render-basemap.mjs
 * paints board.jpg through this very projection). The mat's own painting is
 * geographically loose; we keep its graph, not its wobble.
 *
 *   node tools/generate-board.mjs
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TOKEN_COUNT } from '../server/src/game/tokens.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, '..', 'server', 'data', 'nodes.json');

/* ------------------------------------------------------------------ tuning */

/** One disc per city circle, so the bag decides how many cities there must be. */
const EXPECTED_CITIES = TOKEN_COUNT;

/** A transcription guard, not a rule: no painted route carries this many dots. */
const MAX_SANE_DOTS = 12;

/**
 * The picture the board is drawn on, and what part of the world it covers.
 *
 * Every city is placed from its real latitude and longitude into this frame, so
 * these four numbers decide whether Turku lands on Turku or in the sea. The
 * coastline is drawn to match them: client/scripts/render-basemap.mjs paints
 * board.jpg from real vector geometry through this same projection, so a city
 * can only land in the sea if it is genuinely at sea.
 *
 * The window is picked so that:
 *   - every node clears the edge. Soderhamn (17.06E) and Ilomantsi (30.93E) are
 *     the horizontal extremes, Utsjoki and Tukholma the vertical ones. The old
 *     window stopped at 17.104E, which the Swedish coast alone puts out of date.
 *   - the longitude span is what the latitude span needs for the mercator aspect
 *     to equal the image's own shape, so nothing is stretched;
 *   - that shape is the physical mat's 203:299, so the digital board has the
 *     proportions of the real one.
 *
 * Change these and re-run `npm run art`, or the map and the cities part company.
 *
 *   node tools/generate-board.mjs --north 71.2 --south 58 --west 14.5 --east 33
 *   node tools/generate-board.mjs --projection equirectangular
 */
const BASEMAP = {
  image: '/board.jpg',
  width: 1980,
  height: 2916,
  projection: 'mercator',          // or 'equirectangular'
  bounds: { north: 70.6, south: 58.4, west: 14.198, east: 33.803 },
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
 * Every node that carries a token is `city`. Coordinates are real (lat, lon);
 * the names are the ones lettered on the mat.
 *
 * Exactly EXPECTED_CITIES of these, because the physical game places one of the
 * cardboard discs on every city circle. Note the mat has no separate Helsinki -
 * the southern hub is lettered ESPOO, and it stands where Helsinki would.
 */
const CITIES = {
  // --- Lapland
  utsjoki:       { name: 'Utsjoki',        lat: 69.91, lon: 27.03 },
  inari:         { name: 'Inari',          lat: 68.91, lon: 27.03 },
  ivalo:         { name: 'Ivalo',          lat: 68.66, lon: 27.54 },
  muonio:        { name: 'Muonio',         lat: 67.96, lon: 23.68 },
  kolari:        { name: 'Kolari',         lat: 67.33, lon: 23.79 },
  sodankyla:     { name: 'Sodankyla',      lat: 67.42, lon: 26.59 },
  ylitornio:     { name: 'Ylitornio',      lat: 66.32, lon: 23.68 },
  tornio:        { name: 'Tornio',         lat: 65.85, lon: 24.15 },
  rovaniemi:     { name: 'Rovaniemi',      lat: 66.50, lon: 25.73 },
  kemijarvi:     { name: 'Kemijarvi',      lat: 66.71, lon: 27.43 },
  kelloselka:    { name: 'Kelloselka',     lat: 66.93, lon: 29.05 },
  // --- Koillismaa / Kainuu
  kuusamo:       { name: 'Kuusamo',        lat: 65.96, lon: 29.19 },
  taivalkoski:   { name: 'Taivalkoski',    lat: 65.57, lon: 28.24 },
  pudasjarvi:    { name: 'Pudasjarvi',     lat: 65.36, lon: 26.99 },
  suomussalmi:   { name: 'Suomussalmi',    lat: 64.89, lon: 28.91 },
  kuhmo:         { name: 'Kuhmo',          lat: 64.13, lon: 29.52 },
  kajaani:       { name: 'Kajaani',        lat: 64.22, lon: 27.73 },
  // --- Oulu region / Ostrobothnia
  oulu:          { name: 'Oulu',           lat: 65.01, lon: 25.47 },
  ylivieska:     { name: 'Ylivieska',      lat: 64.08, lon: 24.55 },
  haapajarvi:    { name: 'Haapajarvi',     lat: 63.75, lon: 25.32 },
  kokkola:       { name: 'Kokkola',        lat: 63.84, lon: 23.13 },
  vaasa:         { name: 'Vaasa',          lat: 63.10, lon: 21.62 },
  seinajoki:     { name: 'Seinajoki',      lat: 62.79, lon: 22.84 },
  // --- Savo / Karelia
  iisalmi:       { name: 'Iisalmi',        lat: 63.56, lon: 27.19 },
  kuopio:        { name: 'Kuopio',         lat: 62.89, lon: 27.68 },
  lieksa:        { name: 'Lieksa',         lat: 63.32, lon: 30.02 },
  joensuu:       { name: 'Joensuu',        lat: 62.60, lon: 29.76 },
  ilomantsi:     { name: 'Ilomantsi',      lat: 62.67, lon: 30.93 },
  savonlinna:    { name: 'Savonlinna',     lat: 61.87, lon: 28.88 },
  mikkeli:       { name: 'Mikkeli',        lat: 61.69, lon: 27.27 },
  lappeenranta:  { name: 'Lappeenranta',   lat: 61.06, lon: 28.19 },
  kotka:         { name: 'Kotka',          lat: 60.47, lon: 26.94 },
  // --- central
  saarijarvi:    { name: 'Saarijarvi',     lat: 62.71, lon: 25.26 },
  jyvaskyla:     { name: 'Jyvaskyla',      lat: 62.24, lon: 25.75 },
  parkano:       { name: 'Parkano',        lat: 62.01, lon: 23.02 },
  tampere:       { name: 'Tampere',        lat: 61.50, lon: 23.76 },
  lahti:         { name: 'Lahti',          lat: 60.98, lon: 25.66 },
  // --- south-west
  pori:          { name: 'Pori',           lat: 61.49, lon: 21.80 },
  rauma:         { name: 'Rauma',          lat: 61.13, lon: 21.51 },
  forssa:        { name: 'Forssa',         lat: 60.81, lon: 23.62 },
  turku:         { name: 'Turku',          lat: 60.45, lon: 22.27 },
  espoo:         { name: 'Espoo',          lat: 60.21, lon: 24.66 },
  // --- abroad
  tallinna:      { name: 'Tallinn',        lat: 59.44, lon: 24.75 },
  pietari:       { name: 'Pietari',        lat: 59.93, lon: 30.34 },
  maarianhamina: { name: 'Maarianhamina',  lat: 60.10, lon: 19.94 },
  // --- Sweden, down the Gulf of Bothnia
  lulea:         { name: 'Lulea',          lat: 65.58, lon: 22.15 },
  skelleftea:    { name: 'Skelleftea',     lat: 64.75, lon: 20.95 },
  uumaja:        { name: 'Umea',           lat: 63.83, lon: 20.26 },
  ornskoldsvik:  { name: 'Ornskoldsvik',   lat: 63.29, lon: 18.72 },
  sundsvall:     { name: 'Sundvall',       lat: 62.39, lon: 17.31 },
  soderhamn:     { name: 'Soderhamn',      lat: 61.30, lon: 17.06 },
  gavle:         { name: 'Gavle',          lat: 60.67, lon: 17.14 },
  uppsala:       { name: 'Uppsala',        lat: 59.86, lon: 17.64 },
  tukholma:      { name: 'Tukholma',       lat: 59.33, lon: 18.07 },
};

/**
 * Named non-city nodes. These never carry a token.
 *
 * Haaparanta is the Swedish side of the Tornio border crossing: the rulebook
 * makes teams stop here and face the border guard. On the mat it is painted as a
 * circle of its own, touching Tornio with no dot between them.
 *
 * The rest are JUNCTIONS. The mat forks routes at plain connector dots, not only
 * at cities - so a dot can carry three or four edges, and a route can end at one.
 * They are ordinary `dot` squares in play; they are named here only so ADJACENCY
 * has something to attach the branches to, and their coordinates are estimates
 * of where the mat paints the fork.
 */
const SPECIAL_NODES = {
  // The real Haparanda is 1.4km from Tornio, which at this scale is less than a
  // pixel: the two circles land on top of each other and the border square
  // becomes impossible to see or tap. The mat draws them side by side, so this
  // one place is nudged ~10km west of its true position to match that - far
  // enough to read as two squares, still on the Swedish bank.
  haaparanta: { name: 'Haaparanta', lat: 65.84, lon: 23.90, type: 'border' },

  // Lapland: the Muonio road meets the Inari-Sodankyla road, and Ivalo hangs off it
  lappi_a:    { name: '', lat: 68.80, lon: 26.70, type: 'dot' },
  lappi_b:    { name: '', lat: 68.60, lon: 26.85, type: 'dot' },
  // north-east of Rovaniemi, where Sodankyla / Rovaniemi / Kemijarvi meet
  lappi_c:    { name: '', lat: 66.85, lon: 26.40, type: 'dot' },
  // the four-way in the middle: Seinajoki / Saarijarvi / Jyvaskyla / Parkano
  keski_j:    { name: '', lat: 62.50, lon: 24.00, type: 'dot' },
  // Hame: the Tampere road forks for Forssa and for Espoo
  hame_k:     { name: '', lat: 61.00, lon: 24.15, type: 'dot' },
  // in the archipelago south-west of Turku, where the Aland ferry branches
  saaristo_j: { name: '', lat: 60.05, lon: 21.40, type: 'dot' },
};

/**
 * Every painted route, `neighbour: connectorDots`, one line per node.
 *
 * The number is how many black dots the mat paints BETWEEN the two circles, so 0
 * means they touch. Symmetrised below, so write each route once. Writing it from
 * both ends is allowed only if both ends agree; a disagreement is a hard error,
 * because a silent winner between 3 and 4 is exactly the transcription slip this
 * file exists to catch.
 */
const ADJACENCY = {
  // --- Lapland
  utsjoki:       { inari: 2 },
  inari:         { lappi_a: 0 },
  lappi_a:       { muonio: 5, lappi_b: 0 },
  lappi_b:       { ivalo: 1, sodankyla: 2 },
  ivalo:         { kelloselka: 6 },
  muonio:        { kolari: 2 },
  kolari:        { ylitornio: 4, rovaniemi: 4 },
  ylitornio:     { haaparanta: 0 },
  haaparanta:    { tornio: 0, lulea: 2 },
  rovaniemi:     { tornio: 2 },
  lappi_c:       { sodankyla: 2, rovaniemi: 1, kemijarvi: 1 },
  kemijarvi:     { kelloselka: 2, kuusamo: 4 },
  kuusamo:       { taivalkoski: 1 },
  tornio:        { oulu: 3 },
  // --- Koillismaa / Kainuu
  taivalkoski:   { pudasjarvi: 1, suomussalmi: 3 },
  pudasjarvi:    { oulu: 2 },
  suomussalmi:   { kuhmo: 2, kajaani: 2 },
  kuhmo:         { lieksa: 3 },
  kajaani:       { iisalmi: 3, oulu: 4 },
  // --- Oulu region / Ostrobothnia
  oulu:          { ylivieska: 3, kokkola: 4 },
  ylivieska:     { kokkola: 2, haapajarvi: 1 },
  haapajarvi:    { saarijarvi: 3, iisalmi: 2 },
  kokkola:       { vaasa: 2 },
  vaasa:         { uumaja: 3, seinajoki: 2, pori: 5 },
  // --- Savo / Karelia
  iisalmi:       { kuopio: 2 },
  kuopio:        { joensuu: 3 },
  lieksa:        { joensuu: 2 },
  joensuu:       { ilomantsi: 1, savonlinna: 3 },
  savonlinna:    { lappeenranta: 3 },
  mikkeli:       { lappeenranta: 2 },
  jyvaskyla:     { mikkeli: 3, tampere: 4 },
  // --- central
  keski_j:       { seinajoki: 2, saarijarvi: 2, jyvaskyla: 2, parkano: 2 },
  pori:          { parkano: 2, rauma: 1 },
  parkano:       { tampere: 3 },
  rauma:         { turku: 3 },
  turku:         { forssa: 2, espoo: 4, saaristo_j: 1 },
  hame_k:        { tampere: 1, forssa: 1, espoo: 2 },
  // --- south
  espoo:         { lahti: 2, kotka: 3, tallinna: 2 },
  lahti:         { mikkeli: 3 },
  kotka:         { lappeenranta: 3, pietari: 4 },
  lappeenranta:  { pietari: 5 },
  // --- ferries out west
  saaristo_j:    { maarianhamina: 2, tallinna: 4 },
  maarianhamina: { tukholma: 4 },
  // --- Sweden, down the Gulf of Bothnia
  lulea:         { skelleftea: 4 },
  skelleftea:    { uumaja: 3 },
  uumaja:        { ornskoldsvik: 3 },
  ornskoldsvik:  { sundsvall: 3 },
  sundsvall:     { soderhamn: 4 },
  soderhamn:     { gavle: 2 },
  gavle:         { uppsala: 3 },
  uppsala:       { tukholma: 2 },
  // --- the flight
  pietari:       { ivalo: 0 },
};

/** Edges crossed by ferry. Rulebook: one beer to begin the sea journey. */
const WATER_EDGES = [
  ['vaasa', 'uumaja'],
  ['espoo', 'tallinna'],
  ['turku', 'saaristo_j'],
  ['saaristo_j', 'maarianhamina'],
  ['saaristo_j', 'tallinna'],
  ['maarianhamina', 'tukholma'],
];

/** Rulebook: the flight route runs between Pietari and Ivalo, for three beers. */
const FLIGHT_EDGES = [
  ['pietari', 'ivalo'],
];

/**
 * Teekkariristeily: one water square hands out three cruise shots on landing.
 * `dot` is the 0-based index of that square, counting from `from`.
 */
const CRUISE_ON_EDGE = { from: 'maarianhamina', to: 'tukholma', dot: 2 };

/**
 * Guilds start from their own home city. Ids must match server/data/guilds.json,
 * which a test cross-checks. TiK sits in Otaniemi, but the mat letters that
 * square ESPOO, so that is where the pawn starts.
 */
const HOME_CITIES = {
  turku: ['digit', 'date'],
  tampere: ['tite'],
  oulu: ['otit'],
  espoo: ['tik'],
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
 * Distance in projected degrees. Dot counts no longer come from this - they are
 * transcribed - but it still powers the spacing sanity check at the bottom.
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

// 1. place every city and named non-city node
for (const [id, p] of Object.entries(CITIES)) {
  const { x, y } = toPercent(p);
  addNode(id, p.name, 'city', x, y, p);
}
for (const [id, p] of Object.entries(SPECIAL_NODES)) {
  const { x, y } = toPercent(p);
  addNode(id, p.name, p.type, x, y, p);
}

// 2. collapse the adjacency lists into a deduplicated, symmetric edge set that
//    carries the transcribed dot count with each route
const edgeTypes = new Map();
for (const [a, b] of WATER_EDGES) edgeTypes.set(key(a, b), 'water');
for (const [a, b] of FLIGHT_EDGES) edgeTypes.set(key(a, b), 'flight');

const trunkEdges = new Map();
for (const [from, neighbours] of Object.entries(ADJACENCY)) {
  if (!nodes.has(from)) throw new Error(`adjacency for unknown node: ${from}`);
  for (const [to, dots] of Object.entries(neighbours)) {
    if (!nodes.has(to)) throw new Error(`adjacency ${from} -> unknown node ${to}`);
    if (from === to) throw new Error(`self-edge on ${from}`);
    if (!Number.isInteger(dots) || dots < 0 || dots > MAX_SANE_DOTS) {
      throw new Error(
        `${from} -> ${to}: connector dots must be a whole number 0..${MAX_SANE_DOTS}, got ${dots}`,
      );
    }
    const k = key(from, to);
    const held = trunkEdges.get(k);
    if (held && held.dots !== dots) {
      throw new Error(
        `${from} -> ${to} says ${dots} connector dots, but the same route was already ` +
        `declared from ${held.declaredFrom} with ${held.dots}; count them again on the ` +
        'photograph and write the route once',
      );
    }
    if (!held) trunkEdges.set(k, { a: from, b: to, dots, declaredFrom: from });
  }
}

const problems = [];

// a type annotation that lands on no route types nothing, and is always a typo
for (const [pairs, label] of [[WATER_EDGES, 'water'], [FLIGHT_EDGES, 'flight']]) {
  for (const [a, b] of pairs) {
    if (!trunkEdges.has(key(a, b))) {
      problems.push(`${label} edge ${a} <-> ${b} is not in ADJACENCY - it types nothing`);
    }
  }
}

// 3. subdivide with the transcribed number of connector dots.
//    Flight edges are never subdivided: you fly the whole leg or not at all.
const cruiseKey = key(CRUISE_ON_EDGE.from, CRUISE_ON_EDGE.to);
let dotCount = 0;
let cruiseId = null;

for (const [k, { a, b, dots }] of [...trunkEdges].sort()) {
  const type = edgeTypes.get(k) ?? 'land';
  if (type === 'flight' && dots !== 0) {
    throw new Error(`${a} <-> ${b} is a flight route; it cannot carry ${dots} connector dots`);
  }
  const count = dots;

  if (count === 0) {
    link(a, b, type);
    continue;
  }

  // The cruise square is a specific dot counted from CRUISE_ON_EDGE.from, so the
  // index has to be flipped when the route is stored the other way round.
  const cruiseAt = k === cruiseKey
    ? (a === CRUISE_ON_EDGE.from ? CRUISE_ON_EDGE.dot : count - 1 - CRUISE_ON_EDGE.dot)
    : -1;
  if (k === cruiseKey && (cruiseAt < 0 || cruiseAt >= count)) {
    throw new Error(
      `the cruise square is dot ${CRUISE_ON_EDGE.dot} of ${CRUISE_ON_EDGE.from} <-> ` +
      `${CRUISE_ON_EDGE.to}, but that route only has ${count} connector dots`,
    );
  }

  const pa = nodes.get(a);
  const pb = nodes.get(b);
  const chain = [a];

  for (let i = 0; i < count; i++) {
    const t = (i + 1) / (count + 1);
    const id = `${a}__${b}_${i}`;
    const isCruise = i === cruiseAt;
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

const list = [...nodes.values()];

const cities = list.filter((n) => n.type === 'city');
if (cities.length !== EXPECTED_CITIES) {
  problems.push(
    `expected ${EXPECTED_CITIES} city nodes (one per cardboard disc), got ${cities.length}:\n` +
    '      ' + cities.map((c) => c.id).sort().join(', '),
  );
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
  note: 'Route graph and connector-dot counts transcribed from photographs of the physical mat; city positions from real coordinates.',
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
const byType = (t) => list.filter((n) => n.type === t).length;
const junctions = Object.values(SPECIAL_NODES).filter((p) => p.type === 'dot').length;
console.log('Board written to server/data/nodes.json');
console.log(`  nodes   ${list.length}  (${cities.length} city, ${byType('dot')} dot, ` +
  `${byType('border')} border, ${byType('cruise')} cruise)`);
console.log(`  dots    ${dotCount} laid along routes, plus ${junctions} named junctions`);
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

// Transcription sanity, not a rule. The mat spaces its dots roughly evenly, so a
// route whose implied spacing is far off the median is usually a miscount - a 1
// typed for a 4, or a route traced straight past a junction. Warn, never fail:
// some routes really are odd, and a failing generator blocks the whole workflow.
const spacings = [];
for (const [k, { a, b, dots }] of trunkEdges) {
  if ((edgeTypes.get(k) ?? 'land') === 'flight') continue;
  const ga = geo(allPlaces[a]);
  const gb = geo(allPlaces[b]);
  spacings.push({ a, b, dots, gap: Math.hypot(gb.gx - ga.gx, gb.gy - ga.gy) / (dots + 1) });
}
const median = [...spacings].sort((p, q) => p.gap - q.gap)[spacings.length >> 1].gap;
const odd = spacings.filter((s) => s.gap > median * 2.2 || s.gap < median / 2.2);
if (odd.length) {
  console.warn(
    `  WARN    ${odd.length} route(s) spaced oddly against the median ` +
    `${median.toFixed(2)} deg/dot - worth re-counting on the photograph:`,
  );
  for (const s of odd) {
    console.warn(`            ${s.a} <-> ${s.b}  ${s.dots} dots  ${s.gap.toFixed(2)} deg/dot`);
  }
}
