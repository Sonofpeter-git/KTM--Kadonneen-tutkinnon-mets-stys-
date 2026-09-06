#!/usr/bin/env node
/**
 * Loads the real app in a real browser and measures the board.
 *
 * Server-side render tests prove the markup is right; they say nothing about
 * layout, which is where a zoom-and-pan board actually goes wrong. This drives
 * Chrome, seeds a started game over the socket, and reports the box of every
 * layer plus how far apart two squares ended up.
 *
 *   node scripts/inspect-board.mjs [url]
 */

import { chromium } from 'playwright-core';
import { io } from 'socket.io-client';

const TARGET = process.argv[2] ?? 'http://localhost:3001';
// Fresh room each run: rooms persist in Redis, and a started one cannot be set up again.
const ROOM = 'PW' + Math.floor(Math.random() * 9000 + 1000);
const SHOT = 'board-check.png';
const PLATE = 'board-plate.png';

const ask = (s, e, p) => new Promise((res, rej) => {
  s.emit(e, p, (r) => (r?.ok ? res(r) : rej(new Error(r?.code ?? e))));
});
const once = (s, e) => new Promise((r) => s.once(e, r));
const until = (s, pred) => new Promise((res) => {
  const h = (v) => { if (pred(v)) { s.off('res_state_update', h); res(v); } };
  s.on('res_state_update', h);
});

/** Put a real, started game in Redis for the browser to walk into. */
async function seedGame() {
  const [h, a, b] = [io(TARGET), io(TARGET), io(TARGET)];
  await Promise.all([once(h, 'connect'), once(a, 'connect'), once(b, 'connect')]);

  await ask(h, 'req_join', { roomCode: ROOM, playerId: 'pw-host', name: 'Host' });
  await ask(a, 'req_join', { roomCode: ROOM, playerId: 'pw-a', name: 'Anna' });
  await ask(b, 'req_join', { roomCode: ROOM, playerId: 'pw-b', name: 'Beto' });
  await ask(a, 'req_set_guild', { guildId: 'algo' });
  await ask(b, 'req_set_guild', { guildId: 'tik' });

  const playing = until(h, (v) => v.status === 'PLAYING');
  await ask(h, 'req_start_game', {});
  const state = await playing;

  // Roll, so the browser also has highlighted destinations to lay out.
  const activeId = state.turnOrder[state.turnState.activeIndex];
  const act = activeId === 'pw-a' ? a : b;
  const rolled = until(act, (v) => v.turnState.phase === 'MOVING');
  await ask(act, 'req_roll', {});
  await rolled;

  // Put some beers on the board so the tally has something to show.
  await ask(h, 'req_leader_override', { op: 'ADJUST_DRINKS', args: { playerId: 'pw-a', delta: 5 } });
  await ask(h, 'req_leader_override', { op: 'ADJUST_DRINKS', args: { playerId: 'pw-b', delta: 4 } });
  await ask(a, 'req_drink_cleared', { amount: 3 });
  await ask(b, 'req_drink_cleared', { amount: 4 });

  for (const s of [h, a, b]) s.close();
  return activeId;
}

const box = async (page, selector) => page.evaluate((sel) => {
  const el = document.querySelector(sel);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  return {
    w: Math.round(r.width), h: Math.round(r.height),
    display: cs.display, position: cs.position,
    cssW: cs.width, cssH: cs.height,
  };
}, selector);

const main = async () => {
  const activeId = await seedGame();
  console.log(`seeded ${ROOM}, active team is ${activeId}\n`);

  const browser = await chromium.launch({ channel: 'chrome' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  const problems = [];
  page.on('console', (m) => { if (m.type() === 'error') problems.push(m.text()); });
  page.on('pageerror', (e) => problems.push(String(e)));

  // Arrive as the active team, exactly as a returning phone would.
  await page.goto(TARGET);
  await page.evaluate(({ id, room }) => {
    localStorage.setItem('ktm:playerId', id);
    localStorage.setItem('ktm:room', room);
    localStorage.setItem('ktm:name', 'Anna');
  }, { id: activeId, room: ROOM });
  await page.reload();

  await page.waitForSelector('.board__plate', { state: 'attached', timeout: 15000 });
  await page.waitForTimeout(1200);   // let the zoom wrapper settle

  console.log('layer                    size        display   css w x h');
  for (const sel of ['.stage', '.board', '.board__viewport', '.board__content', '.board__plate']) {
    const b = await box(page, sel);
    console.log(
      `  ${sel.padEnd(22)} ${b ? `${b.w}x${b.h}`.padEnd(11) : 'MISSING'.padEnd(11)}` +
      `${b ? b.display.padEnd(9) + b.cssW + ' x ' + b.cssH : ''}`,
    );
  }

  const spread = await page.evaluate(() => {
    const squares = [...document.querySelectorAll('.square')];
    if (squares.length < 2) return null;
    const pts = squares.map((s) => { const r = s.getBoundingClientRect(); return { x: r.x, y: r.y }; });
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    return {
      count: squares.length,
      spreadX: Math.round(Math.max(...xs) - Math.min(...xs)),
      spreadY: Math.round(Math.max(...ys) - Math.min(...ys)),
      routes: document.querySelectorAll('.route').length,
      reachable: document.querySelectorAll('.square--reachable').length,
      pawns: document.querySelectorAll('.pawn').length,
    };
  });

  // The basemap is the easiest thing to get silently wrong: a 404 leaves the
  // element in place but blank, which looks identical to "no map configured".
  const basemap = await page.evaluate(() => {
    const img = document.querySelector('.board__image');
    if (!img) return { present: false };
    const r = img.getBoundingClientRect();
    return {
      present: true,
      src: img.getAttribute('src'),
      loaded: img.complete && img.naturalWidth > 0,
      natural: `${img.naturalWidth}x${img.naturalHeight}`,
      drawn: `${Math.round(r.width)}x${Math.round(r.height)}`,
      display: getComputedStyle(img).display,
    };
  });
  console.log('\nbasemap  ', JSON.stringify(basemap));

  console.log('squares  ', JSON.stringify(spread));
  console.log('doc scrollWidth vs viewport:', await page.evaluate(
    () => `${document.documentElement.scrollWidth} / ${window.innerWidth}`,
  ));

  await page.screenshot({ path: SHOT });
  console.log(`\nscreenshot -> ${SHOT}`);

  // A close-up of the plate alone. The board is tall and narrow, so in a normal
  // window it is far too small to judge whether the cities sit on their real
  // coastlines - which is the only thing that proves the basemap calibration.
  await page.setViewportSize({ width: 760, height: 1750 });
  await page.waitForTimeout(900);
  await page.locator('.board__plate').screenshot({ path: PLATE });
  console.log(`plate      -> ${PLATE}`);

  if (problems.length) console.log('\nconsole errors:\n  ' + problems.join('\n  '));

  const ok = spread && spread.spreadX > 100 && spread.spreadY > 100;
  console.log(ok ? '\nBOARD OK: squares are spread across the plate.' : '\nBOARD BROKEN: squares are collapsed.');

  await browser.close();
  process.exit(ok ? 0 : 1);
};

main().catch((e) => { console.error(e); process.exit(1); });
