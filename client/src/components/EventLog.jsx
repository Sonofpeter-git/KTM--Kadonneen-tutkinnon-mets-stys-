import { T, describeEvent } from '../lib/strings.js';
import { guildName } from './ActionPanel.jsx';

/** Running commentary. Nobody reads all of it; everybody reads the last line. */
export default function EventLog({ feed, state, guildsById }) {
  const nameOf = (id) => {
    if (!id) return '-';
    const player = state?.players?.find((p) => p.id === id);
    return player ? guildName(guildsById, player) : '-';
  };

  const lines = feed
    .map((event, i) => ({ key: i, text: describeEvent(event, nameOf), type: event.type }))
    .filter((line) => line.text)
    .slice(-25)
    .reverse();

  return (
    <section className="log">
      <h2>{T.log}</h2>
      {lines.length === 0 ? (
        <p className="log__empty">{T.noEvents}</p>
      ) : (
        <ol className="log__list">
          {lines.map((line) => (
            <li key={line.key} className={`log__line log__line--${tone(line.type)}`}>
              {line.text}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function tone(type) {
  if (type.startsWith('GRADUATED') || type === 'TOKEN_OP' || type === 'TOKEN_LAKKI') return 'good';
  if (
    type === 'TRAVEL_BEER' || type === 'CRUISE' || type === 'BORDER_BLOCKED' ||
    type === 'PVP_ASSIGNED' || type === 'TOKEN_MUUT_JUO' || type === 'WATER_ROUTE' ||
    type === 'TOKEN_UUDISTUS_REDRINK' || type === 'TOKEN_UUDISTUS_LOST'
  ) return 'bad';
  return 'plain';
}
