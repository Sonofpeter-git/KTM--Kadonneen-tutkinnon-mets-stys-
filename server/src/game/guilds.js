/**
 * Guild roster and the rulebook's turn-order rule.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { shuffle } from './rng.js';

const DATA = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'guilds.json');

export function loadGuilds(path = DATA) {
  return JSON.parse(readFileSync(path, 'utf8')).guilds;
}

export function guildIndex(guilds) {
  return new Map(guilds.map((g, order) => [g.id, { ...g, order }]));
}

/**
 * Rulebook step 0: the youngest participating guild starts, by founding date.
 *
 * Two wrinkles the data forces on us:
 *  - Guilds founded in the same year (Digit and DaTe are both 1999) are ordered
 *    by a coin flip, which falls out of shuffling each year group.
 *  - Guilds whose founding year nobody has filled in yet sort last, in roster
 *    order, rather than being silently treated as founded in year zero. The
 *    Game Leader can override the whole order from the admin panel.
 */
export function computeTurnOrder(holder, players, guilds) {
  const index = guildIndex(guilds);
  const dated = new Map();
  const undated = [];

  for (const player of players) {
    const guild = index.get(player.guildId);
    if (guild && Number.isInteger(guild.foundedYear)) {
      if (!dated.has(guild.foundedYear)) dated.set(guild.foundedYear, []);
      dated.get(guild.foundedYear).push(player);
    } else {
      undated.push({ player, order: guild?.order ?? Number.MAX_SAFE_INTEGER });
    }
  }

  const ordered = [];
  for (const year of [...dated.keys()].sort((a, b) => b - a)) {
    const group = dated.get(year);
    ordered.push(...(group.length > 1 ? shuffle(holder, group) : group));
  }

  undated.sort((a, b) => a.order - b.order);
  ordered.push(...undated.map((u) => u.player));

  return ordered.map((p) => p.id);
}
