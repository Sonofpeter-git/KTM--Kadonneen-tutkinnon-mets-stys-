# Easter egg test report

**Date:** 2026-09-17 · **Build:** `e80cda8` (committed `client/dist`, `index-BYmQBI9J.js`) · **Browser:** Playwright MCP (Chromium), 1280×800

**Result: 8 / 8 eggs trigger and are recorded.** The first pass found four minor issues; all are fixed and re-checked (see the end).

## How it was tested

Docker/Redis was not running, so [`egg-harness.mjs`](egg-harness.mjs) boots the real server (`start()` from
`server/src/index.js`) against `ioredis-mock`, serving the built client on `:3055`. For each egg it
creates a real room over sockets (host + Algo ry + TiK), starts the game, and then edits the stored room
so it is **one action short** of the egg (e.g. `borderFails: 3`, `op: 260` with a hidden 40 op disc at
home). The last action was always done by hand in the browser, logged in as Algo ry, so every trigger
went through the real UI → socket → engine → broadcast path.

Two things were faked on purpose:
- **Border roll:** the harness advances `state.rng` until the next d6 is not a 6, so the 4th roll is guaranteed to fail.
- **Lakkikausi:** today (17 Sep) is inside cap season, so the browser clock was set to 15 Jan 2026 with `page.clock.install`.

Each device's collection (`localStorage['ktm:eggs']`) was checked after every step and ended with all 8.

## Results

| # | Egg | Tier | How loud | Trigger used | Result |
|---|-----|------|------|---------|--------|
| 1 | Nimetty huone | Fuksi | ambient | Room codes `KELA`, `WAPP`, `SAUN` | ✅ reskin + saved |
| 2 | Et sä uskalla | Fuksi | ambient | 5 × press 300 ms / release on "Juotu!" | ✅ appears on exactly the 5th bail |
| 3 | Lakkikausi | Kandi | toast | Pawn holding a teekkarilakki, clock in January | ✅ toast + crooked cap |
| 4 | Rajavartija muistaa sinut | Kandi | toast | 4th failed border roll | ✅ toast + feed line |
| 5 | Tasan 300 | Maisteri | flash | 260 op + open 40 op disc at home | ✅ flash on screen ~5.8 s |
| 6 | Kolmoisosuma | Tohtori | flash | Holding 2 × 80 op, open the 3rd | ✅ flash, not replaced by the plain "80 op" flash |
| 7 | Raitis voittaja | Tohtori | endgame | Winner drank 2, rival drank 14 | ✅ endgame card + scoreboard `*` |
| 8 | Yksi kiekko vajaa | Ikuinen opiskelija | endgame | Rival finishes on 280 op | ✅ endgame card |

---

### 1. Nimetty huone: room code reskins

`KELA`: beige topbar, "HAKEMUS KÄSITTELYSSÄ" stamp, sepia board.
![KELA](01-huonekoodi-kela.png)

`WAPP`: striped band under the topbar.
![WAPP](01b-huonekoodi-wapp.png)

`SAUN`: warm board, copper rule and fog (after fix 2 below).
![SAUN](01c-huonekoodi-saun.png)

### 2. Et sä uskalla

The `btn--mocked` class was off after bails 1–4 and on after bail 5. A full 1.3 s hold afterwards cleared the 3 drinks and removed the label, as intended.

![Et sä uskalla](08-et-uskalla.png)
![Button close-up](08-et-uskalla-button.png)

### 3. Lakkikausi

The toast appears on load. The cap's tooltip reads "Lakkikausi on ohi. Pidät sitä silti."
![Lakkikausi toast](07-lakkikausi-toast.png)
![Crooked cap, zoomed](07-lakkikausi-pawn-zoom.png)

### 4. Rajavartija muistaa sinut

Before: `borderFails` is 3 and it is Algo ry's turn at the border.
![Before](02-rajavartija-before.png)

