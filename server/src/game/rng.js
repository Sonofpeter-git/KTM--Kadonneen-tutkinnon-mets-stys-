/**
 * Deterministic RNG.
 *
 * The whole engine is a pure reducer, which means randomness cannot come from
 * Math.random - a room's state is serialised into Redis between every action, so
 * the generator has to survive a JSON round trip. mulberry32's entire state is a
 * single uint32, so we keep it on the state object and thread it through.
 *
 * Practical upshot: a game replays identically from its seed, which is what makes
 * the rule tests and the full-game simulation reproducible.
 */

const UINT32 = 0x100000000;

/** Advance the generator held on `holder.rng` and return a float in [0, 1). */
export function nextFloat(holder) {
  let a = (holder.rng + 0x6d2b79f5) >>> 0;
  holder.rng = a;
  let t = a;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / UINT32;
}

/** Integer in [min, max], inclusive. */
export function nextInt(holder, min, max) {
  return min + Math.floor(nextFloat(holder) * (max - min + 1));
}

/** Simulate a die with `sides` faces: 1..sides. */
export function rollDie(holder, sides) {
  return nextInt(holder, 1, sides);
}

/** Fisher-Yates, returning a new array and leaving the input untouched. */
export function shuffle(holder, items) {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = nextInt(holder, 0, i);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Turn an arbitrary string into a uint32 seed (FNV-1a). */
export function seedFrom(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
