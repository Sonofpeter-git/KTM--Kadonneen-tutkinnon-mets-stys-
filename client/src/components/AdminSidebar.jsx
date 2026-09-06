import { T } from '../lib/strings.js';
import { guildName } from './ActionPanel.jsx';

/**
 * The Game Leader's override panel.
 *
 * Physical games go wrong: a pawn gets knocked over, someone forgets to drink,
 * a rule gets house-ruled at 2am. Rather than pretend that never happens, the
 * host gets a way to correct the state without restarting the party.
 */
export default function AdminSidebar({ state, guildsById, send, onClose }) {
  const contenders = state.players.filter((p) => p.guildId && p.role !== 'SPECTATOR');

  const adjust = (op, playerId, delta) =>
    send('req_leader_override', { op, args: { playerId, delta } });

  const shuffle = () => {
    const order = [...state.turnOrder];
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    send('req_leader_override', { op: 'SET_TURN_ORDER', args: { turnOrder: order } });
  };

  return (
    <aside className="admin">
      <header className="admin__head">
        <h2>{T.admin}</h2>
        <button className="admin__close" onClick={onClose} aria-label="Sulje">✕</button>
      </header>

      <p className="admin__note">{T.adminNote}</p>

      <ul className="admin__teams">
        {contenders.map((p) => (
          <li key={p.id} style={{ '--team': guildsById[p.guildId]?.color }}>
            <span className="admin__team">{guildName(guildsById, p)}</span>

            <span className="admin__row">
              <em>{T.adjustOp}</em>
              <button onClick={() => adjust('ADJUST_OP', p.id, -20)}>−20</button>
              <strong className="numeric">{p.op}</strong>
              <button onClick={() => adjust('ADJUST_OP', p.id, 20)}>+20</button>
            </span>

            <span className="admin__row">
              <em>{T.adjustDrinks}</em>
              <button onClick={() => adjust('ADJUST_DRINKS', p.id, -1)}>−1</button>
              <strong className="numeric">{p.drinksOwed}</strong>
              <button onClick={() => adjust('ADJUST_DRINKS', p.id, 1)}>+1</button>
            </span>
          </li>
        ))}
      </ul>

      <div className="admin__actions">
        <button className="btn btn--quiet" onClick={() => send('req_leader_override', { op: 'SKIP_TURN' })}>
          {T.skipTurn}
        </button>
        <button className="btn btn--quiet" onClick={shuffle}>
          {T.shuffleOrder}
        </button>
      </div>

      <ol className="admin__order">
        {state.turnOrder.map((id) => (
          <li key={id}>{guildName(guildsById, state.players.find((p) => p.id === id))}</li>
        ))}
      </ol>
    </aside>
  );
}
