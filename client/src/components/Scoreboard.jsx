import { T, TOKEN_LABEL } from '../lib/strings.js';

const GOAL = 300;

/**
 * Who is winning, and how close anyone is to walking out with the papers.
 * Doubles as the spectator view on a TV, so it has to read from across a room.
 */
export default function Scoreboard({ state, guildsById, activeId, boardById }) {
  const contenders = state.players.filter((p) => p.guildId && p.role !== 'SPECTATOR');
  const ranked = [...contenders].sort((a, b) => b.op - a.op);

  return (
    <section className="scoreboard">
      <header className="scoreboard__head">
        <h2>{T.standings}</h2>
        <span className="scoreboard__discs numeric">
          {state.tokensRemaining} <em>{T.discsLeft}</em>
        </span>
      </header>

      {/* The night's running total. It is the number everyone actually wants to
          know by the end, so it gets its own line rather than being buried in a
          team row. */}
      <p className="scoreboard__beers">
        <span className="scoreboard__beerCount numeric">{state.drinksTakenTotal ?? 0}</span>
        <em>{T.drunkTotal}</em>
      </p>

      <ol className="scoreboard__list">
        {ranked.map((p) => {
          const guild = guildsById[p.guildId];
          const pct = Math.min(100, (p.op / GOAL) * 100);
          const home = p.nodeId === p.homeCity;

          return (
            <li
              key={p.id}
              className={[
                'team',
                p.id === activeId ? 'team--active' : '',
                p.id === state.you ? 'team--you' : '',
                !p.connected ? 'team--gone' : '',
              ].join(' ')}
              style={{ '--team': guild?.color ?? 'var(--text-dim)' }}
            >
              <span className="team__dot" aria-hidden="true" />

              <span className="team__id">
                <strong>{guild?.name ?? p.name}</strong>
                <em>
                  {boardById?.get(p.nodeId)?.name || guild?.city || '-'}
                  {home && ` · ${T.atHome}`}
                  {!p.connected && ` · ${T.disconnected}`}
                  {p.dice === 6 && ' · d6'}
                </em>
              </span>

              <span className="team__meter" aria-hidden="true">
                <span className="team__fill" style={{ width: `${pct}%` }} />
              </span>

              <span className="team__op numeric">
                {p.op}
                <em>{T.credits}</em>
              </span>

              <span className="team__tallies">
                {/* grey: beers seen off. red: beers still owed. */}
                <span className="team__drunk numeric" title={T.drunkByTeam}>
                  {p.drinksTaken ?? 0}
                </span>
                {p.drinksOwed > 0 && (
                  <span className="team__drinks numeric" title={T.owed}>
                    {p.drinksOwed}
                  </span>
                )}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** Discs a team is holding, shown on the endgame card. */
export function Transcript({ player }) {
  if (!player?.tokens?.length) return null;
  return (
    <ul className="transcript">
      {player.tokens.map((t, i) => (
        <li key={i} className={`chip chip--${t.op >= 60 ? 'good' : 'dim'}`}>
          {TOKEN_LABEL[t.kind] ?? t.kind}
        </li>
      ))}
    </ul>
  );
}
