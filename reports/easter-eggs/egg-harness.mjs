// Real server on a fake Redis (:3055) + a seeding endpoint (:3056/seed?s=...).
// Each scenario is a started room left one action short of its egg.
import http from 'node:http';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const ROOT = 'C:/Users/nikla/Documents/code/KTM--Kadonneen-tutkinnon-mets-stys-';
process.env.CLIENT_DIST = ROOT + '/client/dist';
const req = createRequire(ROOT + '/server/package.json');
const imp = (p) => import(pathToFileURL(ROOT + p).href);

const { start } = await imp('/server/src/index.js');
const { createStore } = await imp('/server/src/store.js');
const { rollDie } = await imp('/server/src/game/rng.js');
const RedisMock = req('ioredis-mock');
const { io } = req('socket.io-client');

const APP = 'http://localhost:3055';
const { store } = await start({ port: 3055, store: createStore({ client: new RedisMock() }) });

const ask = (s, e, p) => new Promise((res, rej) => s.emit(e, p, (r) => (r?.ok ? res(r) : rej(new Error(r?.code ?? e)))));
const connect = () => new Promise((r) => { const s = io(APP); s.once('connect', () => r(s)); });

let n = 0;
async function seed(scenario) {
  const lobby = scenario.startsWith('lobby-');
  const themed = ['KELA', 'WAPP', 'SAUN'].includes(scenario);
  const room = lobby ? scenario.slice(6) : themed ? scenario : scenario === 'combo' ? 'KELA' : `EGG${++n}${scenario.slice(0, 2).toUpperCase()}`;
  const [h, a, b] = await Promise.all([connect(), connect(), connect()]);
  await ask(h, 'req_join', { roomCode: room, playerId: 'pw-host', name: 'Host' });
  await ask(a, 'req_join', { roomCode: room, playerId: 'pw-a', name: 'Anna' });
  await ask(b, 'req_join', { roomCode: room, playerId: 'pw-b', name: 'Beto' });
  await ask(a, 'req_set_guild', { guildId: 'algo' });
  await ask(b, 'req_set_guild', { guildId: 'tik' });
  if (!lobby) await ask(h, 'req_start_game', {});
  for (const s of [h, a, b]) s.close();
  if (lobby || themed) return room;

  await store.withRoom(room, async (s) => {
    const A = s.players.find((p) => p.id === 'pw-a');
    const B = s.players.find((p) => p.id === 'pw-b');
    for (const p of s.players) p.drinksOwed = 0;
    s.turnState.activeIndex = s.turnOrder.indexOf('pw-a');
    s.turnState.phase = 'ROLLING';
    s.turnState.pending = [];
    const discAt = (id, kind) => { s.board.tokens[id] = { status: 'HIDDEN', kind }; };

    switch (scenario) {
      case 'border':
        A.nodeId = 'haaparanta';
        A.borderFails = 3;
        s.turnState.phase = 'BORDER_ROLL';
        while (rollDie({ rng: s.rng }, 6) === 6) s.rng = (s.rng + 1) >>> 0; // guarantee a fail
        break;
      case 'tasan300':
        A.op = 260; A.drinksTaken = 9; B.op = 120; B.drinksTaken = 3;
        A.nodeId = A.homeCity; discAt(A.homeCity, 'op40');
        break;
      case 'triple':
        A.op = 40; A.nodeId = 'tampere'; discAt('tampere', 'op80');
        A.tokens = [1, 2].map(() => ({ kind: 'op80', op: 80, drinks: 3 }));
        break;
      case 'endgame':
        A.op = 280; A.drinksTaken = 2; B.op = 280; B.drinksTaken = 14;
        A.nodeId = A.homeCity; discAt(A.homeCity, 'op40');
        break;
      case 'combo': // every client-side egg, then a finish to read the card
        A.op = 280; A.drinksOwed = 3; B.drinksTaken = 20;
        A.nodeId = A.homeCity; discAt(A.homeCity, 'op40');
        A.tokens = [{ kind: 'teekkarilakki', op: 0, drinks: 1 }];
        break;
      case 'pace': // opening an 80 on arrival hands out 2 + 3: 8 in the window, 7 this round
        A.op = 40; A.nodeId = 'tampere'; discAt('tampere', 'op80');
        A.recentDrinks = [{ at: Date.now() - 4 * 60 * 1000, n: 3 }];
        A.roundLoad = 2;
        s.turnState.phase = 'RESOLUTION';
        s.turnState.pending = [{ kind: 'TOKEN', cityId: 'tampere' }];
        break;
      case 'pokka': // one square short of Tallinn, and the next d4 is a 1
        A.nodeId = 'espoo__tallinna_1';
        while (rollDie({ rng: s.rng }, 4) !== 1) s.rng = (s.rng + 1) >>> 0;
        break;
      case 'cap':
        A.tokens = [{ kind: 'teekkarilakki', op: 0, drinks: 1 }];
        break;
      case 'chicken':
        A.drinksOwed = 3;
        break;
      default: throw new Error('unknown scenario ' + scenario);
    }
    return { state: s };
  });
  return room;
}

http.createServer(async (rq, rs) => {
  try {
    const room = await seed(new URL(rq.url, 'http://x').searchParams.get('s'));
    rs.end(JSON.stringify({ room, playerId: 'pw-a' }));
  } catch (e) {
    rs.statusCode = 500; rs.end(e.stack);
  }
}).listen(3056, () => console.log('seed endpoint on :3056'));
