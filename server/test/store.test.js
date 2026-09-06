import test from 'node:test';
import assert from 'node:assert/strict';
import RedisMock from 'ioredis-mock';

import { createStore } from '../src/store.js';
import { createRoom } from '../src/game/engine.js';

const store = () => createStore({ client: new RedisMock() });

test('store: a room survives a round trip through Redis', async () => {
  const s = store();
  const room = createRoom({ code: 'ABCD', seed: 'ABCD' });

  await s.set('ABCD', room);
  assert.deepEqual(await s.get('ABCD'), room);
  assert.equal(await s.get('NOPE'), null);
  await s.close();
});

test('store: withRoom hands over the current state and writes the result back', async () => {
  const s = store();
  await s.set('ABCD', createRoom({ code: 'ABCD' }));

  const result = await s.withRoom('ABCD', (state) => {
    assert.equal(state.code, 'ABCD');
    return { state: { ...state, status: 'PLAYING' }, extra: 42 };
  });

  assert.equal(result.extra, 42);
  assert.equal((await s.get('ABCD')).status, 'PLAYING');
  await s.close();
});

test('store: returning no state leaves the room untouched', async () => {
  const s = store();
  await s.set('ABCD', createRoom({ code: 'ABCD' }));
  await s.withRoom('ABCD', () => null);
  assert.equal((await s.get('ABCD')).status, 'LOBBY');
  await s.close();
});

test('store: simultaneous actions on one room do not overwrite each other', async () => {
  const s = store();
  await s.set('ABCD', { code: 'ABCD', counter: 0 });

  // Without the per-room lock both callbacks would read counter 0 and the
  // second write would silently discard the first action.
  const bump = () => s.withRoom('ABCD', async (state) => {
    await new Promise((r) => setTimeout(r, 5));
    return { state: { ...state, counter: state.counter + 1 } };
  });

  await Promise.all([bump(), bump(), bump()]);
  assert.equal((await s.get('ABCD')).counter, 3);
  await s.close();
});

test('store: one failed action does not wedge the room forever', async () => {
  const s = store();
  await s.set('ABCD', { code: 'ABCD', counter: 0 });

  await assert.rejects(
    s.withRoom('ABCD', () => { throw new Error('boom'); }),
    /boom/,
  );

  const after = await s.withRoom('ABCD', (state) => ({
    state: { ...state, counter: state.counter + 1 },
  }));
  assert.equal(after.state.counter, 1);
  await s.close();
});

test('store: rooms expire, so a dead party does not live in Redis forever', async () => {
  const s = createStore({ client: new RedisMock(), ttlSeconds: 60 });
  await s.set('ABCD', createRoom({ code: 'ABCD' }));
  const ttl = await s.redis.ttl('room:ABCD');
  assert.ok(ttl > 0 && ttl <= 60, `expected a live ttl, got ${ttl}`);
  await s.close();
});
