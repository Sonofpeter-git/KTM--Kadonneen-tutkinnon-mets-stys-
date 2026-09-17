/**
 * Every player-facing string, in one file.
 *
 * The UI is in Finnish because the game is: opintopiste, kilta, Teekkarilakki
 * and Tutkintouudistus have no useful English forms, and half-translating them
 * reads worse than not translating at all. Swapping the whole interface to
 * English is a single-file change.
 */

export const TOKEN_LABEL = {
  op40: '40 op',
  op60: '60 op',
  op80: '80 op',
  teekkarilakki: 'Teekkarilakki',
  tutkintouudistus: 'Tutkintouudistus',
  muut_juo: 'Muut juo!',
};

/** Which accent a disc gets on the board and in the log. */
export const TOKEN_TONE = {
  op40: 'dim',
  op60: 'good',
  op80: 'good',
  teekkarilakki: 'primary',
  tutkintouudistus: 'bad',
  muut_juo: 'bad',
};

export const PHASE_LABEL = {
  AWAITING_DRINKS: 'Kaikki juovat',
  ROLLING: 'Heittovuoro',
  MOVING: 'Valitse ruutu',
  RESOLUTION: 'Ratkaise',
  BORDER_ROLL: 'Rajavartija',
  FINISHED: 'Peli päättyi',
};

/**
 * The drinking unit, and every word that moves with it.
 *
 * The bus/light game is this same game in a smaller unit - a sip where the
 * full game drinks a beer. No rule changes: every cost the engine knows about
 * is a plain count, so the whole difference in the game is this table.
 *
 * Finnish needs more than a singular and a plural. `hörppy` drops a p in the
 * genitive (hörpyn) and again in the plural (hörpyt), which no amount of
 * concatenating suffixes would get right, so each form is spelled out.
 */
export const UNITS = {
  beer: {
    one: 'olut', many: 'olutta', gen: 'oluen', plural: 'oluet',
    travelGen: 'matkaoluen',
    // The cruise pours spirits in the full game; the light game flattens it.
    cruise: 'shottia',
  },
  sip: {
    one: 'hörppy', many: 'hörppyä', gen: 'hörpyn', plural: 'hörpyt',
    travelGen: 'matkahörpyn',
    cruise: 'hörppyä',
  },
};

const unitOf = (unit) => UNITS[unit] ?? UNITS.beer;

/** Rules drawer content, condensed from README.md and server/src/game/tokens.js. */
export function rules(unit) {
  const u = unitOf(unit);
  return [
    { title: 'Liikkuminen', body: 'd4, tai d6 kun killalla on Teekkarilakki.' },
    { title: `Matka${u.one}`, body: `Heitto 4 tai enemmän maksaa yhden ${u.travelGen}, vaikka lopulta liikkuisi vähemmän.` },
    { title: 'Lyhyempi siirto', body: 'Minkä tahansa reitin varrella olevan ruudun voi valita pysähdyspaikaksi.' },
    { title: 'Ei peruuttamista', body: 'Reitti ei saa käyttää ruutua, jonka jo ylitti tällä vuorolla.' },
    { title: 'Lautta', body: `1 ${u.one} per merenylitys, ei per vesiruutu.` },
    { title: 'Lento', body: `Pietari ↔ Ivalo, 3 ${u.many}, vie koko vuoron.` },
    { title: 'Teekkariristeily', body: `Risteilyruutuun pysähtyminen maksaa 3 ${u.cruise}.` },
    { title: 'Rajavartija', body: `Haaparannassa on pysähdyttävä. Seuraavalla vuorolla heitetään d6 - kuutosella pääsee läpi ja saa vielä liikkua, muuten yksi ${u.one} ja vuoro päättyy.` },
    { title: 'Toiseen joukkueeseen törmääminen', body: `Voi määrätä heille yhden ${u.gen} tai armahtaa.` },
    { title: 'Kiekon kääntäminen', body: `2 ${u.many} heti, tai 1 ${u.one} ja koko seuraava vuoro odotusta.` },
    { title: 'Juomat ja vuoro', body: 'Juomavelkainen joukkue ohitetaan, ei odoteta - vuoro siirtyy seuraavalle. Jos kaikki ovat velkaa, vuoro on auki ja ensimmäisenä juonut saa sen.' },
    { title: 'Tutkintouudistus', body: `Suurin kurssi suoritetaan uudelleen - opintopisteet säilyvät, mutta sen ${u.plural} juodaan uudelleen.` },
    { title: 'Voitto', body: 'Ensimmäinen kotiin päässyt joukkue, jolla on vähintään 300 op. Muut sijat ratkeavat sen hetken opintopisteillä.' },
    { title: 'Jos kaikki kiekot käännetty ennen kuin kukaan valmistuu', body: 'Ensimmäinen kotiin päässyt saa +80 op ja voittaa.' },
  ];
}

