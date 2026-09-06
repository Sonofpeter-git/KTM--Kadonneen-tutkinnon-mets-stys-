# Kadonneen Tutkinnon Metsästys — Digital Edition

*The Hunt for the Missing Degree.* A digital rebuild of the 2004 TiTeenit drinking board
game, so eight guilds can play without unrolling a 203×299cm vinyl mat.

**Complete and playable.** Board on a TV, everyone else on their phone, server enforcing the
rules nobody remembers correctly by midnight.

---

## Quick start

```bash
docker compose up --build
```

That is the whole thing: Redis, the rules, and the UI, on **one address**. Find your machine's
LAN IP (`ipconfig`) and read that out to the room:

```
http://192.168.1.41:3001/
```

`localhost:3001` works on the host itself — use it for the TV. Everyone types the same room code.

**The first person in becomes the Game Leader, who referees and does not play.** They get the
overrides and the start button, but no guild and no pawn — so join first from whichever device
is running the game, and have the players join after. Two guilds minimum, not counting the host.

Rooms live in Redis on a named volume, so `docker compose restart` mid-party costs nothing.
**Refreshing or locking a phone costs nothing either** — the player id is kept in
`localStorage` and the room is rejoined automatically. "Vaihda huone" in the lobby is the way
out if you want a different room.

### Working on the code instead

Vite's dev server gives hot reload; it proxies the socket back to the game server, so the two
still share an origin.

```bash
docker compose up -d redis                   # just Redis
cd server && npm install && npm start        # :3001
cd client && npm install && npm run dev      # :5173  <- open this one
```

### Checks

```bash
cd server
npm test                   # 78 rule tests, no Redis needed
npm run sim -- 60          # 60 complete games, checking invariants throughout
npm run smoke              # real socket + real Redis, end to end
npm run smoke -- --mock    # ...or against an in-process fake, if you have no Redis
npm run board              # regenerate the map

cd client
npm test                   # 26 render tests, driven by real engine states
npm run build              # production bundle
npm run inspect            # drive real Chrome against a running stack, measure the board
```

`npm run inspect` seeds a started game over the socket, opens the app in your installed Chrome
(no browser download - it uses `channel: 'chrome'`), reports the box of every board layer, and
saves `board-check.png`. Layout bugs are invisible to render tests; this is what catches them.

### Redis

Required — the server refuses to boot without it, and says so plainly. Compose handles it. If
you would rather run it yourself on Windows there is no native build: use Docker, WSL2, or
Memurai. Neither test suite touches Redis, so the rules and the UI can be worked on without it.

Environment variables: `PORT` (3001), `REDIS_URL` (`redis://127.0.0.1:6379`), `CORS_ORIGIN`
(`*`), and `CLIENT_DIST` — set that to the built client and the game server serves the UI too,
which is how the container gets away with one port. Unset in dev, where Vite serves it. The
client's `VITE_SERVER_URL` is only needed if the halves are ever deployed apart.

---

## What is here

```
docker-compose.yml            Redis + one container serving both halves
Dockerfile                    builds the client, then runs it from the game server
tools/generate-board.mjs      places the cities; run it, don't hand-edit nodes.json
tools/fetch-geodata.mjs       refreshes the coastline, lakes and borders from Natural Earth
tools/art/geodata.json        that geometry, vendored so rendering needs no network
tools/art/board-source.jpg    the retired terrain photograph the board used to be painted from
server/
  data/nodes.json             216 nodes, 54 of them city squares
  data/guilds.json            the eight guilds and their founding years
  src/game/                   the rules, as pure functions
    engine.js                 the turn machine: applyAction(state, action) -> {state, events}
    board.js                  the graph and the movement search
    tokens.js                 the 54 discs and every tunable rule constant
    guilds.js                 the roster and the turn-order rule
    sanitize.js               the only place state is prepared for the wire
    rng.js                    seeded, serialisable randomness
  src/store.js                Redis persistence, one JSON document per room
  src/sockets.js              Socket.io transport - contains no rules
client/
  public/board.jpg            generated background - see `npm run art`
  scripts/render-basemap.mjs  draws it; scripts/verify-basemap.mjs checks it still fits
  src/components/Board.jsx    base plate + SVG routes + DOM squares, zoom and pan
  src/components/             ActionPanel, Scoreboard, Lobby, AdminSidebar, EventLog, Finished
  src/net/useRoom.js          the socket, and everything that arrives on it
  src/net/socket.js           connection and the persisted player id
  src/lib/strings.js          every player-facing string, in one file
  src/styles/                 design tokens, then layout
```

