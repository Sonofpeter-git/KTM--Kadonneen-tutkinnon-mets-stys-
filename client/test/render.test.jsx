import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';

import { loadBoard } from '../../server/src/game/board.js';
import { loadGuilds } from '../../server/src/game/guilds.js';
import { applyAction, createRoom } from '../../server/src/game/engine.js';
import { sanitizeState } from '../../server/src/game/sanitize.js';

import Board from '../src/components/Board.jsx';
import Lobby, { JoinForm } from '../src/components/Lobby.jsx';
import ActionPanel from '../src/components/ActionPanel.jsx';
import Scoreboard from '../src/components/Scoreboard.jsx';
import EventLog from '../src/components/EventLog.jsx';
import AdminSidebar from '../src/components/AdminSidebar.jsx';
import Finished from '../src/components/Finished.jsx';
import RulesPanel from '../src/components/RulesPanel.jsx';
import TokenFlash from '../src/components/TokenFlash.jsx';
import EggsPanel from '../src/components/EggsPanel.jsx';
import App from '../src/App.jsx';
import { readFileSync } from 'node:fs';
import { EGGS, EGG_IDS, TIERS, isCapSeason } from '../src/lib/eggs.js';
import { describeEvent } from '../src/lib/strings.js';
import { roomTheme } from '../src/lib/roomThemes.js';

/*
 * The fixtures come out of the real engine and through the real sanitiser, so
 * these tests fail if the server ever changes the shape of what it broadcasts.
 * That is the point: it is the only automated link between the two halves.
 */

const board = loadBoard();
const guilds = loadGuilds();
const deps = { board, guilds };
const guildsById = Object.fromEntries(guilds.map((g) => [g.id, g]));
const boardById = new Map(board.raw.nodes.map((n) => [n.id, n]));

const render = (el) => renderToStaticMarkup(el);

/** `host` joins first and so referees; `a` and `b` are the two teams. */
const HOST = 'host';

function lobbyState() {
  let s = createRoom({ code: 'TITE', seed: 'UI' });
  s = applyAction(s, { type: 'JOIN', playerId: HOST, name: 'Hessu' }, deps).state;
  s = applyAction(s, { type: 'JOIN', playerId: 'a', name: 'Anna' }, deps).state;
  s = applyAction(s, { type: 'JOIN', playerId: 'b', name: 'Beto' }, deps).state;
  s = applyAction(s, { type: 'SET_GUILD', playerId: 'a', guildId: 'digit' }, deps).state;
  s = applyAction(s, { type: 'SET_GUILD', playerId: 'b', guildId: 'tik' }, deps).state;
  return s;
}

/** A live game with `a` guaranteed to be the active team. */
function playing(drinkUnit) {
  let s = lobbyState();
  if (drinkUnit) {
    s = applyAction(s, {
      type: 'LEADER_OVERRIDE', playerId: HOST, op: 'SET_DRINK_UNIT', args: { unit: drinkUnit },
    }, deps).state;
  }
  s = applyAction(s, { type: 'START_GAME', playerId: HOST }, deps).state;
  s = applyAction(s, {
    type: 'LEADER_OVERRIDE', playerId: HOST, op: 'SET_TURN_ORDER',
    args: { turnOrder: ['a', 'b'] },
  }, deps).state;
  s.turnState.activeIndex = 0;
  return s;
}

/** Look a team up by id - players[0] is the host, not a team. */
const team = (s, id) => s.players.find((p) => p.id === id);

const view = (s, who = 'a') => sanitizeState(s, who);
const meIn = (v) => v.players.find((p) => p.id === v.you);

const panel = (v, extra = {}) => render(
  <ActionPanel
    state={v}
    me={meIn(v)}
    isMyTurn
    guildsById={guildsById}
    boardById={boardById}
    send={() => {}}
    {...extra}
  />,
);

/* ------------------------------------------------------------------ entry */