export const T = {
  appName: 'Kadonneen tutkinnon metsästys',
  appShort: 'KTM',

  // lobby
  roomCode: 'Huonekoodi',
  yourName: 'Nimesi',
  join: 'Liity peliin',
  lobby: 'Aula',
  pickGuild: 'Valitse kilta',
  taken: 'Varattu',
  waitingForLeader: 'Odotetaan että pelinjohtaja aloittaa pelin',
  startGame: 'Aloita peli',
  needTwoGuilds: 'Vähintään kaksi kiltaa on valittava',
  randomize: 'Arvo vapaat killat',
  openCostMode: 'Kiekkojen hinta',
  openCostModeFull: 'Täysi (2 / 1)',
  openCostModeHalf: 'Puolikas (1 / 0)',
  drinkUnit: 'Juomayksikkö',
  drinkUnitBeer: 'Olut',
  drinkUnitSip: 'Hörppy (bussiversio)',
  drinkUnitHint: 'Sama peli pienemmällä yksiköllä - säännöt eivät muutu.',
  leader: 'Pelinjohtaja',
  hostOnly: 'Pelinjohtaja ei osallistu kiltana - sinä tuomaroit.',
  hosting: 'Johdat peliä. Seuraa tilannetta ja korjaa tarvittaessa.',
  changeRoom: 'Vaihda huone',
  leaveRoom: 'Poistu huoneesta',
  restoring: 'Palataan peliin…',
  spectator: 'Katsoja',
  spectating: 'Katsot peliä',
  founded: 'Perustettu',
  turnOrderNote: 'Nuorin kilta aloittaa. Samana vuonna perustettujen järjestys arvotaan.',

  // turn
  yourTurn: 'Sinun vuorosi',
  waitingFor: 'Vuorossa',
  roll: 'Heitä noppaa',
  rolled: 'Heitit',
  turnOpen: 'Vuoro on auki',
  turnOpenHint: 'Kaikilla on juomia kesken. Ensimmäisenä juomansa juonut saa vuoron.',
  drinkToClaim: 'Juo ja ota vuoro',
  drinksDone: 'Juotu!',
  holdToConfirm: 'pidä 1s',
  chooseSquare: 'Valitse ruutu johon liikut',
  canMoveLess: 'Saat liikkua vähemmän kuin noppa näyttää.',
  fly: 'Lennä',
  openDiscHere: 'Käännä kiekko',
  faceTheGuard: 'Heitä rajavartijasta',
  guardNote: 'Kuutosella pääset läpi ja saat vielä liikkua.',
  guardPassed: 'Rajavartija ei ole paikalla!',

  // resolution
  discFound: 'Kiekko tässä kaupungissa',
  openNow: 'Käännä heti',
  waitToOpen: 'Odota ensi vuoroon',
  landedOn: 'Törmäsit toiseen joukkueeseen',
  skip: 'Ohita',

  // scoreboard
  standings: 'Tilanne',
  credits: 'op',
  toGraduate: 'valmistumiseen',
  discsLeft: 'kiekkoa kääntämättä',
  drunkByTeam: 'juotu',
  owed: 'juomatta',
  home: 'Kotikaupunki',
  atHome: 'kotona',
  disconnected: 'poissa',

  // endgame
  winner: 'Valmistui',
  finalStandings: 'Loppusijoitukset',
  place: 'sija',

  // flash overlays
  kandiReached: 'Kandi suoritettu!',

  // topbar
  menu: 'Valikko',
  sound: 'Äänet',
  soundOn: 'Äänet päällä',
  soundOff: 'Äänet pois',

  // rules
  rules: 'Säännöt',

  // admin
  admin: 'Pelinjohto',
  adminNote: 'Korjaa tilanne käsin jos peli menee solmuun.',
  adjustOp: 'Opintopisteet',
  adjustDrinks: 'Oluet',
  skipTurn: 'Ohita vuoro',
  turnOrder: 'Heittojärjestys',
  shuffleOrder: 'Sekoita järjestys',

  // log
  log: 'Tapahtumat',
  noEvents: 'Ei vielä tapahtumia.',

  // connection
  connecting: 'Yhdistetään…',
  reconnecting: 'Yhteys katkesi, yritetään uudelleen…',
  offline: 'Ei yhteyttä palvelimeen',
};