The engine never touches Redis, sockets, the clock, or `Math.random`. It takes a state and an
action and returns a new state; the input is never mutated. That is why the rules can be
tested headlessly, why a room can be persisted between every single action, and why the
client can be tested against genuine server output.

---

## The guilds

Turn order runs **youngest guild first**, by founding year (rulebook step 0):

| # | Guild | Home city | Founded |
|---|---|---|---|
| 1 | Algo ry | Jyväskylä | 2020 |
| 2–3 | Digit ry / DaTe | Turku / Åbo | 1999 — **coin flip** |
| 4 | Tampereen TietoTeekkarikilta ry (TiTe) | Tampere | 1990 |
| 5 | Tutti ry | Vaasa | 1989 |
| 6 | Oulun Tietoteekkarit ry (OTiT) | Oulu | 1988 |
| 7 | Tietokilta ry (TiK) | Otaniemi | 1986 |
| 8 | Cluster ry | Lappeenranta | 1984 |

Digit and DaTe share 1999, so the server flips a coin between them. **Åbo and Turku are the
same square:** the rulebook lists eight home cities but only seven distinct places, so both
Turku guilds start on the `turku` node.

The Game Leader can override the whole order at the table. If a future roster leaves a
`foundedYear` as `null`, that guild sorts last and the server warns at boot rather than
pretending it was founded in year zero.

---

## The board

The board is painted in the style of the physical game — flat green land, poster-blue
water, national borders in dashed ink — with the game graph drawn on top: 54 city squares
(one per cardboard disc), 161 connector dots, the Pietari–Ivalo flight, six ferry
crossings, the Haaparanta border, and a Teekkariristeily square on the Stockholm run.

### The background is generated

`client/public/board.jpg` is **not** hand-drawn and must not be edited by hand. It is
drawn from real coastline geometry:

```bash
cd client
npm run art                        # paint the background -> client/public/board.jpg
npm run art -- --cities            # bake the graph in too -> tools/art/board-printable.png
npm run art -- --cities --scale 3  # render that at 3x, for print
npm run art -- --png               # lossless, if you are going to print it
```

Coastline, lakes and national borders come from Natural Earth 1:10m, clipped to the map
window and simplified to half a pixel by [`tools/fetch-geodata.mjs`](tools/fetch-geodata.mjs).
Its output is vendored at `tools/art/geodata.json`, so painting the board needs no network;
re-run the fetch only to refresh the source data.

**Borders are drawn because they are a rule.** The guard at Tornio only makes sense if you
can see which side of the line a team is standing on, so the line is there — as the long
dash-and-dot a printed map uses, which cannot be mistaken for a route.

`--cities` produces a printable version with the routes, city circles and lettering baked
in — close to the physical board, and a useful sanity check that the placement is right.

**Cities are placed from their real latitude and longitude**, not by hand. The `BASEMAP`
block in [`tools/generate-board.mjs`](tools/generate-board.mjs) says which part of the
world the picture covers, and every city is projected into that frame:

```js
const BASEMAP = {
  image: '/board.jpg',
  width: 1470, height: 2912,
  projection: 'mercator',
  bounds: { north: 70.6, south: 58.8, west: 17.104, east: 31.296 },
};
```

### Why the map is drawn rather than photographed

The background used to be a repainted photograph of a terrain map, and those four numbers
were **measured**: a script read the pixels under points of known nature and searched for
the bounds that best explained them. It was careful, and it was still wrong — a coastline
matched against real geometry puts the old bounds about half a degree out. That error had
Kemi standing **20 km out to sea**, Uumaja 13 km, Tornio 8 km.

Worse, the photograph stopped at roughly 69.7°N. Utsjoki is at 69.91°N, so the northern
tip of Finland was not in the picture at all, and no choice of bounds could have put it on
dry land — there was none there to stand on.