test('the join form asks for a room and a name', () => {
  const html = render(<JoinForm onJoin={() => {}} />);
  assert.match(html, /Huonekoodi/);
  assert.match(html, /Nimesi/);
  assert.match(html, /Liity peliin/);
});

test('the app shows a loading placeholder before the board arrives', () => {
  const html = render(<App />);
  assert.match(html, /shimmer/, 'expected the 2s shimmer placeholder');
});

/* ------------------------------------------------------------------ lobby */

test('the lobby lists every guild, youngest first, and marks the taken ones', () => {
  const v = view(lobbyState(), 'a');
  const html = render(
    <Lobby state={v} guilds={guilds} me={meIn(v)} isLeader={false} send={() => {}} onLeave={() => {}} />,
  );

  for (const g of guilds) assert.ok(html.includes(g.name), `${g.name} missing from the lobby`);
  assert.ok(html.indexOf('Algo ry') < html.indexOf('Cluster ry'), 'youngest guild should be first');
  assert.match(html, /guild--mine/, 'your own pick is marked');
  assert.match(html, /guild--taken/, 'a pick by someone else is shown as unavailable');
});

test('a non-leader is told to wait rather than shown a start button', () => {
  const v = view(lobbyState(), 'b');
  const html = render(
    <Lobby state={v} guilds={guilds} me={meIn(v)} isLeader={false} send={() => {}} onLeave={() => {}} />,
  );
  assert.ok(!html.includes('Aloita peli'));
  assert.match(html, /Odotetaan/);
});

test('the host is told they referee, and cannot claim a guild', () => {
  const v = view(lobbyState(), HOST);
  const html = render(
    <Lobby state={v} guilds={guilds} me={meIn(v)} isLeader send={() => {}} onLeave={() => {}} />,
  );

  assert.match(html, /ei osallistu kiltana/, 'the host is told the role is referee-only');
  assert.match(html, /Aloita peli/, 'but still starts the game');

  // Every guild button is disabled for the host - the roster is a read-out.
  const buttons = html.match(/<button[^>]*class="guild[^"]*"[^>]*>/g) ?? [];
  assert.equal(buttons.length, guilds.length);
  assert.ok(buttons.every((b) => b.includes('disabled')), 'the host may not pick a guild');
});

test('every lobby view offers a way out of a remembered room', () => {
  for (const [who, isLeader] of [[HOST, true], ['a', false]]) {
    const v = view(lobbyState(), who);
    const html = render(
      <Lobby state={v} guilds={guilds} me={meIn(v)} isLeader={isLeader} send={() => {}} onLeave={() => {}} />,
    );
    assert.match(html, /Vaihda huone/, `${who} has no escape from the room`);
  }
});

test('the host takes no part in the game itself', () => {
  const s = playing();
  assert.ok(!s.turnOrder.includes(HOST), 'the host never gets a turn');

  const v = view(s, HOST);
  const host = meIn(v);
  assert.equal(host.guildId, null);
  assert.equal(host.nodeId, null);

  // No pawn on the board for the host.
  const html = render(
    <Board
      board={board.raw} tokens={v.board.tokens}
      players={v.players.filter((p) => p.guildId && p.role !== 'SPECTATOR')}
      guildsById={guildsById} validDestinations={null}
      activeNodeId={null} interactive={false} onPick={() => {}}
    />,
  );
  assert.equal((html.match(/class="pawn"/g) ?? []).length, 2, 'two teams, two pawns');
});

/* ----------------------------------------------------------- action panel */

test('panel: an open turn tells everyone to race, and offers nothing else', () => {
  const s = playing();
  team(s, 'a').drinksOwed = 3;
  team(s, 'b').drinksOwed = 1;
  s.turnState.phase = 'AWAITING_DRINKS';

  const html = panel(view(s));
  assert.match(html, /Vuoro on auki/);
  assert.match(html, /Ensimmäisenä juomansa juonut saa vuoron/);
  assert.match(html, /Juotu!/, 'the drink button is the only way forward');
  assert.ok(!html.includes('Heitä noppaa'), 'nobody may roll while the turn is open');
});

