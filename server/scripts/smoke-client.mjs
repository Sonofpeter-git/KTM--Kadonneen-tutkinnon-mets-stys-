#!/usr/bin/env node
/**
 * End-to-end check over a real socket, against a real Redis.
 *
 * Boots the server, connects two clients, and drives a turn far enough to prove
 * the transport, the store and the reducer are wired to each other - the one
 * thing the pure unit tests cannot show. Also watches every broadcast for a
 * leaked disc.
 *
 *   npm run smoke          against a real Redis
 *   npm run smoke -- --mock  against an in-process fake, when you have none
 *
 * If you have no Redis: docker run -p 6379:6379 redis:7
 */

import { io as connect } from 'socket.io-client';
import { start } from '../src/index.js';
import { createStore } from '../src/store.js';

const PORT = Number(process.env.SMOKE_PORT ?? 3999);
const URL = `http://127.0.0.1:${PORT}`;
const ROOM = 'SMOKE';

const DISC_KINDS = ['op40', 'op60', 'op80', 'teekkarilakki', 'tutkintouudistus', 'muut_juo'];

let checks = 0;
const ok = (label) => { checks++; console.log(`  ok  ${label}`); };
const die = (message) => { throw new Error(message); };

/** Promise-wrapped emit, using socket.io acknowledgements. */
const send = (socket, event, payload) =>
  new Promise((resolve, reject) => {
    socket.emit(event, payload, (reply) => {
      if (reply?.ok) resolve(reply);
      else reject(new Error(`${event} rejected: ${reply?.code} ${reply?.message ?? ''}`));
    });
  });

const nextState = (socket) =>
  new Promise((resolve) => socket.once('res_state_update', resolve));

const open = (socket) =>
  new Promise((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('connect_error', reject);
  });

const USE_MOCK = process.argv.includes('--mock');

/**
 * The fake is only ever reachable through this flag. The server itself has no
 * way to fall back to it, so a misconfigured production box still refuses to
 * start rather than quietly losing every room on restart.
 */
async function mockStore() {
  const { default: RedisMock } = await import('ioredis-mock');
  return createStore({ client: new RedisMock() });
}

async function main() {
  if (USE_MOCK) console.log('  --  running against an in-process fake Redis\n');
  const server = await start({ port: PORT, store: USE_MOCK ? await mockStore() : null });
  const clients = [];

  try {
    // Watch every broadcast either client ever receives for a leaked disc.
    const watch = (socket, who) => {
      socket.on('res_state_update', (state) => {
        const wire = JSON.stringify(state.board);
        for (const kind of DISC_KINDS) {
          const hiddenLeak = wire.includes(kind) &&
            Object.values(state.board.tokens).some((c) => c.status === 'HIDDEN' && 'kind' in c);
          if (hiddenLeak) die(`${who} was told the identity of a face-down disc (${kind})`);
        }
      });
    };

    const a = connect(URL, { transports: ['websocket'] });
    const b = connect(URL, { transports: ['websocket'] });
    clients.push(a, b);
    watch(a, 'client A');
    watch(b, 'client B');

    await Promise.all([open(a), open(b)]);
    ok('two clients connected');

    const joinA = await send(a, 'req_join', { roomCode: ROOM, playerId: 'smoke-a', name: 'A' });
    const joinB = await send(b, 'req_join', { roomCode: ROOM, playerId: 'smoke-b', name: 'B' });
    if (joinA.role !== 'LEADER') die(`first joiner should lead, got ${joinA.role}`);
    if (joinB.role !== 'GAMER') die(`second joiner should play, got ${joinB.role}`);
    ok('first joiner is the Game Leader');

    const { board } = await send(a, 'req_board');
    if (!board?.nodes?.length) die('board was not served to the client');
    ok(`board served (${board.nodes.length} nodes)`);

    await send(a, 'req_set_guild', { guildId: 'digit' });
    await send(b, 'req_set_guild', { guildId: 'tik' });
    ok('guilds claimed');

    await send(b, 'req_set_guild', { guildId: 'digit' })
      .then(() => die('a taken guild was handed out twice'))
      .catch((error) => {
        if (!/GUILD_TAKEN/.test(error.message)) throw error;
      });
    ok('a taken guild is refused');

    const started = nextState(a);
    await send(a, 'req_start_game');
    const afterStart = await started;
    if (afterStart.status !== 'PLAYING') die(`expected PLAYING, got ${afterStart.status}`);
    if (afterStart.tokensRemaining !== 54) die(`expected 54 discs, got ${afterStart.tokensRemaining}`);
    ok('game started with 54 discs face down');

    const hidden = Object.values(afterStart.board.tokens).filter((c) => c.status === 'HIDDEN');
    if (hidden.some((c) => 'kind' in c)) die('a face-down disc was broadcast with its identity');
    ok('no face-down disc leaked its identity');

    // Whoever the turn order picked has to be the one who can act.
    const activeId = afterStart.turnOrder[afterStart.turnState.activeIndex];
    const active = activeId === 'smoke-a' ? a : b;
    const idle = activeId === 'smoke-a' ? b : a;

    await send(idle, 'req_roll')
      .then(() => die('the wrong client was allowed to roll'))
      .catch((error) => {
        if (!/NOT_YOUR_TURN/.test(error.message)) throw error;
      });
    ok('only the active team may roll');

    const rolled = nextState(active);
    await send(active, 'req_roll');
    const afterRoll = await rolled;
    if (afterRoll.turnState.phase !== 'MOVING') die(`expected MOVING, got ${afterRoll.turnState.phase}`);
    ok(`rolled a ${afterRoll.turnState.roll}, routes offered`);

    const target = Object.keys(afterRoll.turnState.validDestinations)[0];
    const moved = nextState(active);
    await send(active, 'req_move', { targetId: target });
    const afterMove = await moved;
    const me = afterMove.players.find((p) => p.id === activeId);
    if (me.nodeId !== target) die(`move did not land: ${me.nodeId} != ${target}`);
    ok(`moved to ${target}`);

    // Prove the state actually reached Redis, not just the broadcast.
    const stored = await server.store.get(ROOM);
    if (stored?.players.find((p) => p.id === activeId)?.nodeId !== target) {
      die('the move was broadcast but never persisted');
    }
    ok('state persisted to Redis');

    await server.store.del(ROOM);
    console.log(`\n${checks} checks passed.`);
  } finally {
    for (const c of clients) c.close();
    await server.close();
  }
}

main().catch((error) => {
  console.error(`\nSmoke test failed: ${error.message}`);
  if (/Redis/i.test(error.message)) {
    console.error('Start one with: docker run -p 6379:6379 redis:7');
  }
  process.exit(1);
});