So the window is now a **decision** and the coast is drawn to match it. The renderer
projects the real geometry through the very same bounds that place the city circles, which
means the map and the cities cannot disagree: neither is measured against the other. The
window is chosen so every node sits at least 3% inside the edge, and so the longitude span
is exactly what the latitude span needs for the Mercator aspect to equal the image's own
1470×2912 — nothing is stretched.

### Checking it

```bash
cd client
npm run verify:map           # reads board.jpg off disk, no server needed
npm run inspect              # render it live, writes board-check.png + board-plate.png
```

`verify:map` makes two independent checks. Fifteen places of undisputed nature — open sea,
Lake Ladoga, solid inland — are read out of the painted image, which catches a board.jpg
painted from bounds other than the ones `nodes.json` now declares. Then every city and the
border crossing are read out of the same image: a city on blue is a city in the sea.

A handful of towns do report a pixel or two of blue, and they are the honest ones —
Savonlinna stands on islands in Saimaa, and at half a kilometre to the pixel its shore is
only a few pixels wide. Anything past 8 px fails the run.

Two further guards sit in the generator: it refuses to emit a board with a city off the
image, and it warns when the bounds imply an aspect ratio that disagrees with the image's
own pixels. `board-plate.png` from `npm run inspect` is the final check by eye — coastal
cities on their coastlines, ferry routes crossing water.

If the image is missing entirely the board still plays: the layer stays dark and you get
the plain graph.

### Schema

`data/nodes.json` is generated, not hand-written. Anything matching this shape works:

```jsonc
{
  "aspectRatio": 0.5048,                       // the image's own shape
  "basemap": { "image": "/board.jpg", "bounds": { ... } },
  "homeCities": { "turku": ["digit", "date"], ... },
  "cruiseNode": "…",
  "nodes": [
    { "id": "turku", "name": "Turku / Åbo", "type": "city",   // city | dot | border | cruise
      "x": 30.9, "y": 81.4,                                    // percent of board width/height
      "lat": 60.45, "lon": 22.27,                              // kept, so it can be reprojected
      "edges": [ { "target": "salo__turku_0", "type": "land" } ] }  // land | water | flight
  ]
}
```

Checked by the generator, by the server at boot, and by tests: exactly 54 city squares,
every edge bidirectional and agreeing on its type, the whole map reachable without flying,
every city inside the image, and `homeCities` agreeing with `guilds.json`.

---

## Rules, and where they live

Every constant is at the top of [`src/game/tokens.js`](server/src/game/tokens.js).

| Rule | Behaviour |
|---|---|
| Movement | d4, or d6 once the team holds a Teekkarilakki |
| Travel beer | roll ≥ 4 costs 1 beer, even if the team then moves fewer squares |
| Short moves | any square along the route is a legal destination |
| No doubling back | a route may not reuse a square it already crossed |
| Ferry | 1 beer per **sea crossing**, not per water square |
| Flight | Pietari ↔ Ivalo, 3 beers, and it uses the whole turn |
| Cruise | landing on the Teekkariristeily square is 3 shots |
| Border | you must stop at Haaparanta; next turn roll d6 — a 6 lets you through *and* you still move, anything else is a beer and the turn ends |
| Landing on a rival | assign them 1 beer, or decline |
| Turning a disc | 2 beers on arrival, or 1 beer and your whole next turn |
| Drinks and the turn | a team owing drinks is **skipped**, not waited for — the turn passes to the next team that has finished. Anyone may mark drinks done at any time |
| Open turn | if every team still owes drinks, the turn belongs to nobody until one of them finishes; **first done takes it** |
| Beer tally | every beer marked done is counted, per team and for the night; leader corrections are not |
| Tutkintouudistus | redo your biggest course: keep the OP, drink its beers again |
| Winning | first team home with ≥ 300 OP. Remaining places by OP at that moment |
| Fallback ending | if every disc has been turned, first team home takes +80 OP and the game |

### Rulings confirmed at the table

Three points the written rules leave open, settled by the project owner. The first two are
single constants, documented in place, rather than silent choices:

- **`WATER_CHARGE_MODE`** (`'per-run'`) — the rulebook says one beer *to begin the journey*
  (`aloittaakseen matkan`), so a ferry costs one beer however many squares it spans. Set
  `'per-edge'` to charge per water square instead.