test('panel: a team owing drinks is simply not given the turn', () => {
  // The server never hands the turn to a drinker, so from the client's side
  // this is an ordinary someone-else's-turn panel.
  const s = playing();
  team(s, 'b').drinksOwed = 2;
  const v = view(s, 'b');

  const html = render(
    <ActionPanel
      state={v} me={meIn(v)} isMyTurn={false}
      guildsById={guildsById} boardById={boardById} send={() => {}}
    />,
  );
  assert.match(html, /Vuorossa/);
  assert.match(html, /Juotu!/, 'but they can still drink to be eligible next time');
  assert.ok(!html.includes('Heitä noppaa'));
});

test('panel: rolling shows the die the team actually holds', () => {
  const s = playing();
  s.turnState.phase = 'ROLLING';
  assert.match(panel(view(s)), /Heitä noppaa/);
  assert.match(panel(view(s)), /d4/);

  team(s, 'a').dice = 6;
  assert.match(panel(view(s)), /d6/, 'a Teekkarilakki team should see d6');
});

test('panel: a face-down disc underfoot can be turned instead of moving', () => {
  const s = playing();
  s.turnState.phase = 'ROLLING';
  s.board.tokens[team(s, 'a').nodeId] = { status: 'HIDDEN', kind: 'op80' };

  const html = panel(view(s));
  assert.match(html, /Käännä kiekko/);
  assert.ok(!html.includes('op80'), 'the disc must not be named before it is turned');
});

test('panel: standing on an airport offers the flight and its price', () => {
  const s = playing();
  s.turnState.phase = 'ROLLING';
  team(s, 'a').nodeId = 'pietari';

  const html = panel(view(s));
  assert.match(html, /Lennä/);
  assert.match(html, /Ivalo/);
  assert.match(html, /3 olutta/);
});

test('panel: after rolling, the team is told it may move less', () => {
  const s = playing();
  s.turnState.phase = 'MOVING';
  s.turnState.roll = 4;
  const html = panel(view(s));
  assert.match(html, /4/);
  assert.match(html, /vähemmän/);
});

test('panel: the border offers a roll, not a move', () => {
  const s = playing();
  s.turnState.phase = 'BORDER_ROLL';
  const html = panel(view(s));
  assert.match(html, /rajavartijasta/);
  assert.match(html, /Kuutosella/);
});

test('panel: a disc decision offers both prices', () => {
  const s = playing();
  s.turnState.phase = 'RESOLUTION';
  s.turnState.pending = [{ kind: 'TOKEN', cityId: 'tampere' }];

  const html = panel(view(s));
  assert.match(html, /Käännä heti/);
  assert.match(html, /2 olutta/);
  assert.match(html, /Odota ensi vuoroon/);
  assert.match(html, /Tampere/);
});

test('panel: landing on a rival offers them by guild name, or a pass', () => {
  const s = playing();
  s.turnState.phase = 'RESOLUTION';
  s.turnState.pending = [{ kind: 'PVP', targets: ['b'] }];

  const html = panel(view(s));
  assert.match(html, /Määrää olut/);
  assert.match(html, /Tietokilta/);
  assert.match(html, /Ohita/);
});

test('panel: someone else\'s turn still lets you clear your own drinks', () => {
  const s = playing();
  team(s, 'b').drinksOwed = 2;

  const v = view(s, 'b');
  const html = render(
    <ActionPanel
      state={v} me={meIn(v)} isMyTurn={false}
      guildsById={guildsById} boardById={boardById} send={() => {}}
    />,
  );
  assert.match(html, /Juotu!/, 'Muut juo! beers must be clearable off-turn');
  assert.ok(!html.includes('Heitä noppaa'));
});

/* ------------------------------------------------------------ scoreboard */