After rolling a 5, the toast stays up until it is tapped. The feed shows "Algo ry löysi: Rajavartija muistaa sinut (Kandi)".
![Rajavartija](02-rajavartija.png)

### 5. Tasan 300

The flash was captured 1.2 s after the click. It went away 5.8 s after the click (`EGG_FLASH_MS` is 6000) and left the endgame card with the find under "Yön löydöt".
![Flash](03-tasan-300-flash.png)
![Finished card](03-tasan-300-finished.png)

### 6. Kolmoisosuma

![Kolmoisosuma](04-kolmoisosuma-flash.png)

### 7 + 8. Raitis voittaja and Yksi kiekko vajaa

Both came from the same game ending. The endgame card lists both finds. The scoreboard shows `Algo ry*`, with the blurb as its tooltip, and the feed has one line for each egg.
![Endgame](05-06-endgame-card.png)

### The Löydöt collection

All 8 found:
![All found](09-loydot-all-found.png)

A device that has found 2: unfound eggs show `???` and their tier only.
![Partial](09b-loydot-partial.png)

## Observations, and how they were fixed

The first pass found four minor issues. All four are fixed, and each fix was checked in the browser with the rebuilt `client/dist` (`index-CGo1bWWs.js`). Tests: server 93/93 (2 new), client 56/56.

### 1. Nimetty huone was invisible in the lobby: fixed

**Was:** the egg was saved, but the lobby `<main>` had no theme class and the theme CSS only targeted the in-game topbar and board.
**Fix:** `App.jsx` puts `shell--{theme}` on the lobby shell too. `app.css` gives `.lobby__head` a KELA form with the stamp, the WAPP streamers, and the SAUN copper rule plus fog.

![KELA lobby](10-lobby-kela.png)
![WAPP lobby](10b-lobby-wapp.png)
![SAUN lobby](10c-lobby-saun.png)

### 2. SAUN was hard to notice: fixed

**Was:** `sepia(0.3)` and a fog at 0.28 opacity.
**Fix:** the board filter is now `sepia(0.6) saturate(1.5) hue-rotate(-18deg)`, the topbar has a copper bottom border, and the fog is at 0.42 opacity over 45% of the height. Southern squares (Tallinn, Tukholma) are still readable.

![SAUN in game, after](01c-huonekoodi-saun.png)

### 3. Raitis voittaja ignored drinks still owed: fixed

**Was:** `endgameEggs` compared `drinksTaken` only.
**Fix:** it now compares `drinksTaken + drinksOwed`. New engine test: a winner with 2 drunk and 3 owed is not sober against a rival who drank 4.

### 4. Client-only eggs were missing from the endgame card: fixed

**Was:** Nimetty huone, Et sä uskalla and Lakkikausi were kept only in the device's `localStorage`.
**Fix:** there is a new socket action `req_egg`, which becomes the engine action `CLAIM_EGG`.
- **Allowlist:** a client can claim only these three eggs. Anything else is rejected with `BAD_EGG`, so no client can award itself an egg the server judges.
- **Lakkikausi:** needs someone to actually hold a teekkarilakki, and is credited to that wearer rather than to whichever phone noticed.
- **Same path as server eggs:** claims are filed by the existing `recordEggs`. A repeat claim does nothing, and the feed line and toast come back as ordinary `EGG_FOUND` events.

The client no longer tracks "toast once per room" itself, because the server's dedupe already does that. New engine test: the allowlist, the cap wearer check and credit, and that a repeat claim does nothing.

Browser check: one KELA game with the clock set to January. The cap toast appeared on load. Five bails put "Et sä uskalla" in the feed. Winning then listed all four finds on the endgame card: Nimetty huone (claimed back in the lobby), Lakkikausi, Et sä uskalla and Raitis voittaja.

![Endgame card with client eggs](11-endgame-client-eggs.png)

The browser console showed no errors from the app. The only entries were two WebSocket refusals, logged while the test server was being restarted.