- **`TUTKINTOUUDISTUS_MODE`** (`'redrink'`) — redoing your largest course means **sitting the
  exam again, not losing the credits**: the team keeps the OP and the disc, and drinks that
  disc's beers a second time. An 80op course costs three beers all over again. The discarded
  reading — losing the highest disc — remains available as `'lose-highest'`.
- **Border, on a 6** — the guard is away, so the team crosses *and still takes its normal move
  that same turn*, rather than the turn ending.
- **Drinks skip you, they do not stall the table** — the rulebook says the roll is not granted
  while drinks are outstanding. That is read as the turn passing on, not as everyone waiting.

---

## The client

React + Vite. Three views off one component tree, chosen by role:

- **Gamer** — the map, plus an action panel showing only what this phase permits.
- **Game Leader** — the same, plus an override drawer to fix OP, drinks, turn order or a stuck
  turn without restarting the party.
- **Spectator** — map and scoreboard, read-only. This is the view to cast to a TV.

**The board** is three layers: a base plate (where the scanned mat goes), an SVG route layer,
and real `<button>` squares positioned by percentage — so they stay keyboard- and
screen-reader-reachable, and land correctly at any size. The wrapper zooms and pans underneath
a UI that never moves; labels and pawns counter-scale through a `--inv` custom property rather
than re-rendering on every zoom frame.

Because the board is dense, lighting up every reachable route at once is unreadable: reachable
squares pulse yellow, and the **full route appears on hover or focus** of a destination.

One trap worth knowing about: `react-zoom-pan-pinch` injects its stylesheet at runtime, so its
`fit-content` sizing lands *after* ours in the cascade. The wrapper and content boxes are
therefore sized with inline styles in `Board.jsx`; move those into the stylesheet and the whole
board silently collapses onto a single point.

**Nobody waits for a slow drinker.** A team that still owes beers is passed over and the turn
moves on; they rejoin the rotation once they have caught up. When every team owes something the
turn is left open — the panel says *"Vuoro on auki"* and the first team to finish claims it.

**The beer tally** is the other scoreboard. `drinksOwed` is the debt; `drinksTaken` is the
receipt, and it only ever goes up. The sidebar shows the night's grand total above the
standings, and each team carries two badges — grey for beers seen off, red for beers still
owed. A leader override adjusts the debt without touching the tally, because a correction is
not a beer anyone drank. The endgame card closes with the total.

**Reconnection is free.** The player id is generated once into `localStorage`, and the room
code is stored beside it, so both a dropped socket *and* a full page reload silently reclaim
the same seat, guild, position and score. A phone that locks mid-game loses nothing. The lobby
carries a "Vaihda huone" button so a remembered room is not a one-way door.

**The interface is in Finnish**, because the game is — `opintopiste`, `kilta`, `Teekkarilakki`
and `Tutkintouudistus` have no useful English forms, and half-translating reads worse than not
translating. Every string lives in [`src/lib/strings.js`](client/src/lib/strings.js), so
switching languages is a one-file change.

Fonts (Noto Sans JP, League Spartan) load from Google Fonts with system fallbacks — a venue
with no internet still gets a usable board.

---

## Socket protocol

Client sends a persisted UUID as `playerId`; reconnecting with the same id resumes the same
seat. The first player into a room becomes `LEADER`. Rooms are created on first join. Every
request takes an acknowledgement callback: `{ ok: true, ... }` or `{ code, message }`.

**Client → server**

| Event | Payload |
|---|---|
| `req_join` | `{ roomCode, playerId, name }` |
| `req_board` | — (returns the static map and guild roster) |
| `req_set_guild` | `{ guildId }` |
| `req_start_game` | — (leader only) |
| `req_drink_cleared` | `{ amount }` — omit to clear all |
| `req_roll` | — |
| `req_move` | `{ targetId }` |
| `req_use_flight` | `{ targetId }` |
| `req_open_token` | — (turn the disc you are standing on) |
| `req_resolution_action` | `{ choice: { action: 'OPEN_NOW' \| 'WAIT' } }` or `{ choice: { action: 'ASSIGN', targetId } \| { action: 'SKIP' } }` |
| `req_border_roll` | — |
| `req_leader_override` | `{ op, args }` — `ADJUST_OP`, `ADJUST_DRINKS`, `SKIP_TURN`, `SET_TURN_ORDER`, `RANDOMIZE_GUILDS` |
| `req_state` | — (resync) |