test('the scoreboard ranks on op and counts the discs left', () => {
  const s = playing();
  team(s, 'a').op = 120;
  team(s, 'b').op = 260;
  team(s, 'a').drinksOwed = 2;

  const html = render(
    <Scoreboard state={view(s)} guildsById={guildsById} activeId="a" boardById={boardById} />,
  );
  assert.ok(html.indexOf('Tietokilta') < html.indexOf('Digit'), 'higher op sorts first');
  assert.match(html, /54/, 'all 54 discs are still face down');
  assert.match(html, /team--active/);
});

test('the scoreboard shows the running beer tally, total and per team', () => {
  const s = playing();
  team(s, 'a').drinksTaken = 9;
  team(s, 'a').drinksOwed = 2;
  team(s, 'b').drinksTaken = 4;

  const v = view(s);
  assert.equal(v.drinksTakenTotal, 13, 'the server totals it, not the client');

  const html = render(
    <Scoreboard state={v} guildsById={guildsById} activeId="a" boardById={boardById} />,
  );
  assert.match(html, /13/, 'the grand total is shown');
  assert.match(html, /olutta juotu yhteensä/);
  assert.match(html, /team__drunk[^>]*>9/, "a team's own tally is shown");
  assert.match(html, /team__drinks[^>]*>2/, 'alongside what it still owes');
});

/* ------------------------------------------------------------------- log */

test('the log renders real engine events in Finnish', () => {
  const s = playing();
  const { events } = applyAction(s, { type: 'ROLL', playerId: 'a' }, deps);

  const html = render(
    <EventLog feed={events} state={view(s)} guildsById={guildsById} />,
  );
  assert.match(html, /heitti/);
  assert.match(html, /Digit/);
});

test('the log survives an event type it has no wording for', () => {
  const html = render(
    <EventLog
      feed={[{ type: 'SOMETHING_NEW', playerId: 'a' }]}
      state={view(playing())}
      guildsById={guildsById}
    />,
  );
  assert.match(html, /Ei vielä tapahtumia/, 'unknown events are dropped, not crashed on');
});

/* ----------------------------------------------------------- the bus version */

/*
 * The light game is the full game counted in sips. Nothing in the engine
 * changes, so what these guard is the wording - and specifically the Finnish,
 * which is where a naive swap breaks: hörppy drops a p in the genitive and
 * again in the plural.
 */

test('the bus version counts in sips wherever a beer was named', () => {
  const s = playing('sip');
  team(s, 'a').drinksOwed = 2;
  const html = panel(view(s));

  assert.match(html, /hörppyä juomatta/);
  assert.doesNotMatch(html, /olut/, 'nothing is left counting beers');
});

test('one sip is singular, the way one beer was', () => {
  const s = playing('sip');
  team(s, 'a').drinksOwed = 1;

  assert.match(panel(view(s)), /hörppy juomatta/, 'nominative, not partitive');
});

test('the log declines the unit instead of concatenating it', () => {
  const s = playing('sip');
  const html = render(
    <EventLog
      feed={[
        { type: 'PVP_ASSIGNED', playerId: 'a', targetId: 'b' },
        { type: 'TRAVEL_BEER', playerId: 'a' },
        { type: 'BORDER_BLOCKED', playerId: 'a' },
      ]}
      state={view(s)}
      guildsById={guildsById}
    />,
  );

  assert.match(html, /määräsi hörpyn/, 'genitive drops a p');
  assert.match(html, /juo matkahörpyn/);
  assert.match(html, /juo hörpyn/);
});

test('the scoreboard tallies sips', () => {
  const s = playing('sip');
  team(s, 'a').drinksTaken = 4;

  const html = render(
    <Scoreboard state={view(s)} guildsById={guildsById} activeId="a" boardById={boardById} />,
  );
  assert.match(html, /hörppyä juotu yhteensä/);
});