/** "3 olutta" / "1 olut", in whichever unit the room is playing. */
export const drinkCount = (n, unit) =>
  `${n} ${n === 1 ? unitOf(unit).one : unitOf(unit).many}`;

/**
 * The labels that name the unit. Everything left in `T` reads the same either
 * way - "Juotu!" and "juomatta" are about drinking, not about what was drunk.
 */
export function unitLabels(unit) {
  const u = unitOf(unit);
  return {
    drinksOwedOne: `${u.one} juomatta`,
    drinksOwedMany: `${u.many} juomatta`,
    drinks: u.many,
    drunkTotal: `${u.many} juotu yhteensä`,
    flyCost: `3 ${u.many}`,
    assignDrink: `Määrää ${u.one}`,
  };
}

/** Mirrors server/src/game/tokens.js's OPEN_COST_MODES. */
const OPEN_COSTS = {
  full: { now: 2, later: 1 },
  half: { now: 1, later: 0 },
};

export const openNowCostLabel = (costMode, unit) =>
  drinkCount((OPEN_COSTS[costMode] ?? OPEN_COSTS.full).now, unit);

export const waitToOpenCostLabel = (costMode, unit) => {
  const n = (OPEN_COSTS[costMode] ?? OPEN_COSTS.full).later;
  return n === 0
    ? 'Ilmaiseksi, mutta menetät liikkumisvuoron'
    : `${drinkCount(n, unit)}, mutta menetät liikkumisvuoron`;
};

export const openDiscHereCostLabel = (costMode, unit) => {
  const n = (OPEN_COSTS[costMode] ?? OPEN_COSTS.full).later;
  return n === 0 ? 'Koko vuoro, ei juomia' : `${drinkCount(n, unit)} ja koko vuoro`;
};

