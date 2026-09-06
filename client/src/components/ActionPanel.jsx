import { T, beers, PHASE_LABEL, TOKEN_LABEL } from '../lib/strings.js';

/**
 * What this player can do, right now.
 *
 * The panel shows exactly one set of choices, driven by the server's phase.
 * Nothing here decides what is legal - it renders what the phase permits and
 * lets the server reject anything else.
 */
export default function ActionPanel({
  state, me, isMyTurn, guildsById, boardById, send,
}) {
  if (!me) return null;

  const phase = state.turnState?.phase;
  const owed = me.drinksOwed;

  // Drinks can arrive from another team's "Muut juo!" while you are nowhere
  // near your own turn, so this is always available.
  const drinkButton = owed > 0 && (
    <button className="btn btn--drink" onClick={() => send('req_drink_cleared', {})}>
      <span className="btn__lead numeric">{owed}</span>
      <span>
        <strong>{T.drinksDone}</strong>
        <em>{owed === 1 ? T.drinksOwedOne : T.drinksOwedMany}</em>
      </span>
    </button>
  );

  // Everyone owes drinks and the turn is up for grabs: first one done takes it.
  if (phase === 'AWAITING_DRINKS') {
    return (
      <div className="panel panel--open">
        <p className="panel__phase">
          <span className="panel__you">{T.turnOpen}</span>
        </p>
        <p className="panel__hint">{T.turnOpenHint}</p>
        {drinkButton}
      </div>
    );
  }

  if (!isMyTurn) {
    const active = state.players.find((p) => p.id === state.turnOrder[state.turnState?.activeIndex]);
    return (
      <div className="panel">
        <p className="panel__idle">
          {T.waitingFor}: <strong>{guildName(guildsById, active)}</strong>
        </p>
        {drinkButton}
      </div>
    );
  }

  return (
    <div className="panel panel--mine">
      <p className="panel__phase">
        <span className="panel__you">{T.yourTurn}</span>
        <span className="panel__phaseName">{PHASE_LABEL[phase] ?? phase}</span>
      </p>

      {phase === 'ROLLING' && (
        <RollingActions
          state={state} me={me} boardById={boardById} send={send}
        />
      )}

      {phase === 'MOVING' && (
        <p className="panel__hint">
          {T.rolled} <strong className="numeric">{state.turnState.roll}</strong>.{' '}
          {T.chooseSquare}. <em>{T.canMoveLess}</em>
        </p>
      )}

      {phase === 'BORDER_ROLL' && (
        <>
          <p className="panel__hint">{T.guardNote}</p>
          <button className="btn btn--primary" onClick={() => send('req_border_roll', {})}>
            {T.faceTheGuard}
          </button>
        </>
      )}

      {phase === 'RESOLUTION' && (
        <Resolution
          pending={state.turnState.pending?.[0]}
          players={state.players}
          guildsById={guildsById}
          boardById={boardById}
          send={send}
        />
      )}

      {drinkButton}
    </div>
  );
}

function RollingActions({ state, me, boardById, send }) {
  const here = boardById?.get(me.nodeId);
  const disc = state.board.tokens[me.nodeId];
  const canOpen = disc?.status === 'HIDDEN';
  const flights = (here?.edges ?? []).filter((e) => e.type === 'flight');

  return (
    <>
      <button className="btn btn--primary btn--roll" onClick={() => send('req_roll', {})}>
        {T.roll}
        <em>d{me.dice}</em>
      </button>

      {canOpen && (
        <button className="btn" onClick={() => send('req_open_token', {})}>
          {T.openDiscHere}
          <em>{T.openDiscHereCost}</em>
        </button>
      )}

      {flights.map((f) => (
        <button
          key={f.target}
          className="btn btn--warn"
          onClick={() => send('req_use_flight', { targetId: f.target })}
        >
          {T.fly}: {boardById?.get(f.target)?.name ?? f.target}
          <em>{T.flyCost}</em>
        </button>
      ))}
    </>
  );
}

function Resolution({ pending, players, guildsById, boardById, send }) {
  if (!pending) return null;

  if (pending.kind === 'TOKEN') {
    return (
      <>
        <p className="panel__hint">
          {T.discFound}: <strong>{boardById?.get(pending.cityId)?.name ?? pending.cityId}</strong>
        </p>
        <button
          className="btn btn--primary"
          onClick={() => send('req_resolution_action', { choice: { action: 'OPEN_NOW' } })}
        >
          {T.openNow}
          <em>{T.openNowCost}</em>
        </button>
        <button
          className="btn"
          onClick={() => send('req_resolution_action', { choice: { action: 'WAIT' } })}
        >
          {T.waitToOpen}
          <em>{T.waitToOpenCost}</em>
        </button>
      </>
    );
  }

  return (
    <>
      <p className="panel__hint">{T.landedOn}</p>
      {pending.targets.map((id) => {
        const victim = players.find((p) => p.id === id);
        return (
          <button
            key={id}
            className="btn btn--warn"
            onClick={() => send('req_resolution_action', {
              choice: { action: 'ASSIGN', targetId: id },
            })}
          >
            {T.assignDrink}: {guildName(guildsById, victim)}
            <em>{beers(1)}</em>
          </button>
        );
      })}
      <button
        className="btn btn--quiet"
        onClick={() => send('req_resolution_action', { choice: { action: 'SKIP' } })}
      >
        {T.skip}
      </button>
    </>
  );
}

export function guildName(guildsById, player) {
  if (!player) return '-';
  return guildsById[player.guildId]?.name ?? player.name;
}

export { TOKEN_LABEL };