test('the rules drawer is rewritten in whichever unit is in play', () => {
  const sips = render(<RulesPanel unit="sip" onClose={() => {}} />);
  assert.match(sips, /Matkahörppy/);
  assert.match(sips, /sen hörpyt juodaan uudelleen/, 'plural drops a p too');
  assert.doesNotMatch(sips, /shottia/, 'the light game pours no spirits');

  // The full game must read exactly as it always did - this is the guard on
  // the light version quietly rewording the real one.
  const beers = render(<RulesPanel unit="beer" onClose={() => {}} />);
  assert.match(beers, /Matkaolut/);
  assert.match(beers, /maksaa 3 shottia/);
  assert.match(beers, /sen oluet juodaan uudelleen/);
});

/* ----------------------------------------------------------------- admin */

test('the admin drawer exposes op, drinks and turn order', () => {
  const html = render(
    <AdminSidebar
      state={view(playing())} guildsById={guildsById}
      send={() => {}} onClose={() => {}}
    />,
  );
  assert.match(html, /Opintopisteet/);
  assert.match(html, /Ohita vuoro/);
  assert.match(html, /\+20/);
});

/* -------------------------------------------------------------- finished */

test('the endgame card names the graduate and lists every place', () => {
  let s = playing();
  team(s, 'a').op = 320;
  team(s, 'a').tokens = [{ kind: 'op80', op: 80, drinks: 3 }];
  team(s, 'b').op = 140;
  team(s, 'a').nodeId = board.node('turku').edges.find((e) => e.type === 'land').target;
  for (const cell of Object.values(s.board.tokens)) cell.status = 'REVEALED';

  s = applyAction(s, { type: 'ROLL', playerId: 'a' }, deps).state;
  const target = Object.keys(s.turnState.validDestinations).includes('turku') ? 'turku' : null;
  assert.ok(target, 'expected Turku to be one square away');
  s = applyAction(s, { type: 'MOVE', playerId: 'a', targetId: 'turku' }, deps).state;
  assert.equal(s.status, 'FINISHED');

  const html = render(<Finished state={view(s)} guildsById={guildsById} />);
  assert.match(html, /Digit/);
  assert.match(html, /Loppusijoitukset/);
  assert.match(html, /80 op/, 'the winner\'s transcript is shown');
});

/* ----------------------------------------------------------------- board */