/** Human-readable one-liners for the event feed. */
export function describeEvent(event, nameOf, unit) {
  const who = nameOf(event.playerId);
  const u = unitOf(unit);
  const beers = (n) => drinkCount(n, unit);

  switch (event.type) {
    case 'PLAYER_JOINED': return `${who} liittyi peliin`;
    case 'PLAYER_DISCONNECTED': return `${who} katosi`;
    case 'PLAYER_RECONNECTED': return `${who} palasi`;
    case 'GUILD_SELECTED': return `${who} valitsi killan`;
    case 'GAME_STARTED': return 'Peli alkoi';
    case 'TURN_BEGAN': return `${who} on vuorossa`;
    case 'TURN_SKIPPED': return `${who} ohitettiin - ${beers(event.drinksOwed)} juomatta`;
    case 'TURN_OPEN': return 'Kaikilla juomia kesken - vuoro on auki';
    case 'TURN_CLAIMED': return `${who} joi ensimmäisenä ja sai vuoron`;
    case 'DRINKS_CLEARED':
      return `${who} joi ${beers(event.cleared)}` +
        (event.total ? ` (yhteensä ${event.total})` : '');
    case 'ROLLED': return `${who} heitti ${event.value} (d${event.dice})`;
    case 'TRAVEL_BEER': return `${who} juo ${u.travelGen}`;
    case 'MOVED': return `${who} liikkui ${event.steps} ruutua`;
    case 'WATER_ROUTE': return `${who} maksoi vesireitistä ${beers(event.drinks)}`;
    case 'CRUISE': return `${who} joutui teekkariristeilylle: ${beers(event.drinks)}`;
    case 'FLEW': return `${who} lensi (${beers(event.drinks)})`;
    case 'BORDER_ROLLED': return `${who} heitti rajavartijasta ${event.value}`;
    case 'BORDER_PASSED': return `${who} pääsi rajan yli`;
    case 'BORDER_BLOCKED': return `${who} jäi rajalle ja juo ${u.gen}`;
    case 'TOKEN_REVEALED': return `${who} käänsi kiekon: ${TOKEN_LABEL[event.kind] ?? event.kind}`;
    case 'TOKEN_OP': return `${who} sai ${event.op} op`;
    case 'TOKEN_LAKKI': return `${who} sai teekkarilakin - jatkossa d6`;
    case 'TOKEN_UUDISTUS_REDRINK':
      return `${who} suorittaa ${event.op} op -kurssin uudelleen: ${beers(event.drinks)}`;
    case 'TOKEN_UUDISTUS_LOST': return `${who} menetti ${event.op} op`;
    case 'TOKEN_UUDISTUS_NOOP': return `${who} ei ole vielä suorittanut mitään`;
    case 'KANDI_REACHED': return `${who} on suorittanut Kandin!`;
    case 'TOKEN_MUUT_JUO': return `${who}: muut juo! (${event.affected.length})`;
    case 'TOKEN_DEFERRED': return `${who} jätti kiekon kääntämättä`;
    case 'PVP_ASSIGNED': return `${who} määräsi ${u.gen}: ${nameOf(event.targetId)}`;
    case 'PVP_SKIPPED': return `${who} armahti`;
    case 'GRADUATED': return `${who} valmistui ${event.op} opintopisteellä!`;
    case 'GRADUATED_EXHAUSTED': return `${who} ehti ensimmäisenä kotiin (+80 op)`;
    case 'GAME_FINISHED': return 'Peli päättyi';
    case 'OVERRIDE_OP': return `Pelinjohto muutti: ${nameOf(event.targetId)} ${event.op} op`;
    case 'OVERRIDE_DRINKS':
      return `Pelinjohto muutti: ${nameOf(event.targetId)} ${beers(event.drinksOwed)}`;
    case 'OVERRIDE_SKIP': return `Pelinjohto ohitti vuoron: ${nameOf(event.skippedId)}`;
    case 'OVERRIDE_TURN_ORDER': return 'Pelinjohto muutti heittojärjestystä';
    case 'OVERRIDE_GUILDS_RANDOMIZED': return 'Killat arvottiin';
    case 'OVERRIDE_COST_MODE':
      return `Pelinjohto asetti kiekkojen hinnan: ${event.mode === 'half' ? 'puolikas' : 'täysi'}`;
    case 'OVERRIDE_DRINK_UNIT':
      return `Pelinjohto asetti juomayksiköksi: ${unitOf(event.unit).one}`;
    default: return null;   // anything unlabelled stays out of the feed
  }
}

export const ERROR_MESSAGE = {
  BAD_ROOM: 'Huonekoodi on 4-8 merkkiä.',
  NOT_JOINED: 'Liity ensin huoneeseen.',
  NO_ROOM: 'Huonetta ei löydy.',
  GUILD_TAKEN: 'Kilta on jo varattu.',
  UNKNOWN_GUILD: 'Tuntematon kilta.',
  NOT_LEADER: 'Vain pelinjohtaja voi tehdä tämän.',
  NOT_ENOUGH_PLAYERS: 'Vähintään kaksi kiltaa on valittava.',
  NOT_YOUR_TURN: 'Ei ole sinun vuorosi.',
  WRONG_PHASE: 'Tämä ei onnistu juuri nyt.',
  WRONG_STATUS: 'Tämä ei onnistu juuri nyt.',
  ILLEGAL_MOVE: 'Tuohon ruutuun ei pääse tällä heitolla.',
  NO_TOKEN: 'Tässä ruudussa ei ole kääntämätöntä kiekkoa.',
  NO_FLIGHT: 'Täältä ei lähde lentoa.',
  BAD_TARGET: 'Tuo joukkue ei ole tässä ruudussa.',
  BAD_CHOICE: 'Valitse jokin vaihtoehdoista.',
  LEADER_DOES_NOT_PLAY: 'Pelinjohtaja ei osallistu kiltana.',
  INTERNAL: 'Palvelimella tapahtui virhe.',
};
