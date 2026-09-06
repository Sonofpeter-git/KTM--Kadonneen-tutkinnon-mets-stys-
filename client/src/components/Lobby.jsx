import { useState } from 'react';
import { T } from '../lib/strings.js';
import { rememberedName, rememberedRoom } from '../net/socket.js';

/** Room code and name, before anything else exists. */
export function JoinForm({ onJoin, busy }) {
  const [room, setRoom] = useState(rememberedRoom());
  const [name, setName] = useState(rememberedName());

  const code = room.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
  const ready = code.length >= 4 && name.trim().length > 0;

  return (
    <form
      className="join"
      onSubmit={(e) => {
        e.preventDefault();
        if (ready) onJoin(code, name.trim());
      }}
    >
      <h1 className="join__title">{T.appName}</h1>

      <label className="field">
        <span>{T.roomCode}</span>
        <input
          className="field__input field__input--code numeric"
          value={room}
          onChange={(e) => setRoom(e.target.value)}
          placeholder="TITE"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck="false"
          maxLength={8}
        />
      </label>

      <label className="field">
        <span>{T.yourName}</span>
        <input
          className="field__input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Matti"
          maxLength={24}
        />
      </label>

      <button className="btn btn--primary" type="submit" disabled={!ready || busy}>
        {T.join}
      </button>
    </form>
  );
}

/** Guild selection, and the leader's start button. */
export default function Lobby({ state, guilds, me, isLeader, send, onLeave }) {
  const takenBy = {};
  for (const p of state.players) if (p.guildId) takenBy[p.guildId] = p;

  const ready = state.players.filter((p) => p.guildId).length >= 2;

  return (
    <div className="lobby">
      <header className="lobby__head">
        <h1>{T.lobby}</h1>
        <span className="lobby__code numeric">{state.code}</span>
      </header>

      <p className="lobby__note">
        {isLeader ? T.hostOnly : T.turnOrderNote}
      </p>

      <ul className="guilds">
        {[...guilds]
          .sort((a, b) => (b.foundedYear ?? -Infinity) - (a.foundedYear ?? -Infinity))
          .map((g) => {
            const holder = takenBy[g.id];
            const mine = holder?.id === me?.id;
            const free = !holder;

            return (
              <li key={g.id}>
                <button
                  className={[
                    'guild',
                    mine ? 'guild--mine' : '',
                    !free && !mine ? 'guild--taken' : '',
                  ].join(' ')}
                  style={{ '--team': g.color }}
                  // The host referees, so for them the roster is a read-out of
                  // who has claimed what rather than something to pick from.
                  disabled={isLeader || (!free && !mine)}
                  onClick={() => send('req_set_guild', { guildId: mine ? null : g.id })}
                >
                  <span className="guild__dot" aria-hidden="true" />
                  <span className="guild__name">
                    <strong>{g.name}</strong>
                    <em>{g.city} · {T.founded} {g.foundedYear ?? '?'}</em>
                  </span>
                  <span className="guild__who">
                    {mine ? '✓' : holder ? holder.name : ''}
                  </span>
                </button>
              </li>
            );
          })}
      </ul>

      <ul className="lobby__players">
        {state.players.map((p) => (
          <li key={p.id} className={p.connected ? '' : 'is-gone'}>
            {p.name}
            {p.role === 'LEADER' && <em> · {T.leader}</em>}
            {p.id === me?.id && <em> · sinä</em>}
          </li>
        ))}
      </ul>

      {isLeader ? (
        <div className="lobby__actions">
          <button className="btn btn--quiet" onClick={onLeave}>{T.changeRoom}</button>
          <button className="btn btn--quiet" onClick={() => send('req_leader_override', { op: 'RANDOMIZE_GUILDS' })}>
            {T.randomize}
          </button>
          <button
            className="btn btn--primary"
            disabled={!ready}
            onClick={() => send('req_start_game', {})}
          >
            {T.startGame}
          </button>
          {!ready && <p className="lobby__hint">{T.needTwoGuilds}</p>}
        </div>
      ) : (
        <div className="lobby__actions">
          <p className="lobby__hint">{T.waitingForLeader}</p>
          <button className="btn btn--quiet" onClick={onLeave}>{T.changeRoom}</button>
        </div>
      )}
    </div>
  );
}
