/**
 * The easter eggs, and how loudly each one announces itself.
 *
 * One row per egg, the same way audio/cues.js holds one row per sound: adding
 * an egg is a line here plus whatever triggers it. Nothing else in the app
 * hard-codes an egg id.
 *
 * `loud` is the whole anti-miss design. A find that only scrolled past in the
 * event feed may as well not have happened - the feed is a capped window and
 * everybody is looking at a drink - so the rarer the egg, the harder it is to
 * look away from:
 *
 *   'ambient'  the egg IS a visible state that lasts the whole game, so there
 *              is nothing to miss and nothing to announce.
 *   'toast'    a Toast, which is the only thing in this app that waits to be
 *              acknowledged instead of timing out.
 *   'flash'    the full-screen overlay, held six seconds rather than the usual
 *              two, plus a sound.
 *   'endgame'  judged only once the game is over, so it lands on the Finished
 *              card, which is already what everyone is reading.
 *
 * Every tier is also listed on the Finished card afterwards, so a find is
 * recoverable even if the moment itself went past unseen.
 */

export const TIERS = {
  fuksi: 'Fuksi',
  kandi: 'Kandi',
  maisteri: 'Maisteri',
  tohtori: 'Tohtori',
  ikuinen: 'Ikuinen opiskelija',
};

export const EGGS = {
  huonekoodi: {
    tier: 'fuksi',
    loud: 'ambient',
    title: 'Nimetty huone',
    blurb: 'Huonekoodilla oli sittenkin väliä.',
  },
  et_uskalla: {
    tier: 'fuksi',
    loud: 'ambient',
    title: 'Et sä uskalla',
    blurb: 'Viisi kertaa peruutettu. Nappi huomasi.',
  },
  lakkikausi: {
    tier: 'kandi',
    // Worn on the pawn all game, but a pawn is a rem across - so it toasts too.
    loud: 'toast',
    title: 'Lakkikausi',
    blurb: 'Lakkia pidetään vapusta syyskuun loppuun. Sinä pidit sitä muulloin.',
  },
  rajavartija: {
    tier: 'kandi',
    loud: 'toast',
    title: 'Rajavartija muistaa sinut',
    blurb: 'Neljä epäonnistunutta heittoa. Hän tuntee sinut jo nimeltä.',
  },
  kaikki_paalle: {
    tier: 'maisteri',
    loud: 'toast',
    title: 'Kaikki kaatuu päälle',
    blurb: 'Seitsemän juomaa kahden oman vuoron välissä. Noppa ei pidä teistä.',
  },
  tasan_300: {
    tier: 'maisteri',
    loud: 'flash',
    title: 'Tasan 300',
    blurb: 'Ei yhtään enempää kuin oli pakko.',
  },
  kolmoisosuma: {
    tier: 'tohtori',
    loud: 'flash',
    title: 'Kolmoisosuma',
    blurb: 'Kolme kiekkoa, kolme kahdeksankymppiä, yksi kilta. Tämä tutkitaan.',
  },
  raitis_voittaja: {
    tier: 'tohtori',
    loud: 'endgame',
    title: 'Raitis voittaja',
    blurb: 'Voitit ja joit vähiten. Tarkastamme kiekot.',
  },
  yksi_vajaa: {
    tier: 'ikuinen',
    loud: 'endgame',
    title: 'Yksi kiekko vajaa',
    blurb: '280 opintopistettä. Yksi kiekko. Yksi.',
  },
};

export const EGG_IDS = Object.keys(EGGS);

/**
 * Teekkarilakki season: from Wappu (1 May) to the end of September. Months are
 * zero-based, so May is 4 and September is 8.
 */
export const isCapSeason = (date = new Date()) => date.getMonth() >= 4 && date.getMonth() <= 8;

export const hasCap = (player) => !!player?.tokens?.some((t) => t.kind === 'teekkarilakki');

export const eggTier = (id) => TIERS[EGGS[id]?.tier] ?? '';

/* ------------------------------------------------------------ the collection */

const KEY = 'ktm:eggs';

// Same try/catch as socket.js and audio/player.js: localStorage throws outright
// in private mode, and a lost collection is never worth breaking the game over.
const read = () => {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((id) => EGGS[id]) : [];
  } catch {
    return [];
  }
};

const write = (ids) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(ids));
  } catch { /* not fatal */ }
};

/** Everything this device has ever found, oldest first. */
export const foundEggs = () => read();

/** Records a find. Returns true the first time, so callers can react to it. */
export function rememberEgg(id) {
  if (!EGGS[id]) return false;
  const found = read();
  if (found.includes(id)) return false;
  found.push(id);
  write(found);
  return true;
}

/** Tests only - a real device keeps its collection. */
export function __resetEggs() {
  try {
    localStorage.removeItem(KEY);
  } catch { /* not fatal */ }
}
