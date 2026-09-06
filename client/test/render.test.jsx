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
import App from '../src/App.jsx';

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
function playing() {
  let s = applyAction(lobbyState(), { type: 'START_GAME', playerId: HOST }, deps).state;
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
