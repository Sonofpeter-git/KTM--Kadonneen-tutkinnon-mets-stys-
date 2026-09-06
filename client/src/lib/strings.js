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
  leader: 'Pelinjohtaja',
  hostOnly: 'Pelinjohtaja ei osallistu kiltana - sinä tuomaroit.',
  hosting: 'Johdat peliä. Seuraa tilannetta ja korjaa tarvittaessa.',
  changeRoom: 'Vaihda huone',
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
  drinksOwedOne: 'olut juomatta',
  drinksOwedMany: 'olutta juomatta',
  chooseSquare: 'Valitse ruutu johon liikut',
  canMoveLess: 'Saat liikkua vähemmän kuin noppa näyttää.',
  travelBeer: 'Matkaolut',
  fly: 'Lennä',
  flyCost: '3 olutta',
  openDiscHere: 'Käännä kiekko',
  openDiscHereCost: '1 olut ja koko vuoro',
  faceTheGuard: 'Heitä rajavartijasta',
  guardNote: 'Kuutosella pääset läpi ja saat vielä liikkua.',
  guardPassed: 'Rajavartija ei ole paikalla!',
  guardBlocked: 'Rajavartija pysäytti. Yksi olut.',

  // resolution
  discFound: 'Kiekko tässä kaupungissa',
  openNow: 'Käännä heti',
  openNowCost: '2 olutta',
  waitToOpen: 'Odota ensi vuoroon',
  waitToOpenCost: '1 olut, mutta menetät liikkumisvuoron',
  landedOn: 'Törmäsit toiseen joukkueeseen',
  assignDrink: 'Määrää olut',
  skip: 'Ohita',

  // scoreboard
  standings: 'Tilanne',
  credits: 'op',
  drinks: 'olutta',
  toGraduate: 'valmistumiseen',
  discsLeft: 'kiekkoa kääntämättä',
  drunkTotal: 'olutta juotu yhteensä',
  drunkByTeam: 'juotu',
  owed: 'juomatta',
  home: 'Kotikaupunki',
  atHome: 'kotona',
  disconnected: 'poissa',

  // endgame
  winner: 'Valmistui',
  finalStandings: 'Loppusijoitukset',
  place: 'sija',

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

/** "3 olutta" / "1 olut" */
export const beers = (n) => `${n} ${n === 1 ? 'olut' : 'olutta'}`;

/** Human-readable one-liners for the event feed. */
export function describeEvent(event, nameOf) {
  const who = nameOf(event.playerId);

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
    case 'TRAVEL_BEER': return `${who} juo matkaoluen`;
    case 'MOVED': return `${who} liikkui ${event.steps} ruutua`;
    case 'WATER_ROUTE': return `${who} maksoi vesireitistä ${beers(event.drinks)}`;
    case 'CRUISE': return `${who} joutui teekkariristeilylle: ${beers(event.drinks)}`;
    case 'FLEW': return `${who} lensi (${beers(event.drinks)})`;
    case 'BORDER_ROLLED': return `${who} heitti rajavartijasta ${event.value}`;
    case 'BORDER_PASSED': return `${who} pääsi rajan yli`;
    case 'BORDER_BLOCKED': return `${who} jäi rajalle ja juo oluen`;
    case 'TOKEN_REVEALED': return `${who} käänsi kiekon: ${TOKEN_LABEL[event.kind] ?? event.kind}`;
    case 'TOKEN_OP': return `${who} sai ${event.op} op`;
    case 'TOKEN_LAKKI': return `${who} sai teekkarilakin - jatkossa d6`;
    case 'TOKEN_UUDISTUS_REDRINK':
      return `${who} suorittaa ${event.op} op -kurssin uudelleen: ${beers(event.drinks)}`;
    case 'TOKEN_UUDISTUS_LOST': return `${who} menetti ${event.op} op`;
    case 'TOKEN_UUDISTUS_NOOP': return `${who} ei ole vielä suorittanut mitään`;
    case 'TOKEN_MUUT_JUO': return `${who}: muut juo! (${event.affected.length})`;
    case 'TOKEN_DEFERRED': return `${who} jätti kiekon kääntämättä`;
    case 'PVP_ASSIGNED': return `${who} määräsi oluen: ${nameOf(event.targetId)}`;
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