**Server → client**

`res_state_update` (the sanitised room, sent to each socket individually so it carries a `you`
marker) · `res_events` · `res_error` · and the convenience channels `res_game_started`,
`res_roll`, `res_turn_advanced`, `res_game_finished`.

### Turn phases

```
end of turn
     │
     ▼
  next team that owes nothing ──▶ ROLLING ──▶ MOVING ──▶ RESOLUTION ──▶ end of turn
     │  (teams still drinking are skipped)      │            ▲
     │                                          └── USE_FLIGHT ┘
     │                                          └── OPEN_TOKEN ──▶ end of turn
     │
     └─ nobody free ──▶ AWAITING_DRINKS ──▶ first team to finish claims it

on the border: BORDER_ROLL ──▶ 6: ROLLING (same turn) · <6: beer, end of turn
```

### Two things never leave the server

Enforced in one place, [`sanitize.js`](server/src/game/sanitize.js):

- **the identity of a face-down disc** — the key is absent entirely, not set to `undefined`,
  so no serialiser can leak it;
- **the RNG state** — a single integer that would let any client predict every roll.

Three separate tests guard this: a unit test on the sanitiser, a client test asserting the
rendered board markup contains no disc names, and the smoke test watching every real broadcast.

---

## Verification

| Command | What it proves | Status |
|---|---|---|
| `node tools/generate-board.mjs` | the map is well-formed and connected | ✅ 216 nodes, 54 cities |
| `server: npm test` | every rule, in isolation | ✅ 78 passing |
| `server: npm run sim -- 60` | 60 complete games; no disc lost, no OP negative, no dead phase, all terminate | ✅ ~103 rolls, ~184 beers, ~22 skipped turns per game |
| `server: npm run smoke` | sockets + reducer + store wired together, against real Redis | ✅ 11 checks |
| `client: npm test` | every view renders, from real engine states | ✅ 26 passing |
| `client: npm run build` | production bundle | ✅ 241 kB / 77 kB gzipped |
| `client: npm run inspect` | the board actually lays out in Chrome | ✅ image loads, squares spread across the plate |
| `client: npm run verify:map` | the painted map and the city circles agree | ✅ 15 / 15 probes, no node past 5 px of water |
| `client: npm run art` | draws the background from the same bounds that place the cities | ✅ 1470×2912, 541 kB |
| `docker compose up --build` | both containers healthy; join → start → roll → move on one origin | ✅ verified, rooms survive a restart |

The client tests build their fixtures with the real engine and pass them through the real
sanitiser, so a change to the server's broadcast shape fails the client suite. That is the only
automated link between the two halves — keep it.

---

## Known limits

- **Leadership never transfers.** If the Game Leader clears their browser storage, nobody can
  start the game or reach the overrides. A refresh is fine — that is now restored — but a
  wiped identity is not.
- **The board is a real map of Finland, painted to match the physical game.** Cities sit on
  their true coordinates rather than being traced off the plywood, so the layout is
  geographically honest but not square-for-square identical to the real board.
- **Only the notable lakes are drawn.** The coastline comes from Natural Earth 1:10m, which
  carries Saimaa, Päijänne, Inari, Ladoga and their like but not the thousands of small
  ones. Finnish lakeland therefore reads cleaner than it did on the terrain photograph —
  more like a printed board, which is arguably the point, but it is a real difference.
- **One server process.** The per-room lock in `store.js` guards a single process; running
  several instances against one Redis would need a distributed lock.
- **No spectator route highlighting.** Valid destinations are sent to the moving player; the TV
  view shows pawns and the scoreboard, not the pending choice.
- **Not tested on real phones.** The board is verified in desktop Chrome by `npm run inspect`,
  but nobody has yet put eight phones on it at a party.
- **City labels crowd each other in the south** at the default zoom, where the map is densest.
  Zooming in separates them, because labels counter-scale rather than growing with the board.
