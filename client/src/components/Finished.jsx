import { T } from '../lib/strings.js';
import { Transcript } from './Scoreboard.jsx';
import { guildName } from './ActionPanel.jsx';

/** The final card. First place is the graduate; everyone else is ranked on OP. */
export default function Finished({ state, guildsById }) {
  const winner = state.players.find((p) => p.id === state.winnerId);

  return (
    <div className="finished">
      <p className="finished__kicker">{T.winner}</p>
      <h1 className="finished__winner" style={{ '--team': guildsById[winner?.guildId]?.color }}>
        {guildName(guildsById, winner)}
      </h1>
      <p className="finished__op numeric">{winner?.op} {T.credits}</p>

      <p className="finished__beers">
        <span className="numeric">{state.drinksTakenTotal ?? 0}</span> {T.drunkTotal}
      </p>

      <h2 className="finished__heading">{T.finalStandings}</h2>
      <ol className="finished__list">
        {state.standings.map((s) => {
          const player = state.players.find((p) => p.id === s.playerId);
          return (
            <li key={s.playerId} style={{ '--team': guildsById[s.guildId]?.color }}>
              <span className="finished__place numeric">{s.place}.</span>
              <span className="finished__team">
                <strong>{guildName(guildsById, player)}</strong>
                <Transcript player={player} />
              </span>
              <span className="finished__score numeric">
                {s.op}
                <em>{player?.drinksTaken ?? 0} {T.drinks}</em>
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
