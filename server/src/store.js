/**
 * Room persistence.
 *
 * One JSON document per room under `room:{CODE}`. Redis is the source of truth;
 * the process keeps nothing in memory between actions, so a restart mid-party
 * loses nothing and clients just reconnect.
 */

import Redis from 'ioredis';

const DEFAULT_TTL = 12 * 60 * 60; // a room outlives any realistic sitting

export function createStore({
  url = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379',
  ttlSeconds = DEFAULT_TTL,
  client = null,
  RedisImpl = Redis,
} = {}) {
  const redis = client ?? new RedisImpl(url, { lazyConnect: true, maxRetriesPerRequest: 2 });
  const key = (code) => `room:${code}`;

  // ioredis emits on a dead socket whether or not anyone is listening, and an
  // unhandled 'error' event would bury the actionable message connect() throws.
  // Once we are up, connection trouble is real news and gets logged.
  let ready = false;
  redis.on?.('error', (error) => {
    if (ready) console.error('[store] redis:', error.message);
  });

  /**
   * Serialises read-modify-write per room.
   *
   * Two sockets acting on the same room in the same tick would otherwise both
   * read the pre-action state and the second write would silently discard the
   * first action. Note this guards one process only - running several server
   * instances against one Redis would need a real distributed lock here.
   */
  const chains = new Map();

  async function connect() {
    ready = false;
    if (redis.status === 'wait' || redis.status === 'end') {
      await redis.connect();
    }
    await redis.ping();
    ready = true;
    return redis;
  }

  async function get(code) {
    const raw = await redis.get(key(code));
    return raw ? JSON.parse(raw) : null;
  }

  async function set(code, state) {
    await redis.set(key(code), JSON.stringify(state), 'EX', ttlSeconds);
    return state;
  }

  async function del(code) {
    await redis.del(key(code));
  }

  /**
   * Run `fn(state)` against the room under its lock. `fn` returns the next state
   * (plus anything it wants passed back); returning a null state skips the write.
   */
  function withRoom(code, fn) {
    const previous = chains.get(code) ?? Promise.resolve();

    const run = previous.then(async () => {
      const current = await get(code);
      const result = await fn(current);
      if (result?.state) await set(code, result.state);
      return result;
    });

    // The chain must survive this link rejecting, or one bad action would wedge
    // the room forever - hence the swallowed catch on the stored tail.
    const tail = run.then(() => {}, () => {});
    chains.set(code, tail);

    // Drop the entry once the room goes quiet, so the map does not grow with
    // every room the server has ever seen.
    tail.then(() => {
      if (chains.get(code) === tail) chains.delete(code);
    });

    return run;
  }

  async function close() {
    await redis.quit().catch(() => redis.disconnect());
  }

  return { redis, connect, get, set, del, withRoom, close };
}