test('the board draws every square and every route exactly once', () => {
  const s = playing();
  const v = view(s);

  const html = render(
    <Board
      board={board.raw}
      tokens={v.board.tokens}
      players={v.players}
      guildsById={guildsById}
      validDestinations={null}
      activeNodeId="turku"
      interactive={false}
      onPick={() => {}}
    />,
  );

  const squares = (html.match(/class="square /g) ?? []).length;
  assert.equal(squares, board.raw.nodes.length, 'one button per square');

  const routes = (html.match(/class="route /g) ?? []).length;
  const edgeCount = board.raw.nodes.reduce((n, x) => n + x.edges.length, 0) / 2;
  assert.equal(routes, edgeCount, 'each route drawn once, not once per direction');

  assert.match(html, /square--border/);
  assert.match(html, /square--cruise/);
  assert.match(html, /square--standing/);
});

test('the board never renders the identity of a face-down disc', () => {
  const s = playing();
  s.board.tokens.tampere = { status: 'REVEALED', kind: 'op80' };
  const v = view(s);

  const html = render(
    <Board
      board={board.raw} tokens={v.board.tokens} players={v.players}
      guildsById={guildsById} validDestinations={null}
      activeNodeId={null} interactive={false} onPick={() => {}}
    />,
  );

  assert.match(html, /80 op/, 'a turned disc is public');
  assert.equal(
    (html.match(/square__facedown/g) ?? []).length, 53,
    'the other 53 discs show as face-down markers with no identity',
  );
  for (const kind of ['op40', 'op60', 'teekkarilakki', 'tutkintouudistus', 'muut_juo']) {
    assert.ok(!html.includes(kind), `${kind} leaked into the board markup`);
  }
});

test('only reachable squares become clickable, and only on your move', () => {
  let s = playing();
  s = applyAction(s, { type: 'ROLL', playerId: 'a' }, deps).state;
  const v = view(s);
  const destinations = v.turnState.validDestinations;

  const idle = render(
    <Board
      board={board.raw} tokens={v.board.tokens} players={v.players}
      guildsById={guildsById} validDestinations={destinations}
      activeNodeId="turku" interactive={false} onPick={() => {}}
    />,
  );
  assert.ok(!idle.includes('square--reachable'), 'nothing is clickable when it is not your move');

  const mine = render(
    <Board
      board={board.raw} tokens={v.board.tokens} players={v.players}
      guildsById={guildsById} validDestinations={destinations}
      activeNodeId="turku" interactive onPick={() => {}}
    />,
  );
  assert.equal(
    (mine.match(/square--reachable/g) ?? []).length,
    Object.keys(destinations).length,
    'exactly the squares the server offered are highlighted',
  );
});

/* ----------------------------------------------------------- easter eggs */

/*
 * The requirement for eggs is that nobody misses one, so these check the
 * places a find is supposed to surface - the flash, the log, the scoreboard,
 * the endgame card and the collection - rather than just that it was detected.
 */

/** Walk `a` home to Turku with every disc already turned, ending the game. */
function finishedGame(setup) {
  let s = playing();
  setup(s);
  team(s, 'a').nodeId = board.node('turku').edges.find((e) => e.type === 'land').target;
  for (const cell of Object.values(s.board.tokens)) cell.status = 'REVEALED';
  s = applyAction(s, { type: 'ROLL', playerId: 'a' }, deps).state;
  s = applyAction(s, { type: 'MOVE', playerId: 'a', targetId: 'turku' }, deps).state;
  assert.equal(s.status, 'FINISHED', 'fixture should end the game');
  return s;
}

test('every egg id the server can emit exists in the client registry', () => {
  // The two halves share these ids only as strings. A typo on either side
  // would not crash anything - the flash would just quietly never appear.
  const source = ['../../server/src/game/engine.js', '../../server/src/game/tokens.js']
    .map((f) => readFileSync(new URL(f, import.meta.url), 'utf8'))
    .join('\n');
  const emitted = [...source.matchAll(/egg: '(\w+)'/g)].map((m) => m[1]);

  assert.ok(emitted.length >= 5, 'expected to find the server-side eggs');
  for (const id of emitted) assert.ok(EGGS[id], `server emits "${id}" but the client has no such egg`);
});

test('every egg has a title, a blurb, a real tier and a known loudness', () => {
  assert.equal(EGG_IDS.length, 9);
  for (const [id, egg] of Object.entries(EGGS)) {
    assert.ok(egg.title && egg.blurb, `${id} needs wording`);
    assert.ok(TIERS[egg.tier], `${id} has an unknown tier`);
    assert.ok(['ambient', 'toast', 'flash', 'endgame'].includes(egg.loud), `${id} has an unknown loudness`);
  }
});

test('the endgame card lists every egg found tonight', () => {
  const s = finishedGame((g) => {
    team(g, 'a').op = 300;
    team(g, 'b').op = 280;
  });
  const html = render(<Finished state={view(s)} guildsById={guildsById} />);

  assert.match(html, /Yön löydöt/);
  assert.match(html, /Tasan 300/);
  assert.match(html, /Yksi kiekko vajaa/, 'including the one credited to the losing team');
});

test('an endgame with no finds says so, and hints where to look', () => {
  const s = finishedGame((g) => { team(g, 'a').op = 320; });
  const html = render(<Finished state={view(s)} guildsById={guildsById} />);

  assert.match(html, /Huonekoodilla on väliä/);
});

test('an egg flash names the egg and its tier', () => {
  const html = render(
    <TokenFlash
      flash={{ kind: 'EGG', egg: 'kolmoisosuma', guildId: 'digit', ms: 6000 }}
      guildsById={guildsById}
      viewerGuildId="tik"
      onDismiss={() => {}}
    />,
  );
  assert.match(html, /Kolmoisosuma/);
  assert.match(html, /Tohtori/);
});

test('a find in the log is named, tiered and styled apart from ordinary lines', () => {
  const html = render(
    <EventLog
      feed={[{ type: 'EGG_FOUND', playerId: 'a', egg: 'rajavartija' }]}
      state={view(playing())}
      guildsById={guildsById}
    />,
  );
  assert.match(html, /löysi: Rajavartija muistaa sinut \(Kandi\)/);
  assert.match(html, /log__line--egg/);
});

test('a sober winner keeps an asterisk on the scoreboard', () => {
  const s = playing();
  s.eggsFound = [{ egg: 'raitis_voittaja', playerId: 'a' }];
  const html = render(
    <Scoreboard state={view(s)} guildsById={guildsById} activeId="a" boardById={boardById} />,
  );
  assert.match(html, /Digit ry<span[^>]*>\*<\/span>/);
  assert.equal(html.match(/>\*<\/span>/g).length, 1, 'only on the winner');
});

test('the collection names what was found and keeps the rest secret', () => {
  const html = render(
    <EggsPanel found={[{ egg: 'tasan_300', playerId: 'a' }]} onClose={() => {}} />,
  );
  assert.match(html, /Tasan 300/);
  assert.match(html, /tänään/, 'tonight\'s finds are marked');
  assert.doesNotMatch(html, /Kolmoisosuma/, 'an unfound egg is not named');
  assert.match(html, /Tohtori/, 'but its tier shows, so there is something to hunt');
  assert.match(html, /\/ 9 löydetty/);
});

test('a team holding the cap wears it on its pawn', () => {
  const s = playing();
  team(s, 'a').tokens = [{ kind: 'teekkarilakki', op: 0, drinks: 1 }];
  const v = view(s);
  const html = render(
    <Board
      board={board.raw}
      tokens={v.board.tokens}
      players={v.players.filter((p) => p.guildId)}
      guildsById={guildsById}
      validDestinations={null}
      activeNodeId={null}
      interactive={false}
      onPick={() => {}}
    />,
  );
  assert.equal(html.match(/pawn__cap/g)?.length, 1, 'only the team with the cap');
});

test('lakkikausi runs from Wappu to the end of September', () => {
  const on = (month, day) => isCapSeason(new Date(2026, month - 1, day));
  assert.equal(on(4, 30), false);
  assert.equal(on(5, 1), true);
  assert.equal(on(9, 30), true);
  assert.equal(on(10, 1), false);
});

test('room codes pick their theme regardless of case, and most pick none', () => {
  assert.equal(roomTheme('KELA'), 'kela');
  assert.equal(roomTheme('wapp'), 'wappu');
  assert.equal(roomTheme('TITE'), '');
  assert.equal(roomTheme(undefined), '');
});

test('the water-break nudge reads in beers and stays silent in the sip game', () => {
  const event = { type: 'PACE_WARNING', playerId: 'a', drinks: 8, minutes: 10 };
  const nameOf = () => 'Algo ry';
  assert.equal(describeEvent(event, nameOf, 'beer'), 'Algo ry: 8 olutta 10 minuutissa. Vesilasi väliin?');
  assert.equal(describeEvent(event, nameOf, 'sip'), null);
});

test('an olutpokka shows on the pawn and in the transcript, even with no discs', () => {
  const s = playing();
  team(s, 'b').pokka = true;
  const v = view(s);

  const scoreboard = render(
    <Scoreboard state={v} guildsById={guildsById} activeId="a" boardById={boardById} />,
  );
  assert.equal(scoreboard.match(/chip--pokka/g)?.length, 1, 'only the team that went');

  const pawns = render(
    <Board
      board={board.raw}
      tokens={v.board.tokens}
      players={v.players.filter((p) => p.guildId)}
      guildsById={guildsById}
      validDestinations={null}
      activeNodeId={null}
      interactive={false}
      onPick={() => {}}
    />,
  );
  assert.equal(pawns.match(/pawn__pokka/g)?.length, 1);
});
