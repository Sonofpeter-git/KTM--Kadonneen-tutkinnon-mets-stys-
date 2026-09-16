import { CUE_SOURCES } from './cues.js';

/**
 * Sample playback. Everything here fails soft: the game is fully playable with
 * the audio dead, and no cue is ever the only signal - the event log already
 * says what happened.
 *
 * Nothing touches AudioContext at module scope. client/test/render.test.jsx
 * imports App.jsx into bare Node with no DOM, so a context built on import
 * would take all 26 render tests down with it. The context is built inside
 * unlock(), which only a real browser gesture ever reaches.
 */

const KEY_MUTED = 'ktm:muted';
const REPEAT_GUARD_MS = 200;

// Same try/catch as socket.js: localStorage throws outright in private mode.
const read = (key) => { try { return localStorage.getItem(key) ?? ''; } catch { return ''; } };
const write = (key, value) => { try { localStorage.setItem(key, value); } catch { /* not fatal */ } };

let ctx = null;
let master = null;
let buffers = new Map();        // src -> AudioBuffer
let muted = null;               // lazily read; null means "not asked yet"
const lastPlayed = new Map();   // src -> timestamp

/** Default on: this is the acting team's own phone, and they asked for it. */
export function isMuted() {
  if (muted === null) muted = read(KEY_MUTED) === '1';
  return muted;
}

export function setMuted(next) {
  muted = !!next;
  write(KEY_MUTED, muted ? '1' : '0');
  if (master && ctx) master.gain.setTargetAtTime(muted ? 0 : 1, ctx.currentTime, 0.01);
}

export const isReady = () => !!ctx;

/**
 * Build the context and decode the pack. Must be called from a real user
 * gesture - a context created without one starts suspended and stays that way.
 *
 * Idempotent, and safe to call from a handler that fires on every tap.
 */
export async function unlock() {
  if (ctx) {
    // Chrome can suspend a backgrounded tab's context; a later tap revives it.
    if (ctx.state === 'suspended') { try { await ctx.resume(); } catch { /* ignore */ } }
    return;
  }

  const Ctor = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
  if (!Ctor) return;            // no Web Audio: the game just stays quiet

  try {
    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = isMuted() ? 0 : 1;
    master.connect(ctx.destination);
    if (ctx.state === 'suspended') await ctx.resume();
  } catch {
    ctx = null;
    return;
  }

  await preload();
}

/**
 * Fetch and decode every sample once, here rather than on first play: decoding
 * costs latency exactly at the moment the sound is supposed to land, and a
 * decoded buffer makes overlapping plays free.
 */
async function preload() {
  const base = (import.meta.env?.BASE_URL ?? '/').replace(/\/$/, '');
  await Promise.all(CUE_SOURCES.map(async (src) => {
    if (buffers.has(src)) return;
    try {
      const res = await fetch(`${base}/sounds/${src}`);
      if (!res.ok) return;      // a missing file is silence, not a crash
      buffers.set(src, await ctx.decodeAudioData(await res.arrayBuffer()));
    } catch { /* leave it undecoded; play() will find nothing and do nothing */ }
  }));
}

/** Play one sample. No-op when locked, muted, undecoded or just-played. */
export function play(src) {
  if (!ctx || !src || isMuted()) return;

  const buffer = buffers.get(src);
  if (!buffer) return;

  // Guards a double-fire of the same cue; not a rate limit. Actor-scoped cues
  // only ever have one listener, so there is no burst to smooth out.
  const now = ctx.currentTime * 1000;
  if (now - (lastPlayed.get(src) ?? -Infinity) < REPEAT_GUARD_MS) return;
  lastPlayed.set(src, now);

  try {
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(master);
    source.start();
  } catch { /* ignore */ }
}

/** Tests only - there is one context per page in the real thing. */
export function __reset() {
  ctx = null; master = null; buffers = new Map(); muted = null; lastPlayed.clear();
}
